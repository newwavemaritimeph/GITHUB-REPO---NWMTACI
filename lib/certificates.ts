import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { automaticEndDate } from "@/lib/scheduling";
import { certificateState, type CertificateView } from "@/lib/certificate-rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaDay = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : null);
export const manilaToday = () => manilaDay(new Date().toISOString())!;

export type CertificateContext = {
  enrollment: { id: string; enrollment_number: string; course_id: string; trainee_id: string; enrollment_status: string };
  trainee: { name: string; email: string | null };
  course: { id: string; name: string; code: string; evaluationFormId: string | null };
  batch: { starts_on: string | null; ends_on: string | null; batch_number: string | null };
  cert: { id: string; status: string; certificate_number: string | null; batch_label: string | null; print_count: number; reprints_allowed: number; void_status: string | null; soft_copy_sent_at: string | null; snapshot: Record<string, unknown> | null } | null;
  view: CertificateView;
  issuanceEnabled: boolean;
};

/**
 * Everything the rules need for one enrollment: training end, balance,
 * evaluation and the certificate row. Tolerant of databases without the
 * 202610080030 columns (they read as zero / empty).
 */
export async function certificateContext(db: Admin, enrollmentId: string): Promise<CertificateContext | null> {
  const { data: e } = await db.from("enrollments").select("id,enrollment_number,course_id,trainee_id,enrollment_status,selling_price_centavos,batch_id,batches(starts_on,ends_on,batch_number),courses(id,name,code,duration_label),trainees(legal_first_name,legal_middle_name,legal_last_name,email)").eq("id", enrollmentId).maybeSingle();
  if (!e) return null;
  const [{ data: extra }, { data: allocations }, { data: charges }, { data: feedback }, { data: settings }, certRes, formRes] = await Promise.all([
    db.from("enrollments").select("scheduled_on").eq("id", enrollmentId).maybeSingle(),
    db.from("payment_allocations").select("amount_centavos,payments(received_at,valid)").eq("enrollment_id", enrollmentId),
    db.from("enrollment_charges").select("amount_centavos,event_type").eq("enrollment_id", enrollmentId).eq("valid", true),
    db.from("training_feedback").select("submitted_at").eq("enrollment_id", enrollmentId).maybeSingle(),
    db.from("organization_settings").select("certificate_issuance_enabled").maybeSingle(),
    db.from("certificates").select("id,status,snapshot,certificate_number,batch_label,print_count,reprints_allowed,void_status,soft_copy_sent_at").eq("enrollment_id", enrollmentId).maybeSingle(),
    db.from("courses").select("evaluation_form_id").eq("id", e.course_id).maybeSingle(),
  ]);
  let cert = certRes.data as CertificateContext["cert"] | null;
  if (certRes.error) {
    const { data: basic } = await db.from("certificates").select("id,status,snapshot,reprint_count").eq("enrollment_id", enrollmentId).maybeSingle();
    cert = basic ? { id: basic.id, status: basic.status, snapshot: basic.snapshot as Record<string, unknown> | null, certificate_number: ((basic.snapshot as Record<string, unknown> | null)?.certificate_number as string) ?? null, batch_label: null, print_count: ["Printed", "Released"].includes(basic.status) ? 1 : 0, reprints_allowed: 0, void_status: null, soft_copy_sent_at: null } : null;
  }
  const b = first(e.batches as unknown as { starts_on: string; ends_on: string; batch_number: string } | null);
  const c = first(e.courses as unknown as { id: string; name: string; code: string; duration_label: string } | null);
  const t = first(e.trainees as unknown as { legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; email?: string | null } | null);
  const scheduled = (extra as { scheduled_on?: string | null } | null)?.scheduled_on ?? null;
  const trainingEnd = b?.ends_on ?? (scheduled && c ? automaticEndDate(scheduled, c.duration_label) : null);
  let paid = 0, lastPaid: string | null = null;
  for (const a of allocations ?? []) {
    const p = first(a.payments as unknown as { received_at: string; valid: boolean } | null);
    if (p && p.valid === false) continue;
    paid += Number(a.amount_centavos);
    const d = manilaDay(p?.received_at);
    if (d && (!lastPaid || d > lastPaid)) lastPaid = d;
  }
  let due = Number(e.selling_price_centavos ?? 0);
  for (const ch of charges ?? []) due += ch.event_type === "discount" ? -Number(ch.amount_centavos) : Number(ch.amount_centavos);
  const evaluationFormId = formRes.error ? null : ((formRes.data as { evaluation_form_id?: string | null } | null)?.evaluation_form_id ?? null);
  const view = certificateState({
    enrollmentStatus: e.enrollment_status, trainingEnd, balanceCentavos: Math.max(0, due - paid), evaluationRequired: !!evaluationFormId,
    evaluationOn: manilaDay((feedback as { submitted_at?: string } | null)?.submitted_at), paidOn: lastPaid,
    cert: cert ? { status: cert.status, printCount: Number(cert.print_count ?? 0), reprintsAllowed: Number(cert.reprints_allowed ?? 0), voidStatus: cert.void_status } : null,
  }, manilaToday());
  return {
    enrollment: { id: e.id, enrollment_number: e.enrollment_number, course_id: e.course_id, trainee_id: e.trainee_id, enrollment_status: e.enrollment_status },
    trainee: { name: t ? [t.legal_first_name, t.legal_middle_name, t.legal_last_name].filter(Boolean).join(" ") : "Trainee", email: t?.email ?? null },
    course: { id: c?.id ?? e.course_id, name: c?.name ?? "Course", code: c?.code ?? "", evaluationFormId },
    batch: { starts_on: b?.starts_on ?? scheduled, ends_on: trainingEnd, batch_number: b?.batch_number ?? null },
    cert, view, issuanceEnabled: Boolean((settings as { certificate_issuance_enabled?: boolean } | null)?.certificate_issuance_enabled),
  };
}

/** Creates the certificate row (status Ready to Print) when a due enrollment has none. */
export async function ensureCertificate(db: Admin, ctx: CertificateContext) {
  if (ctx.cert) return ctx.cert.id;
  const { data, error } = await db.from("certificates").insert({ enrollment_id: ctx.enrollment.id, status: "Ready to Print", snapshot: {} }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** Assigns the next Certificate No. from the Admin's series (once per certificate). */
export async function claimCertificateNumber(db: Admin, certificateId: string, actor: string | null) {
  const { data, error } = await db.rpc("claim_certificate_number", { target_certificate: certificateId, actor });
  if (error) throw new Error(error.message);
  return String(data);
}

/** The active template for a course: Drive link (cached in Storage by file ID) or an uploaded file. */
async function templateBytes(db: Admin, courseId: string) {
  const { data: tpl, error } = await db.from("certificate_templates").select("id,storage_path,drive_file_id,fields").eq("course_id", courseId).eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const row = error ? (await db.from("certificate_templates").select("id,storage_path,fields").eq("course_id", courseId).eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle()).data as { id: string; storage_path: string | null; drive_file_id?: string | null; fields?: unknown } | null : tpl as { id: string; storage_path: string | null; drive_file_id?: string | null; fields?: unknown } | null;
  if (!row) return null;
  if (row.drive_file_id) {
    const cachePath = `drive/${row.drive_file_id}`;
    const cached = await db.storage.from("certificate-templates").download(cachePath);
    if (!cached.error && cached.data) return { id: row.id, bytes: new Uint8Array(await cached.data.arrayBuffer()), fields: row.fields };
    const bytes = await downloadDriveFile(row.drive_file_id);
    await db.storage.from("certificate-templates").upload(cachePath, bytes, { contentType: isPdf(bytes) ? "application/pdf" : isPng(bytes) ? "image/png" : "image/jpeg", upsert: true });
    return { id: row.id, bytes, fields: row.fields };
  }
  if (!row.storage_path) return null;
  const file = await db.storage.from("certificate-templates").download(row.storage_path);
  if (file.error || !file.data) throw new Error("The certificate template file could not be read.");
  return { id: row.id, bytes: new Uint8Array(await file.data.arrayBuffer()), fields: row.fields };
}

/** Downloads a Drive file shared as "Anyone with the link can view". */
export async function downloadDriveFile(fileId: string) {
  const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`, { redirect: "follow", cache: "no-store" });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!res.ok || !(isPdf(bytes) || isPng(bytes) || isJpg(bytes))) throw new Error("Google Drive did not return the template. Share the file as \"Anyone with the link can view\" and use a PDF, PNG or JPEG.");
  return bytes;
}
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

const longDate = (d: string | null) => (d ? new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`)) : "");
const range = (a: string | null, b: string | null) => (!a ? longDate(b) : !b || a === b ? longDate(a) : `${longDate(a)} – ${longDate(b)}`);

/**
 * The certificate PDF: the course template with the trainee's name, course,
 * Certificate No., batch and dates. "preview" is watermarked and never counted;
 * "soft" is the emailed electronic copy.
 */
export async function buildCertificatePdf(db: Admin, ctx: CertificateContext, mode: "preview" | "print" | "soft") {
  const tpl = await templateBytes(db, ctx.course.id);
  if (!tpl) throw new Error("No certificate template is linked for this course yet. Add the Google Drive link in Templates.");
  const pdf = await PDFDocument.create();
  let page;
  if (isPdf(tpl.bytes)) {
    const src = await PDFDocument.load(tpl.bytes);
    const [copied] = await pdf.copyPages(src, [0]);
    page = pdf.addPage([copied.getWidth(), copied.getHeight()]);
    page.drawPage(await pdf.embedPage(copied), { x: 0, y: 0, width: copied.getWidth(), height: copied.getHeight() });
  } else {
    const image = isPng(tpl.bytes) ? await pdf.embedPng(tpl.bytes) : await pdf.embedJpg(tpl.bytes);
    page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  const W = page.getWidth(), H = page.getHeight();
  const f = (tpl.fields && !Array.isArray(tpl.fields) ? tpl.fields : {}) as { nameY?: number; nameSize?: number; lineY?: number };
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold), reg = await pdf.embedFont(StandardFonts.Helvetica);
  const centre = (text: string, y: number, size: number, font = reg, color = rgb(0.18, 0.25, 0.32)) => page.drawText(text, { x: (W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
  const nameY = H - (f.nameY ?? H * 0.42), nameSize = f.nameSize ?? Math.round(W / 26);
  centre(ctx.trainee.name.toUpperCase(), nameY, nameSize, bold, rgb(0.07, 0.25, 0.39));
  const lineY = f.lineY ? H - f.lineY : nameY - nameSize * 1.1;
  centre(ctx.course.name, lineY, Math.round(nameSize * 0.55), bold);
  const number = ctx.cert?.certificate_number ?? "";
  const meta = [number && `Certificate No. ${number}`, ctx.cert?.batch_label && `Batch ${ctx.cert.batch_label}`, ctx.batch.ends_on && `Conducted ${range(ctx.batch.starts_on, ctx.batch.ends_on)}`].filter(Boolean).join("   ·   ");
  if (meta) centre(meta, lineY - nameSize * 0.9, Math.round(nameSize * 0.42));
  centre(`Issued ${longDate(manilaToday())}`, lineY - nameSize * 1.55, Math.round(nameSize * 0.38));
  if (mode === "preview") {
    const text = "PREVIEW - NOT FOR RELEASE", size = Math.round(W / 14);
    page.drawText(text, { x: W * 0.12, y: H * 0.25, size, font: bold, color: rgb(0.71, 0.14, 0.09), opacity: 0.18, rotate: degrees(20) });
  }
  if (mode === "soft") page.drawText("Electronic copy", { x: 18, y: 14, size: 8, font: reg, color: rgb(0.45, 0.5, 0.55) });
  return pdf.save();
}

/**
 * Email the soft copy once: evaluation in (when the course has a form), fee
 * settled, training ended. Claims a number if needed. Never throws.
 */
export async function trySendSoftCopy(db: Admin, enrollmentId: string, options: { force?: boolean; actor?: string | null } = {}) {
  try {
    const ctx = await certificateContext(db, enrollmentId);
    if (!ctx || !ctx.trainee.email || !ctx.issuanceEnabled) return { state: "Skipped" as const };
    if (!["Due", "Printed", "Released"].includes(ctx.view.state)) return { state: "Skipped" as const };
    // Sent once the evaluation is in; without one it goes out only when asked from the screen.
    if (!options.force) {
      const { data: fb } = await db.from("training_feedback").select("id").eq("enrollment_id", enrollmentId).maybeSingle();
      if (!fb) return { state: "Skipped" as const };
    }
    if (ctx.cert?.soft_copy_sent_at && !options.force) return { state: "Already sent" as const };
    const certId = await ensureCertificate(db, ctx);
    const number = ctx.cert?.certificate_number ?? await claimCertificateNumber(db, certId, options.actor ?? null);
    const key = `certificate-softcopy:${certId}:${options.force ? Date.now() : "first"}`;
    const { data: job, error } = await db.from("email_jobs").insert({ template_code: "certificate.softcopy", recipient: ctx.trainee.email, idempotency_key: key, variables: { trainee_name: ctx.trainee.name, course_name: ctx.course.name, certificate_number: number, attach_certificate_for: enrollmentId } }).select("id").maybeSingle();
    if (error && error.code !== "23505") throw error;
    await db.from("certificates").update({ soft_copy_sent_at: new Date().toISOString() }).eq("id", certId);
    return { state: "Queued" as const, jobId: (job as { id?: string } | null)?.id ?? null, to: ctx.trainee.email };
  } catch (error) {
    return { state: "Failed" as const, error: error instanceof Error ? error.message : "Could not send the soft copy." };
  }
}
