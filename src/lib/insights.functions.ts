import { createServerFn } from "@tanstack/react-start";
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
};

type Result = { ok: true; insights: StudyInsights } | { ok: false; error: string };

function empty(): StudyInsights {
  return { summary:"", themes:[], context:"", peoplePlaces:[], crossReferences:[], reflectionQuestions:[], applications:[], prayerPrompts:[], deeperStudy:[] };
}

function parseJson(text: string): StudyInsights | null {
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return { ...empty(), ...JSON.parse(cleaned) } as StudyInsights;
  } catch { return null; }
}

export const generateInsightsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { versionId: string; passage: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    if (!isValidVersionId(data.versionId) || !isValidPassageId(data.passage)) return { ok:false, error:"Invalid passage or translation." };
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { ok:false, error:"AI study insights are not configured on this deployment." };

    try {
      const { getPassage } = await import("./youversion.server");
      const chapter = await getPassage(data.versionId, data.passage);
      const source = chapter.verses.map(v => `${v.number || ""} ${v.text}`.trim()).join("\n").slice(0, 24000);
      const prompt = `Create Bible study assistance grounded ONLY in the supplied chapter text. Do not rewrite or replace Scripture. Distinguish what the text states from historical/cultural context. Do not invent archaeology, dates, people, locations, or cross-references. If uncertain, say so. Cite verse references throughout.\n\nChapter: ${chapter.reference}\n\nSOURCE TEXT:\n${source}\n\nReturn ONLY valid JSON with these keys: summary (string), themes (string[]), context (string), peoplePlaces (string[]), crossReferences (string[] references with one-sentence relevance), reflectionQuestions (string[]), applications (string[]), prayerPrompts (string[]), deeperStudy (string[]).`;
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method:"POST",
        headers:{ Authorization:`Bearer ${key}`, "Content-Type":"application/json" },
        body:JSON.stringify({ model:"google/gemini-3-flash", temperature:0.2, messages:[{role:"system",content:"You are a careful Bible study assistant. Scripture supplied by the application is authoritative source material for this task; your output is commentary, never Scripture."},{role:"user",content:prompt}] }),
      });
      if (!response.ok) return { ok:false, error:`AI service returned ${response.status}.` };
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content || "";
      const insights = parseJson(content);
      if (!insights) return { ok:false, error:"AI response could not be parsed. Please regenerate." };
      return { ok:true, insights };
    } catch (e) {
      return { ok:false, error:e instanceof Error ? e.message : "Unable to generate insights." };
    }
  });
