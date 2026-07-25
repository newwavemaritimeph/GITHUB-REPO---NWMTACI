import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MFA_COOKIE } from "@/lib/mfa";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  (await cookies()).delete(MFA_COOKIE);
  return NextResponse.redirect(new URL("/staff-login", request.url));
}
