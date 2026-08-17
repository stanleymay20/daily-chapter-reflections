# 7-Chapter Bible Study — Setup

A private, non-commercial daily Bible reading app. Seven chapters a day.
**All Scripture text comes from the official YouVersion Platform API — never from AI, and never bundled in this repo.**

## 1. Add your YouVersion App Key (required)

1. Open **Project Settings → Secrets** in Lovable.
2. Add a secret named exactly:

   ```
   YVP_APP_KEY
   ```

3. Paste the app key issued to you by the YouVersion Platform. Do not commit it anywhere, and never paste it into chat or client code.

Until the secret exists, every screen shows the setup state
("Connect YouVersion App Key in project secrets") and the app makes **no** request to YouVersion from the browser.

## 2. How the key is protected

- The key is read only inside server handlers via `process.env['YVP_APP_KEY']` in `src/lib/youversion.server.ts`.
- All YouVersion calls go through server functions in `src/lib/youversion.functions.ts` (`listBiblesFn`, `getPassageFn`). The browser calls those functions; it never talks to `api.youversion.com`.
- `*.server.ts` files are blocked from client bundles, so the key can't leak into JS, source maps, or `VITE_*` env vars.
- Errors log status code + path only — never the key or header values.
- Requests use the `X-YVP-App-Key` header against `https://api.youversion.com/v1`, with a 12s timeout and normalized handling for 401/403, 404, 429, 408 and 5xx.

## 3. Translations

- `GET /bibles?language_ranges[]=eng-*&page_size=99` lists the English versions available to your app key (the bare `eng` range returns `204`).
- The app prefers **BSB (id 3034)** when the key grants it, otherwise the first English version returned, otherwise the first version.
- NIV (111) is never assumed; if your key returns it, it simply appears in the picker.
- The copyright/attribution string returned by the API is displayed under the chapter text, along with a "Source: YouVersion Platform" indicator.

## 4. Testing Genesis 42

1. Add `YVP_APP_KEY`, then reload the app.
2. The home screen shows today's date in Europe/Berlin and the seven chapters. On 17 Aug 2026: Genesis 42, Nehemiah 3, Psalm 79, Proverbs 25, Zephaniah 2, Luke 7, 1 Corinthians 14.
3. Tap **Genesis 42** — the reader opens `/read/GEN.42` and fetches `/bibles/{version_id}/passages/GEN.42` server-side.
4. Expect the full chapter with verse numbers, plus the translation name and attribution.
5. Mark the chapter **Reading** or **Complete**; progress is stored in `localStorage` and the daily count updates on the home screen.
6. Open **Study notes** (collapsed by default) to write local reflections. Commentary stays separate from Scripture.

## 5. Reading plan data

`src/lib/schedule.ts` is the only source of plan data. It exports `PLAN` (day → chapters with USFM codes), `toUsfm`, `passageId`, and `getPlanForDate`, so a full 365-day plan can be dropped in without touching UI code.

## 6. Tests

```
bunx vitest run
```

Covers schedule lookup, USFM mapping/passage-id validation, API error normalization, and verse splitting.

## Scope

No ads, subscriptions, payments, or paywalls. No YouVersion OAuth/sign-in yet — no personal YouVersion account sync is claimed. Personal use only.
