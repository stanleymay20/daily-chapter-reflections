import { z } from "zod";

import { publicSupabasePublishableKey, publicSupabaseUrl } from "@/integrations/supabase/public-config";
import { studyGuideHash, visualStudyGuide } from "./study-guide";
import { groundingSources, type GroundingSources } from "./study-sequence.shared";
import { ProviderError, advanceSequence, gatewayProviders, restDb, retrySequence, type AdvanceResult } from "./study-sequence.server";

export const jobSchema = z.object({ jobId: z.string().uuid(), reference: z.string().trim().min(1).max(120).optional() });

export const json = (message: string, status: number, extra?: Record<string, unknown>) => Response.json({ message, ...extra }, { status });

export function bearerOf(request: Request) {
  const value = request.headers.get("authorization")?.trim();
  return value?.startsWith("Bearer ") && value.length > 7 ? value : null;
}

const asStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Re-reads the caller's persisted guide (RLS), re-verifies its hash, and loads trusted chapter text. */
export async function loadTrustedSources(auth: string, passage: string, versionId: number, guideHash: string, signal?: AbortSignal): Promise<{ sources: GroundingSources; chapterText: string }> {
  const url = new URL(`${publicSupabaseUrl().replace(/\/$/, "")}/rest/v1/ai_insights_cache`);
  url.searchParams.set("version_id", `eq.${versionId}`);
  url.searchParams.set("passage", `eq.${passage}`);
  url.searchParams.set("select", "insights");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { apikey: publicSupabasePublishableKey(), Authorization: auth }, signal: signal ?? null });
  if (!response.ok) throw new ProviderError(503, "The saved chapter guide could not be verified.");
  const rows = (await response.json()) as Array<{ insights?: unknown }>;
  const raw = rows[0]?.insights;
  const visual = visualStudyGuide(raw);
  if (!visual || (await studyGuideHash(visual)) !== guideHash) throw new ProviderError(409, "The chapter guide changed. Refresh before creating a study video.");
  const r = (raw ?? {}) as Record<string, unknown>;
  const sources = groundingSources({
    ...visual,
    themes: asStrings(r["themes"]),
    context: typeof r["context"] === "string" ? r["context"] : "",
    peoplePlaces: asStrings(r["peoplePlaces"]),
    crossReferences: asStrings(r["crossReferences"]),
    deeperStudy: asStrings(r["deeperStudy"]),
  });
  const { getPassage } = await import("./youversion.server");
  const passageResult = await getPassage(String(versionId), passage);
  const chapterText = passageResult.verses.map((v) => v.text).join(" ");
  if (!chapterText.trim()) throw new ProviderError(503, "The chapter text could not be loaded for quotation checks.");
  return { sources, chapterText };
}

export function view(result: Pick<AdvanceResult, "row" | "scenes"> & Partial<AdvanceResult>) {
  const { row, scenes } = result;
  const count = (f: (s: (typeof scenes)[number]) => boolean) => scenes.filter(f).length;
  const visualScenes = scenes.filter((s) => s.visual_kind === "still" || s.visual_kind === "clip");
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    error: row.stage_error,
    mode: row.study_mode,
    budget: row.call_budget,
    usage: row.call_usage,
    scenes: scenes.length,
    visuals: { done: visualScenes.filter((s) => s.visual_status === "done").length, total: visualScenes.length, failed: count((s) => s.visual_status === "failed") },
    narration: { done: count((s) => s.narration_status === "done"), total: scenes.length, failed: count((s) => s.narration_status === "failed") },
    worked: result.worked ?? false,
    waiting: result.waiting ?? false,
  };
}

export async function handleAdvance(request: Request, input: z.infer<typeof jobSchema>) {
  const auth = bearerOf(request);
  if (!auth) return json("Sign in in Settings to use AI study tools.", 401);
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json("AI study tools are not configured on this deployment.", 500);
  const db = restDb(auth);
  const row = await db.loadVideo(input.jobId).catch(() => null);
  if (!row || row.kind !== "sequence") return json("This study video was not found.", 404);
  try {
    const result = await advanceSequence({
      db,
      providers: gatewayProviders(apiKey),
      reference: input.reference ?? row.passage,
      loadSources: () => loadTrustedSources(auth, row.passage, row.version_id, row.guide_hash, request.signal),
      signal: request.signal,
    }, row.id);
    return Response.json(view(result));
  } catch (error) {
    if (error instanceof ProviderError && error.status === 409) {
      await db.patchVideo(row.id, { status: "failed", stage_error: error.message }, { status: "eq.generating" }).catch(() => null);
      return json(error.message, 409);
    }
    console.error("[study-sequence] advance failed", error instanceof Error ? error.message : error);
    return json(error instanceof ProviderError ? error.message : "The study video step could not run. Try again.", 503);
  }
}

export async function handleRetry(request: Request, input: z.infer<typeof jobSchema>) {
  const auth = bearerOf(request);
  if (!auth) return json("Sign in in Settings to use AI study tools.", 401);
  const db = restDb(auth);
  const row = await retrySequence(db, input.jobId).catch(() => null);
  if (!row) return json("Only a failed study video can be retried.", 409);
  return Response.json({ id: row.id, status: row.status, stage: row.stage });
}
