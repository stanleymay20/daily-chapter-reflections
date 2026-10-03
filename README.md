# Daily Scripture Companion

Daily Scripture Companion is a mobile-first Bible reading and study app built around a seven-track daily reading plan. Scripture is fetched from the official YouVersion Platform API; AI is used only for clearly separated study assistance and must never generate, replace, or masquerade as Bible text.

The app is publicly accessible, while personal study data and cost-bearing AI tools are account-aware. It currently has no ads, subscriptions, payments, or paywalls.

## What the app does

- Shows a daily seven-chapter plan across Law, History, Psalms, Wisdom, Prophets, Gospels, and Acts & Epistles.
- Reads actual licensed Scripture from the YouVersion Platform API with selectable available English translations and attribution.
- Provides a guided study flow: Read → Understand → Explore → Reflect → Pray.
- Stores reading progress, notes, highlights, saved verses, study plans, settings, chapter studies, and daily reviews locally and/or in the connected Supabase backend where supported.
- Offers optional AI study assistance for chapter insights, chapter Q&A, Study Memory, neural narration, and interpretive chapter illustrations.
- Keeps AI output visually and semantically separate from Scripture. Generated artwork and commentary are labelled as interpretation/study guidance.
- Includes community posts, comments, likes, and reports with database ownership policies.

## Scripture integrity

The non-negotiable rule is: **Scripture text comes from YouVersion, never from an AI model or bundled fallback text.**

The YouVersion integration runs server-side and reads `YVP_APP_KEY` only from a server secret. The browser never calls YouVersion directly with the key. Passage and translation identifiers are validated, provider failures are normalized, and the UI fails visibly instead of substituting generated Bible text.

Current English discovery uses the YouVersion language range accepted by the Platform API:

```text
/bibles?language_ranges[]=eng-*&page_size=99
```

A translation is selected only from versions actually returned for the configured app key.

## AI security model

Cost-bearing AI operations require an authenticated Supabase session. The server validates the caller's bearer token through Supabase Auth using the public publishable key; it does not require the service-role credential for ordinary session validation and never trusts a caller-supplied user ID.

AI usage limits are enforced by the database through `public.consume_ai_quota(text)`. The committed quota migration is:

```text
supabase/migrations/20261003093500_ai_usage_quota.sql
```

The function derives identity from `auth.uid()`, serializes each user/feature counter with `SELECT ... FOR UPDATE`, and applies server-owned hourly and daily limits. The underlying counter table is not directly accessible to browser roles. If authentication or quota infrastructure cannot be verified, paid AI features fail closed instead of bypassing the guard.

After a migration change, verify that the corresponding migration has been applied to the live Lovable Cloud/Supabase database before treating the release as production-verified.

## Data isolation

User-owned tables use Row Level Security in the migration set. Community tables intentionally allow the reads required by the social experience while constraining writes to authenticated owners as defined by their policies.

When changing database schema or policies:

1. add a versioned migration under `supabase/migrations/`;
2. keep RLS enabled for user data;
3. verify grants and policies against the live database;
4. test cross-user isolation before release.

Do not use the service-role client for normal user-scoped browser operations. The service role is server-only, bypasses RLS, and should be configured only when a trusted privileged server operation actually needs it.

## Environment and public configuration

Never commit a real `.env` or provider secret. `.env.example` documents supported overrides and secrets.

The connected app's Supabase project URL, project ID, and publishable key are **public browser configuration**, not credentials. Daily Scripture Companion keeps a deployment-safe fallback for those three values in:

```text
src/integrations/supabase/public-config.ts
```

This prevents Lovable builds from depending on a tracked `.env` file. A fork or deployment that targets a different Supabase project can override the public defaults with:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

Server-only provider secrets remain deployment secrets:

```text
YVP_APP_KEY
LOVABLE_API_KEY
ELEVENLABS_API_KEY          # optional neural narration
ELEVENLABS_VOICE_ID         # optional
ELEVENLABS_MODEL_ID         # optional
```

For a deliberately privileged server operation using `src/integrations/supabase/client.server.ts`, configure these only in the server environment:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY`, `YVP_APP_KEY`, `LOVABLE_API_KEY`, and `ELEVENLABS_API_KEY` are secrets and must never be placed in `VITE_*` variables, browser code, logs, or committed files.

## Local development

Bun is used by CI and is the reproducible development path:

```sh
git clone https://github.com/stanleymay20/daily-chapter-reflections.git
cd daily-chapter-reflections
bun install --frozen-lockfile
bun run dev
```

Quality checks:

```sh
bun run test
bun run typecheck
bun run build
bun run lint
```

The CI release gate blocks on frozen dependency installation, repository secret hygiene, tests, TypeScript, and the production build. Lint is currently advisory while legacy formatting debt is being retired; new work should not add further lint debt.

## Release discipline

Before a production release:

1. ensure intended work is incorporated into `main` and no release branch is ahead;
2. require a green exact-head CI run;
3. verify required Supabase migrations and RLS/grants against the live database;
4. smoke-test the public reading journey and an authenticated personal-data journey;
5. verify AI endpoints return 401 for unauthenticated use, enforce quotas for authenticated users, and fail closed if quota infrastructure is unavailable;
6. confirm Lovable is synchronized to the exact GitHub `main` SHA before publishing.

GitHub branch protection should require the CI check on `main`, disallow force pushes/deletion, and use pull-request review for normal changes.

## Deployment

The connected Lovable project is **Daily Scripture Companion**. GitHub `main` synchronizes into Lovable; production publishing should occur only after the exact synchronized commit has passed the release checks above.

This project was built with Lovable and TanStack Start, React, TypeScript, Tailwind, and Supabase.
