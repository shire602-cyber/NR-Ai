#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const repoRoot = process.cwd();
const today = new Date().toISOString().slice(0, 10);
const dbHost = "127.0.0.1";
const requestedAppPort = process.env.BENCHMARK_APP_PORT
  ? Number(process.env.BENCHMARK_APP_PORT)
  : 0;
const requestedDbPort = Number(process.env.PGLITE_PORT || "55432");
let appPort = requestedAppPort;
let dbPort = requestedDbPort;
let baseUrl = "";
let databaseUrl = "";
const outputDir = process.env.BENCHMARK_OUTPUT_DIR || `docs/qa/${today}-benchmark-audit-local`;
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const pgliteBin = path.join(repoRoot, "node_modules", ".bin", `pglite-server${binSuffix}`);

const runtimeSecret = randomBytes(32).toString("hex");
const children = new Set();

function log(message) {
  console.log(`[benchmark-local] ${message}`);
}

function childEnv(extra = {}) {
  const frontendUrl = process.env.FRONTEND_URL || baseUrl || "http://localhost:5173";
  const corsOrigins = [frontendUrl, "http://localhost:5173", "http://127.0.0.1:5173"];
  if (process.env.CORS_ORIGIN) corsOrigins.unshift(process.env.CORS_ORIGIN);

  return {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(appPort),
    DATABASE_URL: databaseUrl,
    E2E_DATABASE_URL: databaseUrl,
    SESSION_SECRET: process.env.SESSION_SECRET || runtimeSecret,
    JWT_SECRET: process.env.JWT_SECRET || runtimeSecret,
    FRONTEND_URL: frontendUrl,
    CORS_ORIGIN: corsOrigins.join(","),
    AUTH_PUBLIC_URL: process.env.AUTH_PUBLIC_URL || frontendUrl,
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    AUTO_MIGRATE_ON_BOOT: process.env.AUTO_MIGRATE_ON_BOOT || "true",
    BENCHMARK_OUTPUT_DIR: outputDir,
    BASE_URL: baseUrl,
    ...extra,
  };
}

function spawnLogged(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: childEnv(options.env),
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const prefix = `[${label}]`;
  child.stdout?.on("data", (chunk) => process.stdout.write(`${prefix} ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`${prefix} ${chunk}`));
  child.on("exit", () => children.delete(child));
  return child;
}

function runCommand(label, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnLogged(label, command, args, options);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} exited with ${signal || code}`));
      }
    });
  });
}

async function waitForDatabase(timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2500 });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for PGlite database: ${lastError?.message || "unknown"}`);
}

async function waitForHealth(timeoutMs = 90000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`/health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for app health: ${lastError?.message || "unknown"}`);
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      server.close(resolve);
    });
    server.listen(port, dbHost);
  });
}

async function findAvailablePort(preferredPort, explicit) {
  if (!preferredPort) {
    return await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.once("listening", () => {
        const address = server.address();
        server.close(() => resolve(address.port));
      });
      server.listen(0, dbHost);
    });
  }

  try {
    await assertPortAvailable(preferredPort);
    return preferredPort;
  } catch (error) {
    if (explicit) {
      throw new Error(`Port ${preferredPort} is not available: ${error.message}`);
    }
  }

  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.listen(0, dbHost);
  });
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  log(`Stopping ${label}...`);
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function cleanup() {
  for (const child of [...children].reverse()) {
    await stopChild(child, "child process");
  }
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

let dbServer = null;
let appServer = null;

try {
  await fs.mkdir(path.dirname(path.resolve(repoRoot, outputDir)), { recursive: true });
  appPort = await findAvailablePort(requestedAppPort, Boolean(process.env.BENCHMARK_APP_PORT));
  dbPort = await findAvailablePort(requestedDbPort, Boolean(process.env.PGLITE_PORT));
  baseUrl = `http://localhost:${appPort}`;
  databaseUrl = `postgresql://postgres:postgres@${dbHost}:${dbPort}/postgres?sslmode=disable`;
  if (!process.env.BENCHMARK_APP_PORT) {
    log(`Using app port ${appPort}. Set BENCHMARK_APP_PORT to force a fixed port.`);
  } else if (appPort !== requestedAppPort) {
    log(`Port ${requestedAppPort} is busy; using app port ${appPort}.`);
  }
  if (dbPort !== requestedDbPort) {
    log(`Port ${requestedDbPort} is busy; using database port ${dbPort}.`);
  }

  log(`Starting PGlite socket database on ${dbHost}:${dbPort}...`);
  dbServer = spawnLogged("pglite", pgliteBin, [
    "--db=memory://",
    `--port=${dbPort}`,
    `--host=${dbHost}`,
    "--max-connections=30",
  ]);
  await waitForDatabase();

  log("Running migrations...");
  await runCommand("migrate", "npm", ["run", "db:migrate"]);

  log(`Starting app on ${baseUrl}...`);
  appServer = spawnLogged("app", "npm", ["run", "dev"]);
  await waitForHealth();

  log("Running full local benchmark audit...");
  await runCommand("benchmark", "npm", ["run", "e2e:benchmark-audit", "--", baseUrl], {
    env: {
      BENCHMARK_RUN_FIXTURE: "true",
      BENCHMARK_CRAWL_PROFILE: process.env.BENCHMARK_CRAWL_PROFILE || "all",
      BENCHMARK_OUTPUT_DIR: outputDir,
    },
  });

  log(`Benchmark complete. Evidence: ${outputDir}`);
} finally {
  await stopChild(appServer, "app");
  await stopChild(dbServer, "PGlite");
  await cleanup();
}
