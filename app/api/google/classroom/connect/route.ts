import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { authUrl, googleConfigured } from "@/lib/google-classroom";

export const runtime = "nodejs";

/** Starts "Connect Google Classroom": sends the signed-in Admin or Registration officer to Google's consent screen. */
export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "registration"]);
  const origin = new URL(request.url).origin;
  if (!staff) return NextResponse.redirect(`${origin}/staff-login`);
  if (!googleConfigured()) return NextResponse.redirect(`${origin}/portal?classroom=not-configured`);
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authUrl(origin, state));
  response.cookies.set("nw_gc_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google/classroom", maxAge: 600 });
  return response;
}
