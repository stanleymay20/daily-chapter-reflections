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

function empty(): StudyInsights {
  return { summary:"", themes:[], context:"", peoplePlaces:[], crossReferences:[], reflectionQuestions:[], applications:[], prayerPrompts:[], deeperStudy:[], eventSequence:[], visualTimeline:[], relationships:[], placeNotes:[] };
}

function parseJson<T>(text: string): T | null {
  try { return JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim()) as T; }
  catch { return null; }
}

async function chapterSource(versionId:string,passage:string){
  const { getPassage } = await import("./youversion.server");
  const chapter = await getPassage(versionId, passage);
  const source = chapter.verses.map(v => `${v.number || ""} ${v.text}`.trim()).join("\n").slice(0, 24000);
  return {chapter,source};
}

async function gateway(prompt:string,system:string){
  const key=process.env["LOVABLE_API_KEY"];
  if(!key) throw new Error("AI study tools are not configured on this deployment.");
  const response=await fetch("https://ai.gateway.lovable.dev/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"google/gemini-3-flash",temperature:0.12,messages:[{role:"system",content:system},{role:"user",content:prompt}]})});
  if(!response.ok) throw new Error(`AI service returned ${response.status}.`);
  const json=await response.json() as {choices?:Array<{message?:{content?:string}}>};
  return json.choices?.[0]?.message?.content||"";
}

export const generateInsightsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { versionId: string; passage: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    if (!isValidVersionId(data.versionId) || !isValidPassageId(data.passage)) return { ok:false, error:"Invalid passage or translation." };
    try {
      const {chapter,source}=await chapterSource(data.versionId,data.passage);
      const prompt=`Create careful Bible study assistance grounded primarily in the supplied chapter. Never present your words as Scripture and never invent a Bible quotation. Clearly qualify historical/cultural claims. If a cross-reference is uncertain, omit it. Use verse references when discussing the supplied text. For visual study aids, eventSequence must follow only events explicitly present in this chapter. visualTimeline may describe the chapter's internal sequence only unless chronology is explicitly stated. relationships must describe relationships actually evident in the chapter. placeNotes must avoid invented coordinates, distances, archaeology, or geography; if the chapter itself gives insufficient information, keep the item minimal or omit it.\n\nChapter: ${chapter.reference}\n\nSOURCE TEXT:\n${source}\n\nReturn ONLY valid JSON with keys: summary (string), themes (string[]), context (string), peoplePlaces (string[]), crossReferences (string[] references plus one-sentence relevance), reflectionQuestions (string[]), applications (string[]), prayerPrompts (string[]), deeperStudy (string[]), eventSequence (string[] in chapter order), visualTimeline (string[] concise sequence labels), relationships (string[]), placeNotes (string[]).`;
      const content=await gateway(prompt,"You are a careful Bible study assistant. The supplied Scripture is source material; your output is study guidance, never Scripture. Distinguish explicit text, reasonable inference, and uncertain background claims. Visual aids must not manufacture facts.");
      const parsed=parseJson<StudyInsights>(content);
      if(!parsed) return {ok:false,error:"AI response could not be parsed. Please regenerate."};
      return {ok:true,insights:{...empty(),...parsed}};
    } catch(e){return {ok:false,error:e instanceof Error?e.message:"Unable to generate insights."};}
  });

export const askChapterFn = createServerFn({method:"POST"})
  .inputValidator((input:{versionId:string;passage:string;question:string})=>input)
  .handler(async({data}):Promise<AskResult>=>{
    if(!isValidVersionId(data.versionId)||!isValidPassageId(data.passage)||!data.question.trim()||data.question.length>1200)return {ok:false,error:"Invalid question, passage, or translation."};
    try{
      const {chapter,source}=await chapterSource(data.versionId,data.passage);
      const prompt=`Answer the user's study question about ${chapter.reference}. Begin from the supplied chapter. Do not fabricate Bible quotations or claim certainty where the text is silent. Separate explicit statements from inference. Related references may be suggested by reference only; do not quote them because their text was not supplied.\n\nQUESTION:\n${data.question.trim()}\n\nSOURCE CHAPTER:\n${source}\n\nReturn ONLY valid JSON: {"answer":"concise explanation","explicitFromText":["claims tied to verse references"],"inferences":["clearly labelled reasonable inferences"],"uncertainties":["things the chapter does not establish"],"relatedReferences":["reference only"]}.`;
      const content=await gateway(prompt,"You are a transparent Bible-study assistant. Never blur Scripture, commentary, inference, tradition, or uncertainty.");
      const answer=parseJson<AskChapterAnswer>(content);
      return answer?{ok:true,answer}:{ok:false,error:"AI response could not be parsed. Please try again."};
    }catch(e){return {ok:false,error:e instanceof Error?e.message:"Unable to answer the study question."};}
  });
