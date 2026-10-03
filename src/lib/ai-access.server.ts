import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AiFeature = "insights" | "ask_chapter" | "study_memory" | "narration" | "image";

type AiAccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 429 | 503; error: string; retryAfter?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

async function consumeQuota(token: string, userId: string, feature: AiFeature): Promise<AiAccessResult> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) {
    console.error(`[AI access] Supabase quota configuration is missing for ${feature}.`);
    return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
  }

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
      return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
    }

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload) || typeof payload["allowed"] !== "boolean") {
      console.error(`[AI access] Quota RPC returned an invalid payload for ${feature}.`);
      return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
    }

    if (payload["allowed"] === true) return { ok: true, userId };

    const retryAfter = positiveInteger(payload["retryAfter"]);
    const scope = payload["scope"] === "day" ? "day" : "hour";
    const error =
      scope === "day"
        ? "You have reached today’s AI study limit. Please continue with Scripture, notes, and reflection for now."
        : "AI study tools have been used frequently this hour. Please wait a little and try again.";

    return retryAfter
      ? { ok: false, status: 429, error, retryAfter }
      : { ok: false, status: 429, error };
  } catch (error) {
    console.error(`[AI access] Quota check failed for ${feature}:`, error);
    return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
  }
}

export async function authorizeAiRequest(request: Request, feature: AiFeature): Promise<AiAccessResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Sign in in Settings to use AI study tools." };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, error: "Sign in in Settings to use AI study tools." };

  try {
    // Never trust a caller-supplied user id. Supabase validates the access token
    // and returns the authoritative user. The quota RPC independently derives
    // the same identity from auth.uid().
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user?.id) {
      return { ok: false, status: 401, error: "Your session has expired. Sign in again to use AI study tools." };
    }
    return consumeQuota(token, data.user.id, feature);
  } catch (error) {
    console.error(`[AI access] Authentication failed for ${feature}:`, error);
    return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
  }
}

export async function authorizeCurrentAiRequest(feature: AiFeature): Promise<AiAccessResult> {
  try {
    return authorizeAiRequest(getRequest(), feature);
  } catch (error) {
    console.error(`[AI access] No current request for ${feature}:`, error);
    return { ok: false, status: 503, error: "AI access could not be verified. Please try again." };
  }
}
