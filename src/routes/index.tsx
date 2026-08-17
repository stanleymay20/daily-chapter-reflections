import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookHeart, BookOpen, Check, ChevronRight, Circle, CircleDot, Clock3, Flame, Headphones, MoonStar, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiStateNotice } from "@/components/ApiStateNotice";
import { TranslationPicker } from "@/components/TranslationPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { pickDefaultVersion, useProgress, useSelectedVersion } from "@/hooks/useReadingState";
import { DEFAULT_SETTINGS, loadSettings, type AppSettings } from "@/lib/app-state";
import { berlinToday, chapterLabel, formatBerlinDate, getPlanForDate, passageId } from "@/lib/schedule";
import { estimateMinutes, loadDailyReview, saveDailyReview } from "@/lib/study-state";
import { encodeApiError, normalizeApiError } from "@/lib/youversion";
import { listBiblesFn } from "@/lib/youversion.functions";

export const Route = createFileRoute("/")({
  head:()=>({meta:[{title:"Today's Bible Study"},{name:"description",content:"A guided daily Bible study journey powered by real Scripture from YouVersion."}]}),
  component:Home,
});

const statusIcon={not_started:Circle,reading:CircleDot,complete:Check} as const;

function Home(){
  const today=berlinToday();
  const plan=getPlanForDate(today);
  const {statusOf,completedCount}=useProgress(today);
  const {versionId,select,ready}=useSelectedVersion();
  const [settings,setSettings]=useState<AppSettings>(DEFAULT_SETTINGS);
  const [review,setReview]=useState(()=>loadDailyReview(today));
  useEffect(()=>{setSettings(loadSettings());setReview(loadDailyReview(today));},[today]);

  const listBibles=useServerFn(listBiblesFn);
  const biblesQuery=useQuery({queryKey:["bibles"],queryFn:async()=>{const res=await listBibles();if(!res.ok)throw new Error(encodeApiError(res.error));return res;},retry:false,staleTime:3600000});
  const bibles=biblesQuery.data?.bibles??[];
  const active=useMemo(()=>ready?pickDefaultVersion(bibles,versionId):undefined,[bibles,versionId,ready]);
  const chapters=useMemo(()=>{
    const all=plan?.chapters??[];
    const selected=all.filter(c=>settings.activeTracks.includes(c.track));
    return selected.slice(0,Math.max(1,settings.chaptersPerDay));
  },[plan,settings]);
  const passages=chapters.map(c=>passageId(c.usfm,c.chapter));
  const done=completedCount(passages);
  const percent=passages.length?(done/passages.length)*100:0;
  const next=chapters.find(c=>statusOf(passageId(c.usfm,c.chapter))!=="complete");
  const minutes=estimateMinutes(chapters.length,settings.studyMode);
  const allDone=passages.length>0&&done===passages.length;

  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-28 pt-7 sm:px-6 sm:pt-10">
    <header className="rounded-3xl border bg-gradient-to-b from-primary/8 to-card p-5 shadow-sm sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{formatBerlinDate(today)}</p><h1 className="mt-2 font-[family-name:var(--font-scripture)] text-4xl font-semibold tracking-tight sm:text-5xl">Today's journey</h1><p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">Read slowly. Notice what the text says. Reflect honestly. Pray from what you have learned.</p></div><div className="rounded-full bg-primary/10 p-3 text-primary"><BookHeart className="size-6"/></div></div>

      <div className="mt-6 flex items-center justify-between text-sm"><span>{done} of {passages.length} chapters complete</span><strong>{Math.round(percent)}%</strong></div>
      <Progress className="mt-2 h-2.5" value={percent}/>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="secondary" className="gap-1"><Clock3 className="size-3"/>~{minutes} min · {settings.studyMode} study</Badge><Badge variant="secondary" className="gap-1"><Headphones className="size-3"/>Read aloud available</Badge><Badge variant="secondary" className="gap-1"><Sparkles className="size-3"/>Guided reflection</Badge></div>

      {next?<Link to="/read/$passage" params={{passage:passageId(next.usfm,next.chapter)}} className="mt-5 block"><Button className="h-12 w-full text-base">{done?"Continue study":"Begin today's study"}<ChevronRight className="ml-2 size-4"/></Button></Link>:null}
    </header>

    <section className="mt-4 grid grid-cols-2 gap-3">
      <Card className="p-4"><div className="flex items-center gap-2 text-primary"><Flame className="size-4"/><span className="text-xs font-semibold uppercase tracking-wide">Daily rhythm</span></div><p className="mt-2 text-lg font-semibold">{settings.chaptersPerDay} chapter{settings.chaptersPerDay===1?"":"s"}</p><p className="mt-1 text-xs text-muted-foreground">No shame for missed days. Continue where you are.</p></Card>
      <Card className="p-4"><div className="flex items-center gap-2 text-primary"><MoonStar className="size-4"/><span className="text-xs font-semibold uppercase tracking-wide">Study time</span></div><p className="mt-2 text-lg font-semibold">{settings.reminderEnabled?settings.reminderTime:"Flexible"}</p><p className="mt-1 text-xs text-muted-foreground">{settings.timezone}</p></Card>
    </section>

    <section className="mt-6">
      <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Seven-track plan</p><h2 className="mt-1 font-[family-name:var(--font-scripture)] text-2xl font-semibold">Today's Scripture</h2></div>{biblesQuery.isLoading?<Skeleton className="h-9 w-28"/>:bibles.length>0?<TranslationPicker bibles={bibles} {...(active?{value:active.id}:{})} onChange={select}/>:null}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">Bible text is retrieved from YouVersion Platform. Study guidance is always shown separately.</p>

      {biblesQuery.isError?<div className="mt-4"><ApiStateNotice error={biblesQuery.error} onRetry={()=>biblesQuery.refetch()}/></div>:!biblesQuery.isLoading&&bibles.length===0?<div className="mt-4"><ApiStateNotice error={new Error(encodeApiError(normalizeApiError(403)))} onRetry={()=>biblesQuery.refetch()}/></div>:null}

      <div className="mt-4 space-y-2">{chapters.length?chapters.map((ref,index)=>{const id=passageId(ref.usfm,ref.chapter);const status=statusOf(id);const Icon=statusIcon[status];return <Link key={id} to="/read/$passage" params={{passage:id}} className="block"><Card className={`flex flex-row items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${status==="reading"?"border-primary/40 bg-primary/5":""}`}><div className={`grid size-9 shrink-0 place-items-center rounded-full ${status==="complete"?"bg-primary text-primary-foreground":"bg-muted"}`}><Icon className="size-4"/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{index+1} · {ref.track}</span>{status==="reading"?<Badge variant="secondary" className="text-[9px]">Continue</Badge>:null}</div><p className="mt-0.5 font-[family-name:var(--font-scripture)] text-xl leading-tight">{chapterLabel(ref)}</p></div><ChevronRight className="size-4 shrink-0 text-muted-foreground"/></Card></Link>}):<Card className="flex flex-col items-center gap-2 py-10 text-center"><BookOpen className="size-5 text-muted-foreground"/><p className="text-sm text-muted-foreground">No reading scheduled for {today} yet.</p></Card>}</div>
    </section>

    {allDone?<section className="mt-7 rounded-3xl border bg-card p-5"><div className="flex items-center gap-2 text-primary"><Check className="size-5"/><h2 className="font-[family-name:var(--font-scripture)] text-2xl font-semibold">Daily review</h2></div><p className="mt-2 text-sm text-muted-foreground">This review is yours. It summarizes what you noticed and prayed—not AI-generated Scripture commentary.</p><label className="mt-4 block text-xs font-semibold">What is the clearest takeaway you want to remember?</label><textarea className="mt-2 min-h-24 w-full rounded-xl border bg-background p-3 text-sm" value={review.takeaway??""} onChange={e=>setReview(saveDailyReview(today,{takeaway:e.target.value}))} placeholder="In my own words…"/><label className="mt-4 block text-xs font-semibold">What are you grateful for?</label><textarea className="mt-2 min-h-20 w-full rounded-xl border bg-background p-3 text-sm" value={review.gratitude??""} onChange={e=>setReview(saveDailyReview(today,{gratitude:e.target.value}))} placeholder="Today I am thankful for…"/><label className="mt-4 block text-xs font-semibold">Prayer</label><textarea className="mt-2 min-h-24 w-full rounded-xl border bg-background p-3 text-sm" value={review.prayer??""} onChange={e=>setReview(saveDailyReview(today,{prayer:e.target.value}))} placeholder="Write or dictate your prayer…"/></section>:null}
  </main>;
}
