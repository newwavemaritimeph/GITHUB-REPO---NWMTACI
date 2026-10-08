import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleAccessToken } from "@/lib/google-classroom";

/**
 * Proof-of-payment filing in Google Drive (owner, 7 Oct 2026). GCash, PSBank
 * and UnionBank proofs go straight to the connected Google account's Drive:
 *
 *   NWMTACI Payment Proofs / GCash / 2026-10 October / DELA CRUZ - 2026-10-07.jpg
 *
 * The portal keeps no copy of the file. It uses the drive.file scope, so it
 * can see only the folders and files it created itself.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export const DRIVE_ROOT_NAME = "NWMTACI Payment Proofs";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/** Manila calendar date (YYYY-MM-DD) of an instant. */
export const manilaDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

/** Folder labels and file name for one proof. Pure, so it is unit-tested. */
export function proofNaming(input: { mode: string; receivedAt: string; lastName: string; mime: string }) {
  const date = manilaDate(input.receivedAt);
  const [year, month] = date.split("-");
  const monthLabel = `${year}-${month} ${MONTHS[Number(month) - 1]}`;
  const last = input.lastName.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase() || "TRAINEE";
  const ext = EXT[input.mime] ?? "jpg";
  return { mode: input.mode, monthLabel, monthKey: `${input.mode}/${year}-${month}`, base: `${last} - ${date}`, ext, fileName: `${last} - ${date}.${ext}` };
}

/** "NAME - date.jpg", then "NAME - date (2).jpg", … when the name is taken. */
export function nextFreeName(base: string, ext: string, taken: string[]) {
  const set = new Set(taken.map((n) => n.toLowerCase()));
  if (!set.has(`${base}.${ext}`.toLowerCase())) return `${base}.${ext}`;
  for (let n = 2; n < 1000; n += 1) { const name = `${base} (${n}).${ext}`; if (!set.has(name.toLowerCase())) return name; }
  return `${base} (${Date.now()}).${ext}`;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function driveFetch<T>(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string; status?: string } };
  if (!response.ok) {
    const message = body.error?.message ?? `Google Drive returned ${response.status}`;
    throw new Error(/insufficient|scope|permission/i.test(message) ? "Google Drive is not allowed yet. Reconnect Google (Instructions › Google Classroom) and tick the Drive permission." : message);
  }
  return body;
}

/** The id of a folder the portal manages, creating it (and caching its id) when needed. */
async function ensureFolder(db: Admin, token: string, key: string, name: string, parentId: string | null) {
  const { data: cached } = await db.from("google_drive_folders").select("folder_id").eq("key", key).maybeSingle();
  if (cached?.folder_id) {
    // Still there and not in the bin?
    const check = await fetch(`https://www.googleapis.com/drive/v3/files/${cached.folder_id}?fields=id,trashed`, { headers: { authorization: `Bearer ${token}` } });
    const body = await check.json().catch(() => ({})) as { trashed?: boolean };
    if (check.ok && !body.trashed) return cached.folder_id as string;
  }
  const parent = parentId ? ` and '${q(parentId)}' in parents` : "";
  const found = await driveFetch<{ files?: { id: string }[] }>(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parent}`)}&fields=files(id)&pageSize=1`);
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await driveFetch<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }) });
    id = created.id;
  }
  await db.from("google_drive_folders").upsert({ key, folder_id: id });
  return id;
}

/** Upload one proof into Mode › Month and return its Drive id, link and readable path. */
export async function uploadProofToDrive(db: Admin, input: { bytes: Uint8Array; mime: string; mode: string; receivedAt: string; lastName: string }) {
  const token = await googleAccessToken(db);
  const naming = proofNaming(input);
  const root = await ensureFolder(db, token, "root", DRIVE_ROOT_NAME, null);
  const modeFolder = await ensureFolder(db, token, naming.mode, naming.mode, root);
  const monthFolder = await ensureFolder(db, token, naming.monthKey, naming.monthLabel, modeFolder);
  const existing = await driveFetch<{ files?: { name: string }[] }>(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${q(monthFolder)}' in parents and trashed=false and name contains '${q(naming.base)}'`)}&fields=files(name)&pageSize=1000`);
  const fileName = nextFreeName(naming.base, naming.ext, (existing.files ?? []).map((f) => f.name));
  // Multipart upload: JSON metadata, then the file bytes.
  const boundary = `nwmtaci${Date.now().toString(36)}`;
  const head = Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fileName, parents: [monthFolder] })}\r\n--${boundary}\r\ncontent-type: ${input.mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const uploaded = await driveFetch<{ id: string; webViewLink?: string }>(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body: Buffer.concat([head, Buffer.from(input.bytes), tail]),
  });
  return { fileId: uploaded.id, link: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`, path: `${DRIVE_ROOT_NAME} / ${naming.mode} / ${naming.monthLabel} / ${fileName}` };
}

/**
 * File any document under Root / folder / folder / … in Drive, de-duplicating the
 * name. Folder ids are cached by their path key ("vouchers/Utilities/2026-10").
 */
export async function fileInDrive(db: Admin, input: { rootKey: string; rootName: string; folders: { key: string; name: string }[]; base: string; ext: string; mime: string; bytes: Uint8Array }) {
  const token = await googleAccessToken(db);
  let parent = await ensureFolder(db, token, input.rootKey, input.rootName, null);
  for (const f of input.folders) parent = await ensureFolder(db, token, f.key, f.name, parent);
  const existing = await driveFetch<{ files?: { name: string }[] }>(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${q(parent)}' in parents and trashed=false and name contains '${q(input.base)}'`)}&fields=files(name)&pageSize=1000`);
  const fileName = nextFreeName(input.base, input.ext, (existing.files ?? []).map((f) => f.name));
  const boundary = `nwmtaci${Date.now().toString(36)}`;
  const head = Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fileName, parents: [parent] })}\r\n--${boundary}\r\ncontent-type: ${input.mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const uploaded = await driveFetch<{ id: string; webViewLink?: string }>(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body: Buffer.concat([head, Buffer.from(input.bytes), tail]),
  });
  return { fileId: uploaded.id, link: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`, path: [input.rootName, ...input.folders.map((f) => f.name), fileName].join(" / ") };
}

/** Replace the contents of a file the portal filed earlier (same name and folder). */
export async function replaceDriveFile(db: Admin, fileId: string, bytes: Uint8Array, mime: string) {
  const token = await googleAccessToken(db);
  await driveFetch<{ id: string }>(token, `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, { method: "PATCH", headers: { "content-type": mime }, body: Buffer.from(bytes) });
}

/** Folder labels and file name for an expense voucher. Pure, so it is unit-tested. */
export function voucherNaming(input: { category: string; approvedAt: string; voucherNumber: string; payee: string }) {
  const date = manilaDate(input.approvedAt);
  const [year, month] = date.split("-");
  const clean = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const category = clean(input.category) || "Uncategorized";
  return {
    folders: [{ key: `vouchers/${category}`, name: category }, { key: `vouchers/${category}/${year}-${month}`, name: `${year}-${month} ${MONTHS[Number(month) - 1]}` }],
    base: `${date} ${input.voucherNumber} - ${clean(input.payee).toUpperCase() || "PAYEE"}`,
  };
}
export const VOUCHER_ROOT = { key: "vouchers", name: "NWMTACI Expense Vouchers" };
