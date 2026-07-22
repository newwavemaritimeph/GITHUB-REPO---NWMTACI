import { createSupabaseAdminClient } from "./supabase/admin";
import { createSupabaseServerClient } from "./supabase/server";

export async function hashValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function enforceRateLimit(request: Request, action: string, limit: number, windowMinutes = 15) {
  const db = createSupabaseAdminClient();
  const keyHash = await hashValue(`${requestIp(request)}:${request.headers.get("user-agent") ?? ""}`);
  const date = new Date();
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / windowMinutes) * windowMinutes);
  const windowStartedAt = date.toISOString();
  const { data: current } = await db.from("rate_limits").select("request_count").eq("key_hash", keyHash).eq("action", action).eq("window_started_at", windowStartedAt).maybeSingle();
  if ((current?.request_count ?? 0) >= limit) throw new Error("RATE_LIMITED");
  await db.from("rate_limits").upsert({ key_hash: keyHash, action, window_started_at: windowStartedAt, request_count: (current?.request_count ?? 0) + 1 }, { onConflict: "key_hash,action,window_started_at" });
  return keyHash;
}

export async function requireStaff(allowedRoles?: string[]) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("user_roles").select("roles!inner(code)").eq("user_id", user.id);
  const roleCodes = (data ?? []).flatMap((entry) => {
    const role = entry.roles as unknown as { code?: string } | { code?: string }[];
    return Array.isArray(role) ? role.map((item) => item.code ?? "") : [role?.code ?? ""];
  });
  if (roleCodes.length === 0 || (allowedRoles && !roleCodes.some((role) => allowedRoles.includes(role)))) return null;
  return { user, roleCodes };
}
