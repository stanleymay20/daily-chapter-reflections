import { publicSupabasePublishableKey, publicSupabaseUrl } from "@/integrations/supabase/public-config";
import { STUDY_IMAGE_PROMPT_VERSION, studyGuideHash, visualStudyGuide, type VisualStudyGuide } from "./study-guide";

type MediaCheck<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type ClaimedJob = {
  id: string;
  user_id: string;
  passage: string;
  version_id: number;
  guide_hash: string;
  prompt_version: string;
  status: "generating";
};

function authorization(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim();
  return value?.startsWith("Bearer ") ? value : null;
}

function headers(request: Request, extra?: HeadersInit): Headers | null {
  const auth = authorization(request);
  if (!auth) return null;
  const result = new Headers(extra);
  result.set("apikey", publicSupabasePublishableKey());
  result.set("Authorization", auth);
  if (!result.has("Content-Type")) result.set("Content-Type", "application/json");
  return result;
}

function restUrl(path: string): string {
  return `${publicSupabaseUrl()}/rest/v1/${path}`;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    const json = JSON.parse(text) as { message?: string; hint?: string };
    return json.message || json.hint || fallback;
  } catch {
    return text.slice(0, 500) || fallback;
  }
}

export async function loadOwnedVisualGuide(
  request: Request,
  passage: string,
  versionId: number,
  expectedHash: string,
): Promise<MediaCheck<VisualStudyGuide>> {
  const requestHeaders = headers(request);
  if (!requestHeaders) return { ok: false, status: 401, error: "Sign in before creating a chapter picture." };
  const url = new URL(restUrl("ai_insights_cache"));
  url.searchParams.set("version_id", `eq.${versionId}`);
  url.searchParams.set("passage", `eq.${passage}`);
  url.searchParams.set("select", "insights");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: requestHeaders, signal: request.signal });
  if (!response.ok) {
    return { ok: false, status: response.status === 401 ? 401 : 503, error: await errorMessage(response, "The saved chapter guide could not be verified.") };
  }
  const rows = (await response.json()) as Array<{ insights?: unknown }>;
  const guide = visualStudyGuide(rows[0]?.insights);
  if (!guide) return { ok: false, status: 409, error: "No valid saved chapter guide exists for this translation. Build the guide first." };
  const actualHash = await studyGuideHash(guide);
  if (actualHash !== expectedHash) {
    return { ok: false, status: 409, error: "The chapter guide changed. Refresh the page before creating another picture." };
  }
  return { ok: true, value: guide };
}

export async function claimOwnedImageJob(
  request: Request,
  args: { jobId: string; userId: string; passage: string; versionId: number; guideHash: string },
): Promise<MediaCheck<ClaimedJob>> {
  const requestHeaders = headers(request, { Prefer: "return=representation" });
  if (!requestHeaders) return { ok: false, status: 401, error: "Sign in before creating a chapter picture." };
  const url = new URL(restUrl("study_image_jobs"));
  url.searchParams.set("id", `eq.${args.jobId}`);
  url.searchParams.set("passage", `eq.${args.passage}`);
  url.searchParams.set("version_id", `eq.${args.versionId}`);
  url.searchParams.set("guide_hash", `eq.${args.guideHash}`);
  url.searchParams.set("prompt_version", `eq.${STUDY_IMAGE_PROMPT_VERSION}`);
  url.searchParams.set("status", "eq.queued");
  url.searchParams.set("select", "id,user_id,passage,version_id,guide_hash,prompt_version,status");
  const response = await fetch(url, {
    method: "PATCH",
    headers: requestHeaders,
    body: JSON.stringify({ status: "generating", updated_at: new Date().toISOString(), last_error: null }),
    signal: request.signal,
  });
  if (!response.ok) {
    return { ok: false, status: response.status === 401 ? 401 : 503, error: await errorMessage(response, "The picture generation job could not be claimed.") };
  }
  const rows = (await response.json()) as ClaimedJob[];
  const job = rows[0];
  if (!job) return { ok: false, status: 409, error: "This generation job is no longer available. Refresh the picture history before retrying." };
  if (job.user_id !== args.userId) return { ok: false, status: 403, error: "This picture generation job does not belong to the signed-in user." };
  return { ok: true, value: job };
}

export async function markImageJobFromRequest(
  request: Request,
  jobId: string,
  status: "failed" | "cancelled",
  lastError: string,
): Promise<void> {
  const requestHeaders = headers(request, { Prefer: "return=minimal" });
  if (!requestHeaders) return;
  const url = new URL(restUrl("study_image_jobs"));
  url.searchParams.set("id", `eq.${jobId}`);
  await fetch(url, {
    method: "PATCH",
    headers: requestHeaders,
    body: JSON.stringify({ status, last_error: lastError.slice(0, 1000), updated_at: new Date().toISOString() }),
  }).catch(() => undefined);
}
