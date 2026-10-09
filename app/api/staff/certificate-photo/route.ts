import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { photoFileName } from "@/lib/certificate-photo";
import { trySendSoftCopy } from "@/lib/certificates";

export const runtime = "nodejs";

/**
 * Certificate 2x2 photo (owner, 9 Oct 2026). The Releasing Officer uploads,
 * replaces or removes it (already resized in the browser to a 600 × 600 JPEG). The file is named after the portal's registered name,
 * course, batch and date.
 */
const MAX_BYTES = 1024 * 1024;
const id = z.string().uuid();
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

async function staffFor(roles: string[]) {
  const staff = await requireStaff();
  return staff && staff.roleCodes.some((r) => roles.includes(r)) ? staff : null;
}

/** Signed thumbnail link. */
export async function GET(request: Request) {
  const staff = await staffFor(["admin", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const enrollmentId = id.safeParse(new URL(request.url).searchParams.get("enrollmentId"));
  if (!enrollmentId.success) return NextResponse.json({ error: "Choose an enrollment." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: photo } = await db.from("certificate_photos").select("storage_path,file_name").eq("enrollment_id", enrollmentId.data).maybeSingle();
  if (!photo) return NextResponse.json({ url: null });
  const signed = await db.storage.from("certificate-photos").createSignedUrl(photo.storage_path, 300);
  return NextResponse.json({ url: signed.data?.signedUrl ?? null, fileName: photo.file_name });
}

export async function POST(request: Request) {
  const staff = await staffFor(["admin", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Only the Releasing Officer uploads certificate photos." }, { status: 403 });
  const isAdmin = staff.roleCodes.includes("admin");
  const form = await request.formData();
  const enrollmentId = id.safeParse(form.get("enrollmentId"));
  const file = form.get("file");
  if (!enrollmentId.success || !(file instanceof File)) return NextResponse.json({ error: "Choose the trainee and the photo." }, { status: 400 });
  if (form.get("confirmed") !== "true") return NextResponse.json({ error: "Confirm the photo has a white background and a white polo with collar." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return NextResponse.json({ error: "The photo must be a JPEG. Choose it again so the portal can resize it." }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "The photo is still larger than 1 MB. Choose it again so the portal can resize it." }, { status: 400 });
  const width = Number(form.get("width") ?? 0), height = Number(form.get("height") ?? 0);
  if (width && height && Math.abs(width - height) > Math.max(width, height) * 0.05) return NextResponse.json({ error: "The photo must be square (2x2)." }, { status: 400 });

  const db = createSupabaseAdminClient();
  const { data: prior, error: priorError } = await db.from("certificate_photos").select("storage_path,file_name").eq("enrollment_id", enrollmentId.data).maybeSingle();
  if (priorError) return NextResponse.json({ error: /certificate_photos/i.test(priorError.message) ? "Apply database update 202610090034 first." : priorError.message }, { status: 400 });

  // The name comes from the portal record, never from the uploaded file.
  const { data: e } = await db.from("enrollments").select("id,scheduled_on,trainees(legal_first_name,legal_middle_name,legal_last_name),courses(code),batches(batch_number,ends_on)").eq("id", enrollmentId.data).maybeSingle();
  if (!e) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  const t = one(e.trainees as unknown as { legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string } | null);
  const c = one(e.courses as unknown as { code: string } | null);
  const b = one(e.batches as unknown as { batch_number: string; ends_on: string } | null);
  const fileName = photoFileName({ lastName: t?.legal_last_name ?? "TRAINEE", firstName: t?.legal_first_name ?? "", middleName: t?.legal_middle_name, courseCode: c?.code ?? "COURSE", batchNumber: b?.batch_number ?? null, date: b?.ends_on ?? (e as { scheduled_on?: string | null }).scheduled_on ?? manilaDay() });
  // Storage keys must be plain ASCII (names may carry ñ or accents); the display name is kept on the row.
  const path = `${enrollmentId.data}/${Date.now()}-${fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/[^A-Za-z0-9 ,._()-]/g, "")}`;
  const up = await db.storage.from("certificate-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (up.error) return NextResponse.json({ error: /bucket/i.test(up.error.message) ? "Apply database update 202610090034 first." : up.error.message }, { status: 400 });
  const now = new Date().toISOString();
  const row: Record<string, unknown> & { background_white: boolean } = { enrollment_id: enrollmentId.data, storage_path: path, file_name: fileName, width: width || null, height: height || null, bytes: bytes.length, background_white: form.get("backgroundWhite") === "true", confirmed: true,
    ...(prior ? { replaced_by: staff.user.id, replaced_at: now } : { uploaded_by: staff.user.id, uploaded_at: now }) };
  const { error } = await db.from("certificate_photos").upsert(row);
  if (error) { await db.storage.from("certificate-photos").remove([path]); return NextResponse.json({ error: error.message }, { status: 400 }); }
  if (prior) await db.storage.from("certificate-photos").remove([prior.storage_path]);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: isAdmin ? "admin" : "releasing_officer", action: prior ? "certificate.photo_replaced" : "certificate.photo_uploaded", record_type: "enrollment", record_id: enrollmentId.data, prior_values: prior ? { file_name: prior.file_name } : null, new_values: { file_name: fileName, bytes: bytes.length, background_white: row.background_white } });
  // With the photo in, a certificate that was only waiting for it may now be emailed.
  await trySendSoftCopy(db, enrollmentId.data, { actor: staff.user.id });
  return NextResponse.json({ ok: true, fileName });
}

export async function DELETE(request: Request) {
  const staff = await staffFor(["admin", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Only the Releasing Officer can remove a photo." }, { status: 403 });
  const enrollmentId = id.safeParse(new URL(request.url).searchParams.get("enrollmentId"));
  if (!enrollmentId.success) return NextResponse.json({ error: "Choose an enrollment." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: prior } = await db.from("certificate_photos").select("storage_path,file_name").eq("enrollment_id", enrollmentId.data).maybeSingle();
  if (!prior) return NextResponse.json({ ok: true });
  const { error } = await db.from("certificate_photos").delete().eq("enrollment_id", enrollmentId.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await db.storage.from("certificate-photos").remove([prior.storage_path]);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes.includes("admin") ? "admin" : "releasing_officer", action: "certificate.photo_removed", record_type: "enrollment", record_id: enrollmentId.data, prior_values: { file_name: prior.file_name } });
  return NextResponse.json({ ok: true });
}
