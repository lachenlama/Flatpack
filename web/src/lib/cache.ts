type Entry = { at: number; value?: unknown; pending?: Promise<unknown> };
const store: Map<string, Entry> = ((globalThis as { __flatpackCache?: Map<string, Entry> }).__flatpackCache ??= new Map());

/**
 * Tiny in-memory TTL cache with in-flight de-duplication and stale-on-error. Server-side only (per instance).
 * @param key unique key
 * @param ttlMs freshness window in milliseconds
 * @param load loader called on a miss/expiry
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const e = store.get(key);
  if (e && e.pending) return e.pending as Promise<T>;
  if (e && e.value !== undefined && now - e.at < ttlMs) return e.value as T;
  const pending = load().then(
    (value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    },
    (err: unknown) => {
      if (e && e.value !== undefined) {
        store.set(key, { at: e.at, value: e.value });
        return e.value as T;
      }
      store.delete(key);
      throw err;
    },
  );
  store.set(key, { at: e?.at ?? 0, value: e?.value, pending });
  return pending;
}

/** Drops every cached entry (tests). */
export function clearCache(): void {
  store.clear();
}
