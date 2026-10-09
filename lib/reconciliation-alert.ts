import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";
import { manilaDay } from "@/lib/reconciliation";
import { loadOverdue } from "@/lib/reconciliation-server";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const peso = (c: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(c / 100);
const shortDate = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));

/** Active Accounting Manager email addresses. */
async function accountingRecipients(db: Admin) {
  const { data } = await db.from("user_roles").select("profiles!inner(email,account_state),roles!inner(code)").eq("roles.code", "accounting");
  const emails = new Set<string>();
  for (const row of data ?? []) {
    const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { email?: string; account_state?: string } | null;
    if (profile?.email && profile.account_state !== "Suspended" && profile.account_state !== "Deactivated") emails.add(profile.email.toLowerCase());
  }
  return [...emails];
}

/**
 * Daily reconciliation reminder (owner, 9 Oct 2026), sent with the 4:00 PM run:
 * one email to each Accounting Manager when GCash, PSBank or UnionBank payments
 * from earlier days are still not reconciled. Idempotent per day and recipient.
 */
export async function sendReconciliationReminder(db: Admin, options: { origin?: string } = {}) {
  if (!emailConfigured()) return { configured: false, recipients: 0, payments: 0 };
  const today = manilaDay(new Date().toISOString());
  const overdue = await loadOverdue(db, today);
  const count = overdue.reduce((s, c) => s + c.count, 0);
  if (!count) return { configured: true, recipients: 0, payments: 0 };
  const total = overdue.reduce((s, c) => s + c.total, 0);
  const oldest = overdue.flatMap((c) => c.days.map((d) => d.day)).sort()[0];
  const lines = overdue.flatMap((c) => c.days.map((d) => ({ channel: c.channel, ...d })));
  const rowsHtml = `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f8fc;color:#5b7587;text-align:left"><th style="padding:7px 8px">Day</th><th style="padding:7px 8px">Channel</th><th style="padding:7px 8px">Not reconciled</th><th style="padding:7px 8px;text-align:right">Amount</th></tr></thead><tbody>${lines.map((d) => `<tr style="border-top:1px solid #e5edf2"><td style="padding:7px 8px">${shortDate(d.day)}</td><td style="padding:7px 8px">${d.channel}</td><td style="padding:7px 8px">${d.count}</td><td style="padding:7px 8px;text-align:right">${peso(d.total)}</td></tr>`).join("")}</tbody></table>`;
  const rowsText = lines.map((d) => `- ${shortDate(d.day)} ${d.channel}: ${d.count} payment(s), ${peso(d.total)}`).join("\n");
  const ids: string[] = [];
  for (const to of await accountingRecipients(db)) {
    const { data: job } = await db.from("email_jobs").insert({
      idempotency_key: `reconciliation-reminder:${today}:${to}`, template_code: "reconciliation.unreconciled", recipient: to,
      variables: { date: shortDate(today), count, total: peso(total), oldest: shortDate(oldest), rows_html: rowsHtml, rows_text: rowsText },
    }).select("id").maybeSingle();
    if (job?.id) ids.push(job.id);
  }
  if (ids.length) await processEmailJobs(db, { ids, origin: options.origin });
  return { configured: true, recipients: ids.length, payments: count };
}
