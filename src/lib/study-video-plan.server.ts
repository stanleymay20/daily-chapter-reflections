import { z } from "zod";

import type { VisualStudyGuide } from "./study-guide";
import {
  STUDY_VIDEO_PLAN_MODEL,
  STUDY_VIDEO_PLAN_VERSION,
  audiencePrompt,
  getStudyVideoPreset,
  safeReference,
  validateStudyVideoPlan,
  type StudyVideoAudience,
  type StudyVideoMode,
  type StudyVideoPlan,
} from "./study-video.shared";

const BASE_URL = "https://ai.gateway.lovable.dev";

const sceneSchema = z.object({
  index: z.number().int().min(0).max(20),
  role: z.enum(["title", "content", "closing"]),
  claimType: z.enum(["chapter", "context", "uncertain"]),
  sourceRefs: z.array(z.string().min(1).max(80)).min(1).max(6),
  narration: z.string().trim().min(1).max(700),
  visualBrief: z.string().trim().min(1).max(900),
  visualKind: z.enum(["title", "motion", "still", "closing"]),
});

const planSchema = z.object({
  version: z.literal(STUDY_VIDEO_PLAN_VERSION),
  reference: z.string().trim().min(1).max(100),
  mode: z.enum(["quick", "standard", "deep"]),
  audience: z.enum(["study", "kids-4-7", "kids-7-10", "kids-10-12"]),
  title: z.string().trim().min(1).max(100),
  continuityNotes: z.string().trim().min(1).max(700),
  scenes: z.array(sceneSchema).min(1).max(16),
});

function parseJson(text: string): unknown {
  const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(clean);
}

function guideForPrompt(guide: VisualStudyGuide) {
  return {
    summary: guide.summary,
    eventSequence: guide.eventSequence,
    visualTimeline: guide.visualTimeline,
    relationships: guide.relationships,
    placeNotes: guide.placeNotes,
  };
}

export class StudyVideoPlanError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/** One bounded planning call per explicit generation. The output is rejected unless deterministic grounding gates pass. */
export async function generateStudyVideoPlan(
  apiKey: string,
  reference: string,
  guide: VisualStudyGuide,
  mode: StudyVideoMode,
  audience: StudyVideoAudience,
  signal?: AbortSignal,
): Promise<StudyVideoPlan> {
  const preset = getStudyVideoPreset(mode);
  const allowedRefs = [
    "summary",
    ...guide.eventSequence.map((_, i) => `eventSequence[${i}]`),
    ...guide.visualTimeline.map((_, i) => `visualTimeline[${i}]`),
    ...guide.relationships.map((_, i) => `relationships[${i}]`),
    ...guide.placeNotes.map((_, i) => `placeNotes[${i}]`),
  ];
  const motionIndices = Array.from({ length: preset.motion }, (_, i) => 1 + Math.floor(((i + 1) * (preset.scenes - 2)) / (preset.motion + 1)));

  const system = `You are a Bible-study video editor. You receive only a persisted, already-vetted study guide. Build a coherent narrated sequence without adding facts that are absent from that guide. Never invent dialogue, quotations, doctrine, causal claims, chronology, geography, ethnicity, architecture, clothing, objects or supernatural details. Never write in the first person as God, Jesus, a prophet or a biblical character. Use references instead of quoting Scripture. Context or uncertainty must be explicitly labelled in narration. Return only JSON.`;
  const user = `Create a ${mode} chapter study sequence for ${safeReference(reference)}.
Audience: ${audience}. ${audiencePrompt(audience)}
Target duration: ${preset.minSeconds}-${preset.maxSeconds} seconds, aiming for about ${preset.targetSeconds} seconds.
Exactly ${preset.scenes} scenes are required: scene 0 is a title, scene ${preset.scenes - 1} is a closing "Return to Scripture" scene, and all others are content scenes.
Generated-media hard caps: at most ${preset.motion} motion scenes and ${preset.stills} still-image scenes. Assign motion only to these preferred content indices if useful: ${motionIndices.join(", ") || "none"}. Every other content scene should be still.
Narration: no more than ${preset.maxWordsPerScene} words per scene. Keep it information-dense, natural and non-repetitive. No quotation marks. The closing must direct the viewer back to ${safeReference(reference)}.

Each content scene MUST include one or more sourceRefs from this exact allow-list and be semantically supported by those sources:
${allowedRefs.join("\n")}

Claim types:
- chapter: directly supported by the guide.
- context: background already stated by the guide; say that it is context.
- uncertain: only when the guide itself is tentative; narration must say may/might/uncertain/not established.

Visuals: title and closing are rendered by the app. Content visual briefs must depict only what the referenced guide content supports. Prefer distant figures, environment, objects or symbolic/abstract treatments where visual specifics are not established. No on-screen text.

Persisted guide:
${JSON.stringify(guideForPrompt(guide))}

Return exactly:
{"version":"${STUDY_VIDEO_PLAN_VERSION}","reference":"${safeReference(reference)}","mode":"${mode}","audience":"${audience}","title":"...","continuityNotes":"...","scenes":[{"index":0,"role":"title","claimType":"chapter","sourceRefs":["summary"],"narration":"...","visualBrief":"...","visualKind":"title"}, ...]}`;

  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: STUDY_VIDEO_PLAN_MODEL,
      temperature: 0.15,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: signal ?? null,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
    throw new StudyVideoPlanError(body?.message ?? body?.error?.message ?? `Video planning failed (${response.status}).`, response.status);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new StudyVideoPlanError("The video planner returned no plan.");

  let plan: StudyVideoPlan;
  try {
    plan = planSchema.parse(parseJson(text)) as StudyVideoPlan;
  } catch {
    throw new StudyVideoPlanError("The video planner returned an invalid structured plan.");
  }
  const errors = validateStudyVideoPlan(plan, guide, mode);
  if (errors.length) {
    console.error("[study-video] plan quality gate rejected output", errors.slice(0, 8));
    throw new StudyVideoPlanError("The generated video plan did not pass the Scripture-grounding quality gate.", 422);
  }
  return plan;
}
