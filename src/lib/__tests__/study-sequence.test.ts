import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MODE_SPECS,
  buildManifest,
  canSpend,
  cuesToVtt,
  estimateFor,
  differentiateVisualBriefs,
  canonicalizeVerbatimQuote,
  groundingIssues,
  groundingSources,
  guideReadinessIssue,
  modeForStudy,
  planRetryBlock,
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
    const sql = src("../../../drizzle/migrations/0008_study_video_plan_budget.sql");
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

describe("no-spend guide preflight", () => {
  it("accepts guides with enough genuinely usable sections for the selected mode", () => {
    expect(guideReadinessIssue("quick", sources, ctx.chapterText)).toBeNull();
    expect(guideReadinessIssue("standard", sources, ctx.chapterText)).toBeNull();
    expect(guideReadinessIssue("deep", sources, ctx.chapterText)).toBeNull();
  });

  it("rejects insufficient Standard/Deep source diversity BEFORE the video quota is charged", () => {
    const thin = { summary: "A chapter summary", "eventSequence.0": "The first event" };
    expect(guideReadinessIssue("quick", thin, "Verified Scripture text")).toBeNull();
    expect(guideReadinessIssue("standard", thin, "Verified Scripture text")).toMatch(/only 2 usable source sections/);
    expect(guideReadinessIssue("deep", thin, "Verified Scripture text")).toMatch(/requires at least 3/);
    expect(guideReadinessIssue("quick", thin, " ")).toMatch(/could not be retrieved/);
    expect(guideReadinessIssue("deep", { summary: " ", "themes.0": " " }, "Text")).toMatch(/only 0 usable/);
  });

  it("preflights trusted, server-loaded guide data before calling the quota RPC", () => {
    const start = src("../../routes/api/study-video/sequence-start.ts");
    expect(start.indexOf("guideReadinessIssue(")).toBeGreaterThan(-1);
    expect(start.indexOf("guideReadinessIssue(")).toBeLessThan(start.indexOf('authorizeAiRequest(request, "video")'));
    expect(start).toContain("return json(readiness, 422)");
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

  it("permits apostrophes in normal possessives without treating them as speech", () => {
    const p = goodPlan();
    p.scenes[1]!.narration = "Joseph's brothers travel to Egypt. Jacob's sons seek grain. God's name is not quoted; the family's journey is described by the chapter guide.";
    expect(groundingIssues(p, sources, ctx).map(issue => issue.code)).not.toContain("dialogue");
  });

  it("canonicalizes only single-quoted verbatim Scripture, without rewriting speech", () => {
    const p = goodPlan();
    const scriptural = "And Joseph knew his brethren, but they knew not him.";
    p.scenes[2]!.narration = p.scenes[2]!.narration.replace(`"${scriptural}"`, `‘${scriptural}’`);
    p.scenes[2]!.scriptureQuote = null;
    const canonical = canonicalizeVerbatimQuote(p, ctx.chapterText);
    expect(canonical.scenes[2]!.narration).toContain(`"${scriptural}"`);
    expect(canonical.scenes[2]!.scriptureQuote).toBe(scriptural);
    expect(groundingIssues(canonical, sources, ctx).map(i => i.code)).not.toContain("dialogue");

    const invented = goodPlan();
    invented.scenes[1]!.narration += " ‘Joseph commanded his brothers to return in secret.’";
    const untouched = canonicalizeVerbatimQuote(invented, ctx.chapterText);
    expect(untouched.scenes[1]!.narration).toBe(invented.scenes[1]!.narration);
    expect(groundingIssues(untouched, sources, ctx).map(i => i.code)).toContain("dialogue");
  });

  it("still blocks actual dialogue in straight and curly single quotation marks", () => {
    for (const quote of ["'Bring Benjamin to Egypt'", "‘Bring Benjamin to Egypt’"]) {
      const p = goodPlan();
      p.scenes[1]!.narration = `The brothers speak: ${quote}. Joseph's family remains in Egypt.`;
      expect(groundingIssues(p, sources, ctx).map(issue => issue.code)).toContain("dialogue");
    }
  });

  it("differentiates repeated scene compositions without changing narration, sources or quotations", () => {
    const original = goodPlan();
    original.scenes[3]!.visualBrief = original.scenes[1]!.visualBrief;
    expect(qualityIssues(original, "quick", sources).map(issue => issue.code)).toContain("duplicate_visual");
    const revised = differentiateVisualBriefs(original);
    expect(qualityIssues(revised, "quick", sources).map(issue => issue.code)).not.toContain("duplicate_visual");
    expect(revised.scenes[3]!.visualBrief).toContain("art direction only:");
    for (let i = 0; i < original.scenes.length; i++) {
      expect(revised.scenes[i]!.narration).toBe(original.scenes[i]!.narration);
      expect(revised.scenes[i]!.sourceRefs).toEqual(original.scenes[i]!.sourceRefs);
      expect(revised.scenes[i]!.scriptureQuote).toBe(original.scenes[i]!.scriptureQuote);
    }
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

  it("does not confuse prohibition wording with requests for forbidden imagery", () => {
    const allowed = goodPlan();
    allowed.scenes[1]!.visualBrief = "Distant desert at dawn, no faces, without text or footage";
    expect(groundingIssues(allowed, sources, ctx).map(i => i.code)).not.toContain("visual_specifics");
    const disallowed = goodPlan();
    disallowed.scenes[1]!.visualBrief = "Portrait close-up of Joseph with captions";
    expect(groundingIssues(disallowed, sources, ctx).map(i => i.code)).toContain("visual_specifics");
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

  it("rejects duplicated or out-of-range semantic-audit scene indexes", () => {
    const rows = [
      { index: 0, supported: true, reason: "" },
      { index: 1, supported: true, reason: "" },
    ];
    expect(parseGroundingVerdict({ scenes: [rows[0], rows[0]] }, 2)).toBeNull();
    expect(parseGroundingVerdict({ scenes: [rows[0], { index: 2, supported: true, reason: "" }] }, 2)).toBeNull();
    expect(parseGroundingVerdict({ scenes: rows }, 2)).toEqual([]);
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
    expect(nextStage("visuals", [s("failed", "pending"), s("pending", "pending")])).toEqual({ stage: "visuals", failed: true });
    expect(nextStage("narration", [s("done", "failed"), s("pending", "pending")])).toEqual({ stage: "narration", failed: true });
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

const deepEvents = [
  "Jacob learns that Egypt has grain during the famine. He sends his sons to purchase food for the family while he waits at home in Canaan.",
  "Jacob keeps Benjamin at home because he fears harm might come to his youngest son. The other brothers leave together and carry the family's urgent need for grain.",
  "The ten brothers enter Egypt seeking the grain they cannot obtain in their own land. They reach the place where Joseph now governs the distribution of food.",
  "Joseph holds authority over the grain supply in Egypt and receives the travelers who come to buy food. His brothers approach without realizing whom they will meet.",
  "The brothers bow before Joseph as they request grain. Joseph recognizes the men from his own family, but they do not recognize the brother they once knew.",
  "Joseph accuses the brothers of being spies when they explain where they have come from. They deny his accusation and describe their family and the youngest brother at home.",
  "Joseph holds the brothers for three days while testing their story. He tells them that one must remain and the others must carry food home to their hungry households.",
  "Simeon is kept behind in Egypt while the other brothers return with grain. They are instructed to bring Benjamin back as evidence that their account of the family is true.",
  "On the journey home the brothers find their money in the sacks of grain. This discovery adds fear to their return, although the grain itself will help their family.",
  "Back in Canaan the brothers report their encounter with the ruler in Egypt. Jacob mourns the loss of Joseph and Simeon and refuses to send Benjamin into danger.",
];
const deepVisuals = [
  "Distant hills with winding paths beneath a pale dawn",
  "Muted household landscape with an empty road beyond the courtyard",
  "Distant small silhouettes approaching a wide grain market square",
  "Quiet interior with small figures gathered near baskets of grain",
  "A spacious hall with small figures bowing in soft muted light",
  "Sparse geometric hall with long shadows and separated travelers",
  "Still courtyard beneath low diffuse clouds and subdued morning light",
  "Silent passageway with an open gate and several grain sacks",
  "Layered empty sacks beside a pathway in late daylight",
  "Wide landscape with travelers nearing a small family dwelling",
];
function deepTestPlan(): SequencePlan {
  return {
    title: "Genesis 42: Jacob's family and Joseph in Egypt",
    scenes: [
      {
        role: "opening", visualKind: "title", claimType: "chapter", sourceRefs: ["summary"], scriptureQuote: null, visualBrief: "",
        narration: "Genesis 42 follows Jacob's family through famine and a journey to Egypt for grain. Joseph receives his brothers there, although they do not yet recognize him.",
      },
      ...deepEvents.map((narration, index) => ({
        role: "content" as const,
        visualKind: (index === 4 || index === 8 ? "clip" : "still") as "clip" | "still",
        claimType: "chapter" as const,
        sourceRefs: [`eventSequence.${index}`, ...(index === 2 ? ["placeNotes.0"] : []), ...(index === 6 ? ["themes.0"] : [])],
        scriptureQuote: null,
        visualBrief: deepVisuals[index]!,
        narration,
      })),
      {
        role: "closing", visualKind: "closing", claimType: "chapter", sourceRefs: ["summary"], scriptureQuote: null, visualBrief: "",
        narration: "Read Genesis 42 with care and notice the brothers' journey for grain, Joseph's recognition of them, and the tension that remains when Jacob hears their account.",
      },
    ],
  };
}

describe("pipeline engine (mocked providers)", () => {
  it("runs a fully grounded Deep-mode twelve-scene sequence without paid providers", async () => {
    const h = harness();
    const plan = deepTestPlan();
    const deepSources = {
      summary: "Genesis 42 follows Jacob's family through a famine as Joseph receives his brothers in Egypt for grain; they do not recognize him, and Jacob later hears their account.",
      "themes.0": deepEvents[6]!,
      "placeNotes.0": deepEvents[2]!,
      ...Object.fromEntries(deepEvents.map((text, index) => [`eventSequence.${index}`, text])),
    };
    const errors = validatePlan(plan, "deep", deepSources, ctx);
    expect(errors).toEqual([]);
    h.video.study_mode = "deep";
    h.video.call_budget = { ...MODE_SPECS.deep.budget };
    h.engine.loadSources = async () => ({ sources: deepSources, chapterText: ctx.chapterText });
    const provider = h.engine.providers;
    provider.json = async (_instructions, _input, schemaName) =>
      schemaName === "grounding_audit" ?
        { scenes: plan.scenes.map((_, index) => ({ index, supported: true, reason: "" })) } : plan;
    const result = await runToEnd(h, 90);
    expect(result.row.status).toBe("completed");
    expect(h.scenes).toHaveLength(12);
    expect(h.video.call_usage.plan).toBe(2);
    expect(h.video.call_usage.tts).toBe(12);
    expect(h.video.call_usage.still).toBe(8);
    expect(h.video.call_usage.clip).toBe(2);
    expect(h.video.manifest).toBeTruthy();
  });

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

  it("forbids retrying legacy quota-denied jobs with zero provider calls", async () => {
    const h = harness();
    h.video.status = "failed";
    h.video.stage = "planning";
    h.video.stage_error = "You have reached today's AI study limit.";
    h.video.call_usage.plan = 0;
    expect(planRetryBlock({
      status: h.video.status, stage: h.video.stage,
      usage: h.video.call_usage, budget: h.video.call_budget,
    })).toBe("unstarted");
    const retry = await retrySequence(h.db, "v1");
    expect(retry).toBeNull();
    expect(h.video.status).toBe("failed");
    expect(h.calls["json"]).toBe(0);
  });

  it("separates legitimate funded planning retries from unauthorized attempts", () => {
    const base = { status: "failed", stage: "planning" as const,
      budget: { plan: 4 }, usage: { plan: 1 } };
    expect(planRetryBlock(base)).toBeNull();
    expect(planRetryBlock({ ...base, usage: { plan: 3 } })).toBe("budget");
    expect(planRetryBlock({ ...base, usage: { plan: 0 } })).toBe("unstarted");
    expect(planRetryBlock({ ...base, stage: "visuals" })).toBeNull();
    expect(planRetryBlock({ ...base, status: "generating" })).toBeNull();
  });

  it("refuses a failed planning retry when it cannot pay for both plan and audit", async () => {
    const h = harness();
    h.video.status = "failed";
    h.video.stage = "planning";
    h.video.call_usage.plan = 3;
    const retry = await retrySequence(h.db, "v1");
    expect(retry).toBeNull();
    expect(h.video.status).toBe("failed");
    expect(h.video.call_usage.plan).toBe(3);
  });

  it("allows a budgeted planning retry without resetting provider-call usage", async () => {
    const h = harness();
    h.video.status = "failed";
    h.video.stage = "planning";
    h.video.call_usage.plan = 2;
    const retry = await retrySequence(h.db, "v1");
    expect(retry?.status).toBe("generating");
    expect(h.video.call_usage.plan).toBe(2);
  });

  it("waits for an in-flight motion clip before purchasing later visuals", async () => {
    const h = harness();
    let polls = 0;
    const originalPoll = h.engine.providers.clipPoll;
    h.engine.providers.clipPoll = async (id) => {
      polls++;
      if (polls <= 2) return { id, status: "in_progress" };
      return originalPoll(id);
    };
    await advanceSequence(h.engine, "v1"); // plan and independently audit
    await advanceSequence(h.engine, "v1"); // first still
    await advanceSequence(h.engine, "v1"); // start clip
    expect(h.calls["still"]).toBe(1);
    expect(h.calls["clipCreate"]).toBe(1);
    for (let i = 0; i < 2; i++) {
      const pending = await advanceSequence(h.engine, "v1");
      expect(pending.row.stage).toBe("visuals");
      expect(pending.waiting).toBe(true);
      expect(h.calls["still"]).toBe(1); // no paid visual while clip unresolved
      expect(h.calls["clipCreate"]).toBe(1);
    }
    const done = await runToEnd(h);
    expect(done.row.status).toBe("completed");
    expect(h.calls["still"]).toBe(2);
    expect(h.calls["clipCreate"]).toBe(1);
  });

  it("recovers the original paid clip when delivery failed after provider completion", async () => {
    const h = harness();
    const upload = h.db.upload;
    let deliveryFailed = false;
    h.db.upload = async (path, bytes, contentType) => {
      if (path.endsWith(".mp4") && !deliveryFailed) {
        deliveryFailed = true;
        throw new Error("asset upload failed (403)"); // permanent transfer failure, not an AI failure
      }
      await upload(path, bytes, contentType);
    };
    const failed = await runToEnd(h);
    expect(failed.row.status).toBe("failed");
    expect(failed.row.stage).toBe("visuals");
    const clipScene = h.scenes.find((scene) => scene.visual_kind === "clip");
    expect(clipScene?.visual_status).toBe("failed");
    expect(clipScene?.visual_job_id).toBe("job1");
    expect(clipScene?.last_error).toContain("recover the same clip");
    expect(h.calls["clipCreate"]).toBe(1);
    expect(h.video.call_usage.clip).toBe(1);
    const retry = await retrySequence(h.db, "v1");
    expect(retry?.status).toBe("generating");
    expect(h.scenes.find((scene) => scene.visual_kind === "clip")?.visual_job_id).toBe("job1");
    const finished = await runToEnd(h);
    expect(finished.row.status).toBe("completed");
    expect(h.calls["clipCreate"]).toBe(1);
    expect(h.video.call_usage.clip).toBe(1);
    expect(h.calls["clipPoll"]).toBeGreaterThanOrEqual(2);
    expect(h.scenes.find((scene) => scene.visual_kind === "clip")?.visual_path).toMatch(/\.mp4$/);
  });

  it("retries transient asset uploads once without repeating paid illustration or speech calls", async () => {
    const h = harness();
    const original = h.db.upload;
    let stillFailures = 1;
    let narrationFailures = 1;
    let uploadsAttempted = 0;
    h.db.upload = async (path, bytes, contentType) => {
      uploadsAttempted++;
      if (path.endsWith(".png") && stillFailures > 0) {
        stillFailures--;
        throw new Error("asset upload failed (503)");
      }
      if (path.endsWith(".wav") && narrationFailures > 0) {
        narrationFailures--;
        throw new Error("asset upload failed (502)");
      }
      await original(path, bytes, contentType);
    };
    const done = await runToEnd(h);
    expect(done.row.status).toBe("completed");
    expect(stillFailures).toBe(0);
    expect(narrationFailures).toBe(0);
    expect(uploadsAttempted).toBeGreaterThan(h.uploads.length);
    expect(h.calls["still"]).toBe(2);
    expect(h.calls["speech"]).toBe(5);
    expect(h.video.call_usage.still).toBe(2);
    expect(h.video.call_usage.tts).toBe(5);
  });

  it("never retries a moderation-blocked motion prompt or spends additional clip credits", async () => {
    const h = harness();
    h.engine.providers.clipPoll = async () => {
      h.calls["clipPoll"]!++;
      return { id: "job1", status: "failed", error: { code: "moderation_blocked", message: "Blocked" } };
    };
    const failed = await runToEnd(h);
    expect(failed.row.status).toBe("failed");
    expect(failed.row.stage_error).toContain("safety filter blocked");
    expect(h.scenes.find((scene) => scene.visual_kind === "clip")?.visual_job_id).toBeNull();
    expect(await retrySequence(h.db, "v1")).toBeNull();
    expect(h.calls["clipCreate"]).toBe(1);
    expect(h.video.call_usage.clip).toBe(1);
  });

  it("a terminal provider failure is not confused with a recoverable completed clip", async () => {
    const h = harness();
    let providerFailures = 1;
    const originalPoll = h.engine.providers.clipPoll;
    h.engine.providers.clipPoll = async (id) => {
      if (providerFailures-- > 0) return { id, status: "failed", error: { code: "generation_failed" } };
      return originalPoll(id);
    };
    const failed = await runToEnd(h);
    expect(failed.row.status).toBe("failed");
    expect(h.scenes.find(s => s.visual_kind === "clip")?.visual_job_id).toBeNull();
    await retrySequence(h.db, "v1");
    const finished = await runToEnd(h);
    expect(finished.row.status).toBe("completed");
    expect(h.calls["clipCreate"]).toBe(2); // only explicit retry pays for a new clip
    expect(h.video.call_usage.clip).toBe(2);
  });

  it("pauses all further costly visuals after the first failed scene until explicit retry", async () => {
    const h = harness({ failStillOnce: true });
    const failed = await runToEnd(h);
    expect(failed.row.status).toBe("failed");
    expect(failed.row.stage).toBe("visuals");
    expect(failed.row.stage_error).toContain("Scene 2");
    expect(h.calls["still"]).toBe(1);
    expect(h.calls["clipCreate"]).toBe(0);
    expect(h.calls["speech"]).toBe(0);
    expect(h.scenes.some((scene) => scene.visual_status === "pending")).toBe(true);
    await advanceSequence(h.engine, "v1");
    expect(h.calls["still"]).toBe(1);
  });

  it("pauses all future narration calls after the first TTS failure", async () => {
    const h = harness();
    let failSpeech = true;
    const original = h.engine.providers.speech;
    h.engine.providers.speech = async (...args) => {
      h.calls["speech"]! += 1;
      if (failSpeech) { failSpeech = false; throw new Error("Provider narration unavailable"); }
      // Don't double-count this wrapped speech in the test harness.
      h.calls["speech"]! -= 1;
      return original(...args);
    };
    const first = await runToEnd(h);
    expect(first.row.stage).toBe("narration");
    expect(first.row.status).toBe("failed");
    expect(h.calls["speech"]).toBe(1);
    expect(h.scenes.filter(s => s.narration_status === "pending")).toHaveLength(4);
    await retrySequence(h.db, "v1");
    const final = await runToEnd(h);
    expect(final.row.status).toBe("completed");
    expect(h.calls["speech"]).toBe(6);
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

  it("does not spend corrective planning credits for repeated painting compositions", async () => {
    const h = harness();
    const original = h.engine.providers.json;
    h.engine.providers.json = async (...args) => {
      if (args[2] === "grounding_audit") return original(...args);
      const plan = goodPlan();
      plan.scenes[3]!.visualBrief = plan.scenes[1]!.visualBrief;
      return plan;
    };
    const result = await runToEnd(h);
    expect(result.row.status).toBe("completed");
    expect(h.video.call_usage.plan).toBe(2); // draft + independent audit only
    expect(h.calls["still"]).toBe(2);
    expect(h.calls["speech"]).toBe(5);
  });

  it("does not spend a final lone planning call without enough budget for the audit", async () => {
    const h = harness();
    h.video.call_usage.plan = 3;
    const result = await advanceSequence(h.engine, "v1");
    expect(result.row.status).toBe("failed");
    expect(h.calls["json"]).toBe(0);
    expect(h.video.call_usage.plan).toBe(3);
  });

  it("repairs a rejected plan once and revalidates before generating assets", async () => {
    const h = harness();
    let generated = 0;
    const original = h.engine.providers.json;
    h.engine.providers.json = async (...args) => {
      if (args[2] === "grounding_audit") return original(...args);
      generated++;
      if (generated === 1) return { ...goodPlan(), scenes: goodPlan().scenes.map((s, i) =>
        i === 1 ? { ...s, visualBrief: "Close-up portrait of Joseph with subtitles" } : s) };
      return goodPlan();
    };
    const result = await runToEnd(h);
    expect(result.row.status).toBe("completed");
    expect(generated).toBe(2);
    expect(h.video.call_usage.plan).toBe(3); // draft, repair, independent audit
  });

  it("rejects an ungrounded draft plan before any visual or narration spend", async () => {
    const h = harness();
    h.engine.providers.json = async () => ({ ...goodPlan(), scenes: goodPlan().scenes.map((s, i) => (i === 1 ? { ...s, narration: `${s.narration} Pharaoh rides a chariot through Memphis.` } : s)) });
    const r = await advanceSequence(h.engine, "v1");
    expect(r.row.status).toBe("failed");
    expect(r.issues?.some((i) => i.code === "unsupported_entity")).toBe(true);
    expect(h.video.call_usage.plan).toBe(2); // rejected draft and one corrective call only
  });
});

describe("schema, security and migration parity", () => {
  const drizzle = src("../../../drizzle/migrations/0006_study_video_sequences.sql");
  const supa = src("../../../supabase/migrations/20261004233000_study_video_sequences.sql");

  it("both migration copies are byte-identical", () => {
    expect(supa).toBe(drizzle);
    const g1 = src("../../../drizzle/migrations/0007_study_videos_column_update_grants.sql");
    expect(src("../../../supabase/migrations/20261004233100_study_videos_column_update_grants.sql")).toBe(g1);
    expect(src("../../../supabase/migrations/20261028005500_study_video_plan_budget.sql")).toBe(src("../../../drizzle/migrations/0008_study_video_plan_budget.sql"));
    expect(g1).toContain("revoke update on public.study_videos from authenticated;");
    expect(g1.slice(g1.indexOf("grant update"))).not.toMatch(/call_budget|call_usage|plan_hash|kind|study_mode/);
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

describe("plan repair guidance", async () => {
  const { repairGuidance, planInstructions } = await import("../study-sequence.shared");
  it("gives a concrete fix for an unsupported cause word", () => {
    const text = repairGuidance([{ scene: 1, code: "unsupported_causal", detail: "x" }]);
    expect(text).toMatch(/because/);
  });
  it("tells the planner the cause-word and closing rules up front", () => {
    const text = planInstructions("deep", "Leviticus 24");
    expect(text).toMatch(/so that/);
    expect(text).toMatch(/invite the viewer to "read"/);
  });
});
