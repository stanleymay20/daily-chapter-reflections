import { publicSupabasePublishableKey, publicSupabaseUrl } from "@/integrations/supabase/public-config";

/** All study-video DB/storage access runs with the caller's own bearer token, so RLS stays the boundary. */
export type VideoRow = {
  id: string;
  user_id: string;
  passage: string;
  version_id: number;
  guide_hash: string;
  prompt_version: string;
  model: string;
  status: "queued" | "generating" | "completed" | "failed" | "cancelled";
  provider_job_id: string | null;
  progress: number | null;
  storage_path: string | null;
  duration_seconds: number;
  scenes: unknown;
  last_error: string | null;
};

export const VIDEO_BUCKET = "study-videos";
const COLUMNS = "id,user_id,passage,version_id,guide_hash,prompt_version,model,status,provider_job_id,progress,storage_path,duration_seconds,scenes,last_error";

function base() {
  return publicSupabaseUrl().replace(/\/$/, "");
}

export function bearer(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim();
  return value?.startsWith("Bearer ") && value.length > 7 ? value : null;
}

function headers(auth: string, extra?: HeadersInit) {
  const h = new Headers(extra);
  h.set("apikey", publicSupabasePublishableKey());
  h.set("Authorization", auth);
  if (!h.has("Content-Type")) h.set("Content-Type", "application/json");
  return h;
}

export async function loadVideoRow(auth: string, id: string): Promise<VideoRow | null> {
  const url = new URL(`${base()}/rest/v1/study_videos`);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", COLUMNS);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: headers(auth) });
  if (!response.ok) throw new Error(`video row lookup failed (${response.status})`);
  const rows = (await response.json()) as VideoRow[];
  return rows[0] ?? null;
}

/** Conditional update: only rows matching `where` (e.g. status=queued) change; returns the updated row or null. */
export async function patchVideoRow(
  auth: string,
  id: string,
  patch: Partial<Pick<VideoRow, "status" | "provider_job_id" | "progress" | "storage_path" | "last_error">> & { scenes?: unknown },
  where: Record<string, string> = {},
): Promise<VideoRow | null> {
  const url = new URL(`${base()}/rest/v1/study_videos`);
  url.searchParams.set("id", `eq.${id}`);
  for (const [key, value] of Object.entries(where)) url.searchParams.set(key, value);
  url.searchParams.set("select", COLUMNS);
  const response = await fetch(url, {
    method: "PATCH",
    headers: headers(auth, { Prefer: "return=representation" }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`video row update failed (${response.status})`);
  const rows = (await response.json()) as VideoRow[];
  return rows[0] ?? null;
}

export function videoStoragePath(row: Pick<VideoRow, "user_id" | "passage" | "version_id" | "id">) {
  return `${row.user_id}/${row.passage}/${row.version_id}/${row.id}.mp4`;
}

/** Idempotent upload: an existing object (409) from an earlier poll counts as stored. */
export async function uploadVideo(auth: string, path: string, bytes: ArrayBuffer) {
  const response = await fetch(`${base()}/storage/v1/object/${VIDEO_BUCKET}/${path}`, {
    method: "POST",
    headers: headers(auth, { "Content-Type": "video/mp4", "x-upsert": "false", "cache-control": "3600" }),
    body: bytes,
  });
  if (response.ok || response.status === 409) return;
  const text = await response.text().catch(() => "");
  if (/already exists|Duplicate/i.test(text)) return;
  throw new Error(`video upload failed (${response.status})`);
}
