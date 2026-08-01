import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "training_operations"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("template");
    const courseId = String(form.get("courseId") ?? "");
    if (!z.string().uuid().safeParse(courseId).success) return NextResponse.json({ error: "Pick a course." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a template file (PDF, PNG, or JPEG)." }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Use a PDF, PNG, or JPEG file." }, { status: 400 });
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "The file must be smaller than 50 MB." }, { status: 400 });
    let fields: { key: string; label: string }[] = [];
    try { const raw = form.get("fields"); if (raw) fields = JSON.parse(String(raw)); } catch { fields = []; }

    const db = createSupabaseAdminClient();
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
