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
