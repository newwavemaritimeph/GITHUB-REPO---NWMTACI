import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development" || isSupabaseConfigured()) return NextResponse.json({ error: "Temporary login is disabled." }, { status: 404 });
  const expectedEmail = process.env.TEMP_STAFF_EMAIL;
  const expectedPassword = process.env.TEMP_STAFF_PASSWORD;
  const sessionToken = process.env.TEMP_STAFF_SESSION_TOKEN;
  if (!expectedEmail || !expectedPassword || !sessionToken) return NextResponse.json({ error: "Temporary login is not configured." }, { status: 503 });
  const parsed = credentialsSchema.safeParse(await request.json());
  if (!parsed.success || parsed.data.email.toLowerCase() !== expectedEmail.toLowerCase() || parsed.data.password !== expectedPassword) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("new-wave-temp-staff", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("new-wave-temp-staff", "", { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 0 });
  return response;
}
