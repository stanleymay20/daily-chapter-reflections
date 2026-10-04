import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDY_VIDEO_DURATION_SECONDS,
  STUDY_VIDEO_LABEL,
  STUDY_VIDEO_MAX_SCENES,
  buildVideoPrompt,
  buildVideoScenes,
  parseScenes,
  safeReference,
  scenesToVtt,
} from "../study-video.shared";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const migration = src("../../../drizzle/migrations/0005_study_video_aid.sql");
const startRoute = src("../../routes/api/study-video/start.ts");
const statusRoute = src("../../routes/api/study-video/status.ts");
const hook = src("../../hooks/useStudyVideo.ts");
const component = src("../../components/StudyVideoAid.tsx");
const client = src("../study-video.ts");
const reader = src("../../routes/read.$passage.tsx");
const access = src("../ai-access.server.ts");

const guide = {
  summary: "Joseph's brothers travel to Egypt for grain.",
  eventSequence: ["Jacob sends ten sons to Egypt", "Joseph recognises his brothers", "Simeon is held", "Silver is found in the sacks", "Jacob grieves"],
  visualTimeline: [],
  relationships: [],
  placeNotes: [],
};

describe("video aid scene and prompt builder", () => {
  it("caps scenes, times them evenly across the clip, and derives them only from the guide", () => {
    const scenes = buildVideoScenes(guide);
    expect(scenes).toHaveLength(STUDY_VIDEO_MAX_SCENES);
    expect(scenes[0]!.start).toBe(0);
    expect(scenes.at(-1)!.end).toBe(STUDY_VIDEO_DURATION_SECONDS);
    expect(scenes.map((s) => s.description)).toEqual(guide.eventSequence.slice(0, 4));
  });

  it("forbids speech, on-screen text and historical-footage framing", () => {
    const prompt = buildVideoPrompt("Genesis 42", guide, buildVideoScenes(guide));
    for (const rule of ["No dialogue", "No narration", "No on-screen text", "never historical footage", "keep it abstract"]) expect(prompt).toContain(rule);
  });

  it("sanitises the client-supplied reference label", () => {
    expect(safeReference("Genesis 42 <script>{x}</script>")).not.toMatch(/[<>{}]/);
  });

  it("produces a valid WebVTT scene-description track and round-trips scene metadata", () => {
    const scenes = buildVideoScenes(guide);
    const vtt = scenesToVtt(scenes);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:02.000");
    expect(parseScenes(JSON.parse(JSON.stringify(scenes)))).toEqual(scenes);
    expect(parseScenes([{ start: "x" }, null])).toEqual([]);
  });
});

describe("video aid security and cost contract", () => {
  it("adds a dedicated, small 'video' quota without touching other limits", () => {
    expect(access).toContain('"video"');
    expect(migration).toContain("when 'video' then v_hour_limit := 2; v_day_limit := 3;");
    expect(migration).toContain("when 'image' then v_hour_limit := 6; v_day_limit := 15;");
    expect(migration).toContain("'image', 'video'");
    expect(migration).toContain("revoke all on function public.consume_ai_quota(text) from public, anon");
    expect(startRoute).toContain('authorizeAiRequest(request, "video")');
    expect(startRoute).not.toContain('"image")');
  });

  it("keeps rows and files owner-only with immutable identity columns and a private bucket", () => {
    expect(migration).toContain("alter table public.study_videos enable row level security");
    expect(migration).toContain("revoke all on public.study_videos from anon");
    expect(migration).toMatch(/grant update \(status, provider_job_id, progress, storage_path, scenes, last_error, updated_at, selected_at\)/);
    expect(migration).toContain("storage_path like user_id::text || '/%'");
    expect(migration).toContain("bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text");
    expect(migration).not.toMatch(/storage\.buckets/);
    expect(migration).toMatch(/reserve_study_video_job[\s\S]*security invoker[\s\S]*set search_path = public, pg_temp/);
    expect(migration).toContain("study_videos_one_active_idx");
    expect(client).toContain("createSignedUrl");
    expect(client).not.toContain("getPublicUrl");
  });

  it("generates only from the re-hashed persisted guide and stores the MP4 before expiry", () => {
    expect(startRoute).toContain("loadOwnedVisualGuide");
    expect(startRoute).toContain('{ status: "eq.queued" }');
    expect(startRoute).not.toMatch(/input\.(summary|events|scenes)/);
    expect(statusRoute).toContain("uploadVideo");
    expect(statusRoute).not.toContain("createStudyVideo");
    expect(statusRoute).not.toContain("authorizeAiRequest");
  });

  it("never generates on page load, caps polling, and supports cancel", () => {
    expect(hook).toContain("never start one on page load");
    expect(hook).toContain("MAX_POLLS");
    expect(hook).toContain("cancelStudyVideo");
    expect(hook).not.toMatch(/useEffect\([^]*?createVideo\(\)/);
  });

  it("labels the clip, never autoplays, offers native controls and scene descriptions", () => {
    expect(component).toContain("STUDY_VIDEO_LABEL");
    expect(STUDY_VIDEO_LABEL).toBe("AI-created interpretation · not Scripture");
    expect(component).toContain("controls");
    expect(component).toContain("playsInline");
    expect(component).not.toMatch(/autoPlay/i);
    expect(component).toContain('kind="captions"');
    expect(component).toContain("Scene descriptions");
    expect(component).toContain("not historical footage");
    expect(reader).toContain("<StudyVideoAid");
    expect(reader).toContain("Guide views · not generated media");
  });
});
