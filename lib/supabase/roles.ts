import { createSupabaseAdminClient } from "./admin";

/** Role names assigned to a user (service-role read, independent of RLS). */
export async function getUserRoleNames(userId: string): Promise<string[]> {
  const db = createSupabaseAdminClient();
  const { data } = await db.from("user_roles").select("roles(name)").eq("user_id", userId);
  const names: string[] = [];
  for (const row of data ?? []) {
    const roles = (row as { roles?: { name?: string } | { name?: string }[] }).roles;
    if (Array.isArray(roles)) roles.forEach((r) => r?.name && names.push(r.name));
    else if (roles?.name) names.push(roles.name);
  }
  return names;
}
