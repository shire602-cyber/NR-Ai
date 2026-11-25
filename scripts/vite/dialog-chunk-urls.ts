import path from "node:path";
import type { Plugin } from "vite";

/**
 * Build step behind `client/src/lib/dialogChunk.ts`.
 *
 * A page that loads an on-demand dialog keeps its literal `import("...Dialog")` (so the bundler
 * still splits, hashes and preloads the chunk) and, for a retry after a failed load, imports the
 * same chunk under a fresh query string. That needs the chunk's URL without parsing an error
 * message (older Safari does not name it). The page therefore holds a marker string
 * (`__MUHASIB_DIALOG_CHUNK__<Name>__`); this plugin replaces it, per rendered chunk, with the
 * POSIX path from that chunk to the dialog chunk it dynamically imports. The page resolves it with
 * `new URL(path, import.meta.url)`, so the URL is the one the bundler emitted (hash included).
 */

export const DIALOG_MARKER_PATTERN = /__MUHASIB_DIALOG_CHUNK__([A-Za-z0-9]+)__/g;

interface ChunkLike {
  fileName: string;
  dynamicImports: string[];
}
type ChunkMeta = Record<string, { facadeModuleId?: string | null } | undefined>;

/** Relative URL path from one emitted file to another (always `./` or `../` prefixed). */
export function relativeChunkPath(fromFile: string, toFile: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** The dynamic import of `chunk` that is the `name` dialog module; throws unless exactly one. */
export function findDialogImport(chunk: ChunkLike, name: string, meta: ChunkMeta = {}): string {
  const source = new RegExp(`[\\\\/]${name}\\.tsx?$`);
  const base = new RegExp(`^${name}[-.]`);
  const matches = chunk.dynamicImports.filter((file) => {
    const facade = meta[file]?.facadeModuleId;
    if (facade) return source.test(facade);
    return base.test(path.posix.basename(file));
  });
  if (matches.length !== 1) {
    throw new Error(
      `dialog-chunk-urls: ${chunk.fileName} refers to dialog "${name}" but dynamically imports ` +
        `${matches.length} matching chunks (${chunk.dynamicImports.join(", ") || "none"}). ` +
        `Keep a literal import("...${name}") in the same module as the marker.`
    );
  }
  return matches[0];
}

/** Replace every marker in `code`; returns null when there is none. */
export function replaceDialogMarkers(
  code: string,
  chunk: ChunkLike,
  meta: ChunkMeta = {}
): string | null {
  if (!code.includes("__MUHASIB_DIALOG_CHUNK__")) return null;
  const out = code.replace(DIALOG_MARKER_PATTERN, (_all, name: string) =>
    relativeChunkPath(chunk.fileName, findDialogImport(chunk, name, meta))
  );
  if (out.includes("__MUHASIB_DIALOG_CHUNK__")) {
    throw new Error(`dialog-chunk-urls: unresolved dialog marker left in ${chunk.fileName}`);
  }
  return out;
}

export function dialogChunkUrls(): Plugin {
  return {
    name: "dialog-chunk-urls",
    apply: "build",
    renderChunk(code, chunk, _options, meta) {
      const out = replaceDialogMarkers(
        code,
        chunk,
        (meta as { chunks?: ChunkMeta } | undefined)?.chunks ?? {}
      );
      return out === null ? null : { code: out, map: null };
    },
  };
}
