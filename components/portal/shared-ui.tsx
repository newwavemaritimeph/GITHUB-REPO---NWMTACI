"use client";

import { useState, type ReactNode } from "react";
import { tcl } from "@/lib/title-case";

/**
 * Small UI pieces shared by every role workspace. They used to live inside
 * portal-live-app.tsx (and were re-implemented in several role files); one
 * copy here keeps the look consistent and the role files importable without
 * pulling the whole portal in.
 */

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`portal-badge ${tone ?? String(children).toLowerCase().replaceAll(" ", "-")}`}>{tcl(children)}</span>;
}

export function Message({ kind, text }: { kind: "success" | "error"; text: string }) {
  return <div className={`portal-message ${kind}`} role={kind === "error" ? "alert" : "status"}>{text}</div>;
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="portal-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="portal-modal" style={wide ? { width: "min(980px, 100%)" } : undefined} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header><div><h2 id="modal-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
      {children}
    </section>
  </div>;
}

/** A screen's page frame. Embedded inside another screen it drops its own frame and heading. */
export function Page({ embedded, head, children }: { embedded?: boolean; head: ReactNode; children: ReactNode }) {
  return embedded ? <>{children}</> : <div className="portal-page">{head}{children}</div>;
}

/** Page title. `text` is accepted for older callers but not shown: titles carry no description (owner, 7 Oct 2026). */
export function PageHead({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; text?: string; action?: string; onAction?: () => void }) {
  return <div className="portal-heading"><div><span className="portal-eyebrow">{eyebrow}</span><h1>{title}</h1></div>{action && <button className="portal-primary" onClick={onAction}>{action}</button>}</div>;
}

/** A clickable KPI card; place a row of them inside <div className="reg-kpis">. */
export function Kpi({ icon, label, value, hint = "View all", onClick }: { icon: string; label: string; value: number | string; hint?: string; onClick?: () => void }) {
  return <button type="button" onClick={onClick}><i>{icon}</i><span>{tcl(label)}</span><strong>{value}</strong><small>{hint}</small></button>;
}

/** Page controls for long tables. Keeps the caption and buttons in one place. */
export function Pager({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return <div className="pager">
    <span>Showing {from}–{to} of {total}</span>
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button type="button" className="ghost-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button type="button" className="ghost-button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </span>
  </div>;
}

export const fullName = (person: { legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; suffix?: string | null }) =>
  `${person.legal_first_name} ${person.legal_middle_name ?? ""} ${person.legal_last_name} ${person.suffix ?? ""}`.replace(/\s+/g, " ").trim();

/** Ten rows per page on every list (owner, 20 Oct 2026); back to page 1 when the list changes. */
export function usePaged<T>(rows: T[], perPage = 10) {
  const [page, setPage] = useState(1), [seen, setSeen] = useState(rows.length);
  if (seen !== rows.length) { setSeen(rows.length); setPage(1); }
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / perPage)));
  return { shown: rows.slice((current - 1) * perPage, current * perPage), offset: (current - 1) * perPage, pager: rows.length > perPage ? <Pager page={current} total={rows.length} perPage={perPage} onPage={setPage} /> : null };
}

/** Records by date (owner, 20 Oct 2026): Trainees and Enrollments start on today and list the newest first. */
export type Period = "Daily" | "Weekly" | "Monthly" | "All Dates";
export const manilaDay = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso)) : "");
const shiftDay = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const utcLabel = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", ...o }).format(new Date(`${d}T00:00:00Z`));
export function periodRange(period: Period, date: string): { from: string; to: string; label: string } {
  if (period === "All Dates") return { from: "0000-01-01", to: "9999-12-31", label: "All dates" };
  if (period === "Daily") return { from: date, to: date, label: utcLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) };
  if (period === "Monthly") { const from = `${date.slice(0, 8)}01`; return { from, to: shiftDay(`${shiftDay(from, 32).slice(0, 8)}01`, -1), label: utcLabel(from, { month: "long", year: "numeric" }) }; }
  const from = shiftDay(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7)), to = shiftDay(from, 6);
  return { from, to, label: `Week of ${utcLabel(from, { month: "short", day: "numeric" })} – ${utcLabel(to, { month: "short", day: "numeric", year: "numeric" })}` };
}
export function usePeriod() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const [period, setPeriod] = useState<Period>("Daily"), [date, setDate] = useState(today);
  const range = periodRange(period, date);
  return { period, setPeriod, date, setDate, today, range, inRange: (iso?: string | null) => { const d = manilaDay(iso); return !!d && d >= range.from && d <= range.to; } };
}
export function PeriodBar({ p, what, count }: { p: ReturnType<typeof usePeriod>; what: string; count: string }) {
  const step = (n: number) => p.setDate(p.period === "Daily" || p.period === "All Dates" ? shiftDay(p.date, n) : shiftDay(n < 0 ? p.range.from : p.range.to, n));
  return <div className="pd-bar">
    <span className="cx-seg">{(["Daily", "Weekly", "Monthly", "All Dates"] as Period[]).map((x) => <button key={x} type="button" className={p.period === x ? "on" : ""} onClick={() => p.setPeriod(x)}>{x}</button>)}</span>
    {p.period !== "All Dates" && <><button type="button" className="portal-secondary" aria-label="Previous" onClick={() => step(-1)}>‹</button><input type="date" value={p.date} aria-label="Date" onChange={(e) => e.target.value && p.setDate(e.target.value)} /><button type="button" className="portal-secondary" aria-label="Next" onClick={() => step(1)}>›</button>{p.date !== p.today && <button type="button" className="portal-secondary" onClick={() => p.setDate(p.today)}>Today</button>}</>}
    <span className="pd-label">{what} <b>{p.range.label}</b> · {count} · newest first</span>
  </div>;
}

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

/**
 * Issue (or reprint) the trainee's Training Admission Record and open it in a
 * new tab for printing. The tab is opened first so the browser does not block
 * it as a pop-up, then pointed at the record once its AR number is ready.
 */
export async function openAdmissionRecord(traineeId: string) {
  const tab = window.open("", "_blank");
  try {
    const result = await submit({ action: "admission-record-issue", traineeId }) as { id?: string };
    if (!result.id) throw new Error("The admission record could not be issued.");
    const url = `/portal/admission-record/${result.id}`;
    if (tab) tab.location.href = url; else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}
