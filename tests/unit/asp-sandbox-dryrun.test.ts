import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { FAKE_PASSWORD } from "../fixtures/credentials/fake-credentials";

const script = "scripts/ops/asp-sandbox-dryrun.ts";

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | string; stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        process.execPath,
        ["--import", "tsx", script, ...args],
        {
          timeout: 15_000,
          env: {
            PATH: process.env.PATH,
            DOTENV_CONFIG_PATH: "/nonexistent/asp-dryrun-test.env",
            DOTENV_CONFIG_QUIET: "true",
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://postgres@127.0.0.1:1/dryrun",
            LOG_LEVEL: "fatal",
            ...env,
          },
        },
        (error, stdout, stderr) => {
          if (error?.killed) return reject(error);
          resolve({ code: error?.code ?? 0, stdout, stderr });
        }
      );
    }
  );
}

async function withMock(
  reply: (method: string, path: string, body: string) => { status?: number; body: unknown },
  test: (origin: string, requests: string[]) => Promise<void>
) {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const method = req.method ?? "";
    const path = req.url ?? "";
    requests.push(`${method} ${path}`);
    const response = reply(method, path, Buffer.concat(chunks).toString("utf8"));
    res.writeHead(response.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests);
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("ASP sandbox dry run status", () => {
  it.each(["sandbox", "production"])(
    "polls the Complyance document ID and verifies a %s status response",
    async (environment) => {
      const id = "01K5EXAMPLE00000000000142";
      let documentNumber: string;
      await withMock(
        (method, path, body) => {
          if (method === "POST" && path === "/api/v3/unify") {
            documentNumber = JSON.parse(body).payload.header.documentNumber;
            return { body: { documentId: id, documentNumber } };
          }
          if (method === "GET" && path === `/api/v3/documents/${id}?type=sales`) {
            return {
              body: {
                success: true,
                data: { documentId: id, documentNumber, environment, state: "submitted" },
              },
            };
          }
          return { status: 404, body: {} };
        },
        async (origin, requests) => {
          const result = await run(["--provider", "complyance", "--status"], {
            COMPLYANCE_API_KEY: "loopback-fixture",
            COMPLYANCE_BASE_URL: origin,
          });
          expect(requests, result.stderr).toEqual([
            "POST /api/v3/unify",
            `GET /api/v3/documents/${id}?type=sales`,
          ]);
          expect(result.code, result.stdout).toBe(environment === "sandbox" ? 0 : 1);
        }
      );
    },
    20_000
  );

  it("returns failure when the A-Cube POST succeeds but the GET is unavailable", async () => {
    const id = "8c7d6e5f-c4b3-4210-a987-6543210abcde";
    await withMock(
      (method, path) => {
        if (method === "POST" && path === "/login") return { body: { token: "fixture-token" } };
        if (method === "POST" && path === "/invoices")
          return { status: 201, body: { uuid: id, status: "processed" } };
        return { status: 503, body: {} };
      },
      async (origin, requests) => {
        const result = await run(["--provider", "acube", "--status"], {
          ACUBE_EMAIL: "fixture@example.test",
          ACUBE_PASSWORD: FAKE_PASSWORD,
          ACUBE_BASE_URL: origin,
          ACUBE_LOGIN_URL: `${origin}/login`,
        });
        expect(requests, result.stderr).toEqual([
          "POST /login",
          "POST /invoices",
          `GET /invoices/${id}`,
        ]);
        expect(result.code, result.stdout).toBe(1);
      }
    );
  }, 20_000);

  it("returns failure when no status read could run", async () => {
    const result = await run(["--provider", "complyance", "--status"]);
    expect(result.code, result.stdout).toBe(1);
  }, 20_000);
});
