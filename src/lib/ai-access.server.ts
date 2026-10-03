import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AiFeature = "insights" | "ask_chapter" | "study_memory" | "narration" | "image";

type Limit = { hour: number; day: number };
type FeatureQuota = {
  hourBucket: string;
  hourCount: number;
  dayBucket: string;
  dayCount: number;
};

type AiAccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 429 | 503; error: string; retryAfter?: number };

const LIMITS: Record<AiFeature, Limit> = {
  insights: { hour: 24, day: 80 },
  ask_chapter: { hour: 60, day: 200 },
  study_memory: { hour: 20, day: 60 },
  narration: { hour: 12, day: 40 },
  image: { hour: 6, day: 15 },
};

const QUOTA_METADATA_KEY = "daily_scripture_ai_quota_v1";
const queues = new Map<string, Promise<unknown>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseQuota(value: unknown): FeatureQuota | null {
  if (!isRecord(value)) return null;
  if (typeof value.hourBucket !== "string" || typeof value.dayBucket !== "string") return null;
  return {
    hourBucket: value.hourBucket,
    hourCount: nonNegativeInteger(value.hourCount),
    dayBucket: value.dayBucket,
    dayCount: nonNegativeInteger(value.dayCount),
  };
}

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  queues.set(key, run);
  try {
    return await run;
  } finally {
    if (queues.get(key) === run) queues.delete(key);
  }
}

function retryAfterForHour(now: number) {
  return Math.max(1, Math.ceil((3_600_000 - (now % 3_600_000)) / 1000));
}

function retryAfterForDay(now: number) {
  const date = new Date(now);
  const nextUtcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextUtcMidnight - now) / 1000));
}

async function consumeQuota(userId: string, feature: AiFeature): Promise<AiAccessResult> {
  return withLock(`${userId}:${feature}`, async () => {
    try {
      // Re-read authoritative app metadata inside the lock so successive requests in
      // this worker cannot all consume the same stale counter. app_metadata is admin
      // controlled, so browser clients cannot reset their own quota counters.
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (error || !data.user) {
        console.error(`[AI access] Could not read quota state for ${feature}: ${error?.message ?? "user missing"}`);
        return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
      }

      const now = Date.now();
      const hourBucket = new Date(now).toISOString().slice(0, 13);
      const dayBucket = new Date(now).toISOString().slice(0, 10);
      const appMetadata = isRecord(data.user.app_metadata) ? data.user.app_metadata : {};
      const allQuotas = isRecord(appMetadata[QUOTA_METADATA_KEY])
        ? { ...(appMetadata[QUOTA_METADATA_KEY] as Record<string, unknown>) }
        : {};
      const previous = parseQuota(allQuotas[feature]);
      const hourCount = previous?.hourBucket === hourBucket ? previous.hourCount : 0;
      const dayCount = previous?.dayBucket === dayBucket ? previous.dayCount : 0;
      const limit = LIMITS[feature];

      if (dayCount >= limit.day) {
        return {
          ok: false,
          status: 429,
          error: "You have reached today’s AI study limit. Please continue with Scripture, notes, and reflection for now.",
          retryAfter: retryAfterForDay(now),
        };
      }
      if (hourCount >= limit.hour) {
        return {
          ok: false,
          status: 429,
          error: "AI study tools have been used frequently this hour. Please wait a little and try again.",
          retryAfter: retryAfterForHour(now),
        };
      }

      allQuotas[feature] = {
        hourBucket,
        hourCount: hourCount + 1,
        dayBucket,
        dayCount: dayCount + 1,
      } satisfies FeatureQuota;

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: { ...appMetadata, [QUOTA_METADATA_KEY]: allQuotas },
      });
      if (updateError) {
        console.error(`[AI access] Could not persist quota state for ${feature}: ${updateError.message}`);
        return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
      }

      return { ok: true, userId };
    } catch (error) {
      console.error(`[AI access] Guard failed for ${feature}:`, error);
      return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
    }
  });
}

export async function authorizeAiRequest(request: Request, feature: AiFeature): Promise<AiAccessResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Sign in in Settings to use AI study tools." };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, error: "Sign in in Settings to use AI study tools." };

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user?.id) {
      return { ok: false, status: 401, error: "Your session has expired. Sign in again to use AI study tools." };
    }
    return consumeQuota(data.user.id, feature);
  } catch (error) {
    console.error(`[AI access] Authentication failed for ${feature}:`, error);
    return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
  }
}

export async function authorizeCurrentAiRequest(feature: AiFeature): Promise<AiAccessResult> {
  try {
    const request = getRequest();
    return authorizeAiRequest(request, feature);
  } catch (error) {
    console.error(`[AI access] No current request for ${feature}:`, error);
    return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
  }
}
