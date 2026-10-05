import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MODE_SPECS,
  buildManifest,
  canSpend,
  cuesToVtt,
  modeForStudy,
  nextStage,
  retryReset,
  validatePlan,
  type GroundingSources,
  type SequencePlan,
} from "../study-sequence.shared";
import { buildYouTubeExportPackage, scriptureExportPolicy } from "../youtube-export";
import type { SavedSequence } from "../study-sequence";

const src = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const drizzleMigration = src("../../../drizzle/migrations/0006_study_video_sequences.sql");
const supabaseMigration = src("../../../supabase/migrations/20261004233000_study_video_sequences.sql");
const engine = src("../study-sequence.server.ts");
const hook = src("../../hooks/useStudySequence.ts");
const component = src("../../components/StudyVideoAid.tsx");

const sources: GroundingSources = {
  summary: "Joseph receives his brothers in Egypt during the famine and recognises them.",
  "eventSequence.0": "Jacob sends his sons to Egypt to buy grain during the famine.",
  "eventSequence.1": "Joseph recognises his brothers when they arrive in Egypt.",
  "eventSequence.2": "Joseph keeps Simeon while the other brothers return home.",
  "relationships.0": "Joseph and his brothers are family, though the brothers do not recognise Joseph.",
};

const quickPlan: SequencePlan = {
  title: "Genesis 42",
  scenes: [
    { role: "opening", narration: "Genesis 42 follows Joseph and his brothers during a severe famine, setting the chapter inside a family crisis and urgent search for grain.", visualBrief: "A restrained title view for Genesis 42 and the famine setting", visualKind: "title", claimType: "chapter", sourceRefs: ["summary"], scriptureQuote: null },
    { role: "content", narration: "Jacob sends his sons to Egypt to buy grain during the famine described in the chapter, beginning the journey that brings the brothers before Joseph.", visualBrief: "Distant family figures beginning a journey toward Egypt to obtain grain during famine", visualKind: "clip", claimType: "chapter", sourceRefs: ["eventSequence.0"], scriptureQuote: null },
    { role: "content", narration: "When the brothers arrive in Egypt, Joseph recognises them, while their family relationship remains hidden from them and the brothers do not recognise Joseph.", visualBrief: "Distant brothers arriving in Egypt as Joseph recognises them without close facial detail", visualKind: "still", claimType: "chapter", sourceRefs: ["eventSequence.1", "relationships.0"], scriptureQuote: null },
    { role: "content", narration: "Joseph keeps Simeon while the other brothers begin their return home from Egypt, leaving the family separated as the chapter moves forward.", visualBrief: "Simeon remains behind as the other brothers prepare for the journey home", visualKind: "clip", claimType: "chapter", sourceRefs: ["eventSequence.2"], scriptureQuote: null },
    { role: "content", narration: "The chapter keeps the tension focused on Joseph and his brothers, their hidden family relationship, and the consequences of the brothers not recognising Joseph.", visualBrief: "A restrained family-separation image grounded in Joseph and his brothers", visualKind: "still", claimType: "chapter", sourceRefs: ["summary", "relationships.0"], scriptureQuote: null },
    { role: "closing", narration: "Return to Genesis 42 and read the chapter itself carefully, testing every study point against Scripture and noticing what the chapter actually establishes.", visualBrief: "A quiet closing return-to-Scripture card", visualKind: "closing", claimType: "chapter", sourceRefs: ["summary"], scriptureQuote: null },
  ],
};

describe("Video Aid v1 direct release contracts", () => {
  it("keeps mode targets and hard provider-call ceilings bounded", () => {
    expect(modeForStudy("read")).toEqual({ mode: "quick", suggested: false });
    expect(modeForStudy("standard")).toEqual({ mode: "standard", suggested: true });
    expect(MODE_SPECS.quick.targetSeconds).toEqual([45, 75]);
    expect(MODE_SPECS.standard.targetSeconds).toEqual([90, 150]);
    expect(MODE_SPECS.deep.targetSeconds).toEqual([120, 240]);
    expect(canSpend({ clip: 2 }, { clip: 3 }, "clip")).toBe(true);
    expect(canSpend({ clip: 3 }, { clip: 3 }, "clip")).toBe(false);
  });

  it("rejects fabricated dialogue/unsupported details and preserves explicit retry reuse", () => {
    const bad: SequencePlan = structuredClone(quickPlan);
    bad.scenes[2]!.narration = 'Joseph said: "I will strike you with a steel sword tomorrow."';
    bad.scenes[2]!.visualBrief = "A modern steel sword inside a royal palace";
    expect(validatePlan(bad, "quick", sources, { reference: "Genesis 42", chapterText: "" }).length).toBeGreaterThan(0);
    expect(retryReset([{ visualKind: "still", visualStatus: "done", narrationStatus: "failed" }], "narration")[0]!.visualStatus).toBe("done");
    expect(retryReset([{ visualKind: "still", visualStatus: "done", narrationStatus: "failed" }], "narration")[0]!.narrationStatus).toBe("pending");
    expect(nextStage("visuals", [{ visualKind: "still", visualStatus: "done", narrationStatus: "pending" }])).toEqual({ stage: "narration", failed: false });
  });

  it("keeps migration parity, owner security, atomic call ledger and no hidden provider loop", () => {
    expect(supabaseMigration).toBe(drizzleMigration);
    expect(drizzleMigration).toContain("alter table public.study_video_scenes enable row level security");
    expect(drizzleMigration).toContain("revoke all on public.study_video_scenes from anon");
    expect(drizzleMigration).toContain("create or replace function public.consume_study_video_call");
    expect(drizzleMigration).toContain("when 'video' then v_hour_limit := 1; v_day_limit := 2;");
    expect(engine).toContain("consumeCall");
    expect(engine).not.toMatch(/while\s*\([^)]*provider/i);
    expect(hook).toContain("Each advance runs one bounded server step");
  });

  it("derives caption timing from measured narration and keeps captions equal to narrated text", () => {
    const manifest = buildManifest("Genesis 42", quickPlan.scenes.map((scene, index) => ({ ...scene, index, narrationSeconds: 5, ttsText: scene.narration })));
    expect(manifest.totalSeconds).toBe(30);
    expect(cuesToVtt(manifest.cues)).toContain("WEBVTT");
    expect(() => buildManifest("Genesis 42", quickPlan.scenes.map((scene, index) => ({ ...scene, index, narrationSeconds: 5, ttsText: index === 2 ? "different" : scene.narration })))).toThrow(/captions do not match/i);
  });

  it("exports truthfully with licensing gate and never pretends the browser package is an MP4", () => {
    const manifest = buildManifest("Genesis 42", quickPlan.scenes.map((scene, index) => ({ ...scene, index, narrationSeconds: 5, ttsText: scene.narration })));
    const saved: SavedSequence = {
      id: "video-1",
      mode: "quick",
      createdAt: "2026-10-05T00:00:00Z",
      manifest,
      usage: { plan: 2, still: 2, clip: 2, tts: 6 },
      assets: manifest.scenes.map((scene) => ({ index: scene.index, visualUrl: scene.visualKind === "title" || scene.visualKind === "closing" ? null : `https://signed/scene-${scene.index}.png`, visualType: scene.visualKind === "clip" ? "video" : scene.visualKind === "still" ? "image" : null, audioUrl: `https://signed/scene-${scene.index}.wav` })),
    };
    const pkg = buildYouTubeExportPackage(saved, "Genesis 42", "16:9", "unknown", "study");
    expect(pkg.singleFileVideoAvailable).toBe(false);
    expect(pkg.composition).toBe("timeline-package");
    expect(pkg.scripturePolicy).toBe("references-only");
    expect(pkg.aspect).toBe("16:9");
    expect(pkg.captionsVtt.startsWith("WEBVTT")).toBe(true);
    expect(scriptureExportPolicy("public-domain")).toBe("quoted-scripture-permitted");
    expect(component).toContain("narrated study");
  });
});
