import { Link, createFileRoute } from "@tanstack/react-router";
import { Bookmark, Highlighter, NotebookPen, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadSavedVerses, removeSavedVerse, type SavedVerse } from "@/lib/app-state";
import { allChapterStudies, allDailyReviews, type ChapterStudy, type DailyReview } from "@/lib/study-state";

export const Route=createFileRoute("/saved")({component:JournalPage});
type Tab="notes"|"verses"|"reviews";

function JournalPage(){
  const [verses,setVerses]=useState<SavedVerse[]>([]);const [studies,setStudies]=useState<ChapterStudy[]>([]);const [reviews,setReviews]=useState<DailyReview[]>([]);const [tab,setTab]=useState<Tab>("notes");const [query,setQuery]=useState("");
  useEffect(()=>{setVerses(loadSavedVerses());setStudies(allChapterStudies());setReviews(allDailyReviews())},[]);
  const q=query.trim().toLowerCase();
  const filteredVerses=useMemo(()=>verses.filter(v=>!q||`${v.reference} ${v.text} ${v.note??""}`.toLowerCase().includes(q)),[verses,q]);
  const filteredStudies=useMemo(()=>studies.filter(s=>!q||`${s.passage} ${s.intention??""} ${Object.values(s.reflections).join(" ")} ${s.prayer??""}`.toLowerCase().includes(q)),[studies,q]);
  const filteredReviews=useMemo(()=>reviews.filter(r=>!q||`${r.date} ${r.takeaway??""} ${r.gratitude??""} ${r.prayer??""}`.toLowerCase().includes(q)),[reviews,q]);
  const remove=(id:string)=>{removeSavedVerse(id);setVerses(loadSavedVerses())};
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-28 pt-8 sm:px-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your study memory</p><h1 className="mt-1 font-[family-name:var(--font-scripture)] text-4xl font-semibold">Study Journal</h1><p className="mt-2 text-sm text-muted-foreground">Your own observations, prayers, highlights and reviews—kept distinct from AI study guidance.</p></div>
    <div className="relative mt-5"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your study memory…" className="h-10 w-full rounded-xl border bg-background pl-9 pr-3 text-sm"/></div>
    <div className="mt-4 grid grid-cols-3 rounded-xl bg-muted p-1">{(["notes","verses","reviews"] as Tab[]).map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded-lg px-2 py-2 text-xs font-medium capitalize ${tab===t?"bg-background shadow-sm":"text-muted-foreground"}`}>{t}</button>)}</div>

    {tab==="notes"?<section className="mt-5 space-y-3">{filteredStudies.length?filteredStudies.map(s=><Link key={s.passage} to="/read/$passage" params={{passage:s.passage}}><Card className="p-4 transition hover:bg-accent/30"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><NotebookPen className="size-4 text-primary"/><strong>{s.passage}</strong></div>{s.completedAt?<span className="text-[10px] text-primary">Completed</span>:null}</div>{s.intention?<JournalLine label="Before reading" text={s.intention}/>:null}{s.reflections.observation?<JournalLine label="Observe" text={s.reflections.observation}/>:null}{s.reflections.reflection?<JournalLine label="Reflect" text={s.reflections.reflection}/>:null}{s.reflections.application?<JournalLine label="Apply" text={s.reflections.application}/>:null}{s.prayer?<JournalLine label="Prayer" text={s.prayer}/>:null}</Card></Link>):<Empty text="Your chapter reflections will appear here as you study."/>}</section>:null}

    {tab==="verses"?<section className="mt-5 space-y-3">{filteredVerses.length?filteredVerses.map(item=><Card key={item.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 text-xs text-muted-foreground">{item.bookmarked?<Bookmark className="size-3.5"/>:<Highlighter className="size-3.5"/>}<span>{item.reference}</span>{item.highlight?<span className="capitalize">· {item.highlight}</span>:null}</div><p className="mt-2 font-[family-name:var(--font-scripture)] leading-relaxed">{item.text}</p>{item.note?<p className="mt-3 rounded-lg bg-muted p-3 text-sm">{item.note}</p>:null}</div><Button variant="ghost" size="icon" onClick={()=>remove(item.id)} aria-label="Delete saved verse"><Trash2 className="size-4"/></Button></div></Card>):<Empty text="Tap a verse in the reader to highlight, bookmark or add a verse note."/>}</section>:null}

    {tab==="reviews"?<section className="mt-5 space-y-3">{filteredReviews.length?filteredReviews.map(r=><Card key={r.date} className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-primary">{r.date}</p>{r.takeaway?<JournalLine label="Takeaway" text={r.takeaway}/>:null}{r.gratitude?<JournalLine label="Gratitude" text={r.gratitude}/>:null}{r.prayer?<JournalLine label="Prayer" text={r.prayer}/>:null}</Card>):<Empty text="Complete a day's reading and write your Daily Review to build this archive."/>}</section>:null}
  </main>;
}
function JournalLine({label,text}:{label:string;text:string}){return <div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{text}</p></div>}
function Empty({text}:{text:string}){return <Card className="p-8 text-center text-sm text-muted-foreground">{text}</Card>}
