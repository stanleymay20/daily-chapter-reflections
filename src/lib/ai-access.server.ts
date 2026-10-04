import { getRequest } from "@tanstack/react-start/server";

import { AI_MESSAGES } from "@/lib/ai-error";
import { publicSupabasePublishableKey, publicSupabaseUrl } from "@/integrations/supabase/public-config";

export type AiFeature = "insights" | "ask_chapter" | "study_memory" | "narration" | "image";

type AiAccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 429 | 503; error: string; retryAfter?: number };

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 503; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

async function authenticateUser(token: string): Promise<AuthResult> {
  const supabaseUrl = publicSupabaseUrl();
  const publishableKey = publicSupabasePublishableKey();

  try {
    // Validate the caller's access token using the least-privileged public Auth
    // endpoint. A service-role credential is unnecessary for session validation.
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, error: AI_MESSAGES.sessionExpired };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[AI access] Supabase Auth failed: ${response.status} ${body.slice(0, 300)}`);
      return { ok: false, status: 503, error: AI_MESSAGES.unavailable };
    }

    const payload = (await response.json()) as unknown;
    const userId = isRecord(payload) && typeof payload["id"] === "string" ? payload["id"] : "";
    if (!userId) {
      return { ok: false, status: 401, error: AI_MESSAGES.sessionExpired };
    }
    return { ok: true, userId };
  } catch (error) {
    console.error("[AI access] Supabase Auth request failed:", error);
    return { ok: false, status: 503, error: AI_MESSAGES.unavailable };
  }
}

async function consumeQuota(token: string, userId: string, feature: AiFeature): Promise<AiAccessResult> {
  const supabaseUrl = publicSupabaseUrl();
  const publishableKey = publicSupabasePublishableKey();

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/consume_ai_quota`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_feature: feature }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[AI access] Quota RPC failed for ${feature}: ${response.status} ${body.slice(0, 300)}`);
      return { ok: false, status: 503, error: AI_MESSAGES.unavailable };
    }

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload) || typeof payload["allowed"] !== "boolean") {
      console.error(`[AI access] Quota RPC returned an invalid payload for ${feature}.`);
      return { ok: false, status: 503, error: AI_MESSAGES.unavailable };
    }

    if (payload["allowed"] === true) return { ok: true, userId };

    // DB contract (consume_ai_quota): camelCase `retryAfter` seconds, `scope` "hour"|"day".
    const retryAfter = positiveInteger(payload["retryAfter"]);
    const scope = payload["scope"] === "day" ? "day" : "hour";
    const error =
      scope === "day"
        ? AI_MESSAGES.dayLimit
        : AI_MESSAGES.hourLimit;

    return retryAfter
      ? { ok: false, status: 429, error, retryAfter }
      : { ok: false, status: 429, error };
  } catch (error) {
    console.error(`[AI access] Quota check failed for ${feature}:`, error);
    return { ok: false, status: 503, error: AI_MESSAGES.unavailable };
  }
}

export async function authorizeAiRequest(request: Request, feature: AiFeature): Promise<AiAccessResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: AI_MESSAGES.signIn };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, error: AI_MESSAGES.signIn };

  // Never trust a caller-supplied user id. Supabase Auth validates the bearer
  // token and the quota RPC independently derives the same identity via auth.uid().
  const auth = await authenticateUser(token);
  if (!auth.ok) return auth;
  return consumeQuota(token, auth.userId, feature);
}

export async function authorizeCurrentAiRequest(feature: AiFeature): Promise<AiAccessResult> {
  try {
    return authorizeAiRequest(getRequest(), feature);
  } catch (error) {
    console.error(`[AI access] No current request for ${feature}:`, error);
    return { ok: false, status: 503, error: AI_MESSAGES.unavailable };
  }
}
