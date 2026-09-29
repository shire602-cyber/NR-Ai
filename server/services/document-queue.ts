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
