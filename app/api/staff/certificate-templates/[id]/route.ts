import zlib from "zlib";
import { NextResponse } from "next/server";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Auto-detect the 2x2 photo box on a vector PDF template: parse the page content
// for drawn rectangles ("re" ops) and pick the largest square-ish, non-full-page
// box. Returns top-left origin coords in PDF points, or null (e.g. image templates).
async function detectPhotoBox(bytes: Uint8Array) {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const page = doc.getPage(0), ctx = doc.context, { width, height } = page.getSize();
    const contents = ctx.lookup(page.node.get(PDFName.of("Contents")));
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
    let raw = Buffer.alloc(0);
    for (const s of streams) {
      const getContents = (s as { getContents?: () => Uint8Array })?.getContents;
      if (!getContents) continue;
      let b = Buffer.from(getContents.call(s));
      try { b = zlib.inflateSync(b); } catch { try { b = zlib.inflateRawSync(b); } catch { /* already plain */ } }
      raw = Buffer.concat([raw, b]);
    }
    const txt = raw.toString("latin1");
    const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\b/g;
    const cands: { x: number; yTop: number; w: number; h: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) {
      const rw = Math.abs(+m[3]), rh = Math.abs(+m[4]);
      if (rw < 60 || rh < 60 || rw > width * 0.9 || Math.abs(rw - rh) / Math.max(rw, rh) > 0.5) continue;
      const x = Math.min(+m[1], +m[1] + +m[3]), yBottom = Math.min(+m[2], +m[2] + +m[4]);
      cands.push({ x, yTop: height - (yBottom + rh), w: rw, h: rh });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.w * b.h - a.w * a.h);
    return { ...cands[0], pageW: width, pageH: height };
  } catch { return null; }
}

// Returns a short-lived signed URL + metadata for a certificate template, so the
// browser can fetch the template file to render a certificate PDF client-side.
// Training Operations / Admin only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "training_operations", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: template } = await db.from("certificate_templates").select("id,storage_path,fields").eq("id", id).maybeSingle();
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const { data, error } = await db.storage.from("certificate-templates").createSignedUrl(template.storage_path, 3600);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create a template link." }, { status: 400 });
  const isPdf = template.storage_path.toLowerCase().endsWith(".pdf");
  let photoBox: Awaited<ReturnType<typeof detectPhotoBox>> = null;
  if (isPdf) {
    const { data: file } = await db.storage.from("certificate-templates").download(template.storage_path);
    if (file) photoBox = await detectPhotoBox(new Uint8Array(await file.arrayBuffer()));
  }
  return NextResponse.json({ url: data.signedUrl, isPdf, fields: template.fields ?? [], photoBox }, { headers: { "cache-control": "no-store" } });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
// Accept either a JSON array of {key,label} or a comma-separated list of labels.
function parseFields(raw: unknown): { key: string; label: string }[] {
  if (Array.isArray(raw)) return raw.filter((f): f is { key?: unknown; label?: unknown } => !!f && typeof (f as { label?: unknown }).label === "string").map((f) => ({ key: String((f as { key?: unknown }).key ?? slug(String(f.label))), label: String(f.label) }));
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("[")) { try { return parseFields(JSON.parse(s)); } catch { /* fall through to CSV */ } }
    return s.split(",").map((x) => x.trim()).filter(Boolean).map((label) => ({ key: slug(label), label }));
  }
  return [];
}

// Edit a template: change overlay fields and/or set it active (Admin / Training Ops / Releasing Officer).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "training_operations", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: tpl } = await db.from("certificate_templates").select("id,course_id").eq("id", id).maybeSingle();
  if (!tpl) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const patch: Record<string, unknown> = {};
  if ("fields" in body) patch.fields = parseFields((body as { fields?: unknown }).fields);
  if (typeof (body as { active?: unknown }).active === "boolean") {
    const active = (body as { active: boolean }).active;
    patch.active = active;
    // Only the newest/chosen template stays active per course.
    if (active) await db.from("certificate_templates").update({ active: false }).eq("course_id", tpl.course_id).neq("id", id);
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const { error } = await db.from("certificate_templates").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// Remove a template + its stored file. Blocked once certificates have been issued from it.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "training_operations", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: tpl } = await db.from("certificate_templates").select("id,course_id,storage_path,active").eq("id", id).maybeSingle();
  if (!tpl) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const { count } = await db.from("certificates").select("id", { count: "exact", head: true }).eq("template_id", id);
  if ((count ?? 0) > 0) return NextResponse.json({ error: `Cannot remove: ${count} certificate(s) were already issued from this template.` }, { status: 409 });
  const { error } = await db.from("certificate_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await db.storage.from("certificate-templates").remove([tpl.storage_path]);
  // If we removed the active template, promote the newest remaining version for that course.
  if (tpl.active) {
    const { data: next } = await db.from("certificate_templates").select("id").eq("course_id", tpl.course_id).order("version", { ascending: false }).limit(1).maybeSingle();
    if (next) await db.from("certificate_templates").update({ active: true }).eq("id", next.id);
  }
  return NextResponse.json({ ok: true });
}
