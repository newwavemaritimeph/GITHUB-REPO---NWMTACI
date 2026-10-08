import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Google Classroom connection for New Wave's personal Gmail-owned classes
 * (owner, 7 Oct 2026). An authorised staff member signs in once with Google
 * (OAuth, offline access); the refresh token is stored encrypted and is used to
 * list the account's classes and invite trainees as students. The password never
 * touches the portal, and access can be revoked from the Google Account.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const CLASSROOM_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters",
  // Proof-of-payment uploads (7 Oct 2026): the portal can see only the files and folders it creates.
  "https://www.googleapis.com/auth/drive.file",
];
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const hasDriveScope = (scopes?: string | null) => (scopes ?? "").split(/\s+/).includes(DRIVE_SCOPE);

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
// The same address the Connect button was pressed on, so the sign-in cookie comes back with
// Google's reply. Both portal addresses are registered as redirect URIs in Google Cloud.
export const redirectUri = (origin: string) => `${origin}/api/google/classroom/callback`;

/* -------- token encryption (AES-256-GCM, key derived from the client secret) -------- */
const key = () => createHash("sha256").update(`${process.env.GOOGLE_CLIENT_SECRET ?? ""}:nwmtaci-classroom-token`).digest();
export function sealToken(token: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function openToken(sealed: string) {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/* -------- OAuth -------- */
export function authUrl(origin: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: redirectUri(origin), response_type: "code",
    scope: CLASSROOM_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, origin: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: redirectUri(origin), grant_type: "authorization_code" }),
  });
  const body = await response.json() as { access_token?: string; refresh_token?: string; scope?: string; id_token?: string; error_description?: string; error?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description ?? body.error ?? "Google sign-in failed.");
  return body;
}

export async function accountEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await response.json() as { email?: string };
  return body.email ?? "unknown";
}

/** The active connection (newest, not revoked), if any. */
export async function activeConnection(db: Admin) {
  const { data } = await db.from("google_connections").select("id,account_email,refresh_token_encrypted,scopes,connected_at").eq("provider", "classroom").is("revoked_at", null).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  return data as { id: string; account_email: string; refresh_token_encrypted: string; scopes: string; connected_at: string } | null;
}

/** A fresh access token from the stored Google connection (Classroom and Drive). */
export async function googleAccessToken(db: Admin) { return accessToken(db); }
async function accessToken(db: Admin) {
  const connection = await activeConnection(db);
  if (!googleConfigured()) throw new Error("Google is not set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, then redeploy.");
  if (!connection) throw new Error("Google Classroom is not connected.");
  // A connection saved under an older client secret cannot be opened; ask for a fresh connection.
  let refreshToken: string;
  try { refreshToken = openToken(connection.refresh_token_encrypted); }
  catch { throw new Error("Google Classroom access expired after the Google key changed. Connect it again."); }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const body = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    // invalid_grant: the owner revoked access or the token expired — mark it so the portal asks to reconnect.
    if (body.error === "invalid_grant") await db.from("google_connections").update({ revoked_at: new Date().toISOString() }).eq("id", connection.id);
    throw new Error(body.error === "invalid_grant" ? "Google Classroom access was revoked or expired. Connect it again." : body.error_description ?? "Could not reach Google.");
  }
  return body.access_token;
}

async function classroomFetch<T>(db: Admin, path: string, init: RequestInit = {}) {
  const token = await accessToken(db);
  const response = await fetch(`https://classroom.googleapis.com/v1/${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string; status?: string } };
  return { ok: response.ok, status: response.status, body };
}

export type ClassroomCourse = { id: string; name: string; section?: string; alternateLink?: string; enrollmentCode?: string };

/** Active classes the connected account teaches. */
export async function listClasses(db: Admin): Promise<ClassroomCourse[]> {
  const classes: ClassroomCourse[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const { ok, body } = await classroomFetch<{ courses?: ClassroomCourse[]; nextPageToken?: string }>(db, `courses?teacherId=me&courseStates=ACTIVE&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
    if (!ok) throw new Error(body.error?.message ?? "Could not list Google Classroom classes.");
    classes.push(...(body.courses ?? []).map((c) => ({ id: c.id, name: c.name, section: c.section, alternateLink: c.alternateLink, enrollmentCode: c.enrollmentCode })));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return classes;
}

/** Invite a trainee's email to a class as a student. An existing invite or membership counts as done. */
export async function inviteStudent(db: Admin, classroomCourseId: string, email: string) {
  const { ok, status, body } = await classroomFetch<{ id?: string }>(db, "invitations", { method: "POST", body: JSON.stringify({ courseId: classroomCourseId, userId: email, role: "STUDENT" }) });
  if (ok) return { state: "Invited" as const, invitationId: body.id ?? null, error: null };
  if (status === 409) return { state: "Already invited" as const, invitationId: null, error: null };
  return { state: "Failed" as const, invitationId: null, error: body.error?.message ?? `Google returned ${status}` };
}

export async function revokeConnection(db: Admin) {
  const connection = await activeConnection(db);
  if (!connection) return;
  try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(openToken(connection.refresh_token_encrypted))}`, { method: "POST" }); } catch { /* still mark revoked locally */ }
  await db.from("google_connections").update({ revoked_at: new Date().toISOString() }).eq("id", connection.id);
}
