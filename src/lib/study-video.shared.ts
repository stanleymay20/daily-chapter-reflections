import type { StudyMode } from "./study-state";
import type { VisualStudyGuide } from "./study-guide";

/** Browser-safe Video Aid contract shared by routes, client and tests. */
export const LEGACY_STUDY_VIDEO_PROMPT_VERSION = "study-video-v1";
export const STUDY_VIDEO_PROMPT_VERSION = "study-video-sequence-v1";
export const STUDY_VIDEO_PLAN_VERSION = "chapter-sequence-v1";
export const STUDY_VIDEO_MODEL = "google/gemini-omni-1.1-flash";
export const STUDY_VIDEO_PLAN_MODEL = "google/gemini-3.6-flash";
export const STUDY_VIDEO_TTS_MODEL = "openai/gpt-4o-mini-tts";
export const STUDY_VIDEO_TTS_VOICE = "nova";
export const STUDY_VIDEO_RESOLUTION = "720p";
export const STUDY_VIDEO_MOTION_SECONDS = 8;
export const STUDY_VIDEO_POLL_MS = 8000;
export const STUDY_VIDEO_LABEL = "AI-created interpretation · not Scripture";

export type StudyVideoKind = "clip" | "sequence";
export type StudyVideoStatus = "queued" | "generating" | "completed" | "failed" | "cancelled";
export type StudyVideoStage = "legacy" | "queued" | "planning" | "visuals" | "narration" | "finalizing" | "completed" | "failed" | "cancelled";
export type StudyVideoMode = "quick" | "standard" | "deep";
export type StudyVideoAudience = "study" | "kids-4-7" | "kids-7-10" | "kids-10-12";
export type StudyVideoClaimType = "chapter" | "context" | "uncertain";
export type StudyVideoVisualKind = "title" | "motion" | "still" | "closing";
export type ProviderCallKind = "planning" | "stills" | "motion" | "tts";

export type ProviderCallBudget = Record<ProviderCallKind, number> & { total: number };
export type ProviderCallUsage = Record<ProviderCallKind, number> & { total: number };

export type VideoScene = { start: number; end: number; description: string };

export type StudyVideoScenePlan = {
  index: number;
  role: "title" | "content" | "closing";
  claimType: StudyVideoClaimType;
  sourceRefs: string[];
  narration: string;
  visualBrief: string;
  visualKind: StudyVideoVisualKind;
};

export type StudyVideoPlan = {
  version: typeof STUDY_VIDEO_PLAN_VERSION;
  reference: string;
  mode: StudyVideoMode;
  audience: StudyVideoAudience;
  title: string;
  continuityNotes: string;
  scenes: StudyVideoScenePlan[];
};

export type StudyVideoManifestScene = StudyVideoScenePlan & {
  id: string;
  start: number;
  end: number;
  durationSeconds: number;
  visualPath: string | null;
  narrationPath: string | null;
};

export type StudyVideoManifest = {
  version: "study-video-manifest-v1";
  kind: "sequence";
  reference: string;
  mode: StudyVideoMode;
  audience: StudyVideoAudience;
  estimatedSeconds: number;
  actualSeconds: number;
  label: typeof STUDY_VIDEO_LABEL;
  scenes: StudyVideoManifestScene[];
};

export type StudyVideoPreset = {
  mode: StudyVideoMode;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  scenes: number;
  motion: number;
  stills: number;
  tts: number;
  maxWordsPerScene: number;
  budget: ProviderCallBudget;
};

const PRESETS: Record<StudyVideoMode, Omit<StudyVideoPreset, "mode" | "budget">> = {
  quick: { targetSeconds: 60, minSeconds: 45, maxSeconds: 75, scenes: 6, motion: 2, stills: 2, tts: 6, maxWordsPerScene: 34 },
  standard: { targetSeconds: 120, minSeconds: 90, maxSeconds: 150, scenes: 9, motion: 3, stills: 4, tts: 9, maxWordsPerScene: 42 },
  deep: { targetSeconds: 210, minSeconds: 120, maxSeconds: 240, scenes: 14, motion: 4, stills: 8, tts: 14, maxWordsPerScene: 48 },
};

export function studyVideoMode(mode: StudyMode): StudyVideoMode {
  return mode === "deep" ? "deep" : mode === "standard" ? "standard" : "quick";
}

export function getStudyVideoPreset(mode: StudyVideoMode): StudyVideoPreset {
  const p = PRESETS[mode];
  // One explicit-retry reserve per media category is included in the hard ceiling.
  const budget: ProviderCallBudget = {
    planning: 1,
    stills: p.stills + 1,
    motion: p.motion + 1,
    tts: p.tts + 1,
    total: 1 + p.stills + p.motion + p.tts + 3,
  };
  return { mode, ...p, budget };
}

export function plannedProviderCalls(mode: StudyVideoMode) {
  const p = PRESETS[mode];
  return { planning: 1, stills: p.stills, motion: p.motion, tts: p.tts, total: 1 + p.stills + p.motion + p.tts };
}

export function emptyProviderCallUsage(): ProviderCallUsage {
  return { planning: 0, stills: 0, motion: 0, tts: 0, total: 0 };
}

export function audienceLabel(audience: StudyVideoAudience) {
  if (audience === "study") return "Study video";
  return `Kids Bible · ages ${audience.replace("kids-", "")}`;
}

export function audiencePrompt(audience: StudyVideoAudience) {
  if (audience === "study") return "Use a calm, clear documentary-study tone for adults. Define unfamiliar terms briefly and avoid filler.";
  if (audience === "kids-4-7") return "Use warm, concrete language for ages 4–7, short sentences, gentle handling of frightening material, and narrator-led storytelling without invented dialogue.";
  if (audience === "kids-7-10") return "Use vivid but accurate language for ages 7–10, explain unfamiliar ideas simply, avoid graphic detail, and use narrator-led storytelling without invented dialogue.";
  return "Use thoughtful, age-appropriate language for ages 10–12, preserve nuance, explain context clearly, avoid graphic sensationalism, and use narrator-led storytelling without invented dialogue.";
}

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").replace(/[<>{}[\]`]/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function safeReference(reference: string) {
  return reference.replace(/[^\p{L}\p{N} :.\-]/gu, "").trim().slice(0, 80) || "this chapter";
}

export function resolveGuideRef(guide: VisualStudyGuide, ref: string): string | null {
  if (ref === "summary") return guide.summary;
  const match = /^(eventSequence|visualTimeline|relationships|placeNotes)\[(\d+)]$/.exec(ref);
  if (!match) return null;
  const key = match[1] as "eventSequence" | "visualTimeline" | "relationships" | "placeNotes";
  const index = Number(match[2]);
  return guide[key][index] ?? null;
}

function words(value: string) {
  return value.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

const STOP = new Set(["the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "for", "from", "with", "as", "is", "are", "was", "were", "be", "this", "that", "these", "those", "it", "they", "their", "his", "her", "into", "through", "then", "now", "chapter", "scene"]);

export function groundingScore(text: string, source: string) {
  const sourceTokens = new Set(words(source).filter((w) => w.length > 2 && !STOP.has(w)));
  const textTokens = [...new Set(words(text).filter((w) => w.length > 2 && !STOP.has(w)))];
  if (!textTokens.length) return 1;
  const supported = textTokens.filter((w) => sourceTokens.has(w)).length;
  return supported / textTokens.length;
}

export function validateStudyVideoPlan(plan: StudyVideoPlan, guide: VisualStudyGuide, mode: StudyVideoMode): string[] {
  const errors: string[] = [];
  const preset = getStudyVideoPreset(mode);
  if (plan.version !== STUDY_VIDEO_PLAN_VERSION) errors.push("plan version does not match");
  if (plan.mode !== mode) errors.push("plan mode does not match");
  if (plan.scenes.length !== preset.scenes) errors.push(`plan must contain exactly ${preset.scenes} scenes`);
  const seenNarration = new Set<string>();
  const seenVisual = new Set<string>();
  let motion = 0;
  let stills = 0;
  for (let i = 0; i < plan.scenes.length; i += 1) {
    const scene = plan.scenes[i]!;
    if (scene.index !== i) errors.push(`scene ${i} has the wrong index`);
    if (i === 0 && scene.role !== "title") errors.push("first scene must be title");
    if (i === plan.scenes.length - 1 && scene.role !== "closing") errors.push("last scene must be closing");
    if (i > 0 && i < plan.scenes.length - 1 && scene.role !== "content") errors.push(`scene ${i} must be content`);
    if (scene.visualKind === "motion") motion += 1;
    if (scene.visualKind === "still") stills += 1;
    if (scene.role === "title" && scene.visualKind !== "title") errors.push("title scene must use title visual kind");
    if (scene.role === "closing" && scene.visualKind !== "closing") errors.push("closing scene must use closing visual kind");
    if (scene.role === "content" && scene.visualKind !== "motion" && scene.visualKind !== "still") errors.push(`content scene ${i} needs generated media`);
    const count = words(scene.narration).length;
    if (!count || count > preset.maxWordsPerScene) errors.push(`scene ${i} narration exceeds its word budget`);
    if (/[“”"']/.test(scene.narration)) errors.push(`scene ${i} contains quotation marks; Video Aid uses references rather than unverified quotations`);
    if (/\b(i|we)\s+(am|will|say|tell|command|promise)\b/i.test(scene.narration)) errors.push(`scene ${i} resembles first-person character or divine speech`);
    const sourceTexts = scene.sourceRefs.map((ref) => resolveGuideRef(guide, ref)).filter((x): x is string => Boolean(x));
    if (!sourceTexts.length) errors.push(`scene ${i} has no valid source references`);
    if (sourceTexts.length && scene.role === "content") {
      const source = sourceTexts.join(" ");
      if (groundingScore(scene.narration, source) < 0.18) errors.push(`scene ${i} narration is weakly grounded in its referenced guide content`);
      if (groundingScore(scene.visualBrief, source) < 0.12) errors.push(`scene ${i} visual brief is weakly grounded in its referenced guide content`);
    }
    if (scene.claimType === "uncertain" && !/may|might|uncertain|not established|possible/i.test(scene.narration)) errors.push(`scene ${i} must verbalize uncertainty`);
    const nKey = scene.narration.toLowerCase().replace(/\W/g, "");
    const vKey = scene.visualBrief.toLowerCase().replace(/\W/g, "");
    if (seenNarration.has(nKey)) errors.push(`scene ${i} duplicates narration`); else seenNarration.add(nKey);
    if (scene.role === "content") {
      if (seenVisual.has(vKey)) errors.push(`scene ${i} duplicates a visual brief`); else seenVisual.add(vKey);
    }
  }
  if (motion > preset.motion) errors.push(`plan exceeds the ${preset.motion}-clip motion cap`);
  if (stills > preset.stills) errors.push(`plan exceeds the ${preset.stills}-still cap`);
  return errors;
}

export function buildSceneVisualPrompt(reference: string, scene: StudyVideoScenePlan, continuityNotes: string, audience: StudyVideoAudience) {
  const style = audience === "study"
    ? "Painterly editorial realism, natural earth pigments, gentle cinematic movement, figures distant or softly obscured, restrained documentary-study mood."
    : "Premium storybook animation, warm handcrafted textures, consistent silhouettes and wardrobe palette, expressive composition without recognizable modern people, child-safe and reverent.";
  return `Create one ${scene.visualKind === "motion" ? `${STUDY_VIDEO_MOTION_SECONDS}-second silent cinematic visual` : "16:9 editorial illustration"} for ${safeReference(reference)}. ${STUDY_VIDEO_LABEL}. Never present this as historical footage.\n\nGrounded scene brief: ${clip(scene.visualBrief, 700)}\nContinuity: ${clip(continuityNotes, 500)}\nClaim type: ${scene.claimType}.\n\n${style}\nNo dialogue, speech, lip-synced words, on-screen text, verse text, captions, maps, logos, insignia, gore, sensational violence or invented supernatural effects. Do not add named people, places, architecture, chronology, ethnicity or objects beyond the grounded brief. When detail is uncertain, keep it abstract through light, landscape, texture or distant figures. Audio from the motion model will not be used.`;
}

export function sequenceCaptionsVtt(manifest: StudyVideoManifest) {
  const stamp = (seconds: number) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const milli = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
  };
  return `WEBVTT\n\n${manifest.scenes.map((scene, i) => `${i + 1}\n${stamp(scene.start)} --> ${stamp(scene.end)}\n${scene.narration}`).join("\n\n")}\n`;
}

export function sceneDescriptionsVtt(manifest: StudyVideoManifest) {
  const stamp = (seconds: number) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const milli = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
  };
  return `WEBVTT\n\n${manifest.scenes.map((scene, i) => `${i + 1}\n${stamp(scene.start)} --> ${stamp(scene.end)}\n[Interpretive scene] ${scene.visualBrief}`).join("\n\n")}\n`;
}

/** Legacy v0 helpers retained so existing 8-second clips remain playable. */
export const STUDY_VIDEO_DURATION_SECONDS = 8;
export const STUDY_VIDEO_MAX_SCENES = 4;
export function buildVideoScenes(guide: VisualStudyGuide): VideoScene[] {
  const events = guide.eventSequence.slice(0, STUDY_VIDEO_MAX_SCENES).map((event) => clip(event, 220)).filter(Boolean);
  if (!events.length) return [];
  const span = STUDY_VIDEO_DURATION_SECONDS / events.length;
  return events.map((description, index) => ({ start: Math.round(index * span * 10) / 10, end: Math.round((index + 1) * span * 10) / 10, description }));
}
export function buildVideoPrompt(reference: string, guide: VisualStudyGuide, scenes: VideoScene[]) {
  const timed = scenes.map((scene) => `[${scene.start}-${scene.end}s] A restrained visual evocation of: ${scene.description}`).join("\n");
  return `An ${STUDY_VIDEO_DURATION_SECONDS}-second calm, reverent, educational study visual for a private Bible study about ${safeReference(reference)}. This is an artistic interpretation, never historical footage or a recording of real events.\n\nChapter summary from the saved study guide: ${clip(guide.summary, 400)}\n\n${timed}\n\nStyle: painterly, softly lit, muted natural earth tones, slow gentle camera movement. Figures appear at a distance, in silhouette or softly out of focus, with no identifiable faces. Where a visual detail is not stated above, keep it abstract. No dialogue. No narration. No spoken words. No on-screen text, letters, captions, verse text or symbols. No sensational action. Audio: quiet ambient instrumental only.`;
}
export function scenesToVtt(scenes: VideoScene[]) {
  const stamp = (s: number) => `00:00:${s.toFixed(3).padStart(6, "0")}`;
  return `WEBVTT\n\n${scenes.map((scene, i) => `${i + 1}\n${stamp(scene.start)} --> ${stamp(scene.end)}\n[Interpretive scene] ${scene.description}`).join("\n\n")}\n`;
}
export function parseScenes(value: unknown): VideoScene[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    return typeof r["start"] === "number" && typeof r["end"] === "number" && typeof r["description"] === "string" ? [{ start: r["start"], end: r["end"], description: r["description"] }] : [];
  });
}
