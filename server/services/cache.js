// Tiny in-memory TTL cache with LRU eviction. Weather data for a location
// never changes, so this saves repeated calls to rate-limited APIs.

export class TtlCache {
  constructor({ max = 200, ttlMs = 24 * 3600 * 1000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  /** Returns the cached value or computes it; concurrent callers share one promise. */
  async wrap(key, fn) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const p = fn().catch((err) => {
      this.map.delete(key);
      throw err;
    });
    this.set(key, p);
    return p;
  }
}
