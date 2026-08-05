import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "training_operations", "releasing_officer"]);
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
    let fields: { key: string; label: string }[] = [];
    const rawFields = form.get("fields");
    if (rawFields) {
      const s = String(rawFields).trim();
      const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (s.startsWith("[")) { try { const arr = JSON.parse(s) as { key?: unknown; label?: unknown }[]; fields = arr.filter((f) => typeof f?.label === "string").map((f) => ({ key: String(f.key ?? slug(String(f.label))), label: String(f.label) })); } catch { fields = []; } }
      else fields = s.split(",").map((x) => x.trim()).filter(Boolean).map((label) => ({ key: slug(label), label }));
    }

    const db = createSupabaseAdminClient();
    // Certificate templates are only for New Wave in-house courses (incl. STCW).
    // Endorsed / partner trainings are excluded — New Wave does not issue their certificates.
    const { data: course, error: courseError } = await db.from("courses").select("delivery_type").eq("id", courseId).maybeSingle();
    if (courseError) throw courseError;
    if (!course) return NextResponse.json({ error: "Course not found." }, { status: 404 });
    if (course.delivery_type !== "In-House") return NextResponse.json({ error: "Certificate templates are only for New Wave in-house courses, not endorsed/partner trainings." }, { status: 400 });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "template";
    const path = `${courseId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await db.storage.from("certificate-templates").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data: last } = await db.from("certificate_templates").select("version").eq("course_id", courseId).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (last?.version ?? 0) + 1;
    await db.from("certificate_templates").update({ active: false }).eq("course_id", courseId); // only the newest is active
    const { data: tpl, error: insertError } = await db.from("certificate_templates").insert({
      course_id: courseId, version, storage_path: path, active: true, fields, approved_by: staff.user.id, approved_at: new Date().toISOString(),
    }).select("id").single();
    if (insertError) { await db.storage.from("certificate-templates").remove([path]); throw insertError; }
    return NextResponse.json({ templateId: tpl.id, version });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to store the template." }, { status: 400 });
  }
}
