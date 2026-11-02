/**
 * In-memory sliding-window rate limiter. Fine for a single server; swap for Redis
 * (e.g. Upstash) if you run more than one instance.
 */
const hits = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Drop stale keys so the map doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, times] of hits) {
    if (times.every((t) => t < cutoff)) hits.delete(key);
  }
}, 10 * 60 * 1000).unref();
