import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashValue } from "@/lib/security";
import { automaticEndDate } from "@/lib/scheduling";
import { normalizeVerifyCode } from "@/lib/certificate-verify";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaDay = (v: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v));

/** The only fields the public page shows (owner's QR plan): no birth date, address, contact, SRN or payments. */
export type VerifyResult =
  | { state: "valid"; name: string; course: string; hours: number | null; startsOn: string | null; endsOn: string | null; issuedOn: string | null; certificateNumber: string; stickerNo: string | null; photoUrl: string | null }
  | { state: "revoked"; certificateNumber: string }
  | { state: "not_found" }
  | { state: "limited" };

export const SCANS_PER_MINUTE = 30;

/**
 * Looks up a scanned code, logs the scan with a hashed IP, and returns the
 * limited public record. A certificate counts only once it has been printed.
 */
export async function verifyCertificate(db: Admin, input: string, who: { ip: string; userAgent: string | null }): Promise<VerifyResult> {
  const ipHash = await hashValue(`${who.ip}:${process.env.SCAN_HASH_SALT ?? "nwmtaci-verify"}`);
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("certificate_scans").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("scanned_at", since);
  if ((count ?? 0) >= SCANS_PER_MINUTE) return { state: "limited" };

  const code = normalizeVerifyCode(input);
  const { data: cert } = code
    ? await db.from("certificates").select("id,certificate_number,print_count,status,printed_at,revoked_at,sticker_no,corrections,enrollment_id,enrollments(scheduled_on,batches(starts_on,ends_on),courses(name,duration_label,duration_days),trainees(legal_first_name,legal_middle_name,legal_last_name))").eq("verify_code", code).maybeSingle()
    : { data: null };
  const row = cert as { id: string; certificate_number: string | null; print_count: number | null; status: string; printed_at: string | null; revoked_at: string | null; sticker_no: string | null; corrections: Record<string, string> | null; enrollment_id: string; enrollments: unknown } | null;
  const printed = !!row && (Number(row.print_count ?? 0) > 0 || ["Printed", "Released"].includes(row.status)) && !!row.certificate_number;
  const result: VerifyResult["state"] = !row || !printed ? "not_found" : row.revoked_at ? "revoked" : "valid";
  await db.from("certificate_scans").insert({ certificate_id: printed ? row!.id : null, code_tried: (code ?? input).slice(0, 40), result, ip_hash: ipHash, user_agent: who.userAgent?.slice(0, 300) ?? null });
  if (result === "not_found") return { state: "not_found" };
  if (result === "revoked") return { state: "revoked", certificateNumber: row!.certificate_number! };

  const e = first(row!.enrollments as { scheduled_on: string | null; batches: unknown; courses: unknown; trainees: unknown } | null);
  const b = first(e?.batches as { starts_on: string; ends_on: string } | null);
  const c = first(e?.courses as { name: string; duration_label: string; duration_days: number | null } | null);
  const t = first(e?.trainees as { legal_first_name: string; legal_middle_name: string | null; legal_last_name: string } | null);
  const fix = row!.corrections ?? {};
  const startsOn = fix.startsOn || b?.starts_on || e?.scheduled_on || null;
  const endsOn = fix.endsOn || b?.ends_on || (e?.scheduled_on && c ? automaticEndDate(e.scheduled_on, c.duration_label) : null);
  const { data: photo } = await db.from("certificate_photos").select("storage_path").eq("enrollment_id", row!.enrollment_id).maybeSingle();
  const signed = photo?.storage_path ? await db.storage.from("certificate-photos").createSignedUrl(photo.storage_path as string, 300) : null;
  return {
    state: "valid",
    name: (fix.name || (t ? [t.legal_first_name, t.legal_middle_name, t.legal_last_name].filter(Boolean).join(" ") : "")).toUpperCase(),
    course: fix.courseName || c?.name || "",
    hours: c?.duration_days ? Math.round(Number(c.duration_days) * 8) : null,
    startsOn, endsOn,
    issuedOn: fix.issuedOn || (row!.printed_at ? manilaDay(row!.printed_at) : null),
    certificateNumber: row!.certificate_number!,
    stickerNo: row!.sticker_no,
    photoUrl: signed?.data?.signedUrl ?? null,
  };
}
