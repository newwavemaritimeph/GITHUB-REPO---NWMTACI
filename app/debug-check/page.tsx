"use client";

import { useEffect, useState } from "react";

// Client-side session diagnostic. Visit while signed in; it runs the same
// fetches the portal makes and shows, in one view, whether the browser has
// auth cookies and how each API route responds — resolving why one endpoint
// sees the session and another does not.
export default function DebugCheck() {
  const [out, setOut] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      const cookieNames = document.cookie ? document.cookie.split(";").map((c) => c.trim().split("=")[0]) : [];
      const grab = async (path: string) => {
        try {
          const r = await fetch(path, { cache: "no-store" });
          let body: unknown = null;
          try { body = await r.json(); } catch { /* non-JSON */ }
          return { status: r.status, body };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "fetch failed" };
        }
      };
      const staff = (await grab("/api/staff/operations")) as { status?: number; body?: { roles?: string[] } };
      const admin = (await grab("/api/admin/configuration")) as { status?: number; body?: { debug?: unknown } };
      const dbg = (await grab("/api/debug/auth")) as { body?: unknown };
      setOut({
        browserCookieNames: cookieNames,
        browserCookieCount: cookieNames.length,
        supabaseAuthCookiesInBrowser: cookieNames.filter((n) => n.startsWith("sb-") || n.includes("auth-token")),
        "staff/operations": { status: staff.status, roles: staff.body?.roles ?? null },
        "admin/configuration": { status: admin.status, debug: admin.body?.debug ?? null },
        "debug/auth": dbg.body ?? null,
      });
    })();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1 style={{ fontSize: 18 }}>Session diagnostic</h1>
      <p style={{ fontSize: 13, color: "#555" }}>Sign in first, then load this page. Screenshot the block below.</p>
      <pre style={{ padding: 16, background: "#f4f8fa", border: "1px solid #dbe7ec", borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {out ? JSON.stringify(out, null, 2) : "Running checks…"}
      </pre>
    </main>
  );
}
