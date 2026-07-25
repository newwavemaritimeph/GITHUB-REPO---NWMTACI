"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "totp" | "email";

/** Second-factor challenge UI for privileged staff: TOTP (native Supabase MFA)
 * or an emailed one-time code. On success it navigates to the portal. */
export function MfaGate({ email, hasTotp, emailConfigured }: { email: string; hasTotp: boolean; emailConfigured: boolean }) {
  const [mode, setMode] = useState<Mode>(hasTotp ? "totp" : emailConfigured ? "email" : "totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // TOTP enrollment state (when the user has no verified factor yet).
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  function done() {
    window.location.href = "/portal";
  }

  async function startTotpEnroll() {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start authenticator setup.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp() {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      let factorId = enroll?.factorId;
      if (!factorId) {
        const { data } = await supabase.auth.mfa.listFactors();
        factorId = data?.totp?.find((f) => f.status === "verified")?.id ?? data?.totp?.[0]?.id;
      }
      if (!factorId) throw new Error("No authenticator factor found.");
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (error) throw error;
      done();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That code did not verify. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestEmailCode() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/mfa/email/request", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send a code.");
      setEmailSent(true);
      setMessage(`We emailed a 6-digit code to ${email}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailCode() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/mfa/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Verification failed.");
      done();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mfa-gate">
      <div className="mfa-tabs" role="tablist">
        <button type="button" className={mode === "totp" ? "active" : ""} onClick={() => { setMode("totp"); setCode(""); setMessage(""); }}>
          Authenticator app
        </button>
        <button type="button" className={mode === "email" ? "active" : ""} onClick={() => { setMode("email"); setCode(""); setMessage(""); }}>
          Email code
        </button>
      </div>

      {mode === "totp" && (
        <div className="mfa-panel">
          {hasTotp || enroll ? (
            <>
              {enroll && (
                <div className="mfa-enroll">
                  <p>Scan this in Google Authenticator, Authy, or 1Password, then enter the 6-digit code.</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={enroll.qr} alt="Authenticator QR code" width={180} height={180} />
                  <p className="mfa-secret">Manual key: <code>{enroll.secret}</code></p>
                </div>
              )}
              <label>Authenticator code
                <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              </label>
              <button className="button button-primary button-block" disabled={busy || code.length < 6} onClick={verifyTotp}>
                {busy ? "Verifying…" : "Verify & continue"}
              </button>
            </>
          ) : (
            <>
              <p>Set up an authenticator app for one-tap codes on every sign-in.</p>
              <button className="button button-primary button-block" disabled={busy} onClick={startTotpEnroll}>
                {busy ? "Preparing…" : "Set up authenticator"}
              </button>
            </>
          )}
        </div>
      )}

      {mode === "email" && (
        <div className="mfa-panel">
          {!emailConfigured ? (
            <p className="form-message">Email codes aren’t available yet — email delivery (Resend) isn’t configured. Use the authenticator app instead.</p>
          ) : !emailSent ? (
            <>
              <p>We’ll email a one-time code to <strong>{email}</strong>.</p>
              <button className="button button-primary button-block" disabled={busy} onClick={requestEmailCode}>
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </>
          ) : (
            <>
              <label>Email code
                <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              </label>
              <button className="button button-primary button-block" disabled={busy || code.length < 6} onClick={verifyEmailCode}>
                {busy ? "Verifying…" : "Verify & continue"}
              </button>
              <button className="text-button" type="button" disabled={busy} onClick={requestEmailCode}>Resend code</button>
            </>
          )}
        </div>
      )}

      {message && <p className="form-message" role="status">{message}</p>}
    </div>
  );
}
