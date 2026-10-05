import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MODE_SPECS,
  buildManifest,
  canSpend,
  cuesToVtt,
  estimateFor,
  groundingIssues,
  groundingSources,
  modeForStudy,
  nextStage,
  parseGroundingVerdict,
  qualityIssues,
  retryReset,
  validatePlan,
  wavDurationSeconds,
  type CallKind,
  type SequencePlan,
} from "../study-sequence.shared";
import { advanceSequence, retrySequence, type Db, type Providers, type SceneRow, type SequenceRow } from "../study-sequence.server";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const guide = {
  summary: "Joseph's brothers travel to Egypt to buy grain during a famine and bow before Joseph, who recognizes them while they do not recognize him.",
  themes: ["Guilt and memory: the brothers connect their distress with how they treated Joseph."],
  eventSequence: [
    "Jacob sends ten sons to Egypt to buy grain because of the famine, keeping Benjamin at home.",
    "The brothers bow before Joseph, the governor, who recognizes them and accuses them of being spies.",
    "Joseph keeps Simeon bound and sends the others home with grain, demanding they bring Benjamin.",
    "Jacob refuses to send Benjamin, grieving over Joseph and Simeon.",
  ],
  visualTimeline: [],
  relationships: [],
  placeNotes: ["Egypt held stored grain while the famine spread across the region."],
};
const sources = groundingSources(guide);
const ctx = { reference: "Genesis 42", chapterText: "And Joseph knew his brethren, but they knew not him. And Joseph remembered the dreams which he dreamed of them." };

function goodPlan(): SequencePlan {
  return {
    title: "Genesis 42: The brothers in Egypt",
    scenes: [
      { role: "opening", visualKind: "title", claimType: "chapter", sourceRefs: ["summary"], scriptureQuote: null, visualBrief: "",
        narration: "Genesis 42 follows the brothers of Joseph as famine drives them toward Egypt to buy grain, and toward a meeting they do not expect." },
      { role: "content", visualKind: "still", claimType: "chapter", sourceRefs: ["eventSequence.0", "placeNotes.0"], scriptureQuote: null,
        visualBrief: "Distant silhouettes of travelers crossing a dry plain toward granaries under soft morning light",
        narration: "Because of the famine, Jacob sends ten sons to Egypt to buy grain. He keeps Benjamin at home. Egypt held stored grain while the famine spread across the region." },
      { role: "content", visualKind: "clip", claimType: "chapter", sourceRefs: ["eventSequence.1", "themes.0"], scriptureQuote: "And Joseph knew his brethren, but they knew not him.",
        visualBrief: "Slow push-in on low figures bowing in a vast hall of stone, lit by warm shafts of light",
        narration: "The brothers bow before Joseph, the governor. \"And Joseph knew his brethren, but they knew not him.\" He accuses them of being spies, and the brothers connect their distress with how they treated Joseph." },
      { role: "content", visualKind: "still", claimType: "chapter", sourceRefs: ["eventSequence.2", "eventSequence.3"], scriptureQuote: null,
        visualBrief: "Empty grain sacks and a single lamp in a quiet tent at dusk, suggesting a family in grief",
        narration: "Joseph keeps Simeon bound and sends the others home with grain, demanding that they bring Benjamin. Back home, Jacob refuses to send Benjamin, grieving over Joseph and Simeon." },
      { role: "closing", visualKind: "closing", claimType: "chapter", sourceRefs: ["summary"], scriptureQuote: null, visualBrief: "",
        narration: "Read Genesis 42 again slowly and notice how the brothers remember Joseph, and where the chapter leaves the family waiting." },
    ],
  };
}

function wav(seconds: number) {
  const rate = 24000;
  const dataBytes = Math.round(seconds * rate * 2);
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, dataBytes, true);
  return buf;
}

describe("study modes and cost caps", () => {
  it("maps study experience to video mode; Just Read is never suggested", () => {
    expect(modeForStudy("quick")).toEqual({ mode: "quick", suggested: true });
    expect(modeForStudy("standard").mode).toBe("standard");
    expect(modeForStudy("deep").mode).toBe("deep");
    expect(modeForStudy("read")).toEqual({ mode: "quick", suggested: false });
  });

  it("targets the requested durations and keeps expected calls under each hard ceiling", () => {
    expect(MODE_SPECS.quick.targetSeconds).toEqual([45, 75]);
    expect(MODE_SPECS.standard.targetSeconds).toEqual([90, 150]);
    expect(MODE_SPECS.deep.targetSeconds).toEqual([120, 240]);
    for (const mode of ["quick", "standard", "deep"] as const) {
      const e = estimateFor(mode);
      for (const k of ["plan", "still", "clip", "tts"] as CallKind[]) expect(e.calls[k]).toBeLessThanOrEqual(e.ceiling[k]);
      expect(MODE_SPECS[mode].maxClips + MODE_SPECS[mode].maxStills).toBe(MODE_SPECS[mode].scenes[1] - 2);
    }
  });

  it("SQL reservation budgets mirror the TypeScript ceilings exactly", () => {
    const sql = src("../../../drizzle/migrations/0006_study_video_sequences.sql");
    for (const [mode, spec] of Object.entries(MODE_SPECS)) {
      expect(sql).toContain(`when '${mode}' then v_budget := '${JSON.stringify(spec.budget)}'`);
    }
  });

  it("canSpend refuses at the ceiling", () => {
    expect(canSpend({ clip: 2 }, { clip: 3 }, "clip")).toBe(true);
    expect(canSpend({ clip: 3 }, { clip: 3 }, "clip")).toBe(false);
    expect(canSpend({}, {}, "tts")).toBe(false);
  });
});

describe("grounded plan contract", () => {
  it("accepts a grounded, coherent plan", () => {
    expect(validatePlan(goodPlan(), "quick", sources, ctx)).toEqual([]);
  });

  it("rejects unknown sources, unsupported entities, numbers and chronology", () => {
    const plan = goodPlan();
    plan.scenes[1]!.sourceRefs = ["eventSequence.9"];
    expect(groundingIssues(plan, sources, ctx).map((i) => i.code)).toContain("unknown_ref");
    const p2 = goodPlan();
    p2.scenes[1]!.narration += " Pharaoh watches from Memphis, 1700 years before Christ.";
    const codes = groundingIssues(p2, sources, ctx).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["unsupported_entity", "unsupported_number", "unsupported_chronology"]));
  });

  it("rejects fabricated dialogue and first-person divine or character speech", () => {
    const p = goodPlan();
    p.scenes[3]!.narration = "Joseph said: you will bring Benjamin to me or Simeon stays bound with grain.";
    expect(groundingIssues(p, sources, ctx).map((i) => i.code)).toContain("dialogue");
    const p2 = goodPlan();
    p2.scenes[3]!.narration = "Thus says the Lord to Jacob about Benjamin and Simeon and the grain.";
    expect(groundingIssues(p2, sources, ctx).map((i) => i.code)).toContain("dialogue");
  });

  it("permits only short verbatim, labeled Scripture quotations", () => {
    const fabricated = goodPlan();
    fabricated.scenes[2]!.narration = fabricated.scenes[2]!.narration.replace("And Joseph knew his brethren, but they knew not him.", "Joseph wept over his brothers in secret.");
    fabricated.scenes[2]!.scriptureQuote = "Joseph wept over his brothers in secret.";
    expect(groundingIssues(fabricated, sources, ctx).map((i) => i.code)).toContain("fabricated_quote");
    const unlabeled = goodPlan();
    unlabeled.scenes[2]!.scriptureQuote = null;
    expect(groundingIssues(unlabeled, sources, ctx).map((i) => i.code)).toContain("unlabeled_quote");
  });

  it("requires uncertain claims to be worded as uncertain and divine imagery to be symbolic", () => {
    const p = goodPlan();
    p.scenes[3]!.claimType = "uncertain";
    p.scenes[3]!.visualBrief = "God standing over the tent of Jacob as a tall robed figure";
    const codes = groundingIssues(p, sources, ctx).map((i) => i.code);
    expect(codes).toContain("unlabeled_uncertainty");
    expect(codes).toContain("divine_depiction");
  });

  it("rejects faces, footage and on-screen text in visual briefs", () => {
    const p = goodPlan();
    p.scenes[1]!.visualBrief = "Photorealistic documentary footage close-up of the face of Jacob";
    expect(groundingIssues(p, sources, ctx).map((i) => i.code)).toContain("visual_specifics");
  });

  it("quality gate: arc, duplicates, caps, word budget, opening/closing, coverage", () => {
    const p = goodPlan();
    p.scenes[3] = { ...p.scenes[1]! };
    const codes = qualityIssues(p, "quick", sources).map((i) => i.code);
    expect(codes).toContain("duplicate");
    expect(codes).toContain("arc_order");
    const noClose = goodPlan();
    noClose.scenes.pop();
    expect(qualityIssues(noClose, "quick", sources).map((i) => i.code)).toEqual(expect.arrayContaining(["closing", "scene_count"]));
    const clips = goodPlan();
    clips.scenes[1]!.visualKind = "clip";
    clips.scenes[3]!.visualKind = "clip";
    expect(qualityIssues(clips, "quick", sources).map((i) => i.code)).toContain("clip_cap");
    expect(qualityIssues(goodPlan(), "standard", sources).map((i) => i.code)).toEqual(expect.arrayContaining(["scene_count", "word_budget"]));
  });

  it("entailment audit fails closed when incomplete", () => {
    expect(parseGroundingVerdict({ scenes: [{ index: 0, supported: true, reason: "" }] }, 2)).toBeNull();
    expect(parseGroundingVerdict({ scenes: [{ index: 0, supported: true, reason: "" }, { index: 1, supported: false, reason: "adds a place" }] }, 2)).toHaveLength(1);
  });
});

describe("narration / caption synchronization", () => {
  it("measures WAV duration from the header and rejects non-WAV audio", () => {
    expect(wavDurationSeconds(wav(2.5))).toBe(2.5);
    expect(wavDurationSeconds(new ArrayBuffer(100))).toBeNull();
  });

  it("captions equal the narrated text and scene boundaries equal measured audio", () => {
    const m = buildManifest("T", [
      { index: 0, role: "opening", visualKind: "title", claimType: "chapter", narration: "One. Two words here.", ttsText: "One. Two words here.", visualBrief: "", scriptureQuote: null, sourceRefs: [], narrationSeconds: 3 },
      { index: 1, role: "closing", visualKind: "closing", claimType: "chapter", narration: "Read again.", ttsText: "Read again.", visualBrief: "", scriptureQuote: null, sourceRefs: [], narrationSeconds: 2.25 },
    ]);
    expect(m.totalSeconds).toBe(5.25);
    expect(m.scenes.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 5.25]]);
    expect(m.cues.filter((c) => c.scene === 0).map((c) => c.text).join(" ")).toBe("One. Two words here.");
    expect(m.cues[m.cues.length - 1]!.end).toBe(5.25);
    expect(cuesToVtt(m.cues)).toMatch(/^WEBVTT\n\n1\n00:00:00\.000 --> /);
  });

  it("fails finalization rather than drifting when duration is missing or text differs", () => {
    const base = { index: 0, role: "opening" as const, visualKind: "title" as const, claimType: "chapter" as const, narration: "A.", visualBrief: "", scriptureQuote: null, sourceRefs: [] };
    expect(() => buildManifest("T", [{ ...base, ttsText: "A.", narrationSeconds: null }])).toThrow(/duration/);
    expect(() => buildManifest("T", [{ ...base, ttsText: "B.", narrationSeconds: 2 }])).toThrow(/captions/);
  });
});

describe("stage state machine", () => {
  it("advances only when every asset is done and fails when any failed", () => {
    const s = (v: string, n: string) => ({ visualKind: "still" as const, visualStatus: v as never, narrationStatus: n as never });
    expect(nextStage("visuals", [s("done", "pending"), s("generating", "pending")])).toEqual({ stage: "visuals", failed: false });
    expect(nextStage("visuals", [s("done", "pending"), s("failed", "pending")])).toEqual({ stage: "visuals", failed: true });
    expect(nextStage("visuals", [s("done", "pending")])).toEqual({ stage: "narration", failed: false });
    expect(nextStage("narration", [s("done", "done")])).toEqual({ stage: "finalizing", failed: false });
    expect(retryReset([s("done", "pending"), s("failed", "pending")], "visuals").map((x) => x.visualStatus)).toEqual(["done", "pending"]);
  });
});

// ---------------------------------------------------------------- engine with mocked providers (no paid calls)

function harness(opts: { failStillOnce?: boolean; budget?: Partial<Record<CallKind, number>> } = {}) {
  const video: SequenceRow = {
    id: "v1", user_id: "u1", passage: "GEN.42", version_id: 111, guide_hash: "a".repeat(64), kind: "sequence", study_mode: "quick",
    status: "generating", stage: "planning", stage_error: null, plan_hash: null, plan_title: null,
    call_budget: opts.budget ?? { ...MODE_SPECS.quick.budget }, call_usage: { plan: 0, still: 0, clip: 0, tts: 0 }, duration_seconds: 0, manifest: null,
  };
  let scenes: SceneRow[] = [];
  const priorAssets: SceneRow[] = [];
  const calls: Record<string, number> = { json: 0, still: 0, clipCreate: 0, clipPoll: 0, speech: 0 };
  const uploads: string[] = [];
  let stillFailures = opts.failStillOnce ? 1 : 0;
  const db: Db = {
    loadVideo: async () => ({ ...video }),
    patchVideo: async (_id, patch, where = {}) => {
      if (where["status"] && where["status"] !== `eq.${video.status}`) return null;
      Object.assign(video, patch);
      return { ...video };
    },
    loadScenes: async () => scenes.map((s) => ({ ...s })),
    insertScenes: async (rows) => { scenes = rows.map((r, i) => ({ id: `s${i}`, visual_path: null, visual_job_id: null, narration_path: null, narration_seconds: null, tts_text: null, last_error: null, ...r }) as SceneRow); },
    patchScene: async (id, patch) => { scenes = scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)); },
    findAsset: async (field, key) => priorAssets.find((a) => a[field] === key) ?? null,
    consumeCall: async (_id, kind) => {
      if (video.status !== "generating") return false;
      const used = video.call_usage[kind] ?? 0;
      if (used >= (video.call_budget[kind] ?? 0)) return false;
      video.call_usage = { ...video.call_usage, [kind]: used + 1 };
      return true;
    },
    lockPlan: async (_id, hash, title) => { if (video.plan_hash) return false; Object.assign(video, { plan_hash: hash, plan_title: title, stage: "visuals" }); return true; },
    upload: async (path) => { uploads.push(path); },
    copy: async (_f, to) => { uploads.push(`copy:${to}`); },
  };
  const providers: Providers = {
    json: async (_i, _input, name) => { calls["json"]! += 1; return name === "grounding_audit" ? { scenes: goodPlan().scenes.map((_, index) => ({ index, supported: true, reason: "" })) } : goodPlan(); },
    still: async () => { calls["still"]! += 1; if (stillFailures > 0) { stillFailures -= 1; throw new Error("boom"); } return new ArrayBuffer(8); },
    clipCreate: async () => { calls["clipCreate"]! += 1; return { id: "job1", status: "queued" }; },
    clipPoll: async () => { calls["clipPoll"]! += 1; return { id: "job1", status: "completed" }; },
    clipDownload: async () => new ArrayBuffer(8),
    speech: async () => { calls["speech"]! += 1; return wav(6); },
  };
  const engine = { db, providers, reference: "Genesis 42", loadSources: async () => ({ sources, chapterText: ctx.chapterText }) };
  return { video, get scenes() { return scenes; }, calls, uploads, db, engine, priorAssets };
}

async function runToEnd(h: ReturnType<typeof harness>, max = 40) {
  for (let i = 0; i < max; i += 1) {
    const r = await advanceSequence(h.engine, "v1");
    if (r.row.status !== "generating") return r;
  }
  throw new Error("did not finish");
}

describe("pipeline engine (mocked providers)", () => {
  it("completes a quick study with exact provider-call counts and synced manifest", async () => {
    const h = harness();
    const r = await runToEnd(h);
    expect(r.row.stage_error).toBeNull();
    expect(r.row.status).toBe("completed");
    expect(h.calls).toEqual({ json: 2, still: 2, clipCreate: 1, clipPoll: 1, speech: 5 });
    expect(h.video.call_usage).toEqual({ plan: 2, still: 2, clip: 1, tts: 5 });
    const manifest = h.video.manifest as { totalSeconds: number; cues: Array<{ text: string; scene: number }> };
    expect(manifest.totalSeconds).toBe(30);
    for (const s of h.scenes) expect(manifest.cues.filter((c) => c.scene === s.scene_index).map((c) => c.text).join(" ")).toBe(s.narration);
    expect(h.uploads.every((p) => p.replace("copy:", "").startsWith("u1/GEN.42/111/v1/"))).toBe(true);
  });

  it("does nothing for queued (unpaid) or cancelled jobs", async () => {
    const h = harness();
    h.video.status = "queued";
    await advanceSequence(h.engine, "v1");
    h.video.status = "cancelled";
    await advanceSequence(h.engine, "v1");
    expect(h.calls["json"]).toBe(0);
  });

  it("explicit retry regenerates only the failed scene and never exceeds the ceiling", async () => {
    const h = harness({ failStillOnce: true });
    const failed = await runToEnd(h);
    expect(failed.row.status).toBe("failed");
    expect(failed.row.stage).toBe("visuals");
    await retrySequence(h.db, "v1");
    const done = await runToEnd(h);
    expect(done.row.status).toBe("completed");
    expect(h.calls["still"]).toBe(3); // 2 needed + 1 retry; ceiling is 3
    expect(h.calls["json"]).toBe(2); // plan not regenerated
    expect(h.video.call_usage.still).toBeLessThanOrEqual(MODE_SPECS.quick.budget.still);
  });

  it("stops spending when the call ceiling is reached", async () => {
    const h = harness({ budget: { plan: 4, still: 1, clip: 3, tts: 7 } });
    const r = await runToEnd(h);
    expect(r.row.status).toBe("failed");
    expect(h.calls["still"]).toBe(1);
    expect(h.calls["speech"]).toBe(0);
  });

  it("reuses identical completed assets instead of paying again", async () => {
    const first = harness();
    await runToEnd(first);
    const second = harness();
    second.priorAssets.push(...first.scenes);
    await runToEnd(second);
    expect(second.calls["still"]).toBe(0);
    expect(second.calls["clipCreate"]).toBe(0);
    expect(second.calls["speech"]).toBe(0);
  });

  it("refuses to continue if scene rows were altered after the plan was locked", async () => {
    const h = harness();
    await advanceSequence(h.engine, "v1");
    await h.db.patchScene("s1", { narration: "Tampered narration that was never validated against the guide sources." });
    const r = await advanceSequence(h.engine, "v1");
    expect(r.row.status).toBe("failed");
    expect(h.calls["still"]).toBe(0);
  });

  it("rejects an ungrounded draft plan before any visual or narration spend", async () => {
    const h = harness();
    h.engine.providers.json = async () => ({ ...goodPlan(), scenes: goodPlan().scenes.map((s, i) => (i === 1 ? { ...s, narration: `${s.narration} Pharaoh rides a chariot through Memphis.` } : s)) });
    const r = await advanceSequence(h.engine, "v1");
    expect(r.row.status).toBe("failed");
    expect(r.issues?.some((i) => i.code === "unsupported_entity")).toBe(true);
    expect(h.video.call_usage.plan).toBe(1);
  });
});

describe("schema, security and migration parity", () => {
  const drizzle = src("../../../drizzle/migrations/0006_study_video_sequences.sql");
  const supa = src("../../../supabase/migrations/20261004233000_study_video_sequences.sql");

  it("both migration copies are byte-identical", () => {
    expect(supa).toBe(drizzle);
    const g1 = src("../../../drizzle/migrations/0007_study_videos_column_update_grants.sql");
    expect(src("../../../supabase/migrations/20261004233100_study_videos_column_update_grants.sql")).toBe(g1);
    expect(g1).toContain("revoke update on public.study_videos from authenticated;");
    expect(g1).not.toMatch(/call_budget|call_usage|plan_hash|kind|study_mode/);
  });

  it("keeps a dedicated video quota and derives identity from auth.uid()", () => {
    expect(drizzle).toContain("when 'video' then v_hour_limit := 1; v_day_limit := 2;");
    for (const fn of ["reserve_study_sequence", "consume_study_video_call", "lock_study_video_plan"]) {
      expect(drizzle).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
      expect(drizzle).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
    }
    expect(drizzle).not.toMatch(/p_user_id/);
    expect((drizzle.match(/v_user_id uuid := auth\.uid\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("owner-only scenes table, no anon, budget columns not client-writable", () => {
    expect(drizzle).toContain("alter table public.study_video_scenes enable row level security;");
    expect(drizzle).toContain("revoke all on public.study_video_scenes from anon;");
    expect(drizzle).toContain("revoke insert on public.study_videos from authenticated;");
    expect(drizzle).toContain("grant insert (user_id, passage, version_id, guide_hash, prompt_version, model, status) on public.study_videos to authenticated;");
    expect(drizzle).not.toMatch(/grant update \([^)]*call_(budget|usage)/);
    expect(drizzle).not.toMatch(/grant update \([^)]*plan_hash/);
    expect(drizzle).toMatch(/visual_path like user_id::text \|\| '\/%'/);
    expect(drizzle).not.toMatch(/drop table|drop column|insert into storage\.buckets/i);
  });

  it("keeps v0 clips valid and server routes authenticated with no client-trusted script", () => {
    expect(drizzle).toContain("(kind = 'clip' and duration_seconds between 3 and 10)");
    expect(drizzle).toContain("add column if not exists kind text not null default 'clip'");
    const start = src("../../routes/api/study-video/sequence-start.ts");
    expect(start).toContain('authorizeAiRequest(request, "video")');
    expect(start).toContain("loadTrustedSources");
    const routes = src("../study-sequence-routes.server.ts");
    expect(routes).toContain("studyGuideHash");
    expect(src("../../routes/api/study-video/advance.ts")).not.toMatch(/narration|visualBrief|scenes/);
    const client = src("../study-sequence.ts");
    expect(client).not.toMatch(/LOVABLE_API_KEY|ai\.gateway/);
  });

  it("never generates on load and caps the client advance loop", () => {
    const hook = src("../../hooks/useStudySequence.ts");
    expect(hook).toContain("Never generate on load");
    expect(hook).toContain("SEQUENCE_MAX_ADVANCE_STEPS");
    expect(hook).not.toMatch(/useEffect\([^]*?generate\(/);
    const player = src("../../components/StudySequencePlayer.tsx");
    expect(player).toContain("muted");
    expect(player).toMatch(/<audio[^>]*>/);
    expect(player).not.toMatch(/<audio[^>]*autoPlay/);
  });
});
