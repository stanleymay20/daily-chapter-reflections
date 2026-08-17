import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, ChevronLeft, Highlighter, NotebookPen, Pause, Play, Share2, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiStateNotice } from "@/components/ApiStateNotice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { pickDefaultVersion, useNotes, useProgress, useSelectedVersion, type ProgressStatus } from "@/hooks/useReadingState";
import { berlinToday, findChapterByPassageId } from "@/lib/schedule";
import { getPassageFn, listBiblesFn } from "@/lib/youversion.functions";
import { generateInsightsFn, type StudyInsights } from "@/lib/insights.functions";
import { encodeApiError, isValidPassageId } from "@/lib/youversion";
import { loadSavedVerses, loadSettings, safeShareText, upsertSavedVerse, type HighlightColor, type SavedVerse } from "@/lib/app-state";

export const Route = createFileRoute("/read/$passage")({ component: Reader });

const statuses: { value: ProgressStatus; label: string }[] = [
  { value: "not_started", label: "Not started" }, { value: "reading", label: "Reading" }, { value: "complete", label: "Complete" },
];
const highlightColors: HighlightColor[] = ["yellow","green","blue","pink","purple"];
const bg: Record<HighlightColor,string> = { yellow:"bg-yellow-200/60 dark:bg-yellow-700/30", green:"bg-green-200/60 dark:bg-green-700/30", blue:"bg-blue-200/60 dark:bg-blue-700/30", pink:"bg-pink-200/60 dark:bg-pink-700/30", purple:"bg-purple-200/60 dark:bg-purple-700/30" };

type Tab = "scripture" | "insights" | "media";

function Reader() {
  const { passage } = Route.useParams();
  const today = berlinToday();
  const found = findChapterByPassageId(passage);
  const label = found ? `${found.ref.book} ${found.ref.chapter}` : passage;
  const { statusOf, setStatus } = useProgress(today);
  const { note, save } = useNotes(passage);
  const { versionId, ready } = useSelectedVersion();
  const [tab,setTab]=useState<Tab>("scripture");
  const [selectedVerse,setSelectedVerse]=useState<string | null>(null);
  const [saved,setSaved]=useState<SavedVerse[]>([]);
  const [insights,setInsights]=useState<StudyInsights | null>(null);
  const [insightsError,setInsightsError]=useState("");
  const [generating,setGenerating]=useState(false);
  const [speaking,setSpeaking]=useState(false);
  const [verseCursor,setVerseCursor]=useState(0);
  const settings=useMemo(()=>loadSettings(),[]);

  useEffect(()=>setSaved(loadSavedVerses()),[]);
  useEffect(()=>()=>{if(typeof window!=="undefined")window.speechSynthesis?.cancel()},[]);

  const listBibles = useServerFn(listBiblesFn);
  const getPassage = useServerFn(getPassageFn);
  const generateInsights = useServerFn(generateInsightsFn);
  const biblesQuery = useQuery({ queryKey:["bibles"], queryFn:async()=>{const res=await listBibles();if(!res.ok)throw new Error(encodeApiError(res.error));return res;}, retry:false, staleTime:3600000 });
  const active = useMemo(()=>ready?pickDefaultVersion(biblesQuery.data?.bibles??[],versionId):undefined,[biblesQuery.data,versionId,ready]);
  const passageQuery = useQuery({ queryKey:["passage",active?.id,passage], queryFn:async()=>{const res=await getPassage({data:{versionId:active!.id,passage}});if(!res.ok)throw new Error(encodeApiError(res.error));return res.passage;}, enabled:Boolean(active?.id)&&isValidPassageId(passage), retry:false });
  const status=statusOf(passage);
  const copyright=passageQuery.data?.copyright||active?.copyright||"";
  const verseKey=(n:string)=>`${active?.id||"x"}:${passage}:${n}`;
  const savedFor=(n:string)=>saved.find(x=>x.id===verseKey(n));

  const persistVerse=(n:string,text:string,patch:Partial<SavedVerse>)=>{
    const current=savedFor(n);
    const item:SavedVerse={id:verseKey(n),passage,verse:n,reference:`${label}:${n}`,text,updatedAt:new Date().toISOString(),...current,...patch};
    upsertSavedVerse(item);setSaved(loadSavedVerses());
  };
  const share=async(reference:string,text:string)=>{const payload=safeShareText(reference,text);try{if(navigator.share)await navigator.share({title:reference,text:payload,url:location.href});else await navigator.clipboard.writeText(`${payload}\n${location.href}`);}catch{}}
  const speakVerse=(index:number)=>{const verses=passageQuery.data?.verses??[];if(!verses.length||!window.speechSynthesis)return;const safe=Math.max(0,Math.min(index,verses.length-1));window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(verses[safe]!.text);u.rate=settings.audioRate;u.onstart=()=>setSpeaking(true);u.onend=()=>setSpeaking(false);setVerseCursor(safe);window.speechSynthesis.speak(u);};
  const speakChapter=()=>{const text=(passageQuery.data?.verses??[]).map(v=>v.text).join(" ");if(!text)return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=settings.audioRate;u.onstart=()=>setSpeaking(true);u.onend=()=>setSpeaking(false);window.speechSynthesis.speak(u);};
  const stopSpeech=()=>{window.speechSynthesis?.cancel();setSpeaking(false)};
  const doInsights=async()=>{if(!active)return;setGenerating(true);setInsightsError("");const res=await generateInsights({data:{versionId:active.id,passage}});setGenerating(false);if(res.ok)setInsights(res.insights);else setInsightsError(res.error);};

  return <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-32 pt-6">
    <div className="flex items-center justify-between"><Link to="/"><Button variant="ghost" size="sm" className="-ml-2"><ChevronLeft className="mr-1 size-4"/>Today</Button></Link><span className="text-[11px] text-muted-foreground">{active?`${active.abbreviation||active.name} · `:""}Source: YouVersion Platform</span></div>
    <h1 className="mt-4 font-[family-name:var(--font-scripture)] text-3xl font-semibold tracking-tight">{label}</h1>{found?<p className="text-xs text-muted-foreground">{found.ref.track} track</p>:null}
    <div className="mt-4 flex gap-2">{statuses.map(s=><Button key={s.value} size="sm" variant={status===s.value?"default":"outline"} className="text-xs" onClick={()=>setStatus(passage,s.value)}>{s.label}</Button>)}</div>
    <div className="mt-5 grid grid-cols-3 rounded-lg bg-muted p-1">{(["scripture","insights","media"] as Tab[]).map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded-md px-2 py-2 text-xs font-medium capitalize ${tab===t?"bg-background shadow-sm":"text-muted-foreground"}`}>{t}</button>)}</div>

    {tab==="scripture"?<>
      <section className="mt-6">{!isValidPassageId(passage)?<ApiStateNotice error={new Error("YVP_ERROR:{\"kind\":\"invalid_request\",\"status\":400,\"message\":\"That passage reference is not valid.\",\"retryable\":false}")}/>:biblesQuery.isError?<ApiStateNotice error={biblesQuery.error} onRetry={()=>biblesQuery.refetch()}/>:biblesQuery.isLoading||passageQuery.isLoading||!ready?<div className="space-y-3">{Array.from({length:8}).map((_,i)=><Skeleton key={i} className="h-5 w-full"/>)}</div>:!active?<ApiStateNotice error={new Error("YVP_ERROR:{\"kind\":\"not_found\",\"status\":403,\"message\":\"No Bible translations are available for this app.\",\"retryable\":true}")} onRetry={()=>biblesQuery.refetch()}/>:passageQuery.isError?<ApiStateNotice error={passageQuery.error} onRetry={()=>passageQuery.refetch()}/>:passageQuery.data?<article className="scripture text-foreground" style={{fontSize:settings.fontSize,lineHeight:settings.lineHeight}}><p className="mb-4 text-xs font-sans uppercase tracking-[0.16em] text-muted-foreground">{passageQuery.data.reference}</p>{passageQuery.data.verses.map((v,i)=>{const stored=savedFor(v.number);return <p key={`${v.number}-${i}`} id={`verse-${v.number}`} onClick={()=>setSelectedVerse(v.number)} className={`mb-3 cursor-pointer rounded px-1 transition ${stored?.highlight?bg[stored.highlight]:""} ${selectedVerse===v.number?"ring-1 ring-primary/40":""}`}><sup className="mr-1 font-sans text-[0.65em] text-muted-foreground">{v.number}</sup>{v.text}</p>})}{copyright?<p className="mt-8 border-t pt-4 font-sans text-[11px] leading-relaxed text-muted-foreground">{copyright}</p>:null}</article>:null}</section>
      {selectedVerse&&passageQuery.data?(()=>{const v=passageQuery.data.verses.find(x=>x.number===selectedVerse);if(!v)return null;const stored=savedFor(v.number);return <Card className="sticky bottom-20 mt-4 p-3 shadow-lg"><div className="flex items-center justify-between"><strong className="text-xs">{label}:{v.number}</strong><button className="text-xs text-muted-foreground" onClick={()=>setSelectedVerse(null)}>Close</button></div><div className="mt-2 flex flex-wrap gap-2">{highlightColors.map(c=><button key={c} title={`Highlight ${c}`} onClick={()=>persistVerse(v.number,v.text,{highlight:c})} className={`size-7 rounded-full border ${bg[c]}`}/>) }<Button variant="outline" size="sm" onClick={()=>persistVerse(v.number,v.text,{bookmarked:!stored?.bookmarked})}><Bookmark className="mr-1 size-3.5"/>{stored?.bookmarked?"Saved":"Bookmark"}</Button><Button variant="outline" size="sm" onClick={()=>{const note=window.prompt("Verse note",stored?.note||"");if(note!==null)persistVerse(v.number,v.text,{note})}}><NotebookPen className="mr-1 size-3.5"/>Note</Button><Button variant="outline" size="sm" onClick={()=>share(`${label}:${v.number}`,v.text)}><Share2 className="mr-1 size-3.5"/>Share</Button></div></Card>})():null}
      {passageQuery.data?<Card className="mt-5 p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Volume2 className="size-4"/><span className="text-sm font-medium">Read aloud · {settings.audioRate}×</span></div><div className="flex gap-1"><Button size="sm" variant="outline" onClick={()=>speakVerse(Math.max(0,verseCursor-1))}>Prev</Button><Button size="sm" onClick={speaking?stopSpeech:speakChapter}>{speaking?<Pause className="size-4"/>:<Play className="size-4"/>}</Button><Button size="sm" variant="outline" onClick={()=>speakVerse(verseCursor+1)}>Next</Button></div></div></Card>:null}
      <Collapsible className="mt-6 rounded-xl border bg-card"><CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium"><NotebookPen className="size-4 text-muted-foreground"/>Study notes</CollapsibleTrigger><CollapsibleContent className="px-4 pb-4"><p className="mb-2 text-xs text-muted-foreground">Your own reflections, stored only on this device.</p><Textarea value={note} onChange={e=>save(e.target.value)} placeholder={`Notes on ${label}…`} className="min-h-32 text-sm"/></CollapsibleContent></Collapsible>
    </>:null}

    {tab==="insights"?<section className="mt-6"><div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4"/>AI Study Insights</h2><p className="text-xs text-muted-foreground">Study assistance — not Scripture. Generated from this YouVersion chapter.</p></div><Button size="sm" onClick={doInsights} disabled={generating||!active}>{generating?"Generating…":insights?"Regenerate":"Generate"}</Button></div>{insightsError?<Card className="mt-4 p-4 text-sm text-destructive">{insightsError}</Card>:null}{insights?<div className="mt-4 space-y-4"><Insight title="Summary"><p>{insights.summary}</p></Insight><Insight title="Key themes" items={insights.themes}/><Insight title="Historical / cultural context"><p>{insights.context}</p></Insight><Insight title="People & places" items={insights.peoplePlaces}/><Insight title="Cross-references" items={insights.crossReferences}/><Insight title="Reflection questions" items={insights.reflectionQuestions}/><Insight title="Practical application" items={insights.applications}/><Insight title="Prayer prompts" items={insights.prayerPrompts}/><Insight title="Deeper study" items={insights.deeperStudy}/></div>:!generating?<Card className="mt-4 p-6 text-center text-sm text-muted-foreground">Generate grounded insights after the chapter has loaded.</Card>:null}</section>:null}

    {tab==="media"?<section className="mt-6"><h2 className="font-semibold">Media study aids</h2><p className="text-xs text-muted-foreground">AI-generated study aid — not Scripture.</p>{insights?<div className="mt-4 space-y-3"><Insight title="People & places" items={insights.peoplePlaces}/><Insight title="Key-event / deeper-study cards" items={insights.deeperStudy}/><Insight title="Themes" items={insights.themes}/></div>:<Card className="mt-4 p-6 text-center text-sm text-muted-foreground">Generate AI Study Insights first; the Media tab reuses the same grounded chapter analysis for structured cards.</Card>}</section>:null}
  </main>;
}

function Insight({title,items,children}:{title:string;items?:string[];children?:React.ReactNode}){return <Card className="p-4"><h3 className="text-sm font-semibold">{title}</h3>{children?<div className="mt-2 text-sm leading-relaxed">{children}</div>:null}{items?.length?<ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">{items.map((x,i)=><li key={i}>{x}</li>)}</ul>:null}</Card>}
