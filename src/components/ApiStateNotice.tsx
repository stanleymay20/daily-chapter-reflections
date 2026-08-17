import { KeyRound, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { decodeApiError } from "@/lib/youversion";

export function ApiStateNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const normalized = decodeApiError(error);
  const isSetup = normalized.kind === "missing_key";

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-3 py-6 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          {isSetup ? <KeyRound className="size-5" /> : <TriangleAlert className="size-5" />}
        </div>
        <h2 className="text-base font-semibold">
          {isSetup ? "Connect YouVersion App Key in project secrets" : "Scripture unavailable"}
        </h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {isSetup
            ? "Add a secret named YVP_APP_KEY in Project Settings → Secrets. Scripture is only ever fetched server-side, and never generated."
            : normalized.message}
        </p>
        {!isSetup && onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 size-4" />
            Retry
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Bible text is never AI-generated. Source: YouVersion Platform.
        </p>
      </CardContent>
    </Card>
  );
}
