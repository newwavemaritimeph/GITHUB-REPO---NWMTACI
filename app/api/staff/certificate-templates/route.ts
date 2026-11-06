import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { detectPhotoBox, hasPictureAt } from "@/lib/certificate-template";
import { autoLayout, type ReadLayout } from "@/lib/certificate-autolayout";
import { bundledLayout, templateLayout } from "@/lib/certificate-template-layouts";

export const runtime = "nodejs";

const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("template");
    const courseId = String(form.get("courseId") ?? "");
    if (!z.string().uuid().safeParse(courseId).success) return NextResponse.json({ error: "Pick a course." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a template file (PDF, PNG, or JPEG)." }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Use a PDF, PNG, or JPEG file." }, { status: 400 });
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "The file must be smaller than 50 MB." }, { status: 400 });
    // Accept a JSON array of {key,label} or a comma-separated list of labels.
    let fields: { key: string; label: string }[] | Record<string, unknown> = [];
    const rawFields = form.get("fields");
    if (rawFields) {
      const s = String(rawFields).trim();
      const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (s.startsWith("[")) { try { const arr = JSON.parse(s) as { key?: unknown; label?: unknown }[]; fields = arr.filter((f) => typeof f?.label === "string").map((f) => ({ key: String(f.key ?? slug(String(f.label))), label: String(f.label) })); } catch { fields = []; } }
      else fields = s.split(",").map((x) => x.trim()).filter(Boolean).map((label) => ({ key: slug(label), label }));
    }
    // Field positions measured from New Wave's Word templates (scripts/certificate-templates, 20 Oct 2026).
    const rawLayout = form.get("layout");
    if (rawLayout) {
      try { const layout = JSON.parse(String(rawLayout)) as { version?: unknown }; if (layout && layout.version === 2) fields = layout as Record<string, unknown>; else return NextResponse.json({ error: "The position file is not from the template converter." }, { status: 400 }); }
      catch { return NextResponse.json({ error: "The position file could not be read." }, { status: 400 }); }
    }

    const db = createSupabaseAdminClient();
    // Certificate templates are only for New Wave in-house courses (incl. STCW).
    // Endorsed / partner trainings are excluded — New Wave does not issue their certificates.
    const { data: course, error: courseError } = await db.from("courses").select("delivery_type,code").eq("id", courseId).maybeSingle();
    if (courseError) throw courseError;
    if (!course) return NextResponse.json({ error: "Course not found." }, { status: 404 });
    if (course.delivery_type !== "In-House") return NextResponse.json({ error: "Certificate templates are only for New Wave in-house courses, not endorsed/partner trainings." }, { status: 400 });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "template";
    const path = `${courseId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await db.storage.from("certificate-templates").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    // Read the positions from the PDF itself (owner, 5 Nov 2026), unless the upload came with its own measured ones.
    // A PDF that cannot be read still goes live, and the uploader is told.
    const bytes = file.type === "application/pdf" ? new Uint8Array(await file.arrayBuffer()) : null;
    const photoBox = bytes ? await detectPhotoBox(bytes) : null;
    let layout: Pick<ReadLayout, "found" | "missing" | "covered"> | null = null;
    if (bytes && !rawLayout) {
      const read = await autoLayout(bytes, { hasMeasuredLayout: !!bundledLayout(path) }).catch((error): ReadLayout => { console.error("Certificate template could not be read", error); return { fields: null, found: [], missing: ["Trainee Name", "Training Dates", "Issued Date", "Certificate No.", "Registration No."], lifted: [] }; });
      if (read) {
        layout = { found: read.found, missing: read.missing, covered: read.covered };
        (photoBox ? layout.found : layout.missing).push("Photo Box");
        // A new version keeps the QR box, which covers the template's placeholder, when its picture is still in the same place.
        const { data: current } = await db.from("certificate_templates").select("storage_path,fields").eq("course_id", courseId).eq("active", true).maybeSingle();
        const qr = current ? templateLayout({ storagePath: current.storage_path, fields: current.fields, code: course.code, isPdf: true })?.qr : undefined;
        const keepQr = !!qr && await hasPictureAt(bytes, qr);
        if (read.fields) fields = { ...read.fields, ...(photoBox ? { photo: { x: photoBox.x, y: photoBox.y, w: photoBox.w, h: photoBox.h } } : {}), ...(keepQr ? { qr } : {}) };
      }
    }

    const { data: last } = await db.from("certificate_templates").select("version").eq("course_id", courseId).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (last?.version ?? 0) + 1;
    await db.from("certificate_templates").update({ active: false }).eq("course_id", courseId); // only the newest is active
    const { data: tpl, error: insertError } = await db.from("certificate_templates").insert({
      course_id: courseId, version, storage_path: path, active: true, fields, approved_by: staff.user.id, approved_at: new Date().toISOString(),
    }).select("id").single();
    if (insertError) { await db.storage.from("certificate-templates").remove([path]); throw insertError; }
    // Tell the uploader whether the 2x2 photo box was found (it is used automatically when printing).
    return NextResponse.json({ templateId: tpl.id, version, layout, photoBox: photoBox ? { w: Math.round(photoBox.w), h: Math.round(photoBox.h), source: photoBox.source } : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to store the template." }, { status: 400 });
  }
}
