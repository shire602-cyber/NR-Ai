// In-process queue, one chain per key.
//
// withDocumentLock opens a transaction and then waits for a Postgres advisory
// lock. Every waiter holds a pooled connection while it waits, and the holder
// needs further connections for its own reads, so N parallel requests for one
// document on a pool of N starve it: the holder waits for a connection until
// the pool's 10 s timeout and fails. Queueing same-key callers here, before a
// connection is taken, keeps pool use per document constant. The advisory lock
// still guards against other processes.

const tails = new Map<string, Promise<unknown>>();

export async function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}

// Process-wide cap on document transactions that hold one pooled connection and
// then need another (withDocumentLock: the transaction itself, plus the reads
// and the journal insert made through the shared pool). With a pool of N, N
// such requests in parallel each hold one connection, none can get the second,
// and every one fails at the pool's 10 s timeout. Capping them at about half the
// pool always leaves connections for the second step (and for a period lock,
// which needs one connection of its own while postings wait behind it).

function postingSlots(): number {
  const raw = Number.parseInt(process.env.DB_POOL_MAX ?? "", 10);
  const poolMax = Number.isFinite(raw) && raw > 0 ? raw : 10;
  return Math.max(1, Math.floor(poolMax / 2) - 1);
}

let active = 0;
const waiting: Array<() => void> = [];

export async function runInPostingSlot<T>(fn: () => Promise<T>, capacity = postingSlots()): Promise<T> {
  if (active >= capacity) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else active--;
  }
}
