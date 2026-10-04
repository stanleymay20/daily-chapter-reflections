import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OTP_RESEND_COOLDOWN_SECONDS, normalizeOtp, requestEmailCode, verifyEmailCode } from "@/lib/cloud-sync";

/** Single in-app email-code sign-in used by Settings and Community. The session is created in this same app context. */
export function EmailCodeSignIn({ onSignedIn }: { onSignedIn?: () => void | Promise<void> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || cooldown > 0) return;
    setBusy(true); setStatus(null);
    try {
      await requestEmailCode(email);
      setStep("code"); setCode(""); setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setStatus({ kind: "ok", text: `We emailed a 6-digit code to ${email.trim()}. Enter it here — no need to open a link.` });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Unable to send code." });
    } finally { setBusy(false); }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setStatus(null);
    try {
      await verifyEmailCode(email, code);
      setStatus({ kind: "ok", text: "Signed in." });
      await onSignedIn?.();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Verification failed." });
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4">
      {step === "email" ? (
        <form onSubmit={send} className="flex gap-2">
          <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-base sm:text-sm" />
          <Button type="submit" size="sm" disabled={busy || cooldown > 0}><Mail className="mr-1 size-3.5" />{busy ? "Sending…" : "Email me a code"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <input
            aria-label="6-digit sign-in code" value={code} onChange={(e) => setCode(normalizeOtp(e.target.value))}
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus placeholder="••••••"
            className="w-full rounded-lg border bg-background px-3 py-3 text-center font-mono text-2xl tracking-[0.5em]"
          />
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}><KeyRound className="mr-1 size-4" />{busy ? "Verifying…" : "Verify code"}</Button>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button type="button" className="underline disabled:no-underline disabled:opacity-60" disabled={busy || cooldown > 0} onClick={() => void send()}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</button>
            <button type="button" className="underline" onClick={() => { setStep("email"); setStatus(null); setCode(""); }}>Use a different email</button>
          </div>
        </form>
      )}
      {status ? <p role="status" className={`mt-3 rounded-lg p-3 text-xs ${status.kind === "error" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>{status.text}</p> : null}
    </div>
  );
}
