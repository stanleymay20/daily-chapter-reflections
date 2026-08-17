import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Check, ChevronRight, Circle, CircleDot } from "lucide-react";
import { useMemo } from "react";

import { ApiStateNotice } from "@/components/ApiStateNotice";
import { TranslationPicker } from "@/components/TranslationPicker";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { pickDefaultVersion, useProgress, useSelectedVersion } from "@/hooks/useReadingState";
import {
  berlinToday,
  chapterLabel,
  formatBerlinDate,
  getPlanForDate,
  passageId,
} from "@/lib/schedule";
import { listBiblesFn } from "@/lib/youversion.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "7-Chapter Bible Study — Today's Reading" },
      {
        name: "description",
        content:
          "A calm daily Bible reading companion: seven scheduled chapters a day with Scripture text from the YouVersion Platform API.",
      },
      { property: "og:title", content: "7-Chapter Bible Study — Today's Reading" },
      {
        property: "og:description",
        content: "Seven chapters a day, read in a quiet, distraction-free space.",
      },
    ],
  }),
  component: Home,
});

const statusIcon = {
  not_started: Circle,
  reading: CircleDot,
  complete: Check,
} as const;

function Home() {
  const today = berlinToday();
  const plan = getPlanForDate(today);
  const { statusOf, completedCount } = useProgress(today);
  const { versionId, select, ready } = useSelectedVersion();

  const listBibles = useServerFn(listBiblesFn);
  const biblesQuery = useQuery({
    queryKey: ["bibles"],
    queryFn: () => listBibles(),
    retry: false,
    staleTime: 60 * 60 * 1000,
  });

  const bibles = biblesQuery.data?.bibles ?? [];
  const active = useMemo(
    () => (ready ? pickDefaultVersion(bibles, versionId) : undefined),
    [bibles, versionId, ready],
  );

  const passages = plan?.chapters.map((c) => passageId(c.usfm, c.chapter)) ?? [];
  const done = completedCount(passages);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-16 pt-10">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {formatBerlinDate(today)} · Europe/Berlin
        </p>
        <h1 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold tracking-tight">
          7-Chapter Bible Study
        </h1>
      </header>

      <section className="mt-6 rounded-xl border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Today's progress</span>
          <span className="text-sm font-medium">{done} of {passages.length}</span>
        </div>
        <Progress className="mt-3 h-2" value={passages.length ? (done / passages.length) * 100 : 0} />
        <div className="mt-4 flex items-center justify-between gap-3">
          {biblesQuery.isLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : bibles.length > 0 ? (
            <TranslationPicker
              bibles={bibles}
              {...(active ? { value: active.id } : {})}
              onChange={select}
            />
          ) : (
            <span className="text-xs text-muted-foreground">No translation selected</span>
          )}
          <span className="text-[11px] text-muted-foreground">Source: YouVersion Platform</span>
        </div>
      </section>

      {biblesQuery.isError ? (
        <div className="mt-5">
          <ApiStateNotice error={biblesQuery.error} onRetry={() => biblesQuery.refetch()} />
        </div>
      ) : null}

      <section className="mt-6 space-y-3">
        {plan ? (
          plan.chapters.map((ref) => {
            const id = passageId(ref.usfm, ref.chapter);
            const status = statusOf(id);
            const Icon = statusIcon[status];
            return (
              <Link key={id} to="/read/$passage" params={{ passage: id }} className="block">
                <Card className="flex flex-row items-center gap-3 px-4 py-4 transition-colors hover:bg-accent/40">
                  <Icon
                    className={
                      status === "complete"
                        ? "size-5 shrink-0 text-primary"
                        : "size-5 shrink-0 text-muted-foreground"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-[family-name:var(--font-scripture)] text-lg leading-tight">
                      {chapterLabel(ref)}
                    </p>
                    <p className="text-xs text-muted-foreground">{ref.track}</p>
                  </div>
                  {status === "reading" ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Reading
                    </Badge>
                  ) : null}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Card>
              </Link>
            );
          })
        ) : (
          <Card className="flex flex-col items-center gap-2 py-10 text-center">
            <BookOpen className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No reading scheduled for {today} yet.
            </p>
          </Card>
        )}
      </section>
    </main>
  );
}
