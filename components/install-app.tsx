"use client";
/* eslint-disable @next/next/no-img-element -- a small static icon. */
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = "nw-install-dismissed";

/**
 * New Wave Staff app (owner, 10 Nov 2026): registers the portal's offline fallback and offers
 * "Install" where the browser supports it. iPhones get the Share › Add to Home Screen steps instead.
 * Hidden once installed (running full-screen) or after "Not Now".
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/staff-sw.js", { scope: "/portal" }).catch(() => undefined);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === "1"; } catch { /* no storage */ }
    if (standalone || dismissed) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallEvent); setHidden(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Safari on iPhone has no install prompt; it only installs through Share › Add to Home Screen.
    const t = window.setTimeout(() => { if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setIos(true); setHidden(false); } }, 0);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.clearTimeout(t); };
  }, []);

  if (hidden) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, "1"); } catch { /* no storage */ } };
  return (
    <div className="nw-install" role="region" aria-label="Install New Wave Staff">
      <img src="/icons/staff-192.png" alt="" />
      <div><b>Install New Wave Staff</b><small>{ios ? "Tap Share, then Add to Home Screen" : "Open the portal like an app"}</small></div>
      {prompt && <button type="button" className="go" onClick={async () => { await prompt.prompt(); const { outcome } = await prompt.userChoice; if (outcome === "accepted") setHidden(true); setPrompt(null); }}>Install</button>}
      <button type="button" className="no" onClick={dismiss}>Not Now</button>
    </div>
  );
}
