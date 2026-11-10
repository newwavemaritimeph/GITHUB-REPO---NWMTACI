import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/classroom";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";
import { fileInDrive } from "@/lib/google-drive";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadDocumentControl } from "@/lib/document-controls";
import { buildHrDocumentPdf, dayOf, longDate, type HrDocSnapshot } from "@/lib/print/hr-documents";
import { HR_DEFAULTS, daysBetween, dueLabel, hrDueItems, manilaDate, needsAction, KIND_LABEL, type HrSettings } from "@/lib/hr-due";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export const HR_ROLES = ["admin", "hr"];
export const canHr = (roles: string[]) => roles.some((r) => HR_ROLES.includes(r));
export const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

const PROFILE_COLS = "id,government_ids,payroll_account,emergency_contact,birth_date,sex,civil_status,address,mobile,personal_email,employment_type,biometric_id,regularization_date,fit_to_work_on,fit_to_work_pending_on,fit_to_work_uploaded_at,biodata_confirmed_at,profile_id,work_email";
export type Hr201 = { id: string; government_ids?: { tin?: string | null; sss?: string | null; philhealth?: string | null; pagibig?: string | null } | null; payroll_account?: { method?: string | null; account?: string | null; days_factor?: number | null; allowance_centavos?: number | null } | null; emergency_contact?: { name?: string | null; relation?: string | null; mobile?: string | null } | null; birth_date: string | null; sex: string | null; civil_status: string | null; address: string | null; mobile: string | null; personal_email: string | null; employment_type: string | null; biometric_id: string | null; regularization_date: string | null; fit_to_work_on: string | null; fit_to_work_pending_on: string | null; fit_to_work_uploaded_at: string | null; biodata_confirmed_at: string | null; profile_id?: string | null; work_email?: string | null };

export async function hrSettings(db: Admin): Promise<HrSettings> {
  const { data } = await db.from("hr_settings").select("fit_to_work_months,biodata_months,first_reminder_days,repeat_days,include_in_daily_email").eq("id", true).maybeSingle();
  return (data as HrSettings | null) ?? HR_DEFAULTS;
}

/** HR and Admin: every employee's 201 extras, memos with acknowledgments, open 201 change requests, settings, last reminders. Empty before migration 095. */
export async function loadHrExtras(db: Admin) {
  const [p, memos, rec, reqs, settings, rem] = await Promise.all([
    db.from("employees").select(PROFILE_COLS),
    db.from("memos").select("id,memo_no,memo_type,subject,body,audience,issued_at").order("issued_at", { ascending: false }).limit(60),
    db.from("memo_recipients").select("memo_id,employee_id,acknowledged_at").limit(3000),
    db.from("hr_requests").select("id,request_no,employee_id,request_type,details,status,decision_remarks,created_at,decided_at").order("created_at", { ascending: false }).limit(200),
    hrSettings(db),
    db.from("hr_reminders").select("employee_id,reminder_type,sent_at").order("sent_at", { ascending: false }).limit(500),
  ]);
  if (p.error) return null;
  const [tpl, coes] = await Promise.all([
    db.from("hr_document_templates").select("doc_type,version,body,signatories,created_at").order("version", { ascending: false }).limit(60),
    db.from("coe_requests").select("id,employee_id,purpose,status,requested_at,completed_at,coe_no,drive_link").order("requested_at", { ascending: false }).limit(200),
  ]);
  const templates: Record<string, unknown> = {};
  for (const t of tpl.data ?? []) if (!templates[t.doc_type as string]) templates[t.doc_type as string] = t;
  const lastReminder: Record<string, string> = {};
  for (const r of rem.data ?? []) { const k = `${r.employee_id}:${r.reminder_type}`; if (!lastReminder[k]) lastReminder[k] = r.sent_at as string; }
  return { profiles: (p.data ?? []) as Hr201[], memos: memos.data ?? [], memoRecipients: rec.data ?? [], requests: reqs.data ?? [], settings, lastReminder, templates, coes: coes.error ? [] : coes.data ?? [] };
}

/** MyHR: the employee's own 201 extras, memos, and requests. */
export async function loadMyHrExtras(db: Admin, employeeId: string) {
  const [p, rec, reqs, settings, coes] = await Promise.all([
    db.from("employees").select(PROFILE_COLS).eq("id", employeeId).maybeSingle(),
    db.from("memo_recipients").select("memo_id,acknowledged_at,memos(id,memo_no,memo_type,subject,body,issued_at)").eq("employee_id", employeeId).limit(100),
    db.from("hr_requests").select("id,request_no,request_type,details,status,decision_remarks,created_at").eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(50),
    hrSettings(db),
    db.from("coe_requests").select("id,purpose,status,requested_at,completed_at,coe_no").eq("employee_id", employeeId).order("requested_at", { ascending: false }).limit(30),
  ]);
  if (p.error) return null;
  const memos = (rec.data ?? []).map((r) => { const m = (Array.isArray(r.memos) ? r.memos[0] : r.memos) as Record<string, unknown> | null; return m ? { ...m, acknowledged_at: r.acknowledged_at } : null; }).filter(Boolean)
    .sort((a, b) => String((b as unknown as { issued_at: string }).issued_at).localeCompare(String((a as unknown as { issued_at: string }).issued_at)));
  return { profile: p.data as Hr201 | null, memos, requests: reqs.data ?? [], settings, coes: coes.error ? [] : coes.data ?? [] };
}

/** The portal account behind an employee: the linked profile, else the profile with the same work e-mail. */
export async function employeeAccounts(db: Admin, ids: string[]) {
  const { data: emps } = await db.from("employees").select("id,complete_name,profile_id,work_email").in("id", ids);
  const emails = (emps ?? []).filter((e) => !e.profile_id && e.work_email).map((e) => String(e.work_email).toLowerCase());
  const { data: profs } = emails.length ? await db.from("profiles").select("id,email").in("email", emails) : { data: [] as { id: string; email: string }[] };
  const byEmail = new Map((profs ?? []).map((p) => [String(p.email).toLowerCase(), p.id as string]));
  return (emps ?? []).map((e) => ({ id: e.id as string, name: e.complete_name as string, email: (e.work_email as string | null) ?? null, profileId: (e.profile_id as string | null) ?? byEmail.get(String(e.work_email ?? "").toLowerCase()) ?? null }));
}

/** In-app notification plus e-mail (when e-mail is set up) to each employee. Best effort: a failed e-mail never blocks the action. */
export async function notifyEmployees(db: Admin, people: Awaited<ReturnType<typeof employeeAccounts>>, msg: { type: string; title: string; body: string; key: string; origin?: string; recordType?: string; recordId?: string }) {
  const rows = people.filter((p) => p.profileId).map((p) => ({ recipient_id: p.profileId, notification_type: msg.type, title: msg.title, body: msg.body, related_record_type: msg.recordType ?? "employee", related_record_id: msg.recordId ?? p.id, deep_link: "/portal#myhr" }));
  if (rows.length) await db.from("notifications").insert(rows).then(({ error }) => { if (error) console.error("HR notification failed:", error.message); });
  if (!emailConfigured()) return;
  const ids: string[] = [];
  const link = `${msg.origin ?? "https://newwavemaritimemtaci.com"}/portal`;
  for (const p of people.filter((x) => x.email)) {
    const { data: job } = await db.from("email_jobs").insert({ idempotency_key: `${msg.key}:${p.id}`, template_code: "hr.notice", recipient: p.email, variables: { subject: msg.title, name: p.name, link, body_html: `<p style="margin:0">${escapeHtml(msg.body)}</p>`, body_text: msg.body } }).select("id").maybeSingle();
    if (job?.id) ids.push(job.id as string);
  }
  if (ids.length) await processEmailJobs(db, { ids, origin: msg.origin }).catch((e) => console.error("HR e-mail failed:", e instanceof Error ? e.message : e));
}

/** Staff holding the HR role (or the Admin when nobody does) get HR's in-app notices. */
export async function notifyHr(db: Admin, title: string, body: string, recordType: string, recordId: string) {
  const { data } = await db.from("user_roles").select("user_id,roles!inner(code)").in("roles.code", ["hr", "admin"]);
  const rows = (data ?? []) as unknown as { user_id: string; roles: { code: string } | { code: string }[] }[];
  const code = (r: (typeof rows)[number]) => (Array.isArray(r.roles) ? r.roles[0]?.code : r.roles?.code);
  const hr = rows.filter((r) => code(r) === "hr"), to = [...new Set((hr.length ? hr : rows).map((r) => r.user_id))];
  if (to.length) await db.from("notifications").insert(to.map((id) => ({ recipient_id: id, notification_type: "hr", title, body, related_record_type: recordType, related_record_id: recordId, deep_link: "/portal#hr" }))).then(({ error }) => { if (error) console.error("HR notice failed:", error.message); });
}

/** HR section of the 8:00 PM owner e-mail: Fit to Work and Biodata overdue, missing, waiting for checking, or due within the reminder window. */
export async function hrDailySection(db: Admin) {
  const [settings, emps] = await Promise.all([hrSettings(db), db.from("employees").select("id,employee_number,complete_name,active,fit_to_work_on,fit_to_work_pending_on,biodata_confirmed_at")]);
  if (emps.error || !settings.include_in_daily_email) return { html: "", text: "" };
  const items = needsAction(hrDueItems((emps.data ?? []) as Parameters<typeof hrDueItems>[0], settings, manilaToday()));
  const head = `<tr><td colspan="3" style="padding:12px 8px 4px;font-weight:700;color:#0571D0;font-size:12px;letter-spacing:.06em;text-transform:uppercase">HR · Six-Month Checks</td></tr>`;
  const row = (i: (typeof items)[number]) => `<tr><td style="padding:6px 8px;border-top:1px solid #e3ecf0">${escapeHtml(i.name)}</td><td style="padding:6px 8px;border-top:1px solid #e3ecf0">${KIND_LABEL[i.kind]}</td><td style="padding:6px 8px;border-top:1px solid #e3ecf0;text-align:right;font-weight:700;color:${i.state === "Overdue" || i.state === "Missing" ? "#B42318" : "#B4400C"}">${dueLabel(i)}</td></tr>`;
  const html = `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:8px">${head}${items.length ? items.map(row).join("") : `<tr><td colspan="3" style="padding:6px 8px;border-top:1px solid #e3ecf0;color:#5b7587">Everyone is up to date.</td></tr>`}</table>`;
  const text = `\nHR · SIX-MONTH CHECKS\n${items.length ? items.map((i) => `- ${i.name}: ${KIND_LABEL[i.kind]} · ${dueLabel(i)}`).join("\n") : "- Everyone is up to date."}`;
  return { html, text };
}

/**
 * Automatic reminders, run with the 8:00 PM job: each employee whose Fit to Work or Biodata is
 * due soon, overdue or missing gets a reminder, then again every `repeat_days` until it is done.
 */
export async function sendAutoReminders(db: Admin, origin?: string) {
  const [settings, emps, rem] = await Promise.all([
    hrSettings(db),
    db.from("employees").select("id,employee_number,complete_name,active,fit_to_work_on,fit_to_work_pending_on,biodata_confirmed_at"),
    db.from("hr_reminders").select("employee_id,reminder_type,sent_at").order("sent_at", { ascending: false }).limit(2000),
  ]);
  if (emps.error) return { sent: 0 };
  const today = manilaToday(), last = new Map<string, string>();
  for (const r of rem.data ?? []) { const k = `${r.employee_id}:${r.reminder_type}`; if (!last.has(k)) last.set(k, manilaDate(r.sent_at as string)); }
  const items = needsAction(hrDueItems((emps.data ?? []) as Parameters<typeof hrDueItems>[0], settings, today)).filter((i) => i.state !== "For Checking");
  let sent = 0;
  for (const kind of ["fit", "biodata"] as const) {
    const type = kind === "fit" ? "fit_to_work" : "biodata";
    const ids = items.filter((i) => i.kind === kind).filter((i) => { const prev = last.get(`${i.employeeId}:${type}`); return !prev || daysBetween(prev, today) >= settings.repeat_days; }).map((i) => i.employeeId);
    if (!ids.length) continue;
    const people = await employeeAccounts(db, ids);
    await db.from("hr_reminders").insert(people.map((p) => ({ employee_id: p.id, reminder_type: type, sent_by: null })));
    await notifyEmployees(db, people, {
      type: "hr", origin, key: `auto-remind:${type}:${today}`,
      title: kind === "fit" ? "Medical Fit to Work Due" : "Please Review Your Biodata",
      body: kind === "fit" ? "Your semi-annual Medical Fit to Work is due. Upload your new certificate in MyHR › My 201." : "Your semi-annual biodata review is due. Open MyHR › My 201, check your details, then tap Confirm No Changes or Request a Change.",
    });
    sent += people.length;
  }
  return { sent };
}

/** The newest saved version of an HR document template (seeded by migration 202611100096). */
export async function latestTemplate(db: Admin, docType: "coe" | "nte" | "memo") {
  const { data } = await db.from("hr_document_templates").select("version,body,signatories").eq("doc_type", docType).order("version", { ascending: false }).limit(1).maybeSingle();
  return data as { version: number; body: string; signatories: { label: string; name: string; title: string }[] } | null;
}

/** COE wording for an employee: the template with its fields filled from the 201. */
export function coeFields(e: { complete_name: string; position: string; date_hired: string; active: boolean; sex?: string | null; employment_type?: string | null }, purpose: string, issuedOn: string) {
  const title = e.sex === "Female" ? "Ms." : e.sex === "Male" ? "Mr." : "";
  const [last] = e.complete_name.split(",");
  return {
    employee_name: e.complete_name.toUpperCase(), title, last_name: (last ?? e.complete_name).trim(), position: e.position,
    date_hired: longDate(e.date_hired), date_until: e.active ? "the present" : "the date of separation",
    employment_type: (e.employment_type ?? "regular").toLowerCase(), purpose, date_issued: dayOf(issuedOn),
  };
}

/** Best-effort copy in Google Drive: New Wave HR / {folder} / {year}. Never throws. */
export async function fileHrDocument(db: Admin, folder: "Certificates of Employment" | "Memorandums", base: string, bytes: Uint8Array) {
  try {
    const year = manilaToday().slice(0, 4), key = folder === "Memorandums" ? "hr/memos" : "hr/coe";
    const r = await fileInDrive(db, { rootKey: "hr", rootName: "New Wave HR", folders: [{ key, name: folder }, { key: `${key}/${year}`, name: year }], base, ext: "pdf", mime: "application/pdf", bytes });
    return r.link;
  } catch (e) { console.error("HR Drive filing failed:", e instanceof Error ? e.message : e); return null; }
}

/** The PDF bytes for an HR document snapshot, with the form's Form Numbers and the emblem. */
export async function hrPdf(db: Admin, doc: HrDocSnapshot) {
  const emblem = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((x) => new Uint8Array(x)).catch(() => undefined);
  return buildHrDocumentPdf(doc, await loadDocumentControl(db, doc.type), emblem);
}
