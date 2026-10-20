// Imports the converted certificate templates into the portal (owner, 20 Oct 2026).
// Each "{CODE} - {Course}.pdf" plus its measured "{CODE} - {Course}.json" becomes the
// active template of the matching New Wave course; earlier versions are kept inactive.
// The ILO catering files share the code ILO, so those match by course name.
//
//   npx tsx --env-file=.env.local scripts/certificate-templates/import.ts <out folder> [--apply]
// Without --apply it only lists the matches.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { matchTemplateFiles } from "../../lib/certificate-rules";

const dir = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dir) throw new Error("Pass the folder with the converted templates.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. --env-file=.env.local).");
const db = createClient(url, key, { auth: { persistSession: false } });

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const keys = (await readdir(dir)).filter((f) => f.endsWith(".json") && !f.endsWith(".word.json")).map((f) => f.slice(0, -5)).sort();
const { data: courses, error } = await db.from("courses").select("id,code,name").eq("delivery_type", "In-House");
if (error) throw error;
const codeCount = new Map<string, number>();
for (const k of keys) { const c = k.split(" - ")[0]; codeCount.set(c, (codeCount.get(c) ?? 0) + 1); }

const plan: { key: string; course: { id: string; code: string; name: string } | null }[] = keys.map((k) => {
  const [code, ...rest] = k.split(" - "), name = rest.join(" - ");
  // A shared code (ILO) cannot pick the course; the course name must match exactly.
  const byName = (courses ?? []).find((c) => norm(c.name) === norm(name));
  const id = (codeCount.get(code) ?? 0) > 1 ? byName?.id ?? null : (courses ?? []).find((c) => norm(c.code) === norm(code))?.id ?? byName?.id ?? matchTemplateFiles([k], courses ?? [])[0].courseId;
  return { key: k, course: (courses ?? []).find((c) => c.id === id) ?? null };
});
const taken = new Map<string, string>();
for (const p of plan) if (p.course) { if (taken.has(p.course.id)) console.log(`Two files for ${p.course.code}: ${taken.get(p.course.id)} and ${p.key} (the second wins)`); taken.set(p.course.id, p.key); }
for (const p of plan) console.log(`${p.course ? "OK  " : "NONE"} ${p.key}${p.course ? `  →  ${p.course.code} · ${p.course.name}` : ""}`);
console.log(`${plan.filter((p) => p.course).length} matched, ${plan.filter((p) => !p.course).length} without a course.`);
if (!apply) { console.log("Dry run. Add --apply to import."); process.exit(0); }

let done = 0;
for (const p of plan) {
  if (!p.course) continue;
  const bytes = await readFile(join(dir, `${p.key}.pdf`));
  const fields = JSON.parse(await readFile(join(dir, `${p.key}.json`), "utf8"));
  const path = `${p.course.id}/${randomUUID()}-${p.course.code.replace(/[^a-zA-Z0-9._-]/g, "-")}.pdf`;
  const { error: up } = await db.storage.from("certificate-templates").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (up) { console.log(`FAILED ${p.key}: ${up.message}`); continue; }
  const { data: last } = await db.from("certificate_templates").select("version").eq("course_id", p.course.id).order("version", { ascending: false }).limit(1).maybeSingle();
  await db.from("certificate_templates").update({ active: false }).eq("course_id", p.course.id);
  const { error: ins } = await db.from("certificate_templates").insert({ course_id: p.course.id, version: (last?.version ?? 0) + 1, storage_path: path, active: true, fields, approved_at: new Date().toISOString() });
  if (ins) { await db.storage.from("certificate-templates").remove([path]); console.log(`FAILED ${p.key}: ${ins.message}`); continue; }
  done++;
}
console.log(`Imported ${done} templates.`);
