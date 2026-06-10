/**
 * Tiny in-memory LRU cache with TTL. Used where we would otherwise hit a
 * paid external API (OpenAI) with repeating identical inputs. Single-process
 * only — if you scale to multiple replicas you'll want Redis or similar.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<K, V> {
  private store = new Map<K, Entry<V>>();

  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {
    if (maxEntries <= 0) throw new Error('maxEntries must be > 0');
    if (ttlMs <= 0) throw new Error('ttlMs must be > 0');
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency (Map iteration order is insertion order).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
