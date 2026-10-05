import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { isValidPassageId, isValidVersionId } from "./youversion";

export type StudyInsights = {
  summary: string;
  themes: string[];
  context: string;
  peoplePlaces: string[];
  crossReferences: string[];
  reflectionQuestions: string[];
  applications: string[];
  prayerPrompts: string[];
  deeperStudy: string[];
  eventSequence: string[];
  visualTimeline: string[];
  relationships: string[];
  placeNotes: string[];
};

export type AskChapterAnswer = {
  answer: string;
  explicitFromText: string[];
  inferences: string[];
  uncertainties: string[];
  relatedReferences: string[];
};

type Result = { ok: true; insights: StudyInsights } | { ok: false; error: string };
type AskResult = { ok: true; answer: AskChapterAnswer } | { ok: false; error: string };

const chapterInputSchema = z.object({
  versionId: z.string().trim().min(1).max(20),
  passage: z.string().trim().min(1).max(20),
});

const askInputSchema = chapterInputSchema.extend({
  question: z.string().trim().min(1).max(1200),
});

const stringArray = { type: "array", items: { type: "string" } } as const;

const STUDY_INSIGHTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "themes",
    "context",
    "peoplePlaces",
    "crossReferences",
    "reflectionQuestions",
    "applications",
    "prayerPrompts",
    "deeperStudy",
    "eventSequence",
    "visualTimeline",
    "relationships",
    "placeNotes",
  ],
  properties: {
    summary: { type: "string" },
    themes: stringArray,
    context: { type: "string" },
    peoplePlaces: stringArray,
    crossReferences: stringArray,
    reflectionQuestions: stringArray,
    applications: stringArray,
    prayerPrompts: stringArray,
    deeperStudy: stringArray,
    eventSequence: stringArray,
    visualTimeline: stringArray,
    relationships: stringArray,
    placeNotes: stringArray,
  },
} as const;

const ASK_CHAPTER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "explicitFromText", "inferences", "uncertainties", "relatedReferences"],
  properties: {
    answer: { type: "string" },
    explicitFromText: stringArray,
    inferences: stringArray,
    uncertainties: stringArray,
    relatedReferences: stringArray,
  },
} as const;

function empty(): StudyInsights {
  return {
    summary: "",
    themes: [],
    context: "",
    peoplePlaces: [],
    crossReferences: [],
    reflectionQuestions: [],
    applications: [],
    prayerPrompts: [],
    deeperStudy: [],
    eventSequence: [],
    visualTimeline: [],
    relationships: [],
    placeNotes: [],
  };
}

async function chapterSource(versionId: string, passage: string) {
  const { getPassage } = await import("./youversion.server");
  const chapter = await getPassage(versionId, passage);
  const source = chapter.verses
    .map((v) => `${v.number || ""} ${v.text}`.trim())
    .join("\n")
    .slice(0, 24000);
  return { chapter, source };
}

/** Browser-safe provider error contract. Never expose raw provider/database internals. */
export function gatewayErrorMessage(status: number, _message?: string) {
  if (status === 400 || status === 404) {
    return "The configured AI model is unavailable on this deployment. Please try again later.";
  }
  if (status === 402) {
    return "AI credits are exhausted for this workspace. Add credits in Lovable (Settings → Plans & credits) to use AI study tools.";
  }
  if (status === 403) return "AI access is blocked by workspace policy or a credit limit.";
  if (status === 429) return "AI service is rate limited right now. Please wait a moment and try again.";
  if (status >= 500) return "AI service is temporarily unavailable. Please try again.";
  return "AI study tools could not complete this request. Please try again.";
}

async function gatewayJson<T>(prompt: string, system: string, schemaName: string, schema: unknown): Promise<T> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI study tools are not configured on this deployment.");

  try {
    // Reuse the same verified Responses/provider boundary as Video Aid instead of maintaining
    // a second chat-completions integration with a separate model contract.
    const { gatewayProviders } = await import("./study-sequence.server");
    return (await gatewayProviders(key).json(system, prompt, schemaName, schema)) as T;
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : null;
    if (status !== null) throw new Error(gatewayErrorMessage(status));
    throw error;
  }
}

export const generateInsightsFn = createServerFn({ method: "POST" })
  .validator(chapterInputSchema)
  .handler(async ({ data }): Promise<Result> => {
    if (!isValidVersionId(data.versionId) || !isValidPassageId(data.passage)) {
      return { ok: false, error: "Invalid passage or translation." };
    }
    if (!process.env["LOVABLE_API_KEY"]) {
      return { ok: false, error: "AI study tools are not configured on this deployment." };
    }

    const { authorizeCurrentAiRequest } = await import("./ai-access.server");
    const access = await authorizeCurrentAiRequest("insights");
    if (!access.ok) return { ok: false, error: access.error };

    try {
      const { chapter, source } = await chapterSource(data.versionId, data.passage);
      const prompt = `Create careful Bible study assistance grounded primarily in the supplied chapter. Never present your words as Scripture and never invent a Bible quotation. Clearly qualify historical/cultural claims. If a cross-reference is uncertain, omit it. Use verse references when discussing the supplied text. For visual study aids, eventSequence must follow only events explicitly present in this chapter. visualTimeline may describe the chapter's internal sequence only unless chronology is explicitly stated. relationships must describe relationships actually evident in the chapter. placeNotes must avoid invented coordinates, distances, archaeology, or geography; if the chapter itself gives insufficient information, keep the item minimal or omit it.\n\nChapter: ${chapter.reference}\n\nSOURCE TEXT:\n${source}\n\nReturn the requested structured study guide.`;
      const parsed = await gatewayJson<StudyInsights>(
        prompt,
        "You are a careful Bible study assistant. The supplied Scripture is source material; your output is study guidance, never Scripture. Distinguish explicit text, reasonable inference, and uncertain background claims. Visual aids must not manufacture facts.",
        "study_insights",
        STUDY_INSIGHTS_JSON_SCHEMA,
      );
      return { ok: true, insights: { ...empty(), ...parsed } };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to generate insights.",
      };
    }
  });

export const askChapterFn = createServerFn({ method: "POST" })
  .validator(askInputSchema)
  .handler(async ({ data }): Promise<AskResult> => {
    if (!isValidVersionId(data.versionId) || !isValidPassageId(data.passage)) {
      return { ok: false, error: "Invalid question, passage, or translation." };
    }
    if (!process.env["LOVABLE_API_KEY"]) {
      return { ok: false, error: "AI study tools are not configured on this deployment." };
    }

    const { authorizeCurrentAiRequest } = await import("./ai-access.server");
    const access = await authorizeCurrentAiRequest("ask_chapter");
    if (!access.ok) return { ok: false, error: access.error };

    try {
      const { chapter, source } = await chapterSource(data.versionId, data.passage);
      const prompt = `Answer the user's study question about ${chapter.reference}. Begin from the supplied chapter. Do not fabricate Bible quotations or claim certainty where the text is silent. Separate explicit statements from inference. Related references may be suggested by reference only; do not quote them because their text was not supplied.\n\nQUESTION:\n${data.question}\n\nSOURCE CHAPTER:\n${source}`;
      const answer = await gatewayJson<AskChapterAnswer>(
        prompt,
        "You are a transparent Bible-study assistant. Never blur Scripture, commentary, inference, tradition, or uncertainty.",
        "ask_chapter",
        ASK_CHAPTER_JSON_SCHEMA,
      );
      return { ok: true, answer };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to answer the study question.",
      };
    }
  });
