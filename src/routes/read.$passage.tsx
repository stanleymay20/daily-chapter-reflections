import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, NotebookPen } from "lucide-react";
import { useMemo } from "react";

import { ApiStateNotice } from "@/components/ApiStateNotice";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  pickDefaultVersion,
  useNotes,
  useProgress,
  useSelectedVersion,
  type ProgressStatus,
} from "@/hooks/useReadingState";
import { berlinToday, findChapterByPassageId } from "@/lib/schedule";
import { getPassageFn, listBiblesFn } from "@/lib/youversion.functions";
import { isValidPassageId } from "@/lib/youversion";

export const Route = createFileRoute("/read/$passage")({
  head: ({ params }) => {
    const found = findChapterByPassageId(params.passage);
    const title = found ? `${found.ref.book} ${found.ref.chapter}` : "Reading";
    return {
      meta: [
        { title: `${title} — 7-Chapter Bible Study` },
        {
          name: "description",
          content: `Read ${title} in a quiet, distraction-free space. Scripture text from the YouVersion Platform API.`,
        },
        { property: "og:title", content: `${title} — 7-Chapter Bible Study` },
        { property: "og:description", content: `Read ${title} with your own study notes.` },
      ],
    };
  },
  component: Reader,
});

const statuses: { value: ProgressStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "reading", label: "Reading" },
  { value: "complete", label: "Complete" },
];

function Reader() {
  const { passage } = Route.useParams();
  const today = berlinToday();
  const found = findChapterByPassageId(passage);
  const label = found ? `${found.ref.book} ${found.ref.chapter}` : passage;

  const { statusOf, setStatus } = useProgress(today);
  const { note, save } = useNotes(passage);
  const { versionId, ready } = useSelectedVersion();

  const listBibles = useServerFn(listBiblesFn);
  const getPassage = useServerFn(getPassageFn);

  const biblesQuery = useQuery({
    queryKey: ["bibles"],
    queryFn: () => listBibles(),
    retry: false,
    staleTime: 60 * 60 * 1000,
  });

  const active = useMemo(
    () => (ready ? pickDefaultVersion(biblesQuery.data?.bibles ?? [], versionId) : undefined),
    [biblesQuery.data, versionId, ready],
  );

  const passageQuery = useQuery({
    queryKey: ["passage", active?.id, passage],
    queryFn: () => getPassage({ data: { versionId: active!.id, passage } }),
    enabled: Boolean(active?.id) && isValidPassageId(passage),
    retry: false,
  });

  const status = statusOf(passage);
  const copyright = passageQuery.data?.copyright || active?.copyright || "";

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-20 pt-6">
      <div className="flex items-center justify-between">
        <Link to="/">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ChevronLeft className="mr-1 size-4" />
            Today
          </Button>
        </Link>
        <span className="text-[11px] text-muted-foreground">
          {active ? `${active.abbreviation || active.name} · ` : ""}Source: YouVersion Platform
        </span>
      </div>

      <h1 className="mt-4 font-[family-name:var(--font-scripture)] text-3xl font-semibold tracking-tight">
        {label}
      </h1>
      {found ? <p className="text-xs text-muted-foreground">{found.ref.track} track</p> : null}

      <div className="mt-4 flex gap-2">
        {statuses.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={status === s.value ? "default" : "outline"}
            className="text-xs"
            onClick={() => setStatus(passage, s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <section className="mt-6">
        {!isValidPassageId(passage) ? (
          <ApiStateNotice error={new Error("YVP_ERROR:{\"kind\":\"invalid_request\",\"status\":400,\"message\":\"That passage reference is not valid.\",\"retryable\":false}")} />
        ) : biblesQuery.isError ? (
          <ApiStateNotice error={biblesQuery.error} onRetry={() => biblesQuery.refetch()} />
        ) : biblesQuery.isLoading || passageQuery.isLoading || !ready ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : !active ? (
          <ApiStateNotice
            error={new Error(
              "YVP_ERROR:{\"kind\":\"not_found\",\"status\":404,\"message\":\"No translation is available for this app key.\",\"retryable\":false}",
            )}
            onRetry={() => biblesQuery.refetch()}
          />
        ) : passageQuery.isError ? (
          <ApiStateNotice error={passageQuery.error} onRetry={() => passageQuery.refetch()} />
        ) : passageQuery.data ? (
          <article className="scripture text-foreground">
            <p className="mb-4 text-xs font-sans uppercase tracking-[0.16em] text-muted-foreground">
              {passageQuery.data.reference}
            </p>
            {passageQuery.data.verses.map((v, i) => (
              <p key={`${v.number}-${i}`} className="mb-3">
                {v.number ? (
                  <sup className="mr-1 font-sans text-[0.65em] text-muted-foreground">
                    {v.number}
                  </sup>
                ) : null}
                {v.text}
              </p>
            ))}
            {copyright ? (
              <p className="mt-8 border-t pt-4 font-sans text-[11px] leading-relaxed text-muted-foreground">
                {copyright}
              </p>
            ) : null}
          </article>
        ) : null}
      </section>

      <Collapsible className="mt-10 rounded-xl border bg-card">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium">
          <NotebookPen className="size-4 text-muted-foreground" />
          Study notes
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Your own reflections, stored only on this device.
          </p>
          <Textarea
            value={note}
            onChange={(e) => save(e.target.value)}
            placeholder={`Notes on ${label}…`}
            className="min-h-32 text-sm"
          />
        </CollapsibleContent>
      </Collapsible>
    </main>
  );
}
