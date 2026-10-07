import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/classroom";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";
import { trainingEnd, unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const peso = (c: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(c / 100);
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** Trainees whose training ended (or ends today) with a balance, read straight from the database. */
export async function loadUnpaidBalances(db: Admin, today: string) {
  const { data: rows } = await db.from("enrollments")
    .select("id,enrollment_number,trainee_id,course_id,enrollment_status,selling_price_centavos,scheduled_on,batches(ends_on,batch_number),trainees(legal_first_name,legal_middle_name,legal_last_name,trainee_number),courses(name,code,duration_label)")
    .neq("enrollment_status", "Cancelled").order("created_at", { ascending: false }).limit(5000);
  const enrollments = (rows ?? []) as unknown as (BalanceEnrollment & { courses?: { duration_label?: string } | { duration_label?: string }[] | null })[];
  const durationOf = (courseId: string) => { const e = enrollments.find((x) => x.course_id === courseId); const c = (Array.isArray(e?.courses) ? e?.courses[0] : e?.courses) as { duration_label?: string } | null | undefined; return c?.duration_label ?? "1"; };
  // Only enrollments whose training has ended need their money loaded.
  const candidates = enrollments.filter((e) => { const end = trainingEnd(e, durationOf); return !!end && end <= today; });
  const ids = candidates.map((e) => e.id);
  const paid = new Map<string, number>(), charges = new Map<string, number>(), discounts = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [allocations, adjustments] = await Promise.all([
      db.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", chunk).eq("payments.valid", true),
      db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", chunk).eq("valid", true),
    ]);
    for (const a of allocations.data ?? []) paid.set(a.enrollment_id, (paid.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
    for (const c of adjustments.data ?? []) { const target = c.event_type === "discount" ? discounts : charges; target.set(c.enrollment_id, (target.get(c.enrollment_id) ?? 0) + Number(c.amount_centavos)); }
  }
  return unpaidAfterTraining(candidates.map((e) => ({ ...e, paid_centavos: paid.get(e.id) ?? 0, charges_centavos: charges.get(e.id) ?? 0, discounts_centavos: discounts.get(e.id) ?? 0 })), durationOf, today);
}

/** Active Cashier and Accounting staff email addresses. */
async function summaryRecipients(db: Admin) {
  const { data } = await db.from("user_roles").select("profiles!inner(email,account_state),roles!inner(code)").in("roles.code", ["cashier", "accounting"]);
  const emails = new Set<string>();
  for (const row of data ?? []) {
    const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { email?: string; account_state?: string } | null;
    if (profile?.email && profile.account_state !== "Suspended" && profile.account_state !== "Deactivated") emails.add(profile.email.toLowerCase());
  }
  return [...emails];
}

/**
 * The 4:00 PM unpaid-balance summary: one email to each Cashier and Accounting
 * Manager. The daily run is idempotent per day and recipient; "Email Summary
 * Now" from the dashboard always sends a fresh copy.
 */
export async function sendBalanceSummary(db: Admin, options: { origin?: string; manual?: boolean } = {}) {
  if (!emailConfigured()) return { configured: false, recipients: 0, rows: 0 };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const rows = await loadUnpaidBalances(db, today);
  const total = rows.reduce((s, r) => s + r.balanceCentavos, 0);
  const rowsHtml = rows.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f8fc;color:#5b7587;text-align:left"><th style="padding:7px 8px">Trainee</th><th style="padding:7px 8px">Course</th><th style="padding:7px 8px">Training end</th><th style="padding:7px 8px;text-align:right">Due</th><th style="padding:7px 8px;text-align:right">Paid</th><th style="padding:7px 8px;text-align:right">Balance</th></tr></thead><tbody>${rows.map((r) => `<tr style="border-top:1px solid #e3edf2"><td style="padding:7px 8px"><b>${escapeHtml(r.traineeName)}</b><br><span style="color:#5b7587">${escapeHtml(r.enrollmentNumber)}</span></td><td style="padding:7px 8px">${escapeHtml(r.course)}</td><td style="padding:7px 8px">${r.endsToday ? "Today" : shortDate(r.trainingEnd)}</td><td style="padding:7px 8px;text-align:right">${peso(r.dueCentavos)}</td><td style="padding:7px 8px;text-align:right">${peso(r.paidCentavos)}</td><td style="padding:7px 8px;text-align:right;color:#c8440e;font-weight:700">${peso(r.balanceCentavos)}</td></tr>`).join("")}</tbody></table>`
    : `<p style="font-size:14px;color:#0a6a33">No unpaid balances after training today.</p>`;
  const rowsText = rows.map((r) => `- ${r.traineeName} (${r.enrollmentNumber}) ${r.course}, training ${r.endsToday ? "ends today" : `ended ${shortDate(r.trainingEnd)}`}: balance ${peso(r.balanceCentavos)}`).join("\n") || "No unpaid balances after training today.";
  const recipients = await summaryRecipients(db);
  const stamp = options.manual ? `:manual:${Date.now()}` : "";
  const ids: string[] = [];
  for (const to of recipients) {
    const { data: job } = await db.from("email_jobs").insert({
      idempotency_key: `balance-summary:${today}:${to}${stamp}`, template_code: "cashier.balance.summary", recipient: to,
      variables: { date: shortDate(today), count: rows.length, total: peso(total), rows_html: rowsHtml, rows_text: rowsText },
    }).select("id").maybeSingle();
    if (job?.id) ids.push(job.id);
  }
  if (ids.length) await processEmailJobs(db, { ids, origin: options.origin });
  return { configured: true, recipients: ids.length, rows: rows.length };
}
