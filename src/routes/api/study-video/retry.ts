import { createFileRoute } from "@tanstack/react-router";

import { handleRetry, jobSchema, json } from "@/lib/study-sequence-routes.server";

/** Explicit retry of a failed stage. Reuses completed assets; never raises the call ceiling. */
export const Route = createFileRoute("/api/study-video/retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = jobSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json("Invalid study video job.", 400);
        return handleRetry(request, parsed.data);
      },
    },
  },
});
