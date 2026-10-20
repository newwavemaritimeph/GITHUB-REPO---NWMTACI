import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { sheetCsvUrl } from "@/lib/admin-imports";

export const runtime = "nodejs";

/**
 * Reads a Google Sheet shared as "Anyone with the link can view" as CSV, for the
 * Admin's one-time imports (owner, 20 Oct 2026). Only docs.google.com sheets.
 */
export async function POST(request: Request) {
  const staff = await requireStaff(["admin"]);
  if (!staff) return NextResponse.json({ error: "Only the Admin imports sheets." }, { status: 403 });
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  const csvUrl = sheetCsvUrl(String(url ?? ""));
  if (!csvUrl) return NextResponse.json({ error: "Paste a Google Sheets link (docs.google.com/spreadsheets/…)." }, { status: 400 });
  const res = await fetch(csvUrl, { redirect: "follow", cache: "no-store" });
  const text = await res.text();
  if (!res.ok || /<html/i.test(text.slice(0, 200))) return NextResponse.json({ error: "The sheet could not be read. In Google Sheets click Share › General access › Anyone with the link (Viewer), then try again." }, { status: 400 });
  if (text.length > 2_000_000) return NextResponse.json({ error: "The sheet is too large." }, { status: 400 });
  return NextResponse.json({ csv: text });
}
