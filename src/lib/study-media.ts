import type { StudyInsights } from "./insights.functions";
import { STUDY_IMAGE_PROMPT_VERSION, studyGuideHash, visualStudyGuide } from "./study-guide";
import { supabase } from "@/integrations/supabase/client";
import { publicSupabasePublishableKey, publicSupabaseUrl } from "@/integrations/supabase/public-config";

const STUDY_IMAGE_BUCKET = "study-images";
const SIGNED_URL_SECONDS = 60 * 60 * 6;

type AuthContext = { token: string; userId: string };

type StudyImageRow = {
  id: string;
  user_id: string;
  job_id: string;
  passage: string;
  version_id: number;
  guide_hash: string;
  prompt_version: string;
  storage_path: string;
  created_at: string;
  selected_at: string;
};

export type StudyImageVersion = {
  id: string;
  jobId: string;
  url: string;
  storagePath: string;
  guideHash: string;
  createdAt: string;
  selectedAt: string;
};

export type StudyImageJobReservation = {
  id: string;
  status: "queued" | "generating";
  created: boolean;
  createdAt: string;
};

function versionNumber(versionId: string): number {
  const value = Number(versionId);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("The selected Bible translation is not valid for saved study media.");
  return value;
}

async function authContext(): Promise<AuthContext> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token || !data.session.user?.id) {
    throw new Error("Sign in to save and restore AI study pictures across devices.");
  }
  return { token: data.session.access_token, userId: data.session.user.id };
}

function restUrl(path: string): string {
  return `${publicSupabaseUrl()}/rest/v1/${path}`;
}

function restHeaders(token: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("apikey", publicSupabasePublishableKey());
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return headers;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { message?: string; error_description?: string; hint?: string };
    return parsed.message || parsed.error_description || parsed.hint || fallback;
  } catch {
    return text.slice(0, 500) || fallback;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function cachedInsights(value: unknown): StudyInsights | null {
  const visual = visualStudyGuide(value);
  if (!visual || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    summary: visual.summary,
    themes: stringArray(record["themes"]),
    context: typeof record["context"] === "string" ? record["context"] : "",
    peoplePlaces: stringArray(record["peoplePlaces"]),
    crossReferences: stringArray(record["crossReferences"]),
    reflectionQuestions: stringArray(record["reflectionQuestions"]),
    applications: stringArray(record["applications"]),
    prayerPrompts: stringArray(record["prayerPrompts"]),
    deeperStudy: stringArray(record["deeperStudy"]),
    eventSequence: visual.eventSequence,
    visualTimeline: visual.visualTimeline,
    relationships: visual.relationships,
    placeNotes: visual.placeNotes,
  };
}

export async function loadCachedStudyGuide(versionId: string, passage: string): Promise<StudyInsights | null> {
  const auth = await authContext();
  const url = new URL(restUrl("ai_insights_cache"));
  url.searchParams.set("user_id", `eq.${auth.userId}`);
  url.searchParams.set("version_id", `eq.${versionNumber(versionId)}`);
  url.searchParams.set("passage", `eq.${passage}`);
  url.searchParams.set("select", "insights");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: restHeaders(auth.token) });
  if (!response.ok) throw new Error(await responseMessage(response, "The saved chapter guide could not be loaded."));
  const rows = (await response.json()) as Array<{ insights?: unknown }>;
  return cachedInsights(rows[0]?.insights);
}

export async function saveCachedStudyGuide(versionId: string, passage: string, insights: StudyInsights): Promise<void> {
  if (!visualStudyGuide(insights)) throw new Error("The chapter guide is incomplete and cannot be saved for visual study.");
  const auth = await authContext();
  const response = await fetch(restUrl("ai_insights_cache"), {
    method: "POST",
    headers: restHeaders(auth.token, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({
      user_id: auth.userId,
      version_id: versionNumber(versionId),
      passage,
      insights,
      generated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "The chapter guide was created but could not be saved."));
}

export async function reserveStudyImageJob(versionId: string, passage: string, guideHash: string): Promise<StudyImageJobReservation> {
  const auth = await authContext();
  const response = await fetch(restUrl("rpc/reserve_study_image_job"), {
    method: "POST",
    headers: restHeaders(auth.token),
    body: JSON.stringify({
      p_passage: passage,
      p_version_id: versionNumber(versionId),
      p_guide_hash: guideHash,
      p_prompt_version: STUDY_IMAGE_PROMPT_VERSION,
    }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "The picture generation job could not be reserved."));
  const payload = (await response.json()) as Partial<StudyImageJobReservation>;
  if (!payload.id || (payload.status !== "queued" && payload.status !== "generating") || typeof payload.created !== "boolean") {
    throw new Error("The picture generation job returned an invalid reservation.");
  }
  return {
    id: payload.id,
    status: payload.status,
    created: payload.created,
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString(),
  };
}

export async function markStudyImageJob(
  jobId: string,
  status: "generating" | "completed" | "failed" | "cancelled",
  lastError?: string,
): Promise<void> {
  const auth = await authContext();
  const url = new URL(restUrl("study_image_jobs"));
  url.searchParams.set("id", `eq.${jobId}`);
  url.searchParams.set("user_id", `eq.${auth.userId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: restHeaders(auth.token, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      status,
      last_error: lastError ? lastError.slice(0, 1000) : null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "The picture generation state could not be saved."));
}

async function signedVersion(row: StudyImageRow): Promise<StudyImageVersion> {
  const { data, error } = await supabase.storage.from(STUDY_IMAGE_BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("A saved chapter picture could not be opened securely.");
  return {
    id: row.id,
    jobId: row.job_id,
    url: data.signedUrl,
    storagePath: row.storage_path,
    guideHash: row.guide_hash,
    createdAt: row.created_at,
    selectedAt: row.selected_at,
  };
}

export async function loadStudyImages(versionId: string, passage: string): Promise<StudyImageVersion[]> {
  const auth = await authContext();
  const url = new URL(restUrl("study_images"));
  url.searchParams.set("user_id", `eq.${auth.userId}`);
  url.searchParams.set("version_id", `eq.${versionNumber(versionId)}`);
  url.searchParams.set("passage", `eq.${passage}`);
  url.searchParams.set("select", "id,user_id,job_id,passage,version_id,guide_hash,prompt_version,storage_path,created_at,selected_at");
  url.searchParams.set("order", "selected_at.desc,created_at.desc");
  url.searchParams.set("limit", "12");
  const response = await fetch(url, { headers: restHeaders(auth.token) });
  if (!response.ok) throw new Error(await responseMessage(response, "Saved chapter pictures could not be loaded."));
  const rows = (await response.json()) as StudyImageRow[];
  return Promise.all(rows.map(signedVersion));
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/png);base64,(.+)$/s.exec(dataUrl);
  if (!match?.[2]) throw new Error("The generated picture is not a valid PNG image.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/png" });
}

export async function persistStudyImage(args: {
  jobId: string;
  versionId: string;
  passage: string;
  guideHash: string;
  dataUrl: string;
}): Promise<StudyImageVersion> {
  const auth = await authContext();
  const versionId = versionNumber(args.versionId);
  const storagePath = `${auth.userId}/${args.passage}/${versionId}/${args.jobId}.png`;
  const blob = dataUrlToBlob(args.dataUrl);
  const upload = await supabase.storage.from(STUDY_IMAGE_BUCKET).upload(storagePath, blob, {
    cacheControl: "31536000",
    contentType: "image/png",
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message || "The generated picture could not be saved.");

  const now = new Date().toISOString();
  const response = await fetch(restUrl("study_images"), {
    method: "POST",
    headers: restHeaders(auth.token, { Prefer: "return=representation" }),
    body: JSON.stringify({
      user_id: auth.userId,
      job_id: args.jobId,
      passage: args.passage,
      version_id: versionId,
      guide_hash: args.guideHash,
      prompt_version: STUDY_IMAGE_PROMPT_VERSION,
      storage_path: storagePath,
      selected_at: now,
    }),
  });
  if (!response.ok) {
    await supabase.storage.from(STUDY_IMAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    throw new Error(await responseMessage(response, "The generated picture file was saved, but its chapter record could not be created."));
  }
  const rows = (await response.json()) as StudyImageRow[];
  const row = rows[0];
  if (!row) throw new Error("The saved picture record was not returned.");
  await markStudyImageJob(args.jobId, "completed");
  return signedVersion(row);
}

export async function selectStudyImage(imageId: string): Promise<void> {
  const auth = await authContext();
  const url = new URL(restUrl("study_images"));
  url.searchParams.set("id", `eq.${imageId}`);
  url.searchParams.set("user_id", `eq.${auth.userId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: restHeaders(auth.token, { Prefer: "return=minimal" }),
    body: JSON.stringify({ selected_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "The selected picture version could not be saved."));
}

export async function hashInsightsForImage(insights: StudyInsights): Promise<string> {
  const guide = visualStudyGuide(insights);
  if (!guide) throw new Error("Build a complete chapter guide before creating a picture.");
  return studyGuideHash(guide);
}
