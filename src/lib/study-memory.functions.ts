import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type StudyMemorySource = {
  kind: "chapter" | "daily_review" | "prayer";
  reference: string;
  text: string;
};

export type StudyMemoryAnswer = {
  answer: string;
  sources: string[];
  patterns: string[];
  unresolvedQuestions: string[];
};

type Result = { ok: true; answer: StudyMemoryAnswer } | { ok: false; error: string };

const sourceSchema = z.object({
  kind: z.enum(["chapter", "daily_review", "prayer"]),
  reference: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(1800),
});

const requestSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  sources: z.array(sourceSchema).min(1).max(120),
});

function parse(text: string): StudyMemoryAnswer | null {
  try { return JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim()) as StudyMemoryAnswer; }
  catch { return null; }
}

export const askStudyMemoryFn = createServerFn({ method: "POST" })
  .validator(requestSchema)
  .handler(async ({ data }): Promise<Result> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { ok:false, error:"AI Study Memory is not configured on this deployment." };

    const { authorizeCurrentAiRequest } = await import("./ai-access.server");
    const access = await authorizeCurrentAiRequest("study_memory");
    if (!access.ok) return { ok:false, error:access.error };

    const corpus = data.sources.map((s,i)=>`[M${i+1}] ${s.kind} ${s.reference}\n${s.text}`).join("\n\n").slice(0,42000);
    const prompt = `Answer the user's question using ONLY their personal study notes supplied below. This is a memory assistant, not a Bible commentary engine. Do not invent Bible content, theology, events, quotations, or things the user did not write. When making a pattern-level synthesis, identify it as a pattern in the user's notes. Cite source labels like [M3]. If the notes do not answer the question, say so clearly.\n\nQUESTION:\n${data.question}\n\nPERSONAL STUDY MEMORY:\n${corpus}\n\nReturn ONLY JSON: {"answer":"grounded synthesis with [M#] citations","sources":["M# — reference"],"patterns":["patterns explicitly supported by multiple notes"],"unresolvedQuestions":["questions or tensions visible in the user's notes"]}.`;
    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method:"POST",
        headers:{"Lovable-API-Key":key,"Content-Type":"application/json"},
        body:JSON.stringify({model:"google/gemini-3.6-flash",messages:[{role:"system",content:"You are a private study-memory assistant. You summarize only the user's supplied writings and never manufacture Scripture or personal history."},{role:"user",content:prompt}]})
      });
      if(!response.ok){
        const body=await response.text();
        let message:string|undefined;
        try{message=(JSON.parse(body) as {message?:string}).message;}catch{/* non-JSON */}
        const { gatewayErrorMessage } = await import("./insights.functions");
        return {ok:false,error:gatewayErrorMessage(response.status,message)};
      }
      const json=await response.json() as {choices?:Array<{message?:{content?:string}}>};
      const parsed=parse(json.choices?.[0]?.message?.content||"");
      return parsed?{ok:true,answer:parsed}:{ok:false,error:"Study Memory response could not be parsed. Please try again."};
    } catch(e) { return {ok:false,error:e instanceof Error?e.message:"Unable to search Study Memory."}; }
  });
