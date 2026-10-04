import { BookOpen, Captions, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { SavedSequence } from "@/lib/study-sequence";
import { SEQUENCE_LABEL, cuesToVtt, type ClaimType } from "@/lib/study-sequence.shared";

const CLAIM_LABEL: Record<ClaimType, string> = { chapter: "From the chapter", context: "Background", uncertain: "Interpretation" };

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * Synchronized study timeline: one narration track per scene drives timing; visuals are muted.
 * Never autoplays. This is a sequence player, not a single rendered video file.
 */
export function StudySequencePlayer({ sequence, label }: { sequence: SavedSequence; label: string }) {
  const { manifest, assets } = sequence;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sceneTime, setSceneTime] = useState(0);
  const [captions, setCaptions] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
    setSceneTime(0);
  }, [sequence.id]);

  const scene = manifest.scenes[index];
  const asset = assets.find((a) => a.index === scene?.index);
  const now = (scene?.start ?? 0) + sceneTime;
  const cue = manifest.cues.find((c) => now >= c.start && now < c.end) ?? null;

  const go = useCallback((next: number, autoplay: boolean) => {
    const bounded = Math.max(0, Math.min(manifest.scenes.length - 1, next));
    setIndex(bounded);
    setSceneTime(0);
    setPlaying(autoplay);
  }, [manifest.scenes.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [playing, index]);

  const transcriptId = `seq-transcript-${sequence.id}`;
  const vttUrl = useMemo(() => URL.createObjectURL(new Blob([cuesToVtt(manifest.cues)], { type: "text/vtt" })), [manifest.cues]);
  useEffect(() => () => URL.revokeObjectURL(vttUrl), [vttUrl]);

  if (!scene) return null;
  const duration = scene.end - scene.start;

  return (
    <div className="border-t bg-muted/40">
      <div className="relative aspect-video w-full overflow-hidden bg-muted" aria-label={`AI-created interpretive study sequence for ${label}. Not Scripture.`} aria-describedby={transcriptId} role="region">
        {scene.visualKind === "title" || scene.visualKind === "closing" || !asset?.visualUrl ? (
          <div className="grid h-full place-items-center bg-gradient-to-b from-muted to-background px-6 text-center">
            <div>
              {scene.visualKind === "closing" ? <BookOpen className="mx-auto size-7 text-primary" aria-hidden /> : null}
              <p className="font-[family-name:var(--font-scripture)] text-2xl font-semibold leading-tight">{scene.visualKind === "closing" ? "Return to the text" : manifest.title}</p>
              <p className="mt-2 text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ) : asset.visualType === "video" ? (
          <video key={asset.visualUrl} className="h-full w-full object-cover" src={asset.visualUrl} muted playsInline loop autoPlay={playing && !reduced} preload="metadata" aria-hidden />
        ) : (
          <img key={asset.visualUrl} src={asset.visualUrl} alt="" aria-hidden className="h-full w-full object-cover"
            style={reduced ? undefined : { transform: playing ? "scale(1.06)" : "scale(1)", transition: `transform ${Math.max(1, duration)}s linear` }} />
        )}
        <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/85 px-2 py-1 text-[10px] font-medium text-foreground">{SEQUENCE_LABEL}</span>
        {scene.scriptureQuote ? (
          <figure className="absolute inset-x-3 top-10 rounded-lg border border-primary/40 bg-background/90 p-3 text-sm shadow-sm">
            <figcaption className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">Scripture · {label}</figcaption>
            <blockquote className="font-[family-name:var(--font-scripture)] leading-snug">“{scene.scriptureQuote}”</blockquote>
          </figure>
        ) : null}
        {captions && cue ? (
          <p className="absolute inset-x-3 bottom-3 rounded-md bg-background/90 px-3 py-2 text-center text-sm leading-snug text-foreground" aria-live="off">{cue.text}</p>
        ) : null}
      </div>

      {asset?.audioUrl ? (
        <audio
          ref={audioRef}
          key={asset.audioUrl}
          src={asset.audioUrl}
          preload="auto"
          onTimeUpdate={(e) => setSceneTime(Math.min(duration, e.currentTarget.currentTime))}
          onEnded={() => (index < manifest.scenes.length - 1 ? go(index + 1, true) : setPlaying(false))}
        >
          <track kind="captions" srcLang="en" label="Narration" src={vttUrl} />
        </audio>
      ) : null}

      <div className="flex items-center gap-2 px-3 py-2">
        <Button size="icon" variant="ghost" className="size-11" aria-label="Previous scene" onClick={() => go(index - 1, playing)} disabled={index === 0}><ChevronLeft className="size-5" /></Button>
        <Button size="icon" className="size-11" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>{playing ? <Pause className="size-5" /> : <Play className="size-5" />}</Button>
        <Button size="icon" variant="ghost" className="size-11" aria-label="Next scene" onClick={() => go(index + 1, playing)} disabled={index >= manifest.scenes.length - 1}><ChevronRight className="size-5" /></Button>
        <span className="ml-1 text-xs tabular-nums text-muted-foreground">{fmt(now)} / {fmt(manifest.totalSeconds)} · Scene {index + 1}/{manifest.scenes.length}</span>
        <Button size="icon" variant={captions ? "secondary" : "ghost"} className="ml-auto size-11" aria-pressed={captions} aria-label="Captions" onClick={() => setCaptions((c) => !c)}><Captions className="size-5" /></Button>
      </div>

      <div className="border-t px-4 py-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">A study sequence built only from your saved chapter guide: narrated scenes with AI-created illustrations. It is interpretation, not historical footage and not Scripture. Passages marked “Scripture” are quoted directly from the chapter text.</p>
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold">Scenes</summary>
          <ol className="space-y-1">
            {manifest.scenes.map((s, i) => (
              <li key={s.index}>
                <button type="button" onClick={() => go(i, false)} aria-current={i === index ? "true" : undefined}
                  className={`flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs ${i === index ? "bg-primary/10" : "hover:bg-muted"}`}>
                  <span className="tabular-nums text-muted-foreground">{fmt(s.start)}</span>
                  <span className="flex-1">{s.visualBrief || (s.role === "opening" ? "Title" : "Closing")}</span>
                  <span className="shrink-0 rounded border px-1.5 text-[10px] text-muted-foreground">{CLAIM_LABEL[s.claimType]}</span>
                </button>
              </li>
            ))}
          </ol>
        </details>
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold">Transcript</summary>
          <div id={transcriptId} className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            {manifest.scenes.map((s) => <p key={s.index}><span className="font-medium text-foreground">[{CLAIM_LABEL[s.claimType]}]</span> {s.narration}</p>)}
          </div>
        </details>
      </div>
    </div>
  );
}
