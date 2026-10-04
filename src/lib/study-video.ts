import { supabase } from "@/integrations/supabase/client";
import {
  STUDY_VIDEO_MODEL,
  STUDY_VIDEO_PROMPT_VERSION,
  parseScenes,
  type StudyVideoStatus,
  type VideoScene,
} from "./study-video.shared";

const BUCKET = "study-videos";
const SIGNED_URL_SECONDS = 60 * 60 * 6;

export type StudyVideoVersion = {
  id: string;
  status: StudyVideoStatus;
  url: string;
  scenes: VideoScene[];
  durationSeconds: number;
  progress: number | null;
  error: string | null;
  createdAt: string;
  selectedAt: string;
};

export type VideoJobStatus = { id: string; status: StudyVideoStatus; progress: number | null; error: string | null; message?: string };

async function token() {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Sign in in Settings to use AI study tools.");
  return value;
}

async function post<T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Video request failed (${response.status}).`);
  return payload;
}

function versionNumber(versionId: string) {
  const value = Number(versionId);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("The selected Bible translation is not valid for saved study media.");
  return value;
}

/** Saved completed versions plus any in-flight job for this chapter + translation. */
export async function loadStudyVideos(versionId: string, passage: string): Promise<{ versions: StudyVideoVersion[]; active: StudyVideoVersion | null }> {
  await token();
  const { data, error } = await supabase
    .from("study_videos")
    .select("id,status,storage_path,scenes,duration_seconds,progress,last_error,created_at,selected_at,updated_at")
    .eq("passage", passage)
    .eq("version_id", versionNumber(versionId))
    .in("status", ["completed", "queued", "generating"])
    .order("selected_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new Error("Saved video aids could not be loaded.");
  const rows = data ?? [];
  const completed = rows.filter((row) => row.status === "completed" && row.storage_path);
  const versions = await Promise.all(
    completed.map(async (row) => {
      const signed = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path as string, SIGNED_URL_SECONDS);
      return {
        id: row.id,
        status: row.status as StudyVideoStatus,
        url: signed.data?.signedUrl ?? "",
        scenes: parseScenes(row.scenes),
        durationSeconds: row.duration_seconds,
        progress: row.progress,
        error: row.last_error,
        createdAt: row.created_at,
        selectedAt: row.selected_at,
      };
    }),
  );
  const activeRow = rows.find((row) => row.status === "queued" || row.status === "generating");
  const active = activeRow
    ? { id: activeRow.id, status: activeRow.status as StudyVideoStatus, url: "", scenes: parseScenes(activeRow.scenes), durationSeconds: activeRow.duration_seconds, progress: activeRow.progress, error: null, createdAt: activeRow.created_at, selectedAt: activeRow.selected_at }
    : null;
  return { versions: versions.filter((v) => v.url), active };
}

export async function reserveStudyVideoJob(versionId: string, passage: string, guideHash: string) {
  await token();
  const { data, error } = await supabase.rpc("reserve_study_video_job", {
    p_passage: passage,
    p_version_id: versionNumber(versionId),
    p_guide_hash: guideHash,
    p_prompt_version: STUDY_VIDEO_PROMPT_VERSION,
    p_model: STUDY_VIDEO_MODEL,
  });
  if (error) throw new Error("The video job could not be reserved.");
  const payload = data as { id?: string; status?: string; created?: boolean } | null;
  if (!payload?.id || typeof payload.created !== "boolean") throw new Error("The video job returned an invalid reservation.");
  return { id: payload.id, created: payload.created, status: payload.status as StudyVideoStatus };
}

export function startStudyVideo(body: { jobId: string; passage: string; versionId: number; guideHash: string; reference: string }) {
  return post<{ id: string; status: StudyVideoStatus }>("/api/study-video/start", body);
}

export function checkStudyVideo(jobId: string, signal?: AbortSignal) {
  return post<VideoJobStatus>("/api/study-video/status", { jobId }, signal);
}

/** Cancel stops waiting and saving. A provider render that already started may still be charged. */
export async function cancelStudyVideo(jobId: string) {
  const { error } = await supabase
    .from("study_videos")
    .update({ status: "cancelled", last_error: "Cancelled by the user.", updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["queued", "generating"]);
  if (error) throw new Error("The video job could not be cancelled.");
}

export async function selectStudyVideo(id: string) {
  const { error } = await supabase.from("study_videos").update({ selected_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("The selected video version could not be saved.");
}
