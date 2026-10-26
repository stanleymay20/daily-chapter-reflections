import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TRACKS } from "@/lib/schedule";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from "@/lib/app-state";

export const Route = createFileRoute("/plans")({ component: PlansPage });

const templates: Record<string,{n:number;tracks:string[]}> = {
  "7 Chapters Daily": { n:7, tracks:TRACKS.map(t=>t.track) },
  "3 Chapters Daily": { n:3, tracks:TRACKS.slice(0,3).map(t=>t.track) },
  "New Testament Focus": { n:2, tracks:["Gospels","Acts & Epistles"] },
  "Gospels Focus": { n:1, tracks:["Gospels"] },
};

function PlansPage(){
  const [settings,setSettings]=useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(()=>setSettings(loadSettings()),[]);
  const commit=(next:AppSettings)=>{setSettings(next);saveSettings(next)};
  const apply=(name:string)=>{const t=templates[name];if(!t)return;commit({...settings,chaptersPerDay:t.n,activeTracks:t.tracks})};
  const setChapterCount=(n:number)=>{const selected=settings.activeTracks.filter(t=>TRACKS.some(x=>x.track===t));const ordered=[...selected,...TRACKS.map(t=>t.track).filter(t=>!selected.includes(t))];commit({...settings,chaptersPerDay:n,activeTracks:ordered.slice(0,n)})};
  const toggle=(track:string)=>{const active=settings.activeTracks.includes(track);let tracks=active?settings.activeTracks.filter(x=>x!==track):[...settings.activeTracks,track];tracks=TRACKS.map(t=>t.track).filter(x=>tracks.includes(x));commit({...settings,activeTracks:tracks,chaptersPerDay:Math.min(7,Math.max(1,tracks.length))})};
  return <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-nav pt-8">
    <h1 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Study Plans</h1>
    <p className="mt-1 text-sm text-muted-foreground">The canonical 7-track plan is never changed. Personal mode only decides which tracks you read each day.</p>
    <section className="mt-5 grid grid-cols-2 gap-2">{Object.keys(templates).map(name=><Button key={name} variant="outline" className="h-auto whitespace-normal py-3 text-xs" onClick={()=>apply(name)}>{name}</Button>)}</section>
    <Card className="mt-5 p-4"><div className="flex items-center justify-between"><div><p className="font-medium">Chapters per day</p><p className="text-xs text-muted-foreground">1–7 active tracks</p></div><strong className="text-2xl">{settings.chaptersPerDay}</strong></div><input className="mt-4 w-full" type="range" min={1} max={7} value={settings.chaptersPerDay} onChange={e=>setChapterCount(Number(e.target.value))} /></Card>
    <p className="mt-2 text-xs text-muted-foreground">Changing the daily chapter count keeps your selected tracks first. Your choices are saved on this device; the original seven-track reading sequence is not modified.</p>
    <section className="mt-5 space-y-2"><h2 className="font-medium">Active tracks</h2>{TRACKS.map(t=><Card key={t.track} className="flex items-center gap-3 p-3"><Checkbox checked={settings.activeTracks.includes(t.track)} onCheckedChange={()=>toggle(t.track)}/><div><p className="text-sm font-medium">{t.track}</p><p className="text-xs text-muted-foreground">{t.books.map(b=>b.book).join(" · ")}</p></div></Card>)}</section>
    <Button className="mt-5 w-full" variant="outline" onClick={()=>commit({...settings,chaptersPerDay:7,activeTracks:TRACKS.map(t=>t.track)})}>Restore seven-track selection</Button>
  </main>;
}
