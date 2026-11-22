import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";
import { fileURLToPath } from "url";
import { LOCALE_COOKIE, SHELL_BOOT_API, firmFirstScreen } from "../shared/firm-boot";
import { accessCookieName, refreshCookieName } from "./services/auth-cookies.service";
import { features, tools } from "../client/src/components/marketing/phase/content";
import { editorialPath } from "../client/src/components/marketing/phase/editorial/pages";
import { siteLocale } from "../client/src/components/marketing/phase/routes";
import { BANK_STATEMENT_ENTRY, isRetiredBankReturnPath } from "../shared/bank-statement-routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/**
 * Crawler / security-contact files the app does not publish. They must answer
 * 404 rather than fall through to the SPA shell (a 200 text/html soft 404 reads
 * as a real sitemap or security.txt). If a real file is ever added under
 * client/public, the static middleware serves it first and this never runs.
 */
const UNPUBLISHED_FILE_PATHS = new Set(["/sitemap.xml", "/llms.txt", "/.well-known/security.txt"]);

export function rejectUnpublishedFiles(req: Request, res: Response, next: NextFunction) {
  if ((req.method === "GET" || req.method === "HEAD") && UNPUBLISHED_FILE_PATHS.has(req.path)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  next();
}

const marketingPaths = new Set([
  "",
  "/book-a-demo",
  "/pricing",
  "/solutions/small-business",
  "/solutions/accounting-firms",
  ...features.map(({ slug }) => `/product/${slug}`),
  ...tools.map(({ slug }) => `/tools/${slug}`),
]);

function decodeUnreserved(pathname: string): string {
  return pathname.replace(/%[\da-f]{2}/gi, (encoded) => {
    const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
    return /^[a-z0-9._~-]$/i.test(character) ? character : encoded;
  });
}

function redirectRetiredBankReturn(req: Request, res: Response, next: NextFunction) {
  if ((req.method === "GET" || req.method === "HEAD") && isRetiredBankReturnPath(decodeUnreserved(req.path))) {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.redirect(303, BANK_STATEMENT_ENTRY);
    return;
  }
  next();
}

/** Keep the localized error page renderable while reporting its status to HTTP clients. */
function documentStatus(url: string): 200 | 404 {
  const pathname = url.split(/[?#]/, 1)[0];
  if (!siteLocale(decodeUnreserved(pathname))) return 200;
  let localPath: string;
  try {
    // Match Wouter's decoding without treating encoded delimiters as path separators.
    localPath = decodeURI(pathname).slice(3).replace(/\/$/, "");
  } catch {
    return 404;
  }
  return marketingPaths.has(localPath) || editorialPath(localPath) ? 200 : 404;
}

/**
 * Set up Vite dev server (development only).
 * Uses dynamic imports so vite/nanoid are NOT loaded in production.
 */
export async function setupVite(app: Express, server: Server) {
  // Dynamic imports — these packages are devDependencies
  const { createServer: createViteServer, createLogger } = await import("vite");
  const { nanoid } = await import("nanoid");

  const viteLogger = createLogger();

  const vite = await createViteServer({
    configFile: path.resolve(projectRoot, "vite.config.ts"),
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
      },
    },
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: "custom",
  });

  app.use(redirectRetiredBankReturn);
  app.use(vite.middlewares);
  app.use(rejectUnpublishedFiles);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(projectRoot, "client", "index.html");

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${nanoid()}"`);
      const page = await vite.transformIndexHtml(url, template);
      res.status(documentStatus(url)).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

/**
 * Serve static production build (production only).
 * No dev dependencies required.
 *
 * Caching strategy is deliberate:
 *   - /assets/* — vite-hashed files, content-addressed → cache forever (1y, immutable)
 *   - / and *.html — entry document, must always be fresh so the user picks up
 *     new bundle hashes after a deploy. Without this Fastly was caching the
 *     post-build HTML for hours and pinning users to a stale bundle even
 *     after the pod restarted with a new image.
 *
 * The `Surrogate-Control` and `CDN-Cache-Control` headers are specifically
 * honored by Fastly (Railway's CDN) and override the upstream Cache-Control
 * for the edge cache only — the browser still sees no-store.
 */
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Surrogate-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * The firm workspace (`/firm`, `/firm/*`) is served from a second build of the same sources
 * (`FIRM_BUILD=1`, vite.config.ts) whose entry chunk already contains the signed-in app and the
 * two firm landing screens, so a phone fetches about a dozen files instead of about fifty. Its
 * document is `firm.html`; everything else (public, portal, no-login links, client books) keeps
 * `index.html` and the main bundle.
 *
 * For the two landing screens (shared/firm-boot.ts) the document additionally
 *  - preloads the first-screen catalogs of the language named by the functional language cookie,
 *    so they download with the entry chunk instead of after it has run, and
 *  - for a visitor who carries a session cookie, starts the reads the screen paints from before any
 *    script has run (an inline, nonce-bearing script handing the promises to the app through
 *    `window.__bootFetch`; client/src/lib/bootFetch.ts adopts them).
 */
export interface FirmDocument {
  html: string;
  catalogs: Record<string, string[]>;
}

export function routeKey(url: string): string {
  const pathname = url.split(/[?#]/)[0] || "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function isFirmPath(url: string): boolean {
  return /^\/firm(\/|$)/.test(routeKey(url));
}

/** The language named by the functional language cookie, or null when absent or unknown. */
export function localeFromCookie(cookieHeader: string | undefined): "en" | "ar" | null {
  const m = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=(en|ar)(?:;|$)`).exec(cookieHeader ?? "");
  return m ? (m[1] as "en" | "ar") : null;
}

export function injectModulePreloads(html: string, files: readonly string[]): string {
  if (files.length === 0 || !html.includes("</head>")) return html;
  const links = files
    .map((file) => `<link rel="modulepreload" crossorigin href="/${file.replace(/^\//, "")}">`)
    .join("\n    ");
  return html.replace("</head>", `    ${links}\n  </head>`);
}

/**
 * Start `paths` (same-origin GETs, cookie session) from an inline script placed before the
 * blocking `theme-init.js`, handing the promises to the app through `window.__bootFetch`
 * (client/src/lib/bootFetch.ts adopts them). The paths are build-time constants, never user input.
 */
export function injectBootFetch(html: string, paths: readonly string[], nonce: string): string {
  const script =
    `<script nonce="${nonce}">(function(){var b=window.__bootFetch={};` +
    `${JSON.stringify(paths)}.forEach(function(u){b[u]=fetch(u,{credentials:"include"})` +
    `.catch(function(){})})})()</script>`;
  const viewport = /<meta name="viewport"[^>]*>/;
  return viewport.test(html)
    ? html.replace(viewport, (m) => `${m}\n    ${script}`)
    : html.replace("</head>", `    ${script}\n  </head>`);
}

export function loadFirmDocument(distPath: string): FirmDocument | null {
  try {
    const html = fs.readFileSync(path.resolve(distPath, "firm.html"), "utf-8");
    const { catalogs } = JSON.parse(
      fs.readFileSync(path.resolve(distPath, "firm-preloads.json"), "utf-8")
    ) as { catalogs?: Record<string, string[]> };
    return { html, catalogs: catalogs ?? {} };
  } catch {
    // No firm build (older build, test fixture): the firm workspace uses the main bundle.
    return null;
  }
}

/** The document for a firm path. */
export function renderFirmDocument(opts: {
  firm: FirmDocument;
  url: string;
  cookieHeader: string | undefined;
  hasSession: boolean;
  nonce: string;
}): string {
  const screen = firmFirstScreen(routeKey(opts.url));
  if (!screen) return opts.firm.html;
  const locale = localeFromCookie(opts.cookieHeader);
  let page = locale
    ? injectModulePreloads(opts.firm.html, opts.firm.catalogs[locale] ?? [])
    : opts.firm.html;
  if (opts.hasSession) {
    page = injectBootFetch(page, [...SHELL_BOOT_API, ...screen.api], opts.nonce);
  }
  return page;
}

/**
 * Serve `name.js.br` / `name.css.br` (written at build time by scripts/precompress-assets.mjs,
 * brotli quality 11) to browsers that accept brotli. They are about 15% smaller than the stream the
 * compression middleware would build on the fly, which is a visible part of a phone's first load.
 * Anything else (no `.br` file, gzip-only clients, other file types) falls through unchanged.
 */
export function precompressedAssets(assetsDir: string) {
  const root = path.resolve(assetsDir);
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const ext = path.extname(req.path);
    if (ext !== ".js" && ext !== ".css") return next();
    if (!/\bbr\b/.test(String(req.headers["accept-encoding"] ?? ""))) return next();
    let file: string;
    try {
      file = path.resolve(root, `.${decodeURIComponent(req.path)}`);
    } catch {
      return next();
    }
    if (!file.startsWith(root + path.sep) || !fs.existsSync(`${file}.br`)) return next();
    res.setHeader("Content-Encoding", "br");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.type(ext === ".js" ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8");
    res.sendFile(`${file}.br`, { cacheControl: false }, (err) => {
      if (err) next(err);
    });
  };
}

function loadMarketingDocument(distPath: string) {
  try {
    const html = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
    const { scripts, styles } = JSON.parse(
      fs.readFileSync(path.resolve(distPath, "marketing-preloads.json"), "utf-8")
    ) as { scripts: string[]; styles: string[] };
    const css = styles.filter((file) => !html.includes(`href="/${file}"`))
      .map((file) => `<link rel="stylesheet" crossorigin href="/${file}">`)
      .join("\n    ");
    return injectModulePreloads(
      html.replace("</head>", `    ${css}\n  </head>`),
      scripts.filter((file) => !html.includes(`href="/${file}"`))
    );
  } catch {
    return null;
  }
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(projectRoot, "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(redirectRetiredBankReturn);
  // Hashed assets — safe to cache aggressively because the filename changes
  // any time content does.
  for (const dir of ["assets", "firm-assets"]) {
    app.use(`/${dir}`, precompressedAssets(path.resolve(distPath, dir)));
    app.use(
      `/${dir}`,
      express.static(path.resolve(distPath, dir), {
        immutable: true,
        maxAge: "1y",
      })
    );
  }

  const marketingDocument = loadMarketingDocument(distPath);
  if (marketingDocument) {
    app.get("*", (req, res, next) => {
      const pathname = decodeUnreserved(routeKey(req.originalUrl));
      const locale = siteLocale(pathname);
      if (pathname !== "/" && !locale) return next();
      const cookies = req.cookies as Record<string, string> | undefined;
      if (pathname === "/" && (cookies?.[accessCookieName()] || cookies?.[refreshCookieName()])) {
        return next();
      }
      let html = marketingDocument;
      if (locale) {
        html = html.replace('<html lang="en">', `<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">`);
        if (pathname === `/${locale}`) {
          html = html.replace("</head>", `    <link rel="preload" as="image" fetchpriority="high" imagesrcset="/product/dashboard-${locale}-small.webp 720w, /product/dashboard-${locale}.webp 1280w" imagesizes="(max-width: 760px) calc(100vw - 34px), 56vw">\n  </head>`);
        }
      }
      res.status(documentStatus(req.originalUrl)).set(NO_STORE_HEADERS).type("html").send(html);
    });
  }

  // Everything else (favicon, manifest, robots, etc.) — short cache only.
  app.use(
    express.static(distPath, {
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.setHeader(k, v);
        }
      },
    })
  );

  app.use(rejectUnpublishedFiles);

  // SPA fallback — index.html is the entry document; must NEVER be cached
  // by the CDN or it pins users to a stale bundle hash forever.
  const firmDocument = loadFirmDocument(distPath);
  app.use("*", (req, res) => {
    for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.setHeader(k, v);
    if (firmDocument && req.method === "GET" && isFirmPath(req.originalUrl)) {
      const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
      res
        .status(200)
        .type("html")
        .send(
          renderFirmDocument({
            firm: firmDocument,
            url: req.originalUrl,
            cookieHeader: req.headers.cookie,
            hasSession: Boolean(cookies[accessCookieName()] || cookies[refreshCookieName()]),
            nonce: String(res.locals.cspNonce ?? ""),
          })
        );
      return;
    }
    res.status(documentStatus(req.originalUrl)).sendFile(path.resolve(distPath, "index.html"));
  });
}
