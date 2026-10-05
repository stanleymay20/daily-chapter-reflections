import { publicSupabasePublishableKey, publicSupabaseUrl } from "@/integrations/supabase/public-config";
import {
  GROUNDING_JSON_SCHEMA,
  MODE_SPECS,
  PLAN_JSON_SCHEMA,
  SEQUENCE_CLIP_SECONDS,
  SEQUENCE_PLANNER_MODEL,
  SEQUENCE_STILL_MODEL,
  SEQUENCE_TTS_MODEL,
  SEQUENCE_TTS_VOICE,
  buildManifest,
  canonicalPlan,
  clipPrompt,
  groundingCheckInstructions,
  narrationKey,
  nextStage,
  parseGroundingVerdict,
  parsePlan,
  planInstructions,
  sha256,
  stillPrompt,
  validatePlan,
  visualKey,
  wavDurationSeconds,
  type AssetStatus,
  type CallKind,
  type GroundingSources,
  type PlanIssue,
  type PlannedScene,
  type SequenceMode,
  type SequencePlan,
  type SequenceStage,
} from "./study-sequence.shared";

/**
 * Video Aid v1 server engine. Every DB/storage call uses the caller's bearer token so RLS remains the
 * boundary; spend is gated by the SECURITY DEFINER call ledger before each provider call.
 * One `advance` performs at most one paid provider call (plus free status polls), so no request
 * outlives the runtime and nothing retries itself.
 */

const GATEWAY = "https://ai.gateway.lovable.dev";
export const SEQUENCE_BUCKET = "study-videos";

export type SequenceRow = {
  id: string;
  user_id: string;
  passage: string;
  version_id: number;
  guide_hash: string;
  kind: string;
  study_mode: SequenceMode | null;
  status: "queued" | "generating" | "completed" | "failed" | "cancelled";
  stage: SequenceStage | null;
  stage_error: string | null;
  plan_hash: string | null;
  plan_title: string | null;
  call_budget: Partial<Record<CallKind, number>>;
  call_usage: Partial<Record<CallKind, number>>;
  duration_seconds: number;
  manifest: unknown;
};

export type SceneRow = {
  id: string;
  video_id: string;
  user_id: string;
  scene_index: number;
  role: PlannedScene["role"];
  visual_kind: PlannedScene["visualKind"];
  claim_type: PlannedScene["claimType"];
  narration: string;
  visual_brief: string;
  source_refs: string[];
  scripture_quote: string | null;
  visual_key: string | null;
  visual_status: AssetStatus;
  visual_path: string | null;
  visual_job_id: string | null;
  narration_key: string | null;
  narration_status: AssetStatus;
  narration_path: string | null;
  narration_seconds: number | null;
  tts_text: string | null;
  last_error: string | null;
};

const VIDEO_COLS = "id,user_id,passage,version_id,guide_hash,kind,study_mode,status,stage,stage_error,plan_hash,plan_title,call_budget,call_usage,duration_seconds,manifest";
const SCENE_COLS = "id,video_id,user_id,scene_index,role,visual_kind,claim_type,narration,visual_brief,source_refs,scripture_quote,visual_key,visual_status,visual_path,visual_job_id,narration_key,narration_status,narration_path,narration_seconds,tts_text,last_error";

// ---------------------------------------------------------------- data access (owner token)

export type Db = {
  loadVideo(id: string): Promise<SequenceRow | null>;
  patchVideo(id: string, patch: Record<string, unknown>, where?: Record<string, string>): Promise<SequenceRow | null>;
  loadScenes(videoId: string): Promise<SceneRow[]>;
  insertScenes(rows: Array<Partial<SceneRow>>): Promise<void>;
  patchScene(id: string, patch: Partial<SceneRow>): Promise<void>;
  findAsset(field: "visual_key" | "narration_key", key: string): Promise<SceneRow | null>;
  consumeCall(videoId: string, kind: CallKind): Promise<boolean>;
  lockPlan(videoId: string, planHash: string, title: string): Promise<boolean>;
  upload(path: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
};

function base() {
  return publicSupabaseUrl().replace(/\/$/, "");
}

export function restDb(auth: string): Db {
  const h = (extra?: HeadersInit) => {
    const headers = new Headers(extra);
    headers.set("apikey", publicSupabasePublishableKey());
    headers.set("Authorization", auth);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return headers;
  };
  const rest = async <T>(path: string, init: RequestInit = {}, params: Record<string, string> = {}): Promise<T> => {
    const url = new URL(`${base()}/rest/v1/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const response = await fetch(url, { ...init, headers: h(init.headers) });
    if (!response.ok) throw new Error(`${path} request failed (${response.status})`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  };
  return {
    async loadVideo(id) {
      const rows = await rest<SequenceRow[]>("study_videos", {}, { id: `eq.${id}`, select: VIDEO_COLS, limit: "1" });
      return rows[0] ?? null;
    },
    async patchVideo(id, patch, where = {}) {
      const params: Record<string, string> = { id: `eq.${id}`, select: VIDEO_COLS, ...where };
      const rows = await rest<SequenceRow[]>("study_videos", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }, params);
      return rows[0] ?? null;
    },
    async loadScenes(videoId) {
      const rows = await rest<SceneRow[]>("study_video_scenes", {}, { video_id: `eq.${videoId}`, select: SCENE_COLS, order: "scene_index.asc" });
      return rows.map((r) => ({ ...r, narration_seconds: r.narration_seconds === null ? null : Number(r.narration_seconds) }));
    },
    async insertScenes(rows) {
      await rest("study_video_scenes", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    },
    async patchScene(id, patch) {
      await rest("study_video_scenes", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }, { id: `eq.${id}` });
    },
    async findAsset(field, key) {
      const pathField = field === "visual_key" ? "visual_path" : "narration_path";
      const statusField = field === "visual_key" ? "visual_status" : "narration_status";
      const rows = await rest<SceneRow[]>("study_video_scenes", {}, { [field]: `eq.${key}`, [statusField]: "eq.done", [pathField]: "not.is.null", select: SCENE_COLS, limit: "1" });
      return rows[0] ? { ...rows[0], narration_seconds: rows[0].narration_seconds === null ? null : Number(rows[0].narration_seconds) } : null;
    },
    async consumeCall(videoId, kind) {
      return (await rest<boolean>("rpc/consume_study_video_call", { method: "POST", body: JSON.stringify({ p_video_id: videoId, p_kind: kind }) })) === true;
    },
    async lockPlan(videoId, planHash, title) {
      return (await rest<boolean>("rpc/lock_study_video_plan", { method: "POST", body: JSON.stringify({ p_video_id: videoId, p_plan_hash: planHash, p_title: title }) })) === true;
    },
    async upload(path, bytes, contentType) {
      const response = await fetch(`${base()}/storage/v1/object/${SEQUENCE_BUCKET}/${path}`, { method: "POST", headers: h({ "Content-Type": contentType, "x-upsert": "false" }), body: bytes });
      if (response.ok || response.status === 409) return;
      const text = await response.text().catch(() => "");
      if (/already exists|Duplicate/i.test(text)) return;
      throw new Error(`asset upload failed (${response.status})`);
    },
    async copy(from, to) {
      const response = await fetch(`${base()}/storage/v1/object/copy`, { method: "POST", headers: h(), body: JSON.stringify({ bucketId: SEQUENCE_BUCKET, sourceKey: from, destinationKey: to }) });
      if (!response.ok && response.status !== 409) throw new Error(`asset copy failed (${response.status})`);
    },
  };
}

// ---------------------------------------------------------------- providers

export class ProviderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type ClipJob = { id: string; status: "queued" | "in_progress" | "completed" | "failed"; error?: { code?: string; message?: string } };

export type Providers = {
  json(instructions: string, input: string, schemaName: string, schema: unknown, signal?: AbortSignal): Promise<unknown>;
  still(prompt: string, signal?: AbortSignal): Promise<ArrayBuffer>;
  clipCreate(prompt: string, signal?: AbortSignal): Promise<ClipJob>;
  clipPoll(id: string): Promise<ClipJob>;
  clipDownload(id: string): Promise<ArrayBuffer>;
  speech(text: string, signal?: AbortSignal): Promise<ArrayBuffer>;
};

async function providerError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
  return new ProviderError(response.status, (body?.message || body?.error?.message || fallback).slice(0, 500));
}

/** Streams a Responses call and returns the parsed JSON output. Never retried here. */
async function streamJson(apiKey: string, instructions: string, input: string, name: string, schema: unknown, signal?: AbortSignal) {
  const response = await fetch(`${GATEWAY}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: SEQUENCE_PLANNER_MODEL,
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "medium", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
    signal: signal ?? null,
  });
  if (!response.ok || !response.body) throw await providerError(response, `Planning request failed (${response.status}).`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += chunk.value;
    let split: number;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as { type?: string; delta?: string; response?: { error?: { message?: string } }; message?: string };
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
      else if (event.type === "response.refusal.delta") throw new ProviderError(403, "The planning model declined this request.");
      else if (event.type === "response.failed" || event.type === "error") throw new ProviderError(502, event.response?.error?.message || event.message || "Planning failed.");
      else if (event.type === "response.completed") done = true;
    }
  }
  if (!done) throw new ProviderError(502, "The planning response ended early.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(502, "The planning response was not valid JSON.");
  }
}

export function gatewayProviders(apiKey: string): Providers {
  return {
    json: (instructions, input, name, schema, signal) => streamJson(apiKey, instructions, input, name, schema, signal),
    async still(prompt, signal) {
      const response = await fetch(`${GATEWAY}/v1/images/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: SEQUENCE_STILL_MODEL, prompt, size: "1536x1024", quality: "medium" }),
        signal: signal ?? null,
      });
      if (!response.ok) throw await providerError(response, `Illustration failed (${response.status}).`);
      const body = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError(502, "The illustration response had no image.");
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    },
    async clipCreate(prompt, signal) {
      const { createStudyVideo } = await import("./video-gateway.server");
      return createStudyVideo(apiKey, prompt, signal, SEQUENCE_CLIP_SECONDS);
    },
    async clipPoll(id) {
      const { pollStudyVideo } = await import("./video-gateway.server");
      return pollStudyVideo(apiKey, id);
    },
    async clipDownload(id) {
      const { downloadStudyVideo } = await import("./video-gateway.server");
      return downloadStudyVideo(apiKey, id);
    },
    async speech(text, signal) {
      const response = await fetch(`${GATEWAY}/v1/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: SEQUENCE_TTS_MODEL,
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SEQUENCE_TTS_VOICE } } } },
          stream_format: "audio",
        }),
        signal: signal ?? null,
      });
      if (!response.ok) throw await providerError(response, `Narration failed (${response.status}).`);
      return response.arrayBuffer();
    },
  };
}

// ---------------------------------------------------------------- engine

export type EngineContext = {
  db: Db;
  providers: Providers;
  reference: string;
  /** Server-reloaded, hash-verified guide sources and trusted chapter text. Loaded only when planning. */
  loadSources: () => Promise<{ sources: GroundingSources; chapterText: string }>;
  signal?: AbortSignal;
};

export type AdvanceResult = { row: SequenceRow; scenes: SceneRow[]; worked: boolean; waiting: boolean; issues?: PlanIssue[] };

function storagePath(row: SequenceRow, scene: number, ext: string) {
  return `${row.user_id}/${row.passage}/${row.version_id}/${row.id}/s${String(scene).padStart(2, "0")}.${ext}`;
}

export async function planHashFor(scenes: Array<Pick<SceneRow, "role" | "narration" | "visual_brief" | "visual_kind" | "claim_type" | "source_refs" | "scripture_quote">>, title: string) {
  const plan: SequencePlan = {
    title,
    scenes: scenes.map((s) => ({ role: s.role, narration: s.narration, visualBrief: s.visual_brief, visualKind: s.visual_kind, claimType: s.claim_type, sourceRefs: s.source_refs, scriptureQuote: s.scripture_quote })),
  };
  return sha256(canonicalPlan(plan));
}

function safeError(error: unknown, fallback: string) {
  if (error instanceof ProviderError) {
    if (error.status === 402) return "AI credits are used up for this workspace. Nothing more will be generated until credits are added.";
    if (error.status === 429) return "The AI service is busy. Retry this stage later.";
    if (error.status === 403) return "The AI provider declined this request.";
    return error.message || fallback;
  }
  return fallback;
}

async function fail(ctx: EngineContext, row: SequenceRow, message: string) {
  const updated = await ctx.db.patchVideo(row.id, { status: "failed", stage_error: message.slice(0, 2000), last_error: message.slice(0, 1000) }, { status: "eq.generating" });
  return updated ?? { ...row, status: "failed" as const, stage_error: message };
}

async function runPlanning(ctx: EngineContext, row: SequenceRow): Promise<AdvanceResult> {
  const mode = row.study_mode;
  if (!mode || !MODE_SPECS[mode]) return { row: await fail(ctx, row, "Unknown study mode."), scenes: [], worked: false, waiting: false };
  const { sources, chapterText } = await ctx.loadSources();
  const input = `REFERENCE: ${ctx.reference}\n\nSOURCES:\n${Object.entries(sources).map(([id, text]) => `[${id}] ${text}`).join("\n")}\n\nCHAPTER TEXT:\n${chapterText.slice(0, 24000)}`;

  if (!(await ctx.db.consumeCall(row.id, "plan"))) return { row: await fail(ctx, row, "This generation reached its planning call limit. Start a new version to try again."), scenes: [], worked: false, waiting: false };
  let plan: SequencePlan | null;
  try {
    plan = parsePlan(await ctx.providers.json(planInstructions(mode, ctx.reference), input, "study_sequence_plan", PLAN_JSON_SCHEMA, ctx.signal));
  } catch (error) {
    return { row: await fail(ctx, row, safeError(error, "The study plan could not be created.")), scenes: [], worked: true, waiting: false };
  }
  if (!plan) return { row: await fail(ctx, row, "The study plan had an invalid shape."), scenes: [], worked: true, waiting: false };

  // Deterministic gates first — before any further spend. Nothing is repaired.
  const issues = validatePlan(plan, mode, sources, { reference: ctx.reference, chapterText });
  if (issues.length) return { row: await fail(ctx, row, `The draft plan did not pass grounding and quality checks (${issues.slice(0, 4).map((i) => i.detail).join(" ")})`), scenes: [], worked: true, waiting: false, issues };

  // Bounded semantic entailment audit: one call, fail closed on incomplete or negative verdicts.
  if (!(await ctx.db.consumeCall(row.id, "plan"))) return { row: await fail(ctx, row, "This generation reached its planning call limit."), scenes: [], worked: true, waiting: false };
  let verdict: PlanIssue[] | null;
  try {
    const auditInput = `${input}\n\nSCRIPT:\n${plan.scenes.map((s, i) => `#${i} claimType=${s.claimType} sources=${s.sourceRefs.join(",")}\nnarration: ${s.narration}\nvisual: ${s.visualBrief}`).join("\n\n")}`;
    verdict = parseGroundingVerdict(await ctx.providers.json(groundingCheckInstructions(), auditInput, "grounding_audit", GROUNDING_JSON_SCHEMA, ctx.signal), plan.scenes.length);
  } catch (error) {
    return { row: await fail(ctx, row, safeError(error, "The grounding check could not run.")), scenes: [], worked: true, waiting: false };
  }
  if (!verdict) return { row: await fail(ctx, row, "The grounding check returned an incomplete audit."), scenes: [], worked: true, waiting: false };
  if (verdict.length) return { row: await fail(ctx, row, `Some scenes were not supported by the saved guide (${verdict.slice(0, 3).map((v) => v.detail).join(" ")})`), scenes: [], worked: true, waiting: false, issues: verdict };

  const rows = await Promise.all(plan.scenes.map(async (s, index) => {
    const needsVisual = s.visualKind === "still" || s.visualKind === "clip";
    return {
      video_id: row.id,
      user_id: row.user_id,
      scene_index: index,
      role: s.role,
      visual_kind: s.visualKind,
      claim_type: s.claimType,
      narration: s.narration,
      visual_brief: s.visualBrief,
      source_refs: s.sourceRefs,
      scripture_quote: s.scriptureQuote,
      visual_key: needsVisual ? await visualKey(row.guide_hash, s) : null,
      visual_status: (needsVisual ? "pending" : "done") as AssetStatus,
      narration_key: await narrationKey(s.narration),
      narration_status: "pending" as AssetStatus,
    };
  }));
  await ctx.db.insertScenes(rows);
  const hash = await sha256(canonicalPlan(plan));
  if (!(await ctx.db.lockPlan(row.id, hash, plan.title))) return { row: await fail(ctx, row, "The study plan could not be locked."), scenes: [], worked: true, waiting: false };
  const updated = (await ctx.db.loadVideo(row.id)) ?? row;
  return { row: updated, scenes: await ctx.db.loadScenes(row.id), worked: true, waiting: false };
}

async function verifyPlan(ctx: EngineContext, row: SequenceRow, scenes: SceneRow[]) {
  if (!row.plan_hash || !row.plan_title || !scenes.length) return false;
  return (await planHashFor(scenes, row.plan_title)) === row.plan_hash;
}

async function runVisuals(ctx: EngineContext, row: SequenceRow, scenes: SceneRow[]): Promise<{ worked: boolean; waiting: boolean }> {
  // Free: poll clips already started.
  let waiting = false;
  for (const scene of scenes.filter((s) => s.visual_status === "generating" && s.visual_job_id)) {
    try {
      const job = await ctx.providers.clipPoll(scene.visual_job_id as string);
      if (job.status === "completed") {
        const path = storagePath(row, scene.scene_index, "mp4");
        await ctx.db.upload(path, await ctx.providers.clipDownload(scene.visual_job_id as string), "video/mp4");
        await ctx.db.patchScene(scene.id, { visual_status: "done", visual_path: path, last_error: null });
        scene.visual_status = "done";
      } else if (job.status === "failed") {
        const message = job.error?.code === "moderation_blocked" ? "The provider's safety filter blocked this scene." : job.error?.message || "The motion scene could not be finished.";
        await ctx.db.patchScene(scene.id, { visual_status: "failed", last_error: message.slice(0, 1000) });
        scene.visual_status = "failed";
      } else waiting = true;
    } catch {
      waiting = true; // transient poll failure: try again on the next explicit advance
    }
  }

  const next = scenes.find((s) => s.visual_status === "pending");
  if (!next) return { worked: false, waiting };
  const kind: CallKind = next.visual_kind === "clip" ? "clip" : "still";
  const ext = kind === "clip" ? "mp4" : "png";
  const path = storagePath(row, next.scene_index, ext);

  // Reuse an identical completed asset (same guide hash + plan version + scene brief + model).
  if (next.visual_key) {
    const prior = await ctx.db.findAsset("visual_key", next.visual_key).catch(() => null);
    if (prior?.visual_path && prior.visual_path.endsWith(`.${ext}`)) {
      try {
        await ctx.db.copy(prior.visual_path, path);
        await ctx.db.patchScene(next.id, { visual_status: "done", visual_path: path, last_error: null });
        next.visual_status = "done";
        return { worked: true, waiting };
      } catch { /* fall through to generation */ }
    }
  }

  if (!(await ctx.db.consumeCall(row.id, kind))) {
    await ctx.db.patchScene(next.id, { visual_status: "failed", last_error: "This generation reached its visual call limit." });
    next.visual_status = "failed";
    return { worked: false, waiting };
  }
  const planned: PlannedScene = { role: next.role, narration: next.narration, visualBrief: next.visual_brief, visualKind: next.visual_kind, claimType: next.claim_type, sourceRefs: next.source_refs, scriptureQuote: next.scripture_quote };
  try {
    if (kind === "clip") {
      const job = await ctx.providers.clipCreate(clipPrompt(ctx.reference, planned), ctx.signal);
      await ctx.db.patchScene(next.id, { visual_status: "generating", visual_job_id: job.id, last_error: null });
      next.visual_status = "generating";
      return { worked: true, waiting: true };
    }
    const bytes = await ctx.providers.still(stillPrompt(ctx.reference, planned), ctx.signal);
    await ctx.db.upload(path, bytes, "image/png");
    await ctx.db.patchScene(next.id, { visual_status: "done", visual_path: path, last_error: null });
    next.visual_status = "done";
  } catch (error) {
    await ctx.db.patchScene(next.id, { visual_status: "failed", last_error: safeError(error, "This scene's visual could not be created.").slice(0, 1000) });
    next.visual_status = "failed";
  }
  return { worked: true, waiting };
}

async function runNarration(ctx: EngineContext, row: SequenceRow, scenes: SceneRow[]): Promise<boolean> {
  const next = scenes.find((s) => s.narration_status === "pending");
  if (!next) return false;
  const path = storagePath(row, next.scene_index, "wav");
  const text = next.narration; // exactly what is sent to TTS and later captioned
  const key = await narrationKey(text);
  const prior = await ctx.db.findAsset("narration_key", key).catch(() => null);
  if (prior?.narration_path && prior.narration_seconds && prior.tts_text === text) {
    try {
      await ctx.db.copy(prior.narration_path, path);
      await ctx.db.patchScene(next.id, { narration_status: "done", narration_path: path, narration_seconds: prior.narration_seconds, tts_text: text, narration_key: key, last_error: null });
      next.narration_status = "done";
      return true;
    } catch { /* regenerate */ }
  }
  if (!(await ctx.db.consumeCall(row.id, "tts"))) {
    await ctx.db.patchScene(next.id, { narration_status: "failed", last_error: "This generation reached its narration call limit." });
    next.narration_status = "failed";
    return false;
  }
  try {
    const audio = await ctx.providers.speech(text, ctx.signal);
    const seconds = wavDurationSeconds(audio);
    if (!seconds) throw new Error("Narration audio length could not be measured.");
    await ctx.db.upload(path, audio, "audio/wav");
    await ctx.db.patchScene(next.id, { narration_status: "done", narration_path: path, narration_seconds: seconds, tts_text: text, narration_key: key, last_error: null });
    next.narration_status = "done";
  } catch (error) {
    await ctx.db.patchScene(next.id, { narration_status: "failed", last_error: (error instanceof ProviderError ? safeError(error, "") : error instanceof Error ? error.message : "Narration failed.").slice(0, 1000) });
    next.narration_status = "failed";
  }
  return true;
}

function sceneStates(scenes: SceneRow[]) {
  return scenes.map((s) => ({ visualKind: s.visual_kind, visualStatus: s.visual_status, narrationStatus: s.narration_status }));
}

/** One bounded step of the pipeline. */
export async function advanceSequence(ctx: EngineContext, videoId: string): Promise<AdvanceResult> {
  let row = await ctx.db.loadVideo(videoId);
  if (!row || row.kind !== "sequence") throw new ProviderError(404, "This study video was not found.");
  // Queued rows have not been charged the 'video' quota yet; only sequence-start may move them on.
  if (row.status !== "generating") return { row, scenes: await ctx.db.loadScenes(row.id), worked: false, waiting: false };

  if (row.stage === "planning" || !row.stage) return runPlanning(ctx, row);

  const scenes = await ctx.db.loadScenes(row.id);
  if (!(await verifyPlan(ctx, row, scenes))) return { row: await fail(ctx, row, "The saved study plan no longer matches its locked version."), scenes, worked: false, waiting: false };

  let worked = false;
  let waiting = false;
  if (row.stage === "visuals") {
    const step = await runVisuals(ctx, row, scenes);
    worked = step.worked;
    waiting = step.waiting;
  } else if (row.stage === "narration") {
    worked = await runNarration(ctx, row, scenes);
  }

  if (row.stage === "visuals" || row.stage === "narration") {
    const transition = nextStage(row.stage, sceneStates(scenes));
    if (transition.failed) {
      const failedCount = scenes.filter((s) => (row!.stage === "visuals" ? s.visual_status : s.narration_status) === "failed").length;
      return { row: await fail(ctx, row, `${failedCount} scene${failedCount === 1 ? "" : "s"} could not be completed in the ${row.stage} stage. Retry this stage to try only those scenes.`), scenes, worked, waiting: false };
    }
    if (transition.stage !== row.stage) row = (await ctx.db.patchVideo(row.id, { stage: transition.stage, stage_error: null }, { status: "eq.generating" })) ?? row;
  }

  if (row.stage === "finalizing") {
    const finalScenes = await ctx.db.loadScenes(row.id);
    try {
      const manifest = buildManifest(row.plan_title ?? ctx.reference, finalScenes.map((s) => ({
        index: s.scene_index, role: s.role, visualKind: s.visual_kind, claimType: s.claim_type, narration: s.narration,
        visualBrief: s.visual_brief, scriptureQuote: s.scripture_quote, sourceRefs: s.source_refs,
        narrationSeconds: s.narration_seconds, ttsText: s.tts_text ?? "",
      })));
      row = (await ctx.db.patchVideo(row.id, { status: "completed", stage: "done", manifest, duration_seconds: Math.min(300, Math.round(manifest.totalSeconds)), progress: 100, stage_error: null, last_error: null }, { status: "eq.generating" })) ?? row;
      worked = true;
    } catch (error) {
      return { row: await fail(ctx, row, error instanceof Error ? error.message : "Finalizing failed."), scenes, worked, waiting: false };
    }
  }
  return { row, scenes, worked, waiting };
}

/** Explicit retry: failed assets of the failed stage go back to pending; done assets are kept; the ceiling is unchanged. */
export async function retrySequence(db: Db, videoId: string) {
  const row = await db.loadVideo(videoId);
  if (!row || row.kind !== "sequence" || row.status !== "failed") return null;
  const scenes = await db.loadScenes(videoId);
  if (row.stage === "visuals") for (const s of scenes.filter((x) => x.visual_status === "failed")) await db.patchScene(s.id, { visual_status: "pending", visual_job_id: null, last_error: null });
  if (row.stage === "narration") for (const s of scenes.filter((x) => x.narration_status === "failed")) await db.patchScene(s.id, { narration_status: "pending", last_error: null });
  return db.patchVideo(videoId, { status: "generating", stage_error: null, last_error: null }, { status: "eq.failed" });
}
