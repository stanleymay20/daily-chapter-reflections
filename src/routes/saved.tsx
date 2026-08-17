import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bookmark, Highlighter, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadSavedVerses, removeSavedVerse, type SavedVerse } from "@/lib/app-state";

export const Route = createFileRoute("/saved")({ component: SavedPage });

function SavedPage(){
  const [items,setItems]=useState<SavedVerse[]>([]);
  useEffect(()=>setItems(loadSavedVerses()),[]);
  const remove=(id:string)=>{removeSavedVerse(id);setItems(loadSavedVerses())};
  return <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-28 pt-8">
    <h1 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Saved</h1>
    <p className="mt-1 text-sm text-muted-foreground">Highlights, bookmarks and verse notes saved on this device.</p>
    <div className="mt-5 space-y-3">{items.length?items.map(item=><Card key={item.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-xs text-muted-foreground">{item.bookmarked?<Bookmark className="size-3.5"/>:<Highlighter className="size-3.5"/>}<span>{item.reference}</span>{item.highlight?<span className="capitalize">· {item.highlight}</span>:null}</div><p className="mt-2 font-[family-name:var(--font-scripture)] leading-relaxed">{item.text}</p>{item.note?<p className="mt-2 rounded-md bg-muted p-2 text-xs">{item.note}</p>:null}</div><Button variant="ghost" size="icon" onClick={()=>remove(item.id)} aria-label="Delete saved verse"><Trash2 className="size-4"/></Button></div></Card>):<Card className="p-8 text-center text-sm text-muted-foreground">Nothing saved yet. Tap a verse in the reader to highlight or bookmark it.</Card>}</div>
  </main>;
}
