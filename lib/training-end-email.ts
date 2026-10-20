import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/classroom";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";
import { loadInstructionDetails } from "@/lib/training-instructions";
import { automaticEndDate } from "@/lib/scheduling";
import { loadPostTest } from "@/lib/post-test-server";
import { passMark } from "@/lib/post-test";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

export type TrainingEndInput = {
  firstName: string; traineeName: string; nwmtaciNo: string; courseName: string; courseCode: string; dates: string; time: string; mode: string; batch: string;
  postTest: { url: string; passingPercent: number; total: number } | null; evaluationUrl: string | null;
};

/**
 * The end-of-training email (owner's Option B, 20 Oct 2026): the training details,
 * then the post-test and the evaluation, each shown only while still to do.
 */
export function trainingEndBody(d: TrainingEndInput) {
  const e = escapeHtml;
  const row = (k: string, v: string) => `<tr><td style="padding:7px 10px;border-top:1px solid #e3ecf0;color:#5b7587;width:38%">${e(k)}</td><td style="padding:7px 10px;border-top:1px solid #e3ecf0">${v}</td></tr>`;
  const btn = (href: string, label: string, color: string) => `<a href="${e(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700">${e(label)}</a>`;
  const box = (title: string, inner: string, accent = "#dbe7ec") => `<div style="border:1px solid ${accent};border-radius:10px;padding:14px 16px;margin:0 0 14px"><h3 style="margin:0 0 6px;font-size:15px;color:#123F63">${e(title)}</h3>${inner}</div>`;
  const details = `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 16px">${[
    row("Trainee", `<b>${e(d.traineeName)}</b>`), row("NWMTACI No.", e(d.nwmtaciNo)), row("Course", `<b>${e(d.courseName)}</b>${d.courseCode ? ` (${e(d.courseCode)})` : ""}`),
    row("Training Dates", e(d.dates)), row("Time", e(d.time)), row("Mode", e(d.mode)), ...(d.batch ? [row("Batch", e(d.batch))] : []),
  ].join("")}</table>`;
  const post = d.postTest ? box("Post-Test", `<p style="margin:0 0 12px">Answer ${d.postTest.total} questions about the course. You pass with <b>${d.postTest.passingPercent}% (${passMark(d.postTest.total, d.postTest.passingPercent)} correct)</b>. If you do not pass, you can take it again; there is no limit on retakes.</p><p style="margin:0 0 10px">${btn(d.postTest.url, "Take the Post-Test", "#F25615")}</p><p style="margin:0;font-size:12.5px;color:#5b7587">This link is for you only. Do not share it.</p>`, "#F25615") : "";
  const evaluation = d.evaluationUrl ? box("Training Evaluation", `<p style="margin:0 0 12px">Tell us how the training went. It takes about 3 minutes.</p><p style="margin:0">${btn(d.evaluationUrl, "Evaluate the Training", "#0571D0")}</p>`) : "";
  const steps = [d.postTest && "post-test", d.evaluationUrl && "training evaluation"].filter(Boolean).join(" and ");
  // How to get to each one (owner, 20 Oct 2026), including the way back in without this email.
  const howItems = [
    ...(d.postTest ? [`<b>Post-test:</b> click <b>Take the Post-Test</b>. It opens on your phone or computer; no login is needed. Answer all ${d.postTest.total} questions, then click <b>Submit Answers</b>. Your score shows right away. If it is below ${d.postTest.passingPercent}%, click <b>Retake the Test</b> and try again.`] : []),
    ...(d.evaluationUrl ? [`<b>Evaluation:</b> click <b>Evaluate the Training</b>. Tick <b>Confirm</b> for attendance, rate each item from Excellent to Poor, write your comments and suggestions, then click <b>Submit Evaluation</b>.`] : []),
    `<b>Lost this email?</b> Go to <a href="https://newwavemaritimemtaci.com/registration-search" style="color:#0571D0">newwavemaritimemtaci.com/registration-search</a>, enter your <b>SRN</b> and <b>NWMTACI No.</b> (${e(d.nwmtaciNo)}), then click ${[d.postTest && "<b>Take Post-Test</b>", d.evaluationUrl && "<b>Evaluate Training</b>"].filter(Boolean).join(" or ")}.`,
    `<b>Need help?</b> Call or text 0948 847 6530, or email newwavemaritime@gmail.com.`,
  ];
  const how = box(`How to Take the ${d.postTest && d.evaluationUrl ? "Post-Test and Evaluation" : d.postTest ? "Post-Test" : "Evaluation"}`, `<ol style="margin:0;padding-left:20px">${howItems.map((x) => `<li style="margin:0 0 8px">${x}</li>`).join("")}</ol>`, "#9EE3F1");
  const html = `<p style="margin:0 0 12px">Dear ${e(d.firstName || d.traineeName)},</p><p style="margin:0 0 12px">Your training has ended. Please complete your <b>${e(steps)}</b> so we can release your certificate.</p>${details}${post}${evaluation}${how}<p style="margin:0">Your certificate is released once your fee is settled${d.postTest ? ", your post-test is passed" : ""}${d.evaluationUrl ? " and your evaluation is submitted" : ""}.</p>`;
  const text = [`Dear ${d.firstName || d.traineeName},`, "", `Your training has ended. Please complete your ${steps} so we can release your certificate.`, "",
    `Course: ${d.courseName}${d.courseCode ? ` (${d.courseCode})` : ""}`, `Training Dates: ${d.dates}`, `NWMTACI No.: ${d.nwmtaciNo}`, "",
    ...(d.postTest ? [`Post-Test (pass with ${d.postTest.passingPercent}%, unlimited retakes): ${d.postTest.url}`] : []), ...(d.evaluationUrl ? [`Training Evaluation: ${d.evaluationUrl}`] : []),
    "", "How to take them: open each link on your phone or computer (no login needed), answer every item and submit. Lost this email? Go to newwavemaritimemtaci.com/registration-search and enter your SRN and NWMTACI No.",
    "", "New Wave Maritime Training and Assessment Center, Inc. · 0948 847 6530 · newwavemaritime@gmail.com"].join("\n");
  return { html, text, steps };
}

/** Queues (and sends) the end-of-training email for one enrollment; skipped when nothing is left to do. */
export async function sendTrainingEndEmail(db: Admin, enrollmentId: string, options: { origin: string; manual?: boolean }) {
  if (!emailConfigured()) return { state: "Not configured" as const };
  const { data: e } = await db.from("enrollments").select("id,feedback_token,partner_offer_id,enrollment_status,courses(id,code,name,delivery_type),trainees(legal_first_name,application_number,trainee_number)").eq("id", enrollmentId).maybeSingle();
  const c = first(e?.courses as unknown as { id: string; code: string; name: string; delivery_type: string } | null);
  if (!e || !c || e.partner_offer_id || c.delivery_type !== "In-House" || e.enrollment_status === "Cancelled" || !e.feedback_token) return { state: "Skipped" as const };
  const details = await loadInstructionDetails(db, enrollmentId);
  if (!details?.traineeEmail) return { state: "No email" as const };
  const [test, { data: fb }, { data: passed }] = await Promise.all([
    loadPostTest(db, c),
    db.from("training_feedback").select("id").eq("enrollment_id", enrollmentId).maybeSingle(),
    db.from("post_test_attempts").select("id").eq("enrollment_id", enrollmentId).eq("passed", true).limit(1),
  ]);
  const t = first(e.trainees as unknown as { legal_first_name: string; application_number: string | null; trainee_number: string | null } | null);
  const base = options.origin.replace(/\/+$/, "");
  const body = trainingEndBody({
    firstName: t?.legal_first_name ?? "", traineeName: details.traineeName, nwmtaciNo: t?.application_number ?? t?.trainee_number ?? "",
    courseName: c.name, courseCode: c.code, dates: details.dates, time: details.time, mode: details.mode, batch: details.batchNumber,
    postTest: test.approved && !(passed ?? []).length ? { url: `${base}/post-test/${e.feedback_token}`, passingPercent: test.passingPercent, total: test.questions.length } : null,
    evaluationUrl: fb ? null : `${base}/feedback/${e.feedback_token}`,
  });
  if (!body.steps) return { state: "Nothing to do" as const };
  const key = `training-end:${enrollmentId}${options.manual ? `:${Math.floor(Date.now() / 3_600_000)}` : ""}`;
  const { data: job, error } = await db.from("email_jobs").insert({ idempotency_key: key, template_code: "training.completion", recipient: details.traineeEmail, variables: { enrollment_id: enrollmentId, course_name: c.name, course_code: c.code, body_html: body.html, body_text: body.text } }).select("id").maybeSingle();
  if (error && error.code === "23505") return { state: "Already sent" as const, to: details.traineeEmail };
  if (error || !job) return { state: "Failed" as const, error: error?.message };
  await processEmailJobs(db, { ids: [job.id], origin: options.origin }).catch(() => undefined);
  return { state: "Sent" as const, to: details.traineeEmail };
}

/** 4:00 PM on the last training day: the end-of-training email to everyone whose training ends today. */
export async function sendTrainingEndEmails(db: Admin, options: { origin: string }) {
  const today = manilaToday();
  const since = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
  const { data: rows } = await db.from("enrollments").select("id,scheduled_on,batches(ends_on),courses(duration_label)").eq("enrollment_status", "Enrolled").is("partner_offer_id", null).gte("created_at", new Date(Date.now() - 180 * 86_400_000).toISOString()).limit(3000);
  const due = (rows ?? []).filter((r) => {
    const end = first(r.batches as unknown as { ends_on: string } | null)?.ends_on ?? (r.scheduled_on && r.scheduled_on >= since ? automaticEndDate(r.scheduled_on, first(r.courses as unknown as { duration_label: string } | null)?.duration_label ?? "1 day") : null);
    return end === today;
  });
  let sent = 0;
  for (const r of due) { const res = await sendTrainingEndEmail(db, r.id as string, options).catch(() => ({ state: "Failed" as const })); if (res.state === "Sent") sent++; }
  return { due: due.length, sent };
}
