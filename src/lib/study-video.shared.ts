import type { VisualStudyGuide } from "./study-guide";

/** Browser-safe Video Aid contract shared by the server routes, client and tests. */
export const STUDY_VIDEO_PROMPT_VERSION = "study-video-v1";
export const STUDY_VIDEO_MODEL = "google/gemini-omni-1.1-flash";
export const STUDY_VIDEO_DURATION_SECONDS = 8;
export const STUDY_VIDEO_RESOLUTION = "720p";
export const STUDY_VIDEO_MAX_SCENES = 4;
export const STUDY_VIDEO_POLL_MS = 8000;
export const STUDY_VIDEO_LABEL = "AI-created interpretation · not Scripture";

export type VideoScene = { start: number; end: number; description: string };
export type StudyVideoStatus = "queued" | "generating" | "completed" | "failed" | "cancelled";

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").replace(/[<>{}[\]`]/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Scenes come only from the persisted guide's event sequence, evenly timed and capped. */
export function buildVideoScenes(guide: VisualStudyGuide): VideoScene[] {
  const events = guide.eventSequence.slice(0, STUDY_VIDEO_MAX_SCENES).map((event) => clip(event, 220)).filter(Boolean);
  if (!events.length) return [];
  const span = STUDY_VIDEO_DURATION_SECONDS / events.length;
  return events.map((description, index) => ({
    start: Math.round(index * span * 10) / 10,
    end: Math.round((index + 1) * span * 10) / 10,
    description,
  }));
}

export function safeReference(reference: string) {
  return reference.replace(/[^\p{L}\p{N} :.\-]/gu, "").trim().slice(0, 60) || "this chapter";
}

export function buildVideoPrompt(reference: string, guide: VisualStudyGuide, scenes: VideoScene[]) {
  const timed = scenes.map((scene) => `[${scene.start}-${scene.end}s] A restrained visual evocation of: ${scene.description}`).join("\n");
  return `An ${STUDY_VIDEO_DURATION_SECONDS}-second calm, reverent, educational study visual for a private Bible study about ${safeReference(reference)}. This is an artistic interpretation, never historical footage or a recording of real events.

Chapter summary from the saved study guide: ${clip(guide.summary, 400)}

${timed}

Style: painterly, softly lit, muted natural earth tones, slow gentle camera movement, gentle dissolves between moments. Figures appear at a distance, in silhouette or softly out of focus, with no identifiable faces. Where a visual detail is not stated above, keep it abstract: light, landscape, texture.
No dialogue. No narration. No spoken words. No on-screen text, letters, captions, verse text or symbols. No supernatural effects unless named above. No weapons, gore or sensational action. No invented maps, architecture, insignia or named individuals.
Audio: a quiet, sparse ambient instrumental pad only. No extra sound effects.`;
}

/** WebVTT scene descriptions so the clip has an accessible text track (there is no speech to caption). */
export function scenesToVtt(scenes: VideoScene[]) {
  const stamp = (s: number) => `00:00:${s.toFixed(3).padStart(6, "0")}`;
  return `WEBVTT\n\n${scenes.map((scene, i) => `${i + 1}\n${stamp(scene.start)} --> ${stamp(scene.end)}\n[Interpretive scene] ${scene.description}`).join("\n\n")}\n`;
}

export function parseScenes(value: unknown): VideoScene[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    return typeof r["start"] === "number" && typeof r["end"] === "number" && typeof r["description"] === "string"
      ? [{ start: r["start"], end: r["end"], description: r["description"] }]
      : [];
  });
}
