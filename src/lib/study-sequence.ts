import { supabase } from "@/integrations/supabase/client";
import { parseManifest, type CallCounts, type SequenceManifest, type SequenceMode, type SequenceStage } from "./study-sequence.shared";

const BUCKET = "study-videos";
const SIGNED_SECONDS = 60 * 60 * 6;

export type SequenceStatus = "queued" | "generating" | "completed" | "failed" | "cancelled";

export type StepView = {
  id: string;
  status: SequenceStatus;
  stage: SequenceStage | null;
  error: string | null;
  mode: SequenceMode | null;
  budget: Partial<CallCounts>;
  usage: Partial<CallCounts>;
  scenes: number;
  visuals: { done: number; total: number; failed: number };
  narration: { done: number; total: number; failed: number };
  worked: boolean;
  waiting: boolean;
};

export type SceneAssets = { index: number; visualUrl: string | null; visualType: "image" | "video" | null; audioUrl: string };
export type SavedSequence = {
  id: string;
  mode: SequenceMode;
  createdAt: string;
  manifest: SequenceManifest;
  assets: SceneAssets[];
  usage: Partial<CallCounts>;
};
export type ActiveSequence = { id: string; status: SequenceStatus; stage: SequenceStage | null; error: string | null; mode: SequenceMode | null };

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
  if (!response.ok) throw new Error(payload.message || `Study video request failed (${response.status}).`);
  return payload;
}

function versionNumber(versionId: string) {
  const value = Number(versionId);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("The selected Bible translation is not valid for saved study media.");
  return value;
}

export async function loadSequences(versionId: string, passage: string): Promise<{ saved: SavedSequence[]; active: ActiveSequence | null }> {
  await token();
  const { data, error } = await supabase
    .from("study_videos")
    .select("id,status,stage,stage_error,study_mode,manifest,call_usage,created_at,selected_at")
    .eq("kind", "sequence")
    .eq("passage", passage)
    .eq("version_id", versionNumber(versionId))
    .in("status", ["completed", "queued", "generating", "failed"])
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new Error("Saved study videos could not be loaded.");
  const rows = data ?? [];
  const completed = rows.filter((r) => r.status === "completed");
  const saved: SavedSequence[] = [];
  for (const row of completed) {
    const manifest = parseManifest(row.manifest);
    if (!manifest) continue;
    const { data: scenes } = await supabase
      .from("study_video_scenes")
      .select("scene_index,visual_kind,visual_path,narration_path")
      .eq("video_id", row.id)
      .order("scene_index");
    const list = scenes ?? [];
    const paths = list.flatMap((s) => [s.visual_path, s.narration_path].filter((p): p is string => Boolean(p)));
    const signed = paths.length ? (await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_SECONDS)).data ?? [] : [];
    const urlFor = (p: string | null) => (p ? signed.find((x) => x.path === p)?.signedUrl ?? null : null);
    const assets = list.map((s) => ({
      index: s.scene_index,
      visualUrl: urlFor(s.visual_path),
      visualType: s.visual_path ? (s.visual_path.endsWith(".mp4") ? ("video" as const) : ("image" as const)) : null,
      audioUrl: urlFor(s.narration_path) ?? "",
    }));
    if (assets.some((a) => !a.audioUrl)) continue;
    saved.push({ id: row.id, mode: row.study_mode as SequenceMode, createdAt: row.created_at, manifest, assets, usage: (row.call_usage ?? {}) as Partial<CallCounts> });
  }
  const activeRow = rows.find((r) => r.status === "queued" || r.status === "generating") ?? (rows[0]?.status === "failed" ? rows[0] : undefined);
  const active = activeRow ? { id: activeRow.id, status: activeRow.status as SequenceStatus, stage: activeRow.stage as SequenceStage | null, error: activeRow.stage_error, mode: activeRow.study_mode as SequenceMode | null } : null;
  return { saved, active };
}

export async function reserveSequence(versionId: string, passage: string, guideHash: string, mode: SequenceMode, force: boolean) {
  await token();
  const { data, error } = await supabase.rpc("reserve_study_sequence", { p_passage: passage, p_version_id: versionNumber(versionId), p_guide_hash: guideHash, p_mode: mode, p_force: force });
  if (error) throw new Error("The study video could not be reserved.");
  const payload = data as { id?: string; status?: string; created?: boolean; reused?: boolean } | null;
  if (!payload?.id || typeof payload.created !== "boolean") throw new Error("The study video reservation was invalid.");
  return { id: payload.id, status: payload.status as SequenceStatus, created: payload.created, reused: Boolean(payload.reused) };
}

export const startSequence = (jobId: string) => post<{ id: string; status: SequenceStatus }>("/api/study-video/sequence-start", { jobId });
export const advanceSequenceStep = (jobId: string, reference: string, signal?: AbortSignal) => post<StepView>("/api/study-video/advance", { jobId, reference }, signal);
export const retrySequenceStage = (jobId: string) => post<{ id: string; status: SequenceStatus }>("/api/study-video/retry", { jobId });

export async function cancelSequence(jobId: string) {
  const { error } = await supabase.from("study_videos").update({ status: "cancelled", last_error: "Cancelled by the user.", updated_at: new Date().toISOString() }).eq("id", jobId).in("status", ["queued", "generating", "failed"]);
  if (error) throw new Error("The study video could not be cancelled.");
}

/** Deletes the row (scenes cascade) and its private objects. Reused assets are copies, so nothing else breaks. */
export async function deleteSequence(jobId: string) {
  const { data: scenes } = await supabase.from("study_video_scenes").select("visual_path,narration_path").eq("video_id", jobId);
  const paths = (scenes ?? []).flatMap((s) => [s.visual_path, s.narration_path].filter((p): p is string => Boolean(p)));
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from("study_videos").delete().eq("id", jobId);
  if (error) throw new Error("The study video could not be deleted.");
}
