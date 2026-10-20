import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/classroom";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";
import { certificateContext } from "@/lib/certificates";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ReportPrint = { certNo: string; by: string; at: string; print: number; balanceCentavos: number };
export type ReportRevoke = { certNo: string; by: string; reason: string };
export type ReportScan = { certNo: string | null; result: string; ipHash: string | null };

const manilaHour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
const clock = (iso: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * The 8:00 PM owner report (owner's QR plan, 20 Oct 2026): prints, reprints and
 * revocations with who did them, the exceptions to look at, and QR scan activity.
 * Reprints before 8 AM or from 6 PM count as after hours.
 */
export function summarizeCertificateDay(input: { prints: ReportPrint[]; revokes: ReportRevoke[]; directSql: number; scans: ReportScan[] }) {
  const originals = input.prints.filter((p) => p.print <= 1), reprints = input.prints.filter((p) => p.print > 1);
  const byPerson = new Map<string, number>();
  for (const p of input.prints) byPerson.set(p.by, (byPerson.get(p.by) ?? 0) + 1);
  const unpaid = input.prints.filter((p) => p.balanceCentavos > 0);
  const afterHours = reprints.filter((p) => { const h = manilaHour(p.at); return h < 8 || h >= 18; });
  const devices = new Map<string, Set<string>>();
  for (const s of input.scans) if (s.certNo && s.ipHash) devices.set(s.certNo, (devices.get(s.certNo) ?? new Set()).add(s.ipHash));
  const spread = [...devices].filter(([, d]) => d.size >= 3).map(([certNo, d]) => ({ certNo, devices: d.size }));
  return {
    printed: originals.length, reprinted: reprints.length, revoked: input.revokes.length,
    printedBy: [...byPerson].map(([by, n]) => `${by} (${n})`),
    reprints: reprints.map((p) => `${p.certNo} · copy ${p.print} · ${clock(p.at)} · ${p.by}`),
    revokes: input.revokes.map((r) => `${r.certNo} · ${r.by}${r.reason ? ` · ${r.reason}` : ""}`),
    unpaid: unpaid.map((p) => p.certNo), directSql: input.directSql, afterHours: afterHours.map((p) => `${p.certNo} · ${clock(p.at)}`),
    scans: input.scans.length, notFound: input.scans.filter((s) => s.result === "not_found").length, spread,
  };
}

function render(s: ReturnType<typeof summarizeCertificateDay>) {
  const rows: [string, string | number, string][] = [
    ["Printed", s.printed, s.printedBy.join(", ")], ["Reprinted", s.reprinted, s.reprints.join("; ")], ["Revoked", s.revoked, s.revokes.join("; ")],
    ["Printed with a balance", s.unpaid.length, s.unpaid.join(", ")], ["Direct database changes", s.directSql, s.directSql ? "See the audit log (certificate.direct_sql)" : ""],
    ["Reprints before 8 AM or after 6 PM", s.afterHours.length, s.afterHours.join("; ")],
    ["QR scans", s.scans, ""], ["Codes not found", s.notFound, ""], ["Scanned from 3+ devices", s.spread.length, s.spread.map((x) => `${x.certNo} (${x.devices} devices)`).join(", ")],
  ];
  const head = (t: string) => `<tr><td colspan="3" style="padding:12px 8px 4px;font-weight:700;color:#0571D0;font-size:12px;letter-spacing:.06em;text-transform:uppercase">${t}</td></tr>`;
  const row = ([label, n, note]: [string, string | number, string]) => `<tr><td style="padding:6px 8px;border-top:1px solid #e3ecf0">${escapeHtml(label)}</td><td style="padding:6px 8px;border-top:1px solid #e3ecf0;text-align:right;font-weight:700${Number(n) && /balance|Direct|after|3\+/.test(label) ? ";color:#b42318" : ""}">${n}</td><td style="padding:6px 8px;border-top:1px solid #e3ecf0;color:#5b7587">${escapeHtml(note)}</td></tr>`;
  const html = `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13.5px">${head("Today")}${rows.slice(0, 3).map(row).join("")}${head("Exceptions")}${rows.slice(3, 6).map(row).join("")}${head("QR Scans")}${rows.slice(6).map(row).join("")}</table>`;
  const text = rows.map(([l, n, note]) => `- ${l}: ${n}${note ? ` (${note})` : ""}`).join("\n");
  return { html, text };
}

/** Active Admin email addresses (the owner holds the Admin role). */
async function adminRecipients(db: Admin) {
  const { data } = await db.from("user_roles").select("profiles!inner(email,account_state),roles!inner(code)").eq("roles.code", "admin");
  const emails = new Set<string>();
  for (const row of data ?? []) {
    const p = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { email?: string; account_state?: string } | null;
    if (p?.email && p.account_state !== "Suspended" && p.account_state !== "Deactivated") emails.add(p.email.toLowerCase());
  }
  return [...emails];
}

export async function sendCertificateReport(db: Admin, options: { origin?: string } = {}) {
  if (!emailConfigured()) return { configured: false, recipients: 0 };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const from = new Date(`${today}T00:00:00+08:00`).toISOString(), to = new Date(new Date(from).getTime() + 86_400_000).toISOString();
  const { data: logs } = await db.from("audit_logs").select("actor_id,action,record_id,new_values,reason,created_at").in("action", ["certificate.printed", "certificate.revoked", "certificate.direct_sql"]).gte("created_at", from).lt("created_at", to).limit(2000);
  const certIds = [...new Set((logs ?? []).filter((l) => l.action !== "certificate.direct_sql").map((l) => l.record_id as string))];
  const actorIds = [...new Set((logs ?? []).map((l) => l.actor_id).filter(Boolean))] as string[];
  const [{ data: certs }, { data: people }, scansRes] = await Promise.all([
    certIds.length ? db.from("certificates").select("id,certificate_number,enrollment_id").in("id", certIds) : Promise.resolve({ data: [] as { id: string; certificate_number: string | null; enrollment_id: string }[] }),
    actorIds.length ? db.from("profiles").select("id,complete_name").in("id", actorIds) : Promise.resolve({ data: [] as { id: string; complete_name: string }[] }),
    db.from("certificate_scans").select("certificate_id,result,ip_hash").gte("scanned_at", from).lt("scanned_at", to).limit(5000),
  ]);
  const certById = new Map((certs ?? []).map((c) => [c.id as string, c]));
  const name = new Map((people ?? []).map((p) => [p.id as string, p.complete_name as string]));
  const balances = new Map<string, number>();
  for (const l of (logs ?? []).filter((x) => x.action === "certificate.printed")) {
    const c = certById.get(l.record_id as string);
    if (c && !balances.has(c.id)) balances.set(c.id, (await certificateContext(db, c.enrollment_id))?.balanceCentavos ?? 0);
  }
  const certNo = (id: string | null) => (id ? certById.get(id)?.certificate_number ?? null : null);
  const scanCerts = [...new Set((scansRes.error ? [] : scansRes.data ?? []).map((s) => s.certificate_id).filter(Boolean))] as string[];
  const missing = scanCerts.filter((id) => !certById.has(id));
  if (missing.length) for (const c of (await db.from("certificates").select("id,certificate_number,enrollment_id").in("id", missing)).data ?? []) certById.set(c.id, c);
  const summary = summarizeCertificateDay({
    prints: (logs ?? []).filter((l) => l.action === "certificate.printed").map((l) => ({ certNo: certNo(l.record_id as string) ?? "—", by: name.get(l.actor_id ?? "") ?? "Staff", at: l.created_at as string, print: Number((l.new_values as { print?: number } | null)?.print ?? 1), balanceCentavos: balances.get(l.record_id as string) ?? 0 })),
    revokes: (logs ?? []).filter((l) => l.action === "certificate.revoked").map((l) => ({ certNo: certNo(l.record_id as string) ?? "—", by: name.get(l.actor_id ?? "") ?? "Admin", reason: (l.reason as string | null) ?? "" })),
    directSql: (logs ?? []).filter((l) => l.action === "certificate.direct_sql").length,
    scans: (scansRes.error ? [] : scansRes.data ?? []).map((s) => ({ certNo: certNo(s.certificate_id as string | null), result: s.result as string, ipHash: s.ip_hash as string | null })),
  });
  const { html, text } = render(summary);
  const date = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date());
  const ids: string[] = [];
  for (const to of await adminRecipients(db)) {
    const { data: job } = await db.from("email_jobs").insert({ idempotency_key: `certificate-report:${today}:${to}`, template_code: "certificate.daily_report", recipient: to, variables: { date, printed: summary.printed, reprinted: summary.reprinted, revoked: summary.revoked, body_html: html, body_text: text } }).select("id").maybeSingle();
    if (job?.id) ids.push(job.id);
  }
  if (ids.length) await processEmailJobs(db, { ids, origin: options.origin });
  return { configured: true, recipients: ids.length, ...summary };
}
