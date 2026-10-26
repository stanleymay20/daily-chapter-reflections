import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TRACKS, berlinToday } from "@/lib/schedule";
import { BOOK_LIBRARY, DEFAULT_PERSONAL_PLAN, normalizePersonalPlan, type PersonalPlan } from "@/lib/personal-plan";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from "@/lib/app-state";

export const Route = createFileRoute("/plans")({ component: PlansPage });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function PlansPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<PersonalPlan>(DEFAULT_PERSONAL_PLAN);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const saved = loadSettings();
    setSettings(saved);
    const existing = normalizePersonalPlan(saved.personalReadingPlan);
    const blank = saved.readingPlanMode === "unselected" ||
      (saved.readingPlanMode !== "personal" && JSON.stringify(existing) === JSON.stringify(DEFAULT_PERSONAL_PLAN));
    setDraft(blank ? { ...DEFAULT_PERSONAL_PLAN, startDate: berlinToday(), books: [] } : existing);
  }, []);
  const commit = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };
  const chooseOriginal = () => {
    commit({ readingPlanMode: "original" });
    setMessage("Original seven-track reading plan selected. Your personal plan stays saved separately.");
  };
  const savePersonal = () => {
    const plan = normalizePersonalPlan(draft);
    if (!plan.books.length || !plan.weekdays.length) { setMessage("Select at least one Bible book and one reading day."); return; }
    commit({ readingPlanMode: "personal", personalReadingPlan: plan });
    setDraft(plan);
    setMessage("Your personal plan is active. The original seven-chapter plan is unchanged.");
  };
  const toggleBook = (usfm: string) => setDraft(plan => ({
    ...plan, books: plan.books.some(book => book.usfm === usfm) ? plan.books.filter(book => book.usfm !== usfm) : [...plan.books, { usfm, fromChapter: 1 }],
  }));
  const moveBook = (index: number, delta: number) => setDraft(plan => {
    const order = [...plan.books];
    const target = index + delta;
    if (target < 0 || target >= order.length) return plan;
    [order[index], order[target]] = [order[target]!, order[index]!];
    return { ...plan, books: order };
  });
  const setOriginalTracks = (names: string[]) => commit({
    readingPlanMode: "original",
    activeTracks: names,
    chaptersPerDay: Math.max(1, names.length),
  });
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-nav pt-8 sm:px-6">
    <h1 className="font-[family-name:var(--font-scripture)] text-4xl font-semibold">Choose your Bible plan</h1>
    <p className="mt-2 text-sm text-muted-foreground">Follow the original seven-chapter plan or build a separate reading schedule around the Bible books and days you choose. The original plan never changes.</p>
    <div className="mt-5 grid grid-cols-2 gap-2">
      <Button className="min-h-12 h-auto whitespace-normal" variant={settings.readingPlanMode === "personal" ? "outline" : "default"} onClick={chooseOriginal}>Original 7-track plan</Button>
      <Button className="min-h-12 h-auto whitespace-normal" variant={settings.readingPlanMode === "personal" ? "default" : "outline"} onClick={savePersonal}>My personal plan</Button>
    </div>
    {message ? <p className="mt-3 text-sm" role="status">{message}</p> : null}

    <Card className="mt-5 p-5">
      <h2 className="text-lg font-semibold">Create your own reading schedule</h2>
      <p className="mt-1 text-xs text-muted-foreground">Your selected books are read in order. A missed or unselected weekday does not advance the reading.</p>
      <label className="mt-4 block text-sm font-medium">Plan name<input type="text" maxLength={60} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="mt-1 h-11 w-full rounded-lg border bg-background px-3"/></label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Start date<input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} className="mt-1 h-11 w-full rounded-lg border bg-background px-3"/></label>
        <label className="text-sm font-medium">Chapters per study day<input type="number" min={1} max={10} value={draft.chaptersPerDay} onChange={e => setDraft({ ...draft, chaptersPerDay: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className="mt-1 h-11 w-full rounded-lg border bg-background px-3"/></label>
      </div>
      <p className="mt-4 text-sm font-medium">Days of the week</p>
      <div className="mt-2 grid grid-cols-7 gap-1">{WEEKDAYS.map((day, index) => <button type="button" key={day} aria-pressed={draft.weekdays.includes(index)} onClick={() => setDraft({ ...draft, weekdays: draft.weekdays.includes(index) ? draft.weekdays.filter(d => d !== index) : [...draft.weekdays, index].sort() })} className={`min-h-10 rounded-lg border text-xs ${draft.weekdays.includes(index) ? "bg-primary text-primary-foreground" : "bg-background"}`}>{day}</button>)}</div>
      <label className="mt-4 flex items-center gap-2 text-sm"><Checkbox checked={draft.repeat} onCheckedChange={v => setDraft({ ...draft, repeat: v === true })}/>Start the selected books again when finished</label>
    </Card>

    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Books in your plan ({draft.books.length})</h2>
      <p className="mt-1 text-xs text-muted-foreground">Move books up or down to choose their reading order. Optionally select a starting chapter.</p>
      <div className="mt-4 space-y-2">{draft.books.map((selection, index) => {
        const book = BOOK_LIBRARY.find(b => b.usfm === selection.usfm);
        if (!book) return null;
        return <div key={selection.usfm} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="text-xs text-muted-foreground">{index + 1}.</span><span className="min-w-24 flex-1 text-sm font-semibold">{book.book}</span>
          <label className="text-xs text-muted-foreground">From <input aria-label={`Start chapter of ${book.book}`} type="number" min={1} max={book.chapters} className="ml-1 w-14 rounded border bg-background p-1" value={selection.fromChapter} onChange={e => setDraft(current => ({ ...current, books: current.books.map(item => item.usfm === selection.usfm ? { ...item, fromChapter: Math.max(1, Math.min(book.chapters, Number(e.target.value) || 1)) } : item) }))}/></label>
          <div className="flex gap-1"><Button type="button" variant="outline" size="sm" aria-label={`Move ${book.book} earlier`} disabled={index === 0} onClick={() => moveBook(index, -1)}>↑</Button><Button type="button" variant="outline" size="sm" aria-label={`Move ${book.book} later`} disabled={index === draft.books.length - 1} onClick={() => moveBook(index, 1)}>↓</Button><Button type="button" variant="ghost" size="sm" onClick={() => toggleBook(book.usfm)}>Remove</Button></div>
        </div>;
      })}</div>
      <h3 className="mt-5 font-semibold">Add Bible books</h3>
      {TRACKS.map(group => <details key={group.track} className="mt-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{group.track} · {group.books.length} books</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{group.books.map(book => <label key={book.usfm} className="flex min-h-9 items-center gap-2 text-sm"><Checkbox checked={draft.books.some(b => b.usfm === book.usfm)} onCheckedChange={() => toggleBook(book.usfm)}/>{book.book}</label>)}</div></details>)}
      <Button className="mt-5 min-h-12 w-full" disabled={!draft.books.length || !draft.weekdays.length} onClick={savePersonal}>Save & activate my plan</Button>
    </Card>

    <Card className="mt-5 p-5">
      <h2 className="font-semibold">Original seven-track plan</h2>
      <p className="mt-1 text-xs text-muted-foreground">Its chapters and dates are immutable. You can follow fewer tracks without altering the source reading plan.</p>
      <div className="mt-3 flex gap-2">{[1, 3, 7].map(n => <Button key={n} size="sm" variant="outline" onClick={() => setOriginalTracks(TRACKS.slice(0, n).map(t => t.track))}>{n}/day</Button>)}</div>
      <div className="mt-4 space-y-2">{TRACKS.map(group => <label key={group.track} className="flex items-center gap-2 text-sm"><Checkbox checked={settings.activeTracks.includes(group.track)} onCheckedChange={() => {
        const selected = settings.activeTracks.includes(group.track) ? settings.activeTracks.filter(t => t !== group.track) : [...settings.activeTracks, group.track];
        setOriginalTracks(TRACKS.map(t => t.track).filter(t => selected.includes(t)));
      }}/>{group.track}</label>)}</div>
      <Button variant="outline" className="mt-4 w-full" onClick={() => setOriginalTracks(TRACKS.map(t => t.track))}>Restore all seven original tracks</Button>
    </Card>
    <Link className="mt-5 block text-center text-sm text-primary underline" to="/">Return to today's readings</Link>
  </main>;
}
