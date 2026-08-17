import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, BookOpenCheck, Check, ChevronLeft, ChevronRight, CircleHelp, Headphones, Heart, Lightbulb, NotebookPen, Pause, Play, Share2, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiStateNotice } from "@/components/ApiStateNotice";
import { TranslationPicker } from "@/components/TranslationPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { pickDefaultVersion, useNotes, useProgress, useSelectedVersion } from "@/hooks/useReadingState";
import { loadSavedVerses, loadSettings, readingWidthClass, safeShareText, upsertSavedVerse, type HighlightColor, type SavedVerse } from "@/lib/app-state";
import { askChapterFn, generateInsightsFn, type AskChapterAnswer, type StudyInsights } from "@/lib/insights.functions";
import { berlinToday, chapterLabel, findChapterByPassageId, getPlanForDate, passageId } from "@/lib/schedule";
import { loadChapterStudy, saveChapterStudy, type ChapterStudy } from "@/lib/study-state";
import { encodeApiError, isValidPassageId } from "@/lib/youversion";
import { getPassageFn, listBiblesFn } from "@/lib/youversion.functions";

export const Route = createFileRoute("/read/$passage")({ component: Reader });

type Stage="read"|"understand"|"reflect"|"pray";
const stages:{id:Stage;label:string;icon:typeof BookOpenCheck}[]=[{id:"read",label:"Read",icon:BookOpenCheck},{id:"understand",label:"Understand",icon:Lightbulb},{id:"reflect",label:"Reflect",icon:NotebookPen},{id:"pray",label:"Pray",icon:Heart}];
const highlightColors:HighlightColor[]=["yellow","green","blue","pink","purple"];
const bg:Record<HighlightColor,string>={yellow:"bg-yellow-200/70 dark:bg-yellow-700/30",green:"bg-green-200/70 dark:bg-green-700/30",blue:"bg-blue-200/70 dark:bg-blue-700/30",pink:"bg-pink-200/70 dark:bg-pink-700/30",purple:"bg-purple-200/70 dark:bg-purple-700/30"};

function Reader(){
  const {passage}=Route.useParams();
  const today=berlinToday();
  const found=findChapterByPassageId(passage);
  const label=found?`${found.ref.book} ${found.ref.chapter}`:passage;
  const {statusOf,setStatus}=useProgress(today);
  const {note,save}=useNotes(passage);
  const {versionId,select,ready}=useSelectedVersion();
  const [stage,setStage]=useState<Stage>("read");
  const [selectedVerse,setSelectedVerse]=useState<string|null>(null);
  const [saved,setSaved]=useState<SavedVerse[]>([]);
  const [study,setStudy]=useState<ChapterStudy>(()=>loadChapterStudy(passage));
  const [insights,setInsights]=useState<StudyInsights|null>(null);
  const [insightsError,setInsightsError]=useState("");
  const [generating,setGenerating]=useState(false);
  const [question,setQuestion]=useState("");
  const [answer,setAnswer]=useState<AskChapterAnswer|null>(null);
  const [asking,setAsking]=useState(false);
  const [speaking,setSpeaking]=useState(false);
  const [verseCursor,setVerseCursor]=useState(0);
  const cancelSpeech=useRef(false);
  const settings=useMemo(()=>loadSettings(),[]);

  useEffect(()=>{setSaved(loadSavedVerses());setStudy(loadChapterStudy(passage));setStatus(passage,statusOf(passage)==="complete"?"complete":"reading");},[passage]);
  useEffect(()=>()=>{cancelSpeech.current=true;if(typeof window!=="undefined")window.speechSynthesis?.cancel()},[]);

  const listBibles=useServerFn(listBiblesFn);const getPassage=useServerFn(getPassageFn);const generateInsights=useServerFn(generateInsightsFn);const askChapter=useServerFn(askChapterFn);
  const biblesQuery=useQuery({queryKey:["bibles"],queryFn:async()=>{const res=await listBibles();if(!res.ok)throw new Error(encodeApiError(res.error));return res;},retry:false,staleTime:3600000});
  const bibles=biblesQuery.data?.bibles??[];
  const active=useMemo(()=>ready?pickDefaultVersion(bibles,versionId):undefined,[bibles,versionId,ready]);
  const passageQuery=useQuery({queryKey:["passage",active?.id,passage],queryFn:async()=>{const res=await getPassage({data:{versionId:active!.id,passage}});if(!res.ok)throw new Error(encodeApiError(res.error));return res.passage;},enabled:Boolean(active?.id)&&isValidPassageId(passage),retry:false});
  const verses=passageQuery.data?.verses??[];
  const copyright=passageQuery.data?.copyright||active?.copyright||"";
  const currentPlan=getPlanForDate(today)?.chapters??[];
  const currentIndex=currentPlan.findIndex(c=>passageId(c.usfm,c.chapter)===passage);
  const nextRef=currentIndex>=0?currentPlan[currentIndex+1]:undefined;
  const nextPassage=nextRef?passageId(nextRef.usfm,nextRef.chapter):null;
  const completed=statusOf(passage)==="complete";
  const progress=((Math.max(currentIndex,0)+(completed?1:0))/Math.max(currentPlan.length,1))*100;
  const verseKey=(n:string)=>`${active?.id||"x"}:${passage}:${n}`;
  const savedFor=(n:string)=>saved.find(x=>x.id===verseKey(n));

  const updateStudy=(patch:Partial<Omit<ChapterStudy,"passage">>)=>{const next=saveChapterStudy(passage,patch);setStudy(next);};
  const persistVerse=(n:string,text:string,patch:Partial<SavedVerse>)=>{const current=savedFor(n);upsertSavedVerse({id:verseKey(n),passage,verse:n,reference:`${label}:${n}`,text,updatedAt:new Date().toISOString(),...current,...patch});setSaved(loadSavedVerses());};
  const share=async(reference:string,text:string)=>{const payload=safeShareText(reference,text);try{if(navigator.share)await navigator.share({title:reference,text:payload,url:location.href});else await navigator.clipboard.writeText(`${payload}\n${location.href}`);}catch{/* user cancelled */}};

  const stopSpeech=()=>{cancelSpeech.current=true;window.speechSynthesis?.cancel();setSpeaking(false)};
  const speakFrom=(index:number)=>{if(!verses.length||!window.speechSynthesis)return;cancelSpeech.current=false;const safe=Math.max(0,Math.min(index,verses.length-1));setVerseCursor(safe);const verse=verses[safe]!;const u=new SpeechSynthesisUtterance(verse.text);u.rate=settings.audioRate;u.onstart=()=>{setSpeaking(true);if(settings.autoScroll)document.getElementById(`verse-${verse.number}`)?.scrollIntoView({behavior:"smooth",block:"center"})};u.onend=()=>{if(cancelSpeech.current){setSpeaking(false);return;}if(safe<verses.length-1)speakFrom(safe+1);else setSpeaking(false)};window.speechSynthesis.cancel();window.speechSynthesis.speak(u);};

  const doInsights=async()=>{if(!active)return;setGenerating(true);setInsightsError("");const res=await generateInsights({data:{versionId:active.id,passage}});setGenerating(false);if(res.ok)setInsights(res.insights);else setInsightsError(res.error);};
  const doAsk=async()=>{if(!active||!question.trim())return;setAsking(true);setAnswer(null);const res=await askChapter({data:{versionId:active.id,passage,question:question.trim()}});setAsking(false);if(res.ok)setAnswer(res.answer);else setInsightsError(res.error);};
  const complete=()=>{setStatus(passage,"complete");updateStudy({completedAt:new Date().toISOString()});};

  return <main className={`mx-auto min-h-screen px-4 pb-32 pt-5 sm:px-6 ${readingWidthClass(settings.readingWidth)}`}>
    <header className="sticky top-0 z-30 -mx-4 border-b bg-background/92 px-4 pb-3 pt-2 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-2"><Link to="/"><Button variant="ghost" size="sm" className="-ml-2"><ChevronLeft className="mr-1 size-4"/>Today</Button></Link><div className="min-w-0 flex-1 text-center"><p className="truncate font-[family-name:var(--font-scripture)] text-lg font-semibold">{label}</p><p className="text-[10px] text-muted-foreground">{found?.ref.track??"Bible study"} · YouVersion Platform</p></div>{bibles.length?<TranslationPicker bibles={bibles} {...(active?{value:active.id}:{})} onChange={select}/>:<span className="w-8"/>}</div>
      {currentIndex>=0?<Progress className="mt-2 h-1" value={progress}/>:null}
    </header>

    <section className="mt-5 rounded-2xl border bg-card p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Before you read</p><p className="mt-2 text-sm">What are you bringing into this chapter today?</p><Textarea className="mt-3 min-h-20" value={study.intention??""} onChange={e=>updateStudy({intention:e.target.value})} placeholder="A concern, gratitude, question, or simply: I am here to listen."/></section>

    <nav className="mt-4 grid grid-cols-4 rounded-xl bg-muted p-1" aria-label="Study stages">{stages.map(({id,label:stageLabel,icon:Icon})=><button key={id} onClick={()=>setStage(id)} className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-medium sm:flex-row sm:justify-center sm:text-xs ${stage===id?"bg-background text-foreground shadow-sm":"text-muted-foreground"}`}><Icon className="size-4"/>{stageLabel}</button>)}</nav>

    {stage==="read"?<section className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h1 className="font-[family-name:var(--font-scripture)] text-4xl font-semibold">{label}</h1>{passageQuery.data?<p className="mt-1 text-xs text-muted-foreground">{passageQuery.data.reference}</p>:null}</div><Button variant="outline" size="sm" onClick={speaking?stopSpeech:()=>speakFrom(verseCursor)} disabled={!verses.length}>{speaking?<Pause className="mr-1 size-4"/>:<Headphones className="mr-1 size-4"/>}{speaking?"Pause":"Listen"}</Button></div>
      {!isValidPassageId(passage)?<ApiStateNotice error={new Error("YVP_ERROR:{\"kind\":\"invalid_request\",\"status\":400,\"message\":\"That passage reference is not valid.\",\"retryable\":false}")}/>:biblesQuery.isError?<ApiStateNotice error={biblesQuery.error} onRetry={()=>biblesQuery.refetch()}/>:biblesQuery.isLoading||passageQuery.isLoading||!ready?<div className="space-y-3">{Array.from({length:10}).map((_,i)=><Skeleton key={i} className="h-6 w-full"/>)}</div>:!active?<ApiStateNotice error={new Error("YVP_ERROR:{\"kind\":\"not_found\",\"status\":403,\"message\":\"No Bible translations are available for this app.\",\"retryable\":true}")} onRetry={()=>biblesQuery.refetch()}/>:passageQuery.isError?<ApiStateNotice error={passageQuery.error} onRetry={()=>passageQuery.refetch()}/>:passageQuery.data?<article className="scripture text-foreground" style={{fontSize:settings.fontSize,lineHeight:settings.lineHeight}}>{verses.map((v,i)=>{const stored=savedFor(v.number);return <p key={`${v.number}-${i}`} id={`verse-${v.number}`} onClick={()=>setSelectedVerse(v.number)} className={`mb-3 cursor-pointer rounded-md px-1.5 py-0.5 transition ${stored?.highlight?bg[stored.highlight]:""} ${selectedVerse===v.number?"ring-1 ring-primary/40":verseCursor===i&&speaking?"bg-primary/8":"hover:bg-muted/50"}`}>{settings.showVerseNumbers?<sup className="mr-1 font-sans text-[0.62em] text-muted-foreground">{v.number}</sup>:null}{v.text}</p>})}{copyright?<p className="mt-10 border-t pt-4 font-sans text-[11px] leading-relaxed text-muted-foreground">{copyright}</p>:null}</article>:null}

      {selectedVerse&&passageQuery.data?(()=>{const v=verses.find(x=>x.number===selectedVerse);if(!v)return null;const stored=savedFor(v.number);return <Card className="sticky bottom-4 z-20 mt-4 p-3 shadow-xl"><div className="flex items-center justify-between"><strong className="text-xs">{label}:{v.number}</strong><button className="text-xs text-muted-foreground" onClick={()=>setSelectedVerse(null)}>Close</button></div><div className="mt-2 flex flex-wrap gap-2">{highlightColors.map(c=><button key={c} aria-label={`Highlight ${c}`} onClick={()=>persistVerse(v.number,v.text,{highlight:c})} className={`size-7 rounded-full border ${bg[c]}`}/>) }<Button variant="outline" size="sm" onClick={()=>persistVerse(v.number,v.text,{bookmarked:!stored?.bookmarked})}><Bookmark className="mr-1 size-3.5"/>{stored?.bookmarked?"Saved":"Bookmark"}</Button><Button variant="outline" size="sm" onClick={()=>{const verseNote=window.prompt("Verse note",stored?.note||"");if(verseNote!==null)persistVerse(v.number,v.text,{note:verseNote})}}><NotebookPen className="mr-1 size-3.5"/>Note</Button><Button variant="outline" size="sm" onClick={()=>share(`${label}:${v.number}`,v.text)}><Share2 className="mr-1 size-3.5"/>Share</Button></div></Card>})():null}

      <Card className="mt-6 p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Volume2 className="size-4 text-primary"/><div><p className="text-sm font-medium">Read aloud</p><p className="text-xs text-muted-foreground">{settings.audioRate}× · verse {Math.min(verseCursor+1,Math.max(verses.length,1))} of {verses.length}</p></div></div><div className="flex gap-1"><Button size="icon" variant="outline" onClick={()=>speakFrom(Math.max(0,verseCursor-1))} disabled={!verses.length} aria-label="Previous verse"><ChevronLeft className="size-4"/></Button><Button size="icon" onClick={speaking?stopSpeech:()=>speakFrom(verseCursor)} disabled={!verses.length} aria-label={speaking?"Pause":"Play"}>{speaking?<Pause className="size-4"/>:<Play className="size-4"/>}</Button><Button size="icon" variant="outline" onClick={()=>speakFrom(Math.min(verses.length-1,verseCursor+1))} disabled={!verses.length} aria-label="Next verse"><ChevronRight className="size-4"/></Button></div></div></Card>

      <Card className="mt-4 p-4"><div className="flex items-center gap-2"><NotebookPen className="size-4 text-primary"/><h2 className="text-sm font-semibold">Chapter notes</h2></div><Textarea value={note} onChange={e=>save(e.target.value)} placeholder={`What do you notice in ${label}?`} className="mt-3 min-h-28"/></Card>
      <div className="mt-5 flex justify-end"><Button onClick={()=>setStage("understand")}>Understand this chapter<ChevronRight className="ml-1 size-4"/></Button></div>
    </section>:null}

    {stage==="understand"?<section className="mt-6"><div className="flex items-start justify-between gap-3"><div><h2 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Understand</h2><p className="mt-1 text-xs text-muted-foreground"><Sparkles className="mr-1 inline size-3"/>AI study guidance — not Scripture. Check every claim against the Bible.</p></div><Button size="sm" onClick={doInsights} disabled={generating||!active}>{generating?"Studying…":insights?"Refresh guide":"Build guide"}</Button></div>{insightsError?<Card className="mt-4 p-4 text-sm text-destructive">{insightsError}</Card>:null}{insights?<div className="mt-4 space-y-3"><StudyCard title="Chapter overview"><p>{insights.summary}</p></StudyCard><StudyCard title="Key themes" items={insights.themes}/><StudyCard title="Context"><p>{insights.context}</p></StudyCard><StudyCard title="People & places" items={insights.peoplePlaces}/><StudyCard title="Scripture connections" items={insights.crossReferences}/><StudyCard title="Visual study board" items={[...insights.themes,...insights.peoplePlaces].slice(0,8)}/><StudyCard title="Go deeper" items={insights.deeperStudy}/></div>:<Card className="mt-4 p-5"><h3 className="text-sm font-semibold">Start with observation</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Before asking AI, identify repeated words, changes in tone, causes and consequences, commands, questions, promises, and what the chapter explicitly says about God and people.</p></Card>}
      <Card className="mt-4 p-4"><div className="flex items-center gap-2"><CircleHelp className="size-4 text-primary"/><h3 className="text-sm font-semibold">Ask about this chapter</h3></div><p className="mt-1 text-xs text-muted-foreground">Answers separate what the chapter explicitly states from inference and uncertainty.</p><Textarea className="mt-3 min-h-20" value={question} onChange={e=>setQuestion(e.target.value)} placeholder={`Why does this happen in ${label}?`}/><Button className="mt-2" size="sm" onClick={doAsk} disabled={asking||!question.trim()}>{asking?"Thinking…":"Ask"}</Button>{answer?<div className="mt-4 space-y-3 text-sm"><p className="leading-relaxed">{answer.answer}</p><AnswerList title="Explicit from this chapter" items={answer.explicitFromText}/><AnswerList title="Reasonable inference" items={answer.inferences}/><AnswerList title="Uncertain / not established here" items={answer.uncertainties}/><AnswerList title="References to examine next" items={answer.relatedReferences}/></div>:null}</Card>
      <div className="mt-5 flex justify-end"><Button onClick={()=>setStage("reflect")}>Reflect<ChevronRight className="ml-1 size-4"/></Button></div></section>:null}

    {stage==="reflect"?<section className="mt-6"><h2 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Reflect</h2><p className="mt-1 text-sm text-muted-foreground">Think before asking for more information. These answers become part of your study memory.</p><div className="mt-5 space-y-4"><ReflectionField label="Observe" prompt="What does the chapter actually say or emphasize?" value={study.reflections.observation??""} onChange={v=>updateStudy({reflections:{observation:v}})}/><ReflectionField label="Understand" prompt="What seems to be happening, and what evidence in the chapter supports that?" value={study.reflections.understanding??""} onChange={v=>updateStudy({reflections:{understanding:v}})}/><ReflectionField label="Reflect" prompt="What challenged, encouraged, surprised, or convicted you?" value={study.reflections.reflection??""} onChange={v=>updateStudy({reflections:{reflection:v}})}/><ReflectionField label="Apply" prompt="What is one concrete response you can make today?" value={study.reflections.application??""} onChange={v=>updateStudy({reflections:{application:v}})}/></div>{insights?.reflectionQuestions?.length?<StudyCard title="Optional study-guide questions" items={insights.reflectionQuestions}/>:null}<div className="mt-5 flex justify-end"><Button onClick={()=>setStage("pray")}>Pray from what you read<ChevronRight className="ml-1 size-4"/></Button></div></section>:null}

    {stage==="pray"?<section className="mt-6"><div className="flex items-center gap-2"><Heart className="size-5 text-primary"/><h2 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Pray</h2></div><p className="mt-2 text-sm text-muted-foreground">Respond in your own words. The app saves your prayer; it does not need to compose one for you.</p>{insights?.prayerPrompts?.length?<StudyCard title="Optional prayer prompts" items={insights.prayerPrompts}/>:null}<Textarea className="mt-4 min-h-40" value={study.prayer??""} onChange={e=>updateStudy({prayer:e.target.value})} placeholder="God, from what I read today…"/><Card className="mt-5 p-4"><div className="flex items-center gap-2"><Check className="size-4 text-primary"/><h3 className="font-semibold">Finish this chapter</h3></div><p className="mt-2 text-sm text-muted-foreground">Mark complete when you have finished the reading. Your notes, highlights, reflections and prayer remain in your journal.</p><Button className="mt-4 w-full" onClick={complete} disabled={completed}>{completed?<><Check className="mr-2 size-4"/>Chapter complete</>:"Complete chapter"}</Button>{completed&&nextPassage&&nextRef?<Link className="mt-3 block" to="/read/$passage" params={{passage:nextPassage}}><Button variant="outline" className="w-full">Next · {chapterLabel(nextRef)}<ChevronRight className="ml-1 size-4"/></Button></Link>:completed?<Link className="mt-3 block" to="/"><Button variant="outline" className="w-full">Return to today's review</Button></Link>:null}</Card></section>:null}
  </main>;
}

function StudyCard({title,items,children}:{title:string;items?:string[];children?:React.ReactNode}){return <Card className="p-4"><h3 className="text-sm font-semibold">{title}</h3>{children?<div className="mt-2 text-sm leading-relaxed">{children}</div>:null}{items?.length?<ul className="mt-2 space-y-2 text-sm leading-relaxed">{items.map((x,i)=><li key={i} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60"/><span>{x}</span></li>)}</ul>:null}</Card>}
function AnswerList({title,items}:{title:string;items:string[]}){if(!items?.length)return null;return <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs font-semibold uppercase tracking-wide">{title}</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed">{items.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
function ReflectionField({label,prompt,value,onChange}:{label:string;prompt:string;value:string;onChange:(v:string)=>void}){return <Card className="p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{label}</p><p className="mt-1 text-sm">{prompt}</p><Textarea className="mt-3 min-h-24" value={value} onChange={e=>onChange(e.target.value)} placeholder="Write what you genuinely notice…"/></Card>}
