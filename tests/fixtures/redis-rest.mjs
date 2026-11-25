import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Short-lived certificates are trusted only by the app processes under test.
export function createRedisRestCertificate(directory) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=redis-rest",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:redis-rest",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
    ],
    { stdio: "ignore" }
  );
}

// Implement the app's Redis throttle commands at the REST boundary. Unknown
// commands fail the request so changes to the transport surface in CI.
function throttleCommands() {
  const sortedSets = new Map();
  const counters = new Map();
  return ([command, ...args]) => {
    const [key, member] = args;
    if (command === "DEL") {
      return Number(sortedSets.delete(key)) + Number(counters.delete(key));
    }
    if (command === "ZREM") return Number(sortedSets.get(key)?.delete(member) ?? false);
    if (command === "ZPOPMAX") {
      const hits = sortedSets.get(key);
      const latest = hits && [...hits].sort(([a, x], [b, y]) => y - x || b.localeCompare(a))[0];
      if (!latest) return [];
      hits.delete(latest[0]);
      return latest;
    }
    const [script, keyCount, bucketKey, horizon, ...argv] = args;
    if (command !== "EVAL" || keyCount !== 1) throw new Error("Unsupported fixture command");

    const now = Date.now();
    if (script.includes('redis.call("PTTL", key)')) {
      const [action, max] = argv;
      const previous = counters.get(bucketKey);
      const current = previous?.expiresAt > now ? previous : undefined;
      if (action === "peek") return [current?.count ?? 0, 0];
      const count = (current?.count ?? 0) + 1;
      const expiresAt = current?.expiresAt ?? now + horizon;
      if (!max || count <= max) counters.set(bucketKey, { count, expiresAt });
      return [count, expiresAt - now];
    }

    const hits = sortedSets.get(bucketKey) ?? new Map();
    sortedSets.set(bucketKey, hits);
    for (const [id, at] of hits) {
      if (at <= now - horizon) hits.delete(id);
    }
    if (script.includes('redis.call("ZRANGE", key, 0, 0, "WITHSCORES")')) {
      const [max, id] = argv;
      const count = hits.size + 1;
      if (hits.size < max) hits.set(id, now);
      return [count, hits.values().next().value + horizon];
    }
    if (script.includes('redis.call("ZRANGEBYSCORE", key,')) {
      const [id, ...rules] = argv;
      const retryAfter = () => {
        let retry = 0;
        for (let i = 0; i < rules.length; i += 2) {
          const [max, window] = [rules[i], rules[i + 1]];
          const recent = [...hits.values()].filter((at) => at > now - window);
          if (recent.length >= max) {
            retry = Math.max(retry, recent[recent.length - max] + window - now);
          }
        }
        return retry;
      };
      const before = retryAfter();
      if (id && !before) hits.set(id, now);
      const after = retryAfter();
      return [after, hits.size, Number(Boolean(id && !before && after))];
    }
    throw new Error("Unsupported fixture script");
  };
}

export async function startRedisRestFixture({ directory, token, host = "127.0.0.1", port = 0 }) {
  if (!token) throw new Error("A throwaway Redis REST fixture token is required");
  const command = throttleCommands();
  const cert = join(directory, "cert.pem");
  const server = createServer(
    {
      key: readFileSync(join(directory, "key.pem")),
      cert: readFileSync(cert),
    },
    async (req, res) => {
      const json = (status, body) =>
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      if (req.method !== "POST" || req.url !== "/") return json(404, { error: "Unknown endpoint" });
      if (req.headers.authorization !== `Bearer ${token}`) {
        return json(401, { error: "Invalid fixture token" });
      }
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const args = JSON.parse(Buffer.concat(chunks).toString());
        return json(200, { result: command(args) });
      } catch (error) {
        return json(400, { error: error.message });
      }
    }
  );
  server.listen(port, host);
  await once(server, "listening");
  return {
    env: {
      UPSTASH_REDIS_REST_URL: `https://${host}:${server.address().port}`,
      UPSTASH_REDIS_REST_TOKEN: token,
      NODE_EXTRA_CA_CERTS: cert,
    },
    close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      return closed;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, directory, host, port] = process.argv.slice(2);
  if (action === "cert") createRedisRestCertificate(directory);
  else if (action === "serve") {
    await startRedisRestFixture({
      directory,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      host,
      port: Number(port),
    });
  } else throw new Error("Expected cert or serve");
}
