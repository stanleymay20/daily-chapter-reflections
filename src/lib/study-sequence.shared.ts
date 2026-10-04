/**
 * Video Aid v1 — browser-safe contract for the guide-grounded chapter study sequence.
 * Shared by server routes, the client player and tests. No provider calls here.
 *
 * Truthful capability note: providers render 3–10 s clips only and the server runtime cannot
 * compose MP4s, so v1 is a synchronized study timeline (scene visuals + narration + captions),
 * never presented as a single rendered video file.
 */
export const SEQUENCE_PLAN_VERSION = "study-seq-v1";
export const SEQUENCE_PIPELINE_MODEL = "pipeline:study-seq-v1";
export const SEQUENCE_PLANNER_MODEL = "openai/gpt-6-astra";
export const SEQUENCE_STILL_MODEL = "openai/gpt-image-2.5-sunburst";
export const SEQUENCE_CLIP_MODEL = "google/gemini-omni-1.1-flash";
export const SEQUENCE_TTS_MODEL = "google/gemini-3.1-flash-tts-preview";
export const SEQUENCE_TTS_VOICE = "Charon";
export const SEQUENCE_CLIP_SECONDS = 6;
export const SEQUENCE_LABEL = "AI-created interpretation · not Scripture";
export const SEQUENCE_MAX_ADVANCE_STEPS = 160;

export type SequenceMode = "quick" | "standard" | "deep";
export type CallKind = "plan" | "still" | "clip" | "tts";
export type CallCounts = Record<CallKind, number>;

export type ModeSpec = {
  label: string;
  targetSeconds: [number, number];
  scenes: [number, number];
  maxClips: number;
  maxStills: number;
  words: [number, number];
  /** Hard provider-call ceiling for the whole generation, including explicit stage retries. Mirrored in SQL. */
  budget: CallCounts;
};

/** Narration pace used for estimates (calm study pace). */
export const WORDS_PER_SECOND = 2.4;

export const MODE_SPECS: Record<SequenceMode, ModeSpec> = {
  quick: { label: "Quick", targetSeconds: [45, 75], scenes: [5, 6], maxClips: 2, maxStills: 2, words: [110, 185], budget: { plan: 4, still: 3, clip: 3, tts: 7 } },
  standard: { label: "Standard", targetSeconds: [90, 150], scenes: [8, 10], maxClips: 3, maxStills: 5, words: [215, 360], budget: { plan: 4, still: 6, clip: 4, tts: 11 } },
  deep: { label: "Deep", targetSeconds: [120, 240], scenes: [12, 16], maxClips: 4, maxStills: 10, words: [290, 575], budget: { plan: 4, still: 11, clip: 5, tts: 17 } },
};

/** Study experience → default video mode. "Just Read" never suggests video; if chosen it starts Quick. */
export function modeForStudy(studyMode: string | undefined): { mode: SequenceMode; suggested: boolean } {
  if (studyMode === "deep") return { mode: "deep", suggested: true };
  if (studyMode === "standard") return { mode: "standard", suggested: true };
  if (studyMode === "quick") return { mode: "quick", suggested: true };
  return { mode: "quick", suggested: false };
}

export function estimateFor(mode: SequenceMode) {
  const spec = MODE_SPECS[mode];
  const contentScenes = spec.scenes[1] - 2;
  return {
    seconds: spec.targetSeconds,
    scenes: spec.scenes,
    /** Expected provider calls for one successful run. */
    calls: { plan: 2, still: spec.maxStills, clip: spec.maxClips, tts: spec.scenes[1] } satisfies CallCounts,
    ceiling: spec.budget,
    contentScenes,
  };
}

// ---------------------------------------------------------------- grounding sources

export type GroundingSources = Record<string, string>;

export type GuideForSources = {
  summary: string;
  themes?: string[];
  context?: string;
  peoplePlaces?: string[];
  crossReferences?: string[];
  deeperStudy?: string[];
  eventSequence: string[];
  visualTimeline: string[];
  relationships: string[];
  placeNotes: string[];
};

const LIST_FIELDS = ["themes", "peoplePlaces", "crossReferences", "deeperStudy", "eventSequence", "visualTimeline", "relationships", "placeNotes"] as const;

/** Flattens the server-reloaded guide into addressable source ids ("summary", "eventSequence.2", …). */
export function groundingSources(guide: GuideForSources): GroundingSources {
  const out: GroundingSources = { summary: guide.summary.trim() };
  if (guide.context?.trim()) out["context"] = guide.context.trim();
  for (const field of LIST_FIELDS) {
    (guide[field] ?? []).forEach((value, index) => {
      if (typeof value === "string" && value.trim()) out[`${field}.${index}`] = value.trim();
    });
  }
  return out;
}

// ---------------------------------------------------------------- plan types

export type SceneRole = "opening" | "content" | "closing";
export type VisualKind = "title" | "still" | "clip" | "closing";
export type ClaimType = "chapter" | "context" | "uncertain";

export type PlannedScene = {
  role: SceneRole;
  narration: string;
  visualBrief: string;
  visualKind: VisualKind;
  claimType: ClaimType;
  sourceRefs: string[];
  scriptureQuote: string | null;
};

export type SequencePlan = { title: string; scenes: PlannedScene[] };

export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "scenes"],
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "narration", "visualBrief", "visualKind", "claimType", "sourceRefs", "scriptureQuote"],
        properties: {
          role: { type: "string", enum: ["opening", "content", "closing"] },
          narration: { type: "string" },
          visualBrief: { type: "string" },
          visualKind: { type: "string", enum: ["title", "still", "clip", "closing"] },
          claimType: { type: "string", enum: ["chapter", "context", "uncertain"] },
          sourceRefs: { type: "array", items: { type: "string" } },
          scriptureQuote: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

export function parsePlan(value: unknown): SequencePlan | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r["title"] !== "string" || !Array.isArray(r["scenes"])) return null;
  const roles = new Set(["opening", "content", "closing"]);
  const kinds = new Set(["title", "still", "clip", "closing"]);
  const claims = new Set(["chapter", "context", "uncertain"]);
  const scenes: PlannedScene[] = [];
  for (const item of r["scenes"]) {
    if (!item || typeof item !== "object") return null;
    const s = item as Record<string, unknown>;
    if (!roles.has(String(s["role"])) || !kinds.has(String(s["visualKind"])) || !claims.has(String(s["claimType"]))) return null;
    if (typeof s["narration"] !== "string" || typeof s["visualBrief"] !== "string" || !Array.isArray(s["sourceRefs"])) return null;
    const quote = s["scriptureQuote"];
    if (quote !== null && quote !== undefined && typeof quote !== "string") return null;
    scenes.push({
      role: s["role"] as SceneRole,
      narration: s["narration"].replace(/\s+/g, " ").trim(),
      visualBrief: s["visualBrief"].replace(/\s+/g, " ").trim(),
      visualKind: s["visualKind"] as VisualKind,
      claimType: s["claimType"] as ClaimType,
      sourceRefs: s["sourceRefs"].filter((x): x is string => typeof x === "string").map((x) => x.trim()).slice(0, 6),
      scriptureQuote: typeof quote === "string" && quote.trim() ? quote.replace(/\s+/g, " ").trim() : null,
    });
  }
  return { title: r["title"].replace(/\s+/g, " ").trim().slice(0, 120), scenes };
}

// ---------------------------------------------------------------- text helpers

const STOP = new Set("about above after again against among another around because before being below between both cannot could doing during each every first from further having here into itself just later little might more most much never other others ought over same shall should since some still such than that their theirs them then there these they this those through under until upon very were what when where which while whom whose with within without would your yours chapter passage reader readers scripture verse verses story shows moment people things something".split(" "));

export function words(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9']+/g) ?? [];
}
export function wordCount(text: string) {
  return words(text).length;
}
function stem(w: string) {
  return w.replace(/'s$/, "").slice(0, 5);
}
function contentStems(text: string) {
  return new Set(words(text).filter((w) => w.length >= 5 && !STOP.has(w)).map(stem));
}
function normalizeQuote(text: string) {
  return text.toLowerCase().replace(/[“”"‘’'`.,;:!?()\-—–]/g, " ").replace(/\s+/g, " ").trim();
}

/** Capitalised words not at sentence start — a deterministic proxy for named entities. */
export function namedEntities(text: string): string[] {
  const out = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    tokens.forEach((token, i) => {
      if (i === 0) return;
      if (/^[A-Z][a-z'’-]+$|^[A-Z]{2,}$/.test(token)) out.add(token.replace(/['’]s$/, ""));
    });
  }
  return [...out];
}

/** Generic terms that may appear capitalised without a guide source. */
const ENTITY_ALLOW = new Set(["God", "Lord", "LORD", "Scripture", "Scriptures", "Bible", "Israel", "Old", "New", "Testament", "Hebrew", "Greek", "I"]);

const DIALOGUE_PATTERNS: RegExp[] = [
  /\b(said|says|declares|declared|replied|replies|answered|answers|cried|told (?:him|her|them|us))\s*[,:]\s*[“"‘']/i,
  /\b(said|says|declares|declared|replied|answered)\s*[,:]\s*$/i,
  /(^|[^\w])(I|I'm|I'll|I've|me|my|mine)(?=[^\w']|$)/,
  /\b(thus says|hear me|listen to me|says the lord|i am the lord)\b/i,
];

const HEDGES = /\b(may|might|perhaps|likely|possibly|probably|uncertain|unclear|some (?:readers|scholars|interpreters)|it is not stated|the text does not say)\b/i;
const CAUSAL = /\b(because|therefore|so that|as a result|led to|caused|causes|in order to|resulted)\b/i;
const CHRONO = /\b(\d{2,4}|years?|centur(?:y|ies)|decades?|b\.?c\.?e?|a\.?d\.?|generations? later)\b/i;
const GENERIC_PHRASES = [/in this chapter we see/i, /timeless truth/i, /powerful reminder/i, /journey of faith/i, /now more than ever/i, /speaks to us today/i];
const VISUAL_BANNED = /\b(face|faces|facial|portrait|close-?up|photo(?:graph)?|photorealistic|footage|documentary footage|recording|archival|selfie|celebrity|text|caption|letters|words on|subtitle|map of|logo)\b/i;
const DIVINE = /\b(god|lord|jesus|christ|holy spirit|spirit of|angel|angels|divine|almighty)\b/i;
const SYMBOLIC = /\b(light|glow|radiance|cloud|abstract|symbolic|sky|dawn|rays?|silhouette|empty|stillness)\b/i;

function quotedSpans(text: string) {
  return [...text.matchAll(/[“"]([^”"]{3,})[”"]/g)].map((m) => m[1] ?? "");
}

// ---------------------------------------------------------------- deterministic gates

export type PlanIssue = { scene: number | null; code: string; detail: string };

/**
 * Deterministic grounding: refs must exist and every named entity, number, causal/chronology claim and
 * quotation must be supported by the referenced guide text (or verbatim chapter text for quotations).
 * Nothing is repaired: any issue rejects the plan.
 */
export function groundingIssues(plan: SequencePlan, sources: GroundingSources, ctx: { reference: string; chapterText: string }): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const chapterNorm = normalizeQuote(ctx.chapterText);
  const refWords = words(ctx.reference);
  plan.scenes.forEach((scene, i) => {
    const push = (code: string, detail: string) => issues.push({ scene: i, code, detail });
    const refs = scene.sourceRefs.filter((id) => sources[id]);
    if (scene.sourceRefs.length !== refs.length) push("unknown_ref", "Scene cites a guide source that does not exist.");
    if (!refs.length) { push("no_source", "Scene has no supporting guide source."); return; }
    const support = `${refs.map((id) => sources[id]).join(" ")} ${ctx.reference}`;
    const supportLower = support.toLowerCase();

    // Quotations: only verbatim chapter text, short, mirrored in scriptureQuote so it is labeled as Scripture.
    const spans = quotedSpans(scene.narration);
    for (const span of spans) {
      const norm = normalizeQuote(span);
      if (!norm || !chapterNorm.includes(norm)) push("fabricated_quote", "Quoted words are not verbatim chapter text.");
      else if (wordCount(span) > 25) push("long_quote", "Scripture quotation is longer than 25 words.");
      else if (!scene.scriptureQuote || normalizeQuote(scene.scriptureQuote) !== norm) push("unlabeled_quote", "Quotation is not labeled as Scripture.");
    }
    if (scene.scriptureQuote) {
      const norm = normalizeQuote(scene.scriptureQuote);
      if (!chapterNorm.includes(norm)) push("fabricated_quote", "Scripture quotation is not verbatim chapter text.");
      if (wordCount(scene.scriptureQuote) > 25) push("long_quote", "Scripture quotation is longer than 25 words.");
    }

    // Dialogue / impersonation outside verified quotations.
    const unquoted = scene.narration.replace(/[“"][^”"]*[”"]/g, " ");
    if (DIALOGUE_PATTERNS.some((re) => re.test(unquoted))) push("dialogue", "Narration contains character or divine speech outside a verified Scripture quotation.");
    if (/[‘'][^’']{12,}[’']/.test(unquoted)) push("dialogue", "Narration contains a quotation in single marks.");

    // Named entities, numbers, causal and chronology claims must appear in the cited sources.
    for (const entity of namedEntities(`${unquoted}. ${scene.visualBrief}`)) {
      if (ENTITY_ALLOW.has(entity) || refWords.includes(entity.toLowerCase())) continue;
      if (!supportLower.includes(entity.toLowerCase())) push("unsupported_entity", `“${entity}” is not in the cited guide sources.`);
    }
    for (const n of unquoted.match(/\b\d+\b/g) ?? []) {
      if (!support.includes(n)) push("unsupported_number", `The number ${n} is not in the cited guide sources.`);
    }
    if (CAUSAL.test(unquoted) && !CAUSAL.test(support) && scene.claimType === "chapter") push("unsupported_causal", "Causal claim is not stated in the cited sources.");
    if (CHRONO.test(unquoted) && !CHRONO.test(support)) push("unsupported_chronology", "Date or chronology is not in the cited sources.");

    // Lexical support ratio by claim type.
    const stems = contentStems(unquoted);
    const supportStems = contentStems(support);
    if (stems.size >= 4) {
      const hit = [...stems].filter((s) => supportStems.has(s)).length / stems.size;
      const min = scene.role !== "content" ? 0.2 : scene.claimType === "chapter" ? 0.45 : 0.3;
      if (hit < min) push("weak_support", "Narration is not supported closely enough by the cited sources.");
    }
    if (scene.claimType === "uncertain" && !HEDGES.test(unquoted)) push("unlabeled_uncertainty", "Uncertain claim is not worded as uncertain.");

    // Visual integrity.
    if (VISUAL_BANNED.test(scene.visualBrief)) push("visual_specifics", "Visual brief asks for faces, footage, text or other disallowed specifics.");
    if (DIVINE.test(scene.visualBrief) && !SYMBOLIC.test(scene.visualBrief)) push("divine_depiction", "Divine presence must be symbolic (light, cloud, stillness), not a literal figure.");
  });
  return issues;
}

/** Deterministic quality gate before any visual/narration spend. */
export function qualityIssues(plan: SequencePlan, mode: SequenceMode, sources: GroundingSources): PlanIssue[] {
  const spec = MODE_SPECS[mode];
  const issues: PlanIssue[] = [];
  const push = (scene: number | null, code: string, detail: string) => issues.push({ scene, code, detail });
  const scenes = plan.scenes;
  if (!plan.title) push(null, "no_title", "Plan has no title.");
  if (scenes.length < spec.scenes[0] || scenes.length > spec.scenes[1]) push(null, "scene_count", `Expected ${spec.scenes[0]}–${spec.scenes[1]} scenes.`);
  if (scenes[0]?.role !== "opening" || scenes[0]?.visualKind !== "title") push(0, "opening", "First scene must be the title/reference opening.");
  const last = scenes[scenes.length - 1];
  if (last?.role !== "closing" || last?.visualKind !== "closing") push(scenes.length - 1, "closing", "Last scene must be the closing return to Scripture.");
  if (last && !/\b(read|reread|scripture|text|chapter)\b/i.test(last.narration)) push(scenes.length - 1, "closing_return", "Closing must return the viewer to the chapter text.");
  scenes.slice(1, -1).forEach((s, i) => {
    if (s.role !== "content" || s.visualKind === "title" || s.visualKind === "closing") push(i + 1, "arc", "Middle scenes must be content scenes with a still or clip visual.");
  });
  const clips = scenes.filter((s) => s.visualKind === "clip").length;
  const stills = scenes.filter((s) => s.visualKind === "still").length;
  if (clips > spec.maxClips) push(null, "clip_cap", `At most ${spec.maxClips} motion clips.`);
  if (stills > spec.maxStills) push(null, "still_cap", `At most ${spec.maxStills} stills.`);

  const total = scenes.reduce((n, s) => n + wordCount(s.narration), 0);
  if (total < spec.words[0] || total > spec.words[1]) push(null, "word_budget", `Narration should be ${spec.words[0]}–${spec.words[1]} words (got ${total}).`);
  scenes.forEach((s, i) => {
    const n = wordCount(s.narration);
    if (n < 8 || n > 70) push(i, "scene_length", "Each scene needs 8–70 narration words.");
    if (s.visualKind !== "title" && s.visualKind !== "closing" && wordCount(s.visualBrief) < 6) push(i, "visual_brief", "Visual brief is too thin.");
  });

  // Duplicates.
  for (let a = 0; a < scenes.length; a += 1) {
    for (let b = a + 1; b < scenes.length; b += 1) {
      const x = contentStems(scenes[a]!.narration);
      const y = contentStems(scenes[b]!.narration);
      const inter = [...x].filter((s) => y.has(s)).length;
      const union = new Set([...x, ...y]).size || 1;
      if (inter / union >= 0.6) push(b, "duplicate", "Scene repeats an earlier scene.");
      if (scenes[a]!.visualBrief && scenes[a]!.visualBrief.toLowerCase() === scenes[b]!.visualBrief.toLowerCase()) push(b, "duplicate_visual", "Visual repeats an earlier scene.");
    }
  }

  // Chronological arc through the chapter's event sequence.
  let lastEvent = -1;
  scenes.forEach((s, i) => {
    if (s.role !== "content") return;
    const events = s.sourceRefs.map((r) => /^eventSequence\.(\d+)$/.exec(r)?.[1]).filter(Boolean).map(Number);
    if (!events.length) return;
    const first = Math.min(...events);
    if (first < lastEvent) push(i, "arc_order", "Content scenes jump backwards in the chapter's event order.");
    lastEvent = Math.max(lastEvent, ...events);
  });

  // Source coverage.
  const eventIds = Object.keys(sources).filter((k) => k.startsWith("eventSequence."));
  const usedEvents = new Set(scenes.flatMap((s) => s.sourceRefs.filter((r) => r.startsWith("eventSequence."))));
  const needEvents = Math.min(eventIds.length, mode === "quick" ? 2 : Math.ceil(eventIds.length * 0.6));
  if (usedEvents.size < needEvents) push(null, "coverage", "Plan does not cover enough of the chapter's events.");
  const fields = new Set(scenes.flatMap((s) => s.sourceRefs.map((r) => r.split(".")[0])));
  if (mode !== "quick" && fields.size < 3) push(null, "coverage_fields", "Standard and Deep plans must draw on at least three guide sections.");

  // Generic filler.
  if (mode !== "quick") {
    scenes.forEach((s, i) => {
      if (s.role === "content" && s.sourceRefs.every((r) => r === "summary")) push(i, "generic", "Content scene relies only on the summary.");
    });
  }
  const allText = scenes.map((s) => s.narration).join(" ");
  const generic = GENERIC_PHRASES.filter((re) => re.test(allText)).length;
  if (generic > 1) push(null, "generic_prose", "Narration leans on generic devotional filler.");
  return issues;
}

export function validatePlan(plan: SequencePlan, mode: SequenceMode, sources: GroundingSources, ctx: { reference: string; chapterText: string }) {
  return [...qualityIssues(plan, mode, sources), ...groundingIssues(plan, sources, ctx)];
}

// ---------------------------------------------------------------- hashing / dedupe keys

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalPlan(plan: SequencePlan) {
  return JSON.stringify({ title: plan.title, scenes: plan.scenes.map((s) => [s.role, s.narration, s.visualBrief, s.visualKind, s.claimType, s.sourceRefs, s.scriptureQuote]) });
}

export function visualKey(guideHash: string, scene: Pick<PlannedScene, "visualKind" | "visualBrief">) {
  const model = scene.visualKind === "clip" ? SEQUENCE_CLIP_MODEL : SEQUENCE_STILL_MODEL;
  return sha256(`${guideHash}|${SEQUENCE_PLAN_VERSION}|${scene.visualKind}|${model}|${scene.visualBrief}`);
}

export function narrationKey(text: string) {
  return sha256(`${SEQUENCE_PLAN_VERSION}|${SEQUENCE_TTS_MODEL}|${SEQUENCE_TTS_VOICE}|${text}`);
}

// ---------------------------------------------------------------- stage state machine

export type SequenceStage = "planning" | "visuals" | "narration" | "finalizing" | "done";
export type AssetStatus = "pending" | "generating" | "done" | "failed";
export const STAGE_ORDER: SequenceStage[] = ["planning", "visuals", "narration", "finalizing", "done"];

export type SceneState = { visualKind: VisualKind; visualStatus: AssetStatus; narrationStatus: AssetStatus };

/** Pure transition: given scene states, which stage is next and whether the current one failed. */
export function nextStage(stage: SequenceStage, scenes: SceneState[]): { stage: SequenceStage; failed: boolean } {
  if (stage === "visuals") {
    if (scenes.some((s) => s.visualStatus === "pending" || s.visualStatus === "generating")) return { stage, failed: false };
    if (scenes.some((s) => s.visualStatus === "failed")) return { stage, failed: true };
    return { stage: "narration", failed: false };
  }
  if (stage === "narration") {
    if (scenes.some((s) => s.narrationStatus === "pending" || s.narrationStatus === "generating")) return { stage, failed: false };
    if (scenes.some((s) => s.narrationStatus === "failed")) return { stage, failed: true };
    return { stage: "finalizing", failed: false };
  }
  return { stage, failed: false };
}

/** Explicit retry resets failed assets only; done assets are reused and the call ceiling is unchanged. */
export function retryReset<T extends SceneState>(scenes: T[], stage: SequenceStage): T[] {
  return scenes.map((s) =>
    stage === "visuals" && s.visualStatus === "failed" ? { ...s, visualStatus: "pending" }
      : stage === "narration" && s.narrationStatus === "failed" ? { ...s, narrationStatus: "pending" }
        : s,
  );
}

export function canSpend(usage: Partial<CallCounts>, budget: Partial<CallCounts>, kind: CallKind) {
  return (usage[kind] ?? 0) < (budget[kind] ?? 0);
}

// ---------------------------------------------------------------- timeline + captions

export type ManifestScene = {
  index: number;
  role: SceneRole;
  visualKind: VisualKind;
  claimType: ClaimType;
  narration: string;
  visualBrief: string;
  scriptureQuote: string | null;
  sourceRefs: string[];
  start: number;
  end: number;
};
export type Cue = { start: number; end: number; text: string; scene: number };
export type SequenceManifest = { version: typeof SEQUENCE_PLAN_VERSION; title: string; totalSeconds: number; scenes: ManifestScene[]; cues: Cue[] };

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Scene boundaries come only from measured narration audio; a missing/invalid duration throws so
 * finalization fails instead of drifting captions. Caption text is exactly the text sent to TTS,
 * split into sentences timed proportionally inside the measured scene window.
 */
export function buildManifest(title: string, scenes: Array<Omit<ManifestScene, "start" | "end"> & { narrationSeconds: number | null; ttsText: string }>): SequenceManifest {
  let t = 0;
  const outScenes: ManifestScene[] = [];
  const cues: Cue[] = [];
  for (const s of scenes) {
    if (typeof s.narrationSeconds !== "number" || !Number.isFinite(s.narrationSeconds) || s.narrationSeconds <= 0.3 || s.narrationSeconds > 120) {
      throw new Error(`Scene ${s.index + 1} has no reliable narration duration.`);
    }
    if (s.ttsText !== s.narration) throw new Error(`Scene ${s.index + 1} captions do not match the narrated text.`);
    const start = t;
    const end = t + s.narrationSeconds;
    const sentences = s.ttsText.match(/[^.!?]+[.!?]+["”’]?|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [s.ttsText];
    const chars = sentences.reduce((n, x) => n + x.length, 0) || 1;
    let c = start;
    sentences.forEach((text, i) => {
      const span = (text.length / chars) * s.narrationSeconds;
      const cueEnd = i === sentences.length - 1 ? end : c + span;
      cues.push({ start: round3(c), end: round3(cueEnd), text, scene: s.index });
      c = cueEnd;
    });
    const { narrationSeconds: _n, ttsText: _t, ...rest } = s;
    outScenes.push({ ...rest, start: round3(start), end: round3(end) });
    t = end;
  }
  return { version: SEQUENCE_PLAN_VERSION, title, totalSeconds: round3(t), scenes: outScenes, cues };
}

function stamp(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

export function cuesToVtt(cues: Cue[]) {
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join("\n\n")}\n`;
}

export function parseManifest(value: unknown): SequenceManifest | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<SequenceManifest>;
  if (r.version !== SEQUENCE_PLAN_VERSION || !Array.isArray(r.scenes) || !Array.isArray(r.cues) || typeof r.totalSeconds !== "number") return null;
  return r as SequenceManifest;
}

// ---------------------------------------------------------------- WAV measurement

/** Reads duration from a PCM WAV header (data bytes / byte rate). Returns null when it cannot be trusted. */
export function wavDurationSeconds(bytes: ArrayBuffer): number | null {
  const view = new DataView(bytes);
  if (bytes.byteLength < 44) return null;
  const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") byteRate = view.getUint32(offset + 16, true);
    if (id === "data") {
      if (!byteRate) return null;
      const available = Math.min(size === 0xffffffff || size === 0 ? bytes.byteLength - offset - 8 : size, bytes.byteLength - offset - 8);
      const seconds = available / byteRate;
      return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) / 1000 : null;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

// ---------------------------------------------------------------- prompts

export function planInstructions(mode: SequenceMode, reference: string) {
  const spec = MODE_SPECS[mode];
  return `You plan a private Bible study explainer for ${reference}. You are given numbered guide SOURCES and the CHAPTER TEXT. Return JSON only.

Rules (a validator rejects any violation; nothing is repaired):
- ${spec.scenes[0]}–${spec.scenes[1]} scenes. Scene 1: role "opening", visualKind "title" — names the reference and what the study covers. Last scene: role "closing", visualKind "closing" — invites the viewer back to read the chapter text itself.
- Middle scenes: role "content", visualKind "still" or "clip" (at most ${spec.maxClips} clips, at most ${spec.maxStills} stills). Follow the chapter's event order.
- Total narration ${spec.words[0]}–${spec.words[1]} words; each scene 8–70 words. Calm, neutral study narrator in third person. Teach what happens and why it matters using only the cited sources; no filler.
- Every scene lists sourceRefs (exact source ids). Every name, place, number, cause, date and detail must appear in the cited sources. Do not add facts, doctrine, archaeology, geography, clothing, ethnicity or chronology not in them.
- claimType: "chapter" for what the chapter states, "context" for guide background, "uncertain" for interpretation — word uncertain claims with "may", "perhaps" or "likely".
- Never write dialogue or first-person speech for God, Jesus, prophets or any character. No "he said:". No "I", "me", "my".
- A Scripture quotation is optional, at most 25 words, copied verbatim from CHAPTER TEXT, wrapped in double quotes in narration and copied exactly into scriptureQuote. Otherwise scriptureQuote is null and narration has no quotation marks.
- visualBrief: restrained, painterly, symbolic or environmental imagery. Figures distant or in silhouette, no faces, no text, no maps, never "footage". Divine presence only as light, cloud or stillness. Title/closing briefs may be short.`;
}

export function groundingCheckInstructions() {
  return `You audit a Bible study script. For each scene, decide whether every factual statement in its narration and visual brief is directly supported by its cited SOURCES (and, for quotations, the CHAPTER TEXT). Unsupported names, events, causes, dates, places, doctrine or visual specifics mean supported=false. Interpretation is acceptable only when the scene's claimType is "uncertain" or "context" and it is worded tentatively. Return JSON only.`;
}

export const GROUNDING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "supported", "reason"],
        properties: { index: { type: "integer" }, supported: { type: "boolean" }, reason: { type: "string" } },
      },
    },
  },
} as const;

export function parseGroundingVerdict(value: unknown, sceneCount: number): PlanIssue[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { scenes?: unknown }).scenes)) return null;
  const rows = (value as { scenes: Array<{ index?: unknown; supported?: unknown; reason?: unknown }> }).scenes;
  const seen = new Set<number>();
  const issues: PlanIssue[] = [];
  for (const row of rows) {
    if (typeof row.index !== "number" || typeof row.supported !== "boolean") return null;
    seen.add(row.index);
    if (!row.supported) issues.push({ scene: row.index, code: "entailment", detail: String(row.reason ?? "Not supported by cited sources.").slice(0, 200) });
  }
  for (let i = 0; i < sceneCount; i += 1) if (!seen.has(i)) return null; // incomplete audit = fail closed
  return issues;
}

export function stillPrompt(reference: string, scene: PlannedScene) {
  return `A calm, reverent, painterly study illustration for a private Bible study on ${reference}. Artistic interpretation only — not a historical photograph or record.
Scene: ${scene.visualBrief}
Style: muted natural earth tones, soft directional light, generous negative space, 3:2 landscape. Figures only at a distance or in silhouette with no identifiable faces. Where a detail is not stated, keep it abstract: light, landscape, texture. Divine presence only as light or cloud, never a figure.
No text, letters, captions, maps, logos or symbols. No weapons, gore or sensational action.`;
}

export function clipPrompt(reference: string, scene: PlannedScene) {
  return `A ${SEQUENCE_CLIP_SECONDS}-second calm, painterly study visual for a private Bible study on ${reference}. Artistic interpretation, never historical footage.
${scene.visualBrief}
One slow camera move (gentle push-in or slow pan), in a single continuous shot, no scene cuts. Figures distant or in silhouette, no identifiable faces. Divine presence only as light or cloud. Muted earth tones, soft light.
No dialogue. No narration. No on-screen text, letters or captions. No weapons or gore. Audio: near silence, soft room tone only. No music.`;
}
