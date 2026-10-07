"use client";

import { useState, type ReactNode } from "react";

/**
 * Small UI pieces shared by every role workspace. They used to live inside
 * portal-live-app.tsx (and were re-implemented in several role files); one
 * copy here keeps the look consistent and the role files importable without
 * pulling the whole portal in.
 */

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`portal-badge ${tone ?? String(children).toLowerCase().replaceAll(" ", "-")}`}>{children}</span>;
}

export function Message({ kind, text }: { kind: "success" | "error"; text: string }) {
  return <div className={`portal-message ${kind}`} role={kind === "error" ? "alert" : "status"}>{text}</div>;
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="portal-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="portal-modal" style={wide ? { width: "min(980px, 100%)" } : undefined} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header><div><span className="portal-eyebrow">Secure staff action</span><h2 id="modal-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
      {children}
    </section>
  </div>;
}

/** A screen's page frame. Embedded inside another screen it drops its own frame and heading. */
export function Page({ embedded, head, children }: { embedded?: boolean; head: ReactNode; children: ReactNode }) {
  return embedded ? <>{children}</> : <div className="portal-page">{head}{children}</div>;
}

export function PageHead({ eyebrow, title, text, action, onAction }: { eyebrow: string; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="portal-heading"><div><span className="portal-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action && <button className="portal-primary" onClick={onAction}>{action}</button>}</div>;
}

/** A clickable KPI card; place a row of them inside <div className="reg-kpis">. */
export function Kpi({ icon, label, value, hint = "View all →", onClick }: { icon: string; label: string; value: number | string; hint?: string; onClick?: () => void }) {
  return <button type="button" onClick={onClick}><i>{icon}</i><span>{label}</span><strong>{value}</strong><small>{hint}</small></button>;
}

/** Page controls for long tables. Keeps the caption and buttons in one place. */
export function Pager({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return <div className="pager">
    <span>Showing {from}–{to} of {total}</span>
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button type="button" className="ghost-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
      <button type="button" className="ghost-button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </span>
  </div>;
}

export const fullName = (person: { legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; suffix?: string | null }) =>
  `${person.legal_first_name} ${person.legal_middle_name ?? ""} ${person.legal_last_name} ${person.suffix ?? ""}`.replace(/\s+/g, " ").trim();

export const fmtDate = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value.length === 10 ? `${value}T00:00:00+08:00` : value}`)) : "—";

export const fmtClock = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(value)) : "—";

/** POST one action to the staff operations endpoint. Throws with the server's message. */
export async function submit(body: unknown) {
  const response = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to save the record.");
  return result;
}

/**
 * Busy flag + last message around `submit`, then a reload. Replaces the
 * private `post()` helpers each module used to carry.
 */
export function usePost(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  async function post(body: Record<string, unknown>, successText?: string) {
    setBusy(true); setMsg(null);
    try {
      const result = await submit(body);
      await reload();
      if (successText) setMsg({ kind: "success", text: successText });
      return result as Record<string, unknown>;
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "The action could not be completed." });
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, setMsg, post };
}
