import { createFileRoute } from "@tanstack/react-router";
import { BookOpenCheck, Flame, Highlighter, NotebookPen, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { loadSavedVerses } from "@/lib/app-state";
import { berlinToday, getPlanForDate, passageId } from "@/lib/schedule";
import { allChapterStudies, allDailyReviews } from "@/lib/study-state";

export const Route=createFileRoute("/progress")({component:ProgressPage});

type Store=Record<string,string>;
function progressStore():Store{if(typeof window==="undefined")return{};try{return JSON.parse(localStorage.getItem("7cbs.progress.v1")||"{}") as Store}catch{return{}}}
function dateMinus(iso:string,days:number){const [y,m,d]=iso.split("-").map(Number);const x=new Date(Date.UTC(y!,m!-1,d!-days));return x.toISOString().slice(0,10)}

function ProgressPage(){
  const today=berlinToday();const [store,setStore]=useState<Store>({});const [savedCount,setSavedCount]=useState(0);const [notes,setNotes]=useState(0);const [reviews,setReviews]=useState(0);
  useEffect(()=>{setStore(progressStore());setSavedCount(loadSavedVerses().length);setNotes(allChapterStudies().filter(s=>Object.values(s.reflections).some(Boolean)||s.prayer||s.intention).length);setReviews(allDailyReviews().filter(r=>r.takeaway||r.gratitude||r.prayer).length)},[]);
  const stats=useMemo(()=>{
    let totalComplete=0;for(const status of Object.values(store))if(status==="complete")totalComplete++;
    let streak=0;for(let i=0;i<400;i++){const date=dateMinus(today,i);const plan=getPlanForDate(date);if(!plan)break;const ids=plan.chapters.map(c=>`${date}|${passageId(c.usfm,c.chapter)}`);const complete=ids.filter(id=>store[id]==="complete").length;if(complete===0)break;streak++;}
    const last30=Array.from({length:30},(_,i)=>dateMinus(today,29-i));
    const daily=last30.map(date=>{const plan=getPlanForDate(date);const ids=plan?.chapters.map(c=>`${date}|${passageId(c.usfm,c.chapter)}`)??[];return {date,done:ids.filter(id=>store[id]==="complete").length,total:ids.length}});
    const done30=daily.reduce((a,x)=>a+x.done,0);const total30=daily.reduce((a,x)=>a+x.total,0);
    return{totalComplete,streak,daily,done30,total30};
  },[store,today]);
  const monthPct=stats.total30?(stats.done30/stats.total30)*100:0;
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-28 pt-8 sm:px-6">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your journey</p><h1 className="mt-1 font-[family-name:var(--font-scripture)] text-4xl font-semibold">Progress</h1><p className="mt-2 text-sm text-muted-foreground">A gentle record of consistency and learning. Progress is information, not pressure.</p>
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat icon={BookOpenCheck} label="Chapters completed" value={stats.totalComplete}/><Stat icon={Flame} label="Active-day streak" value={stats.streak}/><Stat icon={NotebookPen} label="Study entries" value={notes}/><Stat icon={Highlighter} label="Saved verses" value={savedCount}/></div>
    <Card className="mt-4 p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Last 30 days</p><p className="text-xs text-muted-foreground">{stats.done30} of {stats.total30} scheduled chapters completed</p></div><strong className="text-xl">{Math.round(monthPct)}%</strong></div><Progress className="mt-4 h-2.5" value={monthPct}/><div className="mt-5 grid grid-cols-10 gap-1.5">{stats.daily.map(x=>{const pct=x.total?x.done/x.total:0;return <div key={x.date} title={`${x.date}: ${x.done}/${x.total}`} className={`aspect-square rounded-sm border ${pct===1?"bg-primary":pct>0?"bg-primary/35":"bg-muted"}`}/>})}</div><p className="mt-2 text-[10px] text-muted-foreground">Each square is one day. Partial days still count as showing up.</p></Card>
    <Card className="mt-4 p-5"><div className="flex items-center gap-2"><Target className="size-4 text-primary"/><h2 className="font-semibold">Study memory</h2></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-muted p-3"><p className="text-2xl font-semibold">{notes}</p><p className="text-xs text-muted-foreground">chapters with your reflections</p></div><div className="rounded-xl bg-muted p-3"><p className="text-2xl font-semibold">{reviews}</p><p className="text-xs text-muted-foreground">daily reviews written</p></div></div><p className="mt-4 text-sm leading-relaxed text-muted-foreground">The most valuable progress is not a streak: it is the growing record of what you noticed, applied and prayed through over time.</p></Card>
  </main>;
}
function Stat({icon:Icon,label,value}:{icon:typeof BookOpenCheck;label:string;value:number}){return <Card className="p-4"><Icon className="size-4 text-primary"/><p className="mt-3 text-2xl font-semibold">{value}</p><p className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</p></Card>}
