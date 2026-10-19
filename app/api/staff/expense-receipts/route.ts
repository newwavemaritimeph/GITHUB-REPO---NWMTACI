import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/google-classroom";
import { fileInDrive, manilaDate, VOUCHER_ROOT } from "@/lib/google-drive";

export const runtime = "nodejs";

/**
 * Receipt photos for an expense (owner, 19 Oct 2026): the Cashier attaches the
 * receipt or bill (e.g. a Shopee order receipt) before sending the expense for
 * approval. Each file goes straight to Google Drive under
 * NWMTACI Expense Vouchers / Receipts / YYYY-MM Month; the portal keeps the link.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the receipt photo." }, { status: 400 });
    const ext = EXT[file.type];
    if (!ext) return NextResponse.json({ error: "Use a photo (PNG, JPEG or WebP) or a PDF." }, { status: 400 });
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Each receipt file must be smaller than 4 MB." }, { status: 400 });
    if (!googleConfigured()) return NextResponse.json({ error: "Google is not set up yet. Add the Google keys in Vercel, then connect Google." }, { status: 400 });
    const payee = String(form.get("payee") ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 60) || "EXPENSE";
    const date = manilaDate(new Date().toISOString());
    const [year, month] = date.split("-");
    const filed = await fileInDrive(createSupabaseAdminClient(), {
      rootKey: VOUCHER_ROOT.key, rootName: VOUCHER_ROOT.name,
      folders: [{ key: `${VOUCHER_ROOT.key}/receipts`, name: "Receipts" }, { key: `${VOUCHER_ROOT.key}/receipts/${year}-${month}`, name: `${year}-${month} ${MONTHS[Number(month) - 1]}` }],
      base: `${date} ${payee} - receipt`, ext, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json({ fileId: filed.fileId, link: filed.link, name: filed.path.split(" / ").pop() ?? file.name, mime: file.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the receipt to Google Drive.";
    return NextResponse.json({ error: /not connected|revoked|expired|invalid_grant/i.test(message) ? "Google is not connected. Ask the Admin to reconnect Google, then attach the receipt again." : message }, { status: 400 });
  }
}
