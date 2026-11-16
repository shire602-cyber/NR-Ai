/**
 * R20-09: ai.routes.ts and firm.routes.ts were monoliths (2,570 / 2,412 lines). Handlers now
 * live in sub-domain modules under server/routes/ai/ and server/routes/firm/, while every
 * registration (method, path, middleware chain and order) stays in the parent module. These
 * tests pin the registered route table so the split cannot silently drop, reorder or re-guard a
 * route, and keep each module under the size budget.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { describe, expect, it } from "vitest";
import { registerAIRoutes } from "../../server/routes/ai.routes";
import { registerFirmRoutes } from "../../server/routes/firm.routes";

const root = process.cwd();
const lines = (file: string) => readFileSync(join(root, file), "utf8").split("\n").length;

type Layer = {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name: string } }>;
  };
  name: string;
  handle: { name: string; stack?: Layer[] };
  regexp?: RegExp;
};

/** METHOD path [middleware/handler names] in registration order, including routers mounted on the app. */
function routeTable(register: (app: express.Express) => void): string[] {
  const app = express();
  register(app);
  const out: string[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        const methods = Object.keys(layer.route.methods).join(",").toUpperCase();
        const chain = layer.route.stack.map((l) => l.handle.name || "<anonymous>").join(",");
        out.push(`${methods} ${paths.map((p) => prefix + p).join("|")} [${chain}]`);
      } else if (layer.name === "router" && layer.handle.stack) {
        out.push(`USE-ROUTER ${prefix}`);
        walk(layer.handle.stack, prefix + "/api");
      } else if (prefix) {
        out.push(`USE ${prefix} ${layer.name}`);
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, "");
  return out;
}

/** Registered AI route table, captured from the pre-split ai.routes.ts. */
const AI_TABLE = [
  "POST /api/ai/categorize [authMiddleware,<anonymous>,requireCustomer,<anonymous>]",
  "POST /api/ai/parse-bank-statement [authMiddleware,<anonymous>,<anonymous>]",
  "POST /api/ai/cfo-advice [authMiddleware,<anonymous>,requireCustomer,<anonymous>,<anonymous>]",
  "POST /api/ai/batch-categorize [authMiddleware,<anonymous>,requireCustomer,<anonymous>]",
  "POST /api/ai/detect-anomalies [authMiddleware,<anonymous>,requireCustomer,<anonymous>]",
  "GET /api/companies/:companyId/anomaly-alerts [authMiddleware,requireCustomer,<anonymous>]",
  "POST /api/anomaly-alerts/:id/resolve [authMiddleware,requireCustomer,<anonymous>]",
  "POST /api/ai/reconcile [authMiddleware,<anonymous>,requireCustomer,<anonymous>]",
  "POST /api/bank-transactions/:id/reconcile [authMiddleware,<anonymous>]",
  "GET /api/companies/:companyId/bank-transactions [authMiddleware,requireCustomer,<anonymous>]",
  "POST /api/companies/:companyId/bank-transactions [authMiddleware,requireCustomer,<anonymous>,<anonymous>]",
  "POST /api/companies/:companyId/bank-transactions/import [authMiddleware,requireCustomer,<anonymous>,<anonymous>]",
  "POST /api/ai/forecast-cashflow [authMiddleware,<anonymous>,requireCustomer,<anonymous>,<anonymous>]",
  "GET /api/companies/:companyId/forecasts [authMiddleware,<anonymous>,<anonymous>]",
  "POST /api/ai/classification-feedback [authMiddleware,<anonymous>]",
  "POST /api/ai/autopilot/process [authMiddleware,<anonymous>,requireCustomer,<anonymous>]",
  "GET /api/ai/classifier-stats [authMiddleware,requireCustomer,<anonymous>]",
  "GET /api/ai/classifier-config [authMiddleware,requireCustomer,<anonymous>]",
  "PATCH /api/ai/classifier-config [authMiddleware,requireCustomer,<anonymous>]",
  "POST /api/ai/nl-gateway [authMiddleware,<anonymous>,<anonymous>]",
  "POST /api/ask|/api/ai/chat [authMiddleware,<anonymous>,<anonymous>]",
  "GET /api/ask/history [authMiddleware,<anonymous>]",
  "GET /api/autocomplete/accounts [authMiddleware,<anonymous>]",
  "GET /api/autocomplete/customers [authMiddleware,<anonymous>]",
  "GET /api/autocomplete/merchants [authMiddleware,<anonymous>]",
  "GET /api/autocomplete/descriptions [authMiddleware,<anonymous>]",
  "POST /api/ai/smart-suggest [authMiddleware,<anonymous>,<anonymous>]",
];
/** Registered firm route table, captured from the pre-split firm.routes.ts. */
const FIRM_TABLE = [
  "USE-ROUTER ",
  "USE /api authMiddleware",
  "USE /api <anonymous>",
  "GET /api/firm/clients [<anonymous>]",
  "GET /api/firm/clients/:companyId/summary [<anonymous>]",
  "POST /api/firm/clients [<anonymous>,<anonymous>,<anonymous>]",
  "PUT /api/firm/clients/:companyId [<anonymous>,<anonymous>,<anonymous>]",
  "POST /api/firm/clients/:companyId/assign-staff [<anonymous>,<anonymous>,<anonymous>]",
  "GET /api/firm/staff [<anonymous>]",
  "GET /api/firm/bookkeeper-dashboard [<anonymous>]",
  "GET /api/firm/health [<anonymous>]",
  "GET /api/firm/health/deadlines [<anonymous>]",
  "POST /api/firm/clients/:companyId/switch [<anonymous>]",
  "DELETE /api/firm/clients/:companyId [<anonymous>,<anonymous>]",
  "POST /api/firm/clients/import [<anonymous>,<anonymous>]",
  "GET /api/firm/overview [<anonymous>]",
];

describe("route module split (R20-09)", () => {
  it("[R20-09] ai and firm route modules stay within 1,200 lines", () => {
    const files = [
      "server/routes/ai.routes.ts",
      "server/routes/firm.routes.ts",
      ...readdirSync(join(root, "server/routes/ai")).map((f) => `server/routes/ai/${f}`),
      ...readdirSync(join(root, "server/routes/firm")).map((f) => `server/routes/firm/${f}`),
    ];
    const oversized = files
      .map((file) => ({ file, lines: lines(file) }))
      .filter((f) => f.lines > 1200);
    expect(oversized).toEqual([]);
  });

  it("[R20-09] AI routes register the same paths, order and middleware counts", () => {
    expect(routeTable((app) => registerAIRoutes(app, { openaiClient: null }))).toEqual(AI_TABLE);
  });

  it("[R20-09] firm routes keep the /firm auth + firm-access guard ahead of every route", () => {
    expect(routeTable(registerFirmRoutes)).toEqual(FIRM_TABLE);
  });
});
