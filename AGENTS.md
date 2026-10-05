<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Generate chapter artwork through the server image route and keep it explicitly labeled as interpretive, because Scripture must remain the authoritative primary content.
- Email sign-in uses the shared in-app OTP_LENGTH-digit (provider-defined, currently 8) code flow (EmailCodeSignIn + verifyOtp type "email"), never magic-link redirects, because installed PWAs lose sessions opened in another browser context.
- Storage buckets are provisioned through the Storage API tool, never SQL inserts into storage.buckets; migrations only hold storage.objects policies, because the migration tool rejects bucket writes.
- Chapter Video Aid v1 is a staged study sequence (plan → visuals → narration → finalize) advanced one bounded step per /api/study-video/advance call with the caller's bearer token, because providers only render short clips and the runtime cannot compose MP4s; spend is gated by SECURITY DEFINER call-ledger RPCs and assets live in the private study-videos bucket. v0 single clips (/start, /status) remain playable.
- Every migration is written byte-identically to drizzle/migrations and supabase/migrations, because both folders must converge and tests enforce parity.
