/**
 * Small browser-side UX cache for a server-enforced video-start quota.
 * This does not authorize requests, modify quotas, or contain any secrets.
 * Every actual video start is still checked by Supabase on the server.
 */
export const VIDEO_QUOTA_STORAGE_PREFIX = "daily-scripture:video-start-reset:v1:";
const MAX_RETRY_SECONDS = 86_400;
const STORAGE_HORIZON_MS = (MAX_RETRY_SECONDS + 60) * 1000;

export type QuotaStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): QuotaStorage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; }
  catch { return null; }
}

function key(userId: string): string | null {
  // Prevent shared-browser/account collisions; never store access tokens.
  return /^[0-9a-f-]{36}$/i.test(userId) ? `${VIDEO_QUOTA_STORAGE_PREFIX}${userId}` : null;
}

export function serverVideoResetAt(
  endpoint: string,
  status: number,
  retryAfter: unknown,
  now = Date.now(),
): number | null {
  if (endpoint !== "/api/study-video/sequence-start" || status !== 429 ||
    typeof retryAfter !== "number" || !Number.isInteger(retryAfter) ||
    retryAfter < 1 || retryAfter > MAX_RETRY_SECONDS || !Number.isFinite(now)) return null;
  return now + retryAfter * 1000;
}

export function readVideoQuotaReset(
  userId: string,
  now = Date.now(),
  storage: QuotaStorage | null = defaultStorage(),
): number | null {
  const id = key(userId);
  if (!id || !storage) return null;
  try {
    const raw = storage.getItem(id);
    if (raw === null) return null;
    const timestamp = Number(raw);
    if (Number.isSafeInteger(timestamp) && timestamp > now && timestamp - now <= STORAGE_HORIZON_MS) return timestamp;
    storage.removeItem(id);
  } catch { /* Quota UX remains optional when storage is disabled. */ }
  return null;
}

export function storeVideoQuotaReset(
  userId: string,
  resetAt: number,
  now = Date.now(),
  storage: QuotaStorage | null = defaultStorage(),
): void {
  const id = key(userId);
  if (!id || !storage || !Number.isSafeInteger(resetAt) ||
    resetAt <= now || resetAt - now > STORAGE_HORIZON_MS) return;
  try { storage.setItem(id, String(resetAt)); }
  catch { /* Server remains authoritative. */ }
}

export function formatVideoQuotaReset(resetAt: number): string {
  return new Date(resetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export class VideoQuotaError extends Error {
  constructor(message: string, readonly resetAt: number) {
    super(message);
    this.name = "VideoQuotaError";
  }
}
