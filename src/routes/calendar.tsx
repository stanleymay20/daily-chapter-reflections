import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { berlinToday, chapterLabel, getPlanForDate, passageId } from "@/lib/schedule";
import { useProgress } from "@/hooks/useReadingState";

export const Route = createFileRoute("/calendar")({ component: CalendarPage });

function iso(y:number,m:number,d:number){return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}

function CalendarPage(){
  const today=berlinToday();
  const [year,setYear]=useState(Number(today.slice(0,4)));
  const [month,setMonth]=useState(Number(today.slice(5,7))-1);
  const [selected,setSelected]=useState(today);
  const plan=getPlanForDate(selected);
  const { completedCount }=useProgress(selected);
  const first=new Date(Date.UTC(year,month,1));
  const days=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const offset=(first.getUTCDay()+6)%7;
  const cells=useMemo(()=>Array.from({length:offset+days},(_,i)=>i<offset?null:i-offset+1),[offset,days]);
  const monthName=new Intl.DateTimeFormat("en-GB",{month:"long",year:"numeric",timeZone:"UTC"}).format(first);
  const move=(delta:number)=>{const d=new Date(Date.UTC(year,month+delta,1));setYear(d.getUTCFullYear());setMonth(d.getUTCMonth());};
  const done=plan?completedCount(plan.chapters.map(c=>passageId(c.usfm,c.chapter))):0;
  return <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-28 pt-8">
    <div className="flex items-center justify-between"><h1 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Calendar</h1><Button variant="outline" size="sm" onClick={()=>{setSelected(today);setYear(+today.slice(0,4));setMonth(+today.slice(5,7)-1)}}>Today</Button></div>
    <Card className="mt-5 p-4">
      <div className="flex items-center justify-between"><Button variant="ghost" size="icon" onClick={()=>move(-1)}><ChevronLeft className="size-4"/></Button><strong>{monthName}</strong><Button variant="ghost" size="icon" onClick={()=>move(1)}><ChevronRight className="size-4"/></Button></div>
      <div className="mt-3 grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-muted-foreground">{["M","T","W","T","F","S","S"].map((x,i)=><span key={`${x}-${i}`}>{x}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">{cells.map((d,i)=>d===null?<div key={`e-${i}`}/>:<button key={d} onClick={()=>setSelected(iso(year,month,d))} className={`aspect-square rounded-lg text-sm ${selected===iso(year,month,d)?"bg-primary text-primary-foreground":iso(year,month,d)===today?"border border-primary":"hover:bg-accent"}`}>{d}</button>)}</div>
    </Card>
    <section className="mt-5"><div className="flex items-center justify-between"><h2 className="font-medium">{selected}</h2><span className="text-xs text-muted-foreground">{done}/{plan?.chapters.length??0} complete</span></div>
      <div className="mt-3 space-y-2">{plan?.chapters.map(c=>{const id=passageId(c.usfm,c.chapter);return <Link key={id} to="/read/$passage" params={{passage:id}}><Card className="flex items-center justify-between p-3"><div><p className="font-[family-name:var(--font-scripture)]">{chapterLabel(c)}</p><p className="text-xs text-muted-foreground">{c.track}</p></div><span className="text-xs text-muted-foreground">Read</span></Card></Link>})}</div>
    </section>
  </main>;
}
