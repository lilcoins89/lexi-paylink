const buckets = new Map<string, { count: number; resetAt: number }>();

export function enforceRateLimit(key: string, limit = 12, windowMs = 60_000): void {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) throw new Error("Too many requests. Please wait before trying again.");
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
}
