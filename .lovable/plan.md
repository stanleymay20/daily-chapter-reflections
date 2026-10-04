# Video Aid v1 — guide-grounded chapter study video

## What the platform genuinely supports (verified)
- Video models (`google/gemini-omni-1.1-flash`, Veo 3.1 family): **3–10 s clips per job**. A 2–4 minute single render is not possible.
- Narration: Lovable AI text-to-speech (`google/gemini-3.1-flash-tts-preview`) is available with no extra key. The existing ElevenLabs path stays optional and is used only if its secret is set.
- Images: existing illustration pipeline (`study-images` bucket, `image` quota).
- **Server-side MP4 composition is not available**: the server runtime cannot run ffmpeg or native encoders. Therefore the final product is a **synchronized study timeline player** (scene media + narration + captions), labeled truthfully as a "study video sequence", not a single rendered MP4. Exporting a single MP4 is the one stated blocker.

## Study modes → plan size (hard caps)
| Mode | Target | Scenes | Motion clips (≤8 s) | Stills | TTS segments |
|---|---|---|---|---|---|
| Quick | 45–75 s | 5–6 | ≤2 | rest | = scenes |
| Standard | 90–150 s | 8–10 | ≤3 | rest | = scenes |
| Deep | 2–4 min | 12–16 | ≤4 | rest | = scenes |
| Just Read | not suggested; Explore shows "Optional" and defaults to Quick if chosen | | | | |

Opening title scene and closing "Return to Scripture" scene are rendered by the player (no provider call). Remaining scenes use stills with gentle pan/zoom (static under reduced motion); only the highest-weight scenes get motion clips. The card shows an estimate before Generate: duration, call counts (1 plan + N stills + M clips + N narration) and a plain credit note ("uses AI credits; longer modes cost more").

## Pipeline (each stage persisted, resumable, explicit-retry only)
```text
Planning ─► Visuals (stills + clips) ─► Narration ─► Finalizing (captions/manifest)
```
1. **Planning** (`openai/gpt-6-astra`, Responses, streamed, strict schema): input is only the server-reloaded, hash-verified study guide + reference. Each scene: narration text, visual brief, `claimType` (`chapter` | `context` | `uncertain`), and `sourceRefs` pointing to guide fields (summary, eventSequence[i], themes[i]...). Server validator rejects scenes whose sources do not exist, quotation marks / first-person divine or character speech, and narration over the word budget. Fail → stage failed, nothing else charged.
2. **Visuals**: per-scene prompt reuses v0 safeguards (no faces, no text, no historical-footage framing, abstract/symbolic for divine manifestations). Clips via existing `/v1/videos` create/poll; stills via the image gateway. Each asset is stored privately, keyed by scene hash.
3. **Narration**: one TTS call per scene, calm neutral documentary voice, narrator-only; audio length measured and used as the scene duration.
4. **Finalizing**: build WebVTT captions from the exact narration text and measured timings, plus a scene-description track and transcript; write the manifest; mark completed.

Dedupe/reuse: asset key = sha256(guide_hash + plan_version + scene_hash + voice/settings). Retrying a failed stage regenerates only missing/failed assets. No auto retries, polling only while a stage is active (8 s, stops on terminal/unmount/cancel).

## Quota and cost
- Keep the dedicated `video` quota but charge it **once per generation** (1/hour, 2/day), plus per-generation hard caps above. Stills/narration within a generation are covered by that one charge; standalone illustrations still use `image`.
- Gateway 402/403/429 surface the real message; the job pauses, never retries itself.

## Persistence (additive, parity in both migration folders)
- `study_videos`: add `kind` ('clip' v0 | 'sequence' v1, default 'clip'), `study_mode`, `plan_version`, `stage`, `manifest jsonb`, `estimated_seconds`; widen duration check for sequences only. v0 rows remain playable unchanged.
- New `study_video_scenes` (owner, video_id, index, scene_hash, plan JSON, visual kind, visual status/path/provider job, narration status/path, duration, error). Owner-only RLS, authenticated grants, no anon.
- Storage reuses private `study-videos` bucket under `{user_id}/...`. Delete removes rows + objects.
- Migration written to `drizzle/migrations/0006_*.sql` and byte-identical copy in `supabase/migrations/`.

## UX (Explore → Video aid card)
Mode selector (defaults to current study mode), estimate, Generate, stage stepper (Planning → Visuals → Narration → Finalizing) with per-scene counts, Cancel, "Retry failed stage", player (play/pause, scrub by scene, captions toggle, never autoplays sound), scene list with claim badges (From the chapter / Context / Uncertain), transcript, saved versions, delete. Permanent "AI-created interpretation · not Scripture" label; closing card links back to the chapter text. 44 px targets, iPhone first.

## Tests (no paid calls; gateway mocked)
Mode mapping/caps, plan validator (grounding, no dialogue/quotes, claim types), caption↔narration sync, stage state machine, partial retry reuse, dedupe keys, cancellation, quota single-charge + caps, RLS/storage ownership contract, migration parity, v0 clip compatibility.

## Technical files
- `src/lib/study-video.shared.ts` (modes, caps, plan schema/validator, VTT), `study-video-plan.server.ts`, `tts-gateway.server.ts`, `study-video.server.ts`, `video-gateway.server.ts`
- Routes: `api/study-video/start|status|advance|retry|cancel` (advance runs one bounded step per poll so no request outlives the runtime)
- `useStudyVideo.ts`, `StudyVideoAid.tsx`, new `StudySequencePlayer.tsx`
- Migrations 0006 (both folders), regenerated types, AGENTS.md rule update.
