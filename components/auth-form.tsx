"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthForm({ portal }: { portal: "staff" | "trainee" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (portal === "staff") {
        const temporary = await fetch("/api/auth/temp-staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
        if (temporary.ok) { window.location.href = "/portal"; return; }
        if (temporary.status === 401) throw new Error("Invalid email or password.");
      }
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = portal === "staff" ? "/portal" : "/registration-search";
    } catch (error) {
      setMessage(error instanceof Error && error.message !== "Supabase is not configured." ? error.message : "Invalid email or password.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email) return setMessage("Enter your email first so we know where to send the reset link.");
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/reset` });
      if (error) throw error;
      setMessage("Check your email for a secure password reset link.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setMessage(
        detail === "Supabase is not configured."
          ? "Password reset will be available after the authentication environment is connected."
          : detail
            ? `Could not send the reset link: ${detail}`
            : "Could not send the reset link. Please try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
      <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="button button-primary button-block" disabled={busy}>{busy ? "Signing in..." : `Sign in to ${portal} portal`}</button>
      <button className="text-button" type="button" onClick={resetPassword} disabled={busy}>Forgot your password?</button>
    </form>
  );
}
