/* global process, console, fetch, AbortSignal */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

// Choose a free port so an existing app cannot satisfy the probe.
const reservation = createServer();
const port = await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", () => {
    const { port } = reservation.address();
    reservation.close((error) => (error ? reject(error) : resolve(port)));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, PORT: String(port) },
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

async function probe(path) {
  const response = await fetch(base + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(1000),
  });
  await response.body?.cancel();
  if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`);
}

try {
  const deadline = Date.now() + 60_000;
  let lastError;
  do {
    if (stopped) throw new Error(`Server stopped before readiness (${stopped})`);
    try {
      await probe("/health/ready");
      await probe("/api/version");
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
  if (stopped) throw new Error(`Server stopped during readiness checks (${stopped})`);
  console.log("/health/ready and /api/version returned HTTP 200");
} finally {
  if (!stopped) {
    // Give the production shutdown handler a chance to release its resources.
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 5000);
    server.kill("SIGTERM");
    await closed;
    clearTimeout(forceStop);
  }
}
