import { Film, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { StudySequencePlayer } from "@/components/StudySequencePlayer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { useStudySequence } from "@/hooks/useStudySequence";
import type { useStudyVideo } from "@/hooks/useStudyVideo";
import { MODE_SPECS, SEQUENCE_LABEL, estimateFor, type SequenceMode } from "@/lib/study-sequence.shared";
import { scenesToVtt } from "@/lib/study-video.shared";

type Sequence = ReturnType<typeof useStudySequence>;
type Legacy = ReturnType<typeof useStudyVideo>;

const STAGES = [
  { id: "planning", label: "Planning" },
  { id: "visuals", label: "Visuals" },
  { id: "narration", label: "Narration" },
  { id: "finalizing", label: "Finalizing" },
] as const;

function LegacyClip({ video, label, poster }: { video: Legacy; label: string; poster?: string | undefined }) {
  const selected = video.selected;
  const [trackUrl, setTrackUrl] = useState("");
  const vtt = useMemo(() => (selected?.scenes.length ? scenesToVtt(selected.scenes) : ""), [selected]);
  useEffect(() => {
    if (!vtt) { setTrackUrl(""); return; }
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setTrackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [vtt]);
  if (!selected) return null;
  return (
    <details className="border-t px-4 py-3">
      <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold">Earlier short clip (no narration)</summary>
      <video key={selected.id} className="mt-2 aspect-video w-full rounded-md bg-muted" controls playsInline preload="metadata" poster={poster} src={selected.url}
        aria-label={`AI-created interpretive clip for ${label}. Not Scripture.`}>
        {trackUrl ? <track kind="captions" srcLang="en" label="Scene descriptions" src={trackUrl} /> : null}
      </video>
    </details>
  );
}

export function StudyVideoAid({ sequence, legacy, label, poster }: { sequence: Sequence; legacy: Legacy; label: string; poster?: string | undefined }) {
  const estimate = estimateFor(sequence.mode);
  const step = sequence.step;
  const active = sequence.active;
  const stageIndex = STAGES.findIndex((s) => s.id === (active?.stage ?? step?.stage));
  const failed = active?.status === "failed";

  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <Film className="size-4 text-primary" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">Video aid · narrated study</h3>
            <p className="text-[11px] text-muted-foreground">{SEQUENCE_LABEL}</p>
          </div>
        </div>

        {!sequence.suggested ? <p className="mt-3 text-xs text-muted-foreground">You're in Just Read. A study video is optional; reading the chapter comes first.</p> : null}

        <fieldset className="mt-3" disabled={sequence.generating}>
          <legend className="text-xs font-medium">Length</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(Object.keys(MODE_SPECS) as SequenceMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={sequence.mode === m} onClick={() => sequence.setMode(m)}
                className={`min-h-11 rounded-lg border px-2 text-xs ${sequence.mode === m ? "border-primary bg-primary/10 font-semibold" : "hover:border-primary/50"} disabled:opacity-50`}>
                {MODE_SPECS[m].label}
                <span className="block text-[10px] font-normal text-muted-foreground">{Math.round(MODE_SPECS[m].targetSeconds[0] / 60 * 10) / 10}–{Math.round(MODE_SPECS[m].targetSeconds[1] / 60 * 10) / 10} min</span>
              </button>
            ))}
          </div>
        </fieldset>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          About {estimate.seconds[0]}–{estimate.seconds[1]} seconds, {estimate.scenes[0]}–{estimate.scenes[1]} narrated scenes. Uses AI credits:
          about {estimate.calls.plan} planning, {estimate.calls.still} illustration, {estimate.calls.clip} motion-scene and {estimate.calls.tts} narration requests
          (never more than {estimate.ceiling.plan + estimate.ceiling.still + estimate.ceiling.clip + estimate.ceiling.tts} in total, including retries). Motion scenes cost the most. Counts as 1 of your daily video aids.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {sequence.generating ? (
            <Button className="min-h-11" variant="outline" size="sm" onClick={() => void sequence.cancel()}>Cancel</Button>
          ) : failed ? (
            <>
              <Button className="min-h-11" size="sm" onClick={() => void sequence.retry()}><RotateCcw className="mr-1 size-4" />Retry failed stage</Button>
              <Button className="min-h-11" variant="outline" size="sm" onClick={() => void sequence.cancel()}>Discard</Button>
            </>
          ) : (
            <Button className="min-h-11" size="sm" onClick={() => void sequence.generate(Boolean(sequence.selected && sequence.selected.mode === sequence.mode))}>
              {sequence.selected && sequence.selected.mode === sequence.mode ? "Create a new version" : "Generate study video"}
            </Button>
          )}
          {sequence.generating && !step?.worked && step?.waiting === false && step?.status === "generating" ? (
            <Button className="min-h-11" variant="ghost" size="sm" onClick={sequence.resume}>Resume</Button>
          ) : null}
        </div>
      </div>

      {sequence.generating || failed ? (
        <div className="border-t px-4 py-4" role="status" aria-live="polite">
          <ol className="grid grid-cols-4 gap-1 text-center text-[11px]">
            {STAGES.map((s, i) => (
              <li key={s.id} className={`rounded-md px-1 py-2 ${i < stageIndex ? "bg-primary/15" : i === stageIndex ? (failed ? "bg-destructive/15 font-semibold" : "bg-primary/25 font-semibold") : "bg-muted"}`}>
                {i === stageIndex && !failed ? <Loader2 className="mx-auto mb-0.5 size-3 animate-spin" aria-hidden /> : null}
                {s.label}
              </li>
            ))}
          </ol>
          {step ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Visuals {step.visuals.done}/{step.visuals.total} · Narration {step.narration.done}/{step.narration.total}
              {step.usage ? ` · ${Object.values(step.usage).reduce((n, v) => n + (v ?? 0), 0)} AI requests used` : ""}
            </p>
          ) : <p className="mt-2 text-xs text-muted-foreground">Checking the plan against your saved guide before anything else is generated. You can keep reading.</p>}
        </div>
      ) : null}

      {sequence.selected ? <StudySequencePlayer sequence={sequence.selected} label={label} /> : !sequence.generating ? (
        <div className="grid aspect-video place-items-center border-t bg-muted/40 px-8 text-center">
          <p className="text-sm text-muted-foreground">A narrated, captioned walk through this chapter, built only from your saved guide. Nothing is generated until you tap the button.</p>
        </div>
      ) : null}

      {sequence.notice ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">{sequence.notice}</p> : null}
      {sequence.error ? <p className="border-t px-4 py-3 text-xs text-destructive" role="alert">{sequence.error}</p> : null}

      {sequence.saved.length ? (
        <div className="border-t p-4">
          <p className="text-xs font-semibold">Saved versions</p>
          <ul className="mt-2 space-y-2">
            {sequence.saved.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                <button type="button" aria-pressed={sequence.selected?.id === s.id} onClick={() => sequence.setSelectedId(s.id)}
                  className={`min-h-11 flex-1 rounded-lg border px-3 text-left text-xs ${sequence.selected?.id === s.id ? "ring-2 ring-primary" : "hover:border-primary/50"}`}>
                  Version {sequence.saved.length - i} · {MODE_SPECS[s.mode]?.label ?? s.mode} · {Math.round(s.manifest.totalSeconds)}s · {s.createdAt.slice(0, 10)}
                </button>
                <Button size="icon" variant="ghost" className="size-11" aria-label={`Delete version ${sequence.saved.length - i}`}
                  onClick={() => { if (window.confirm("Delete this saved study video?")) void sequence.remove(s.id); }}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <LegacyClip video={legacy} label={label} poster={poster} />
    </Card>
  );
}
