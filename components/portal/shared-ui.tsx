"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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

/**
 * Pick a Date First (owner, 5 Nov 2026; design/date-hidden-tables-prototype.html): record tables stay hidden until a
 * date is picked, and hide again when the page is left. Lists of work still to do and setup lists are not date hidden.
 * A search looks across every date. A list that needs an older date asks for it through DataSince.
 */
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
export const DataSince = createContext<((from: string) => void) | null>(null);
/** Every date while searching (capped by the server). */
export const ALL_DATES = "2000-01-01";
export function useNeedSince(from: string) {
  const need = useContext(DataSince);
  useEffect(() => { if (from) need?.(from < ALL_DATES ? ALL_DATES : from); }, [need, from]);
}
export const DATE_PICKS = ["Today", "This Week", "This Month", "Last Month"] as const;
export type DatePick = (typeof DATE_PICKS)[number] | "Custom";
export function pickRange(pick: DatePick, today: string, from: string, to: string): { from: string; to: string; label: string } {
  if (pick === "Today") return periodRange("Daily", today);
  if (pick === "This Week") return periodRange("Weekly", today);
  if (pick === "This Month") return periodRange("Monthly", today);
  if (pick === "Last Month") return periodRange("Monthly", shiftDay(`${today.slice(0, 8)}01`, -1));
  const short = { month: "short", day: "numeric", year: "numeric" } as const;
  return { from, to, label: `${utcLabel(from, short)} – ${utcLabel(to, short)}` };
}
export function usePeriod() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const [pick, setPick] = useState<DatePick | null>(null), [from, setFrom] = useState(`${today.slice(0, 8)}01`), [to, setTo] = useState(today);
  const range = pick && (pick !== "Custom" || (!!from && !!to && from <= to)) ? pickRange(pick, today, from, to) : null;
  useNeedSince(range?.from ?? "");
  return { pick, setPick, from, setFrom, to, setTo, today, picked: !!range, range: range ?? { from: "", to: "", label: "" }, inRange: (iso?: string | null) => { if (!range) return false; const d = manilaDay(iso); return !!d && d >= range.from && d <= range.to; } };
}
/** A dated list: the rows of the picked date, none before one is picked, or every date while searching. */
export function useMonthRows<T>(rows: T[], dateOf: (row: T) => string | null | undefined, searching: boolean) {
  const p = usePeriod();
  useNeedSince(searching ? ALL_DATES : "");
  return { p, rows: searching ? rows : rows.filter((row) => p.inRange(dateOf(row))) };
}
export function PeriodBar({ p, what, count, waitText = "Pick a date above." }: { p: ReturnType<typeof usePeriod>; what: string; count: string; waitText?: string }) {
  return <><div className="pd-bar">
    <span className="cx-seg">{DATE_PICKS.map((x) => <button key={x} type="button" className={p.pick === x ? "on" : ""} onClick={() => p.setPick(x)}>{x}</button>)}</span>
    <label className="cx-dt">From<input type="date" value={p.from} max={p.to || undefined} onChange={(e) => p.setFrom(e.target.value)} /></label>
    <label className="cx-dt">To<input type="date" value={p.to} min={p.from || undefined} onChange={(e) => p.setTo(e.target.value)} /></label>
    <button type="button" className={`portal-secondary${p.pick === "Custom" ? " pd-on" : ""}`} onClick={() => p.setPick("Custom")}>Show</button>
    {p.picked && <><span className="pd-label">{what} <b>{p.range.label}</b> · {count} · newest first</span><button type="button" className="portal-secondary" onClick={() => p.setPick(null)}>Hide</button></>}
  </div>{!p.picked && <p className="pd-wait"><b>No Records Shown</b> {waitText}</p>}</>;
}
/** The date bar in its own panel, or "Searching all dates" while a search looks past it. */
export function MonthBar({ p, what, count, searching, waitText }: { p: ReturnType<typeof usePeriod>; what: string; count: string; searching?: boolean; waitText?: string }) {
  return <div className="portal-panel">{searching ? <p className="pd-label pd-pad">Searching all dates · {count} found</p> : <PeriodBar p={p} what={what} count={count} waitText={waitText} />}</div>;
}

export const fmtDate = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value.length === 10 ? `${value}T00:00:00+08:00` : value}`)) : "—";

export const fmtClock = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(value)) : "—";

/** View is a round eye icon everywhere (owner, 4 Nov 2026); `label` names it on hover and for screen readers. A link when given `href`. */
export function ViewIcon({ label, href, onClick, disabled }: { label: string; href?: string; onClick?: () => void; disabled?: boolean }) {
  const eye = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
  return href
    ? <a className="view-icon" href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>{eye}</a>
    : <button type="button" className="view-icon" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{eye}</button>;
}

/**
 * One Actions ▾ menu per row instead of a row of buttons (owner, 10 Nov 2026: "consolidate rows, not so much buttons").
 * Each item runs its action or opens its link; the menu closes on a pick or a click elsewhere.
 */
export type ActionItem = { label: string; onClick?: () => void; href?: string; disabled?: boolean; danger?: boolean };
export function ActionsMenu({ items, label = "Actions", disabled }: { items: (ActionItem | false | null | undefined)[]; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const list = items.filter(Boolean) as ActionItem[];
  if (!list.length) return null;
  return <span className="cx-split act-split" ref={box} onClick={(e) => e.stopPropagation()}><button type="button" className="portal-secondary row-act" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>{label} ▾</button>
    {open && <div className="cx-splitmenu act-menu" role="menu">{list.map((it) => it.href
      ? <a key={it.label} role="menuitem" href={it.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{it.label}</a>
      : <button key={it.label} type="button" role="menuitem" className={it.danger ? "danger" : undefined} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick?.(); }}>{it.label}</button>)}</div>}
  </span>;
}

/** When a transaction was made: Nov 4, 9:12 AM. */
export const txWhen = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));

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
export async function openAdmissionRecord(traineeId: string, enrollmentIds?: string[]) {
  const tab = window.open("", "_blank");
  try {
    const result = await submit({ action: "admission-record-issue", traineeId, ...(enrollmentIds?.length ? { enrollmentIds } : {}) }) as { id?: string };
    if (!result.id) throw new Error("The admission record could not be issued.");
    const url = `/portal/admission-record/${result.id}`;
    if (tab) tab.location.href = url; else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}
