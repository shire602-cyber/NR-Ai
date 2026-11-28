/* global process, console, fetch, AbortSignal */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { connectScratchTarget } from "./scratch-target.mjs";

const database = await connectScratchTarget();
await database.end();

// The per-boot version marker ties the responses to this specific child even
// if another process takes the port between releasing the reservation and listen.
const version = "rehearsal-" + randomBytes(16).toString("hex");
const reservation = createServer();
const port = await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", () => {
    const address = reservation.address();
    reservation.close((error) => {
      if (error) reject(error);
      else if (!address || typeof address === "string") reject(new Error("No TCP port reserved"));
      else resolve(address.port);
    });
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    APP_VERSION: version,
    NODE_ENV: "production",
    AUTO_MIGRATE_ON_BOOT: "false",
    // The disposable boot check has no object-storage credentials.
    ALLOW_LOCAL_STORAGE: "true",
  },
  stdio: ["ignore", "inherit", "inherit"],
});
let stopped;
const closed = new Promise((resolve) => {
  server.on("error", (error) => {
    stopped = error.message;
  });
  server.once("close", (code, signal) => {
    stopped ??= signal ?? `exit ${code}`;
    resolve();
  });
});

async function probe(path, valid) {
  const response = await fetch(base + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(1000),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  if (!valid(await response.json())) throw new Error(`${path}: unexpected response`);
}

try {
  const deadline = Date.now() + 60_000;
  let lastError;
  do {
    if (stopped) throw new Error(`Server stopped before readiness (${stopped})`);
    try {
      await probe(
        "/health/ready",
        (body) => body?.status === "ok" && body.checks?.database === "ok"
      );
      await probe(
        "/api/version",
        (body) =>
          body?.status === "ok" && body.environment === "production" && body.version === version
      );
      if (stopped || server.exitCode !== null || server.signalCode !== null) {
        throw new Error(`Server stopped during readiness checks (${stopped ?? server.exitCode})`);
      }
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
    await Promise.race([delay(500), closed]);
  } while (Date.now() < deadline);
  if (lastError) {
    throw new Error(`Server did not pass readiness and version checks: ${lastError.message}`);
  }
  console.log("Production child reported database readiness and its version marker");
} finally {
  if (!stopped) {
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 5000);
    server.kill("SIGTERM");
    await closed;
    clearTimeout(forceStop);
  }
}
