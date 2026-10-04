import { Film, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { useStudyVideo } from "@/hooks/useStudyVideo";
import { STUDY_VIDEO_DURATION_SECONDS, STUDY_VIDEO_LABEL, scenesToVtt } from "@/lib/study-video.shared";

type Video = ReturnType<typeof useStudyVideo>;

export function StudyVideoAid({ video, label, poster }: { video: Video; label: string; poster?: string | undefined }) {
  const selected = video.selected;
  const [trackUrl, setTrackUrl] = useState("");
  const vtt = useMemo(() => (selected?.scenes.length ? scenesToVtt(selected.scenes) : ""), [selected]);
  useEffect(() => {
    if (!vtt) { setTrackUrl(""); return; }
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setTrackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [vtt]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Film className="size-4 text-primary" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">Video aid</h3>
            <p className="text-[11px] text-muted-foreground">{STUDY_VIDEO_LABEL}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {video.generating ? <Button className="min-h-11" size="sm" variant="outline" onClick={() => void video.cancelVideo()}>Cancel</Button> : null}
          <Button className="min-h-11" size="sm" onClick={() => void video.createVideo()} disabled={video.generating}>
            {video.generating ? <><Loader2 className="mr-1 size-4 animate-spin" />Creating…</> : selected ? "Create again" : "Generate video aid"}
          </Button>
        </div>
      </div>

      {video.generating ? (
        <div className="border-t px-4 py-4" role="status" aria-live="polite">
          <p className="text-xs text-muted-foreground">Creating a {STUDY_VIDEO_DURATION_SECONDS}-second clip from your saved chapter guide. This usually takes 1–3 minutes; you can keep reading.</p>
          <Progress className="mt-3" value={video.progress ?? 5} aria-label="Video aid progress" />
        </div>
      ) : null}

      {selected ? (
        <div className="border-t bg-muted/40">
          <div className="relative">
            <video
              key={selected.id}
              className="aspect-video w-full bg-muted"
              controls
              playsInline
              preload="metadata"
              poster={poster}
              src={selected.url}
              aria-label={`AI-created interpretive study video for ${label}. Not Scripture.`}
              aria-describedby={`video-scenes-${selected.id}`}
            >
              {trackUrl ? <track kind="captions" srcLang="en" label="Scene descriptions" src={trackUrl} /> : null}
            </video>
            <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/85 px-2 py-1 text-[10px] font-medium text-foreground">{STUDY_VIDEO_LABEL}</span>
          </div>
          <div className="border-t px-4 py-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">An AI-generated artistic interpretation of your saved chapter guide—not historical footage and not Scripture. It has no speech; the soundtrack is quiet instrumental. Return to the text for what the chapter says.</p>
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold">Scene descriptions</summary>
              <ol id={`video-scenes-${selected.id}`} className="space-y-1 text-xs text-muted-foreground">
                {selected.scenes.map((scene, i) => <li key={i}><span className="tabular-nums">{scene.start}–{scene.end}s</span> · {scene.description}</li>)}
              </ol>
            </details>
          </div>
        </div>
      ) : !video.generating ? (
        <div className="grid aspect-video place-items-center border-t bg-muted/40 px-8 text-center">
          <div>
            <Film className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm text-muted-foreground">Create a short, silent-speech interpretive clip from this saved chapter guide. Nothing is generated until you tap the button.</p>
          </div>
        </div>
      ) : null}

      {video.notice ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">{video.notice}</p> : null}
      {video.error ? <p className="border-t px-4 py-3 text-xs text-destructive" role="alert">{video.error}</p> : null}

      {video.versions.length > 1 ? (
        <div className="border-t p-4">
          <p className="text-xs font-semibold">Saved versions</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {video.versions.map((version, index) => (
              <button key={version.id} type="button" disabled={video.generating} aria-pressed={selected?.id === version.id} onClick={() => void video.chooseVersion(version)}
                className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs ${selected?.id === version.id ? "ring-2 ring-primary" : "hover:border-primary/50"} disabled:opacity-50`}>
                Version {video.versions.length - index} · {version.createdAt.slice(0, 10)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
