/**
 * Google Classroom join details for a course (owner, 7 Oct 2026). New Wave's
 * classes are owned by a personal Gmail account, so trainees join with a link
 * that carries the class code (…/c/<id>?cjc=<code>): opened while signed in to
 * Google, it adds them to the class in one click. Automatic API invites would
 * need Google app verification and are not used.
 */

const CLASSROOM_HOME = "https://classroom.google.com/";

export type ClassroomJoin = { url: string | null; code: string | null };

/** The best join link for a stored class link and/or class code. */
export function classroomJoin(link?: string | null, code?: string | null): ClassroomJoin {
  const cleanCode = (code ?? "").trim() || null;
  const cleanLink = (link ?? "").trim() || null;
  if (cleanLink && /^https:\/\/classroom\.google\.com\//i.test(cleanLink)) {
    if (/[?&]cjc=/i.test(cleanLink) || !cleanCode) return { url: cleanLink, code: cleanCode };
    return { url: `${cleanLink}${cleanLink.includes("?") ? "&" : "?"}cjc=${encodeURIComponent(cleanCode)}`, code: cleanCode };
  }
  if (cleanCode) return { url: CLASSROOM_HOME, code: cleanCode };
  return { url: null, code: null };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The Classroom part of the instructions email (HTML and text), or empty when the course has no class. */
export function classroomEmailBlocks(join: ClassroomJoin) {
  if (!join.url && !join.code) return { html: "", text: "" };
  const direct = !!join.url && join.url !== CLASSROOM_HOME;
  const html = `<div style="margin:16px 0 0;padding:14px;border:1px solid #cfe6f2;border-radius:10px">
  <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#123F63">Join our Google Classroom</p>
  <p style="margin:0 0 12px;font-size:13.5px;line-height:1.5">Sign in with your Google (Gmail) account, then ${direct ? "tap the button to join the class." : `open Google Classroom, tap <b>+</b> &rsaquo; <b>Join class</b> and enter the class code.`}</p>
  ${join.url ? `<a href="${escapeHtml(join.url)}" style="display:inline-block;background:#F25615;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px">Join Google Classroom</a>` : ""}
  ${join.code ? `<p style="margin:12px 0 0;font-size:13px;color:#40606f">Class code: <b style="font-size:15px;letter-spacing:.06em;color:#123F63">${escapeHtml(join.code)}</b></p>` : ""}
</div>`;
  const text = `Join our Google Classroom (sign in with your Google account): ${join.url ?? CLASSROOM_HOME}${join.code ? `\nClass code: ${join.code}` : ""}\n`;
  return { html, text };
}

export { escapeHtml };
