import { createClient } from "@supabase/supabase-js";
import { PARTNER_CENTERS } from "../lib/endorsement-catalog";
import { IN_HOUSE_COURSES } from "../lib/in-house-catalog";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding.");
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: categories, error: categoryError } = await db.from("course_categories").select("id,name");
  if (categoryError) throw categoryError;
  const categoryId = new Map((categories ?? []).map((category) => [category.name, category.id]));

  const ownRows = IN_HOUSE_COURSES.map((course) => ({
    code: course.code,
    name: course.course,
    category_id: categoryId.get(course.category),
    delivery_type: "In-House",
    duration_label: course.duration,
    duration_days: Number.parseFloat(course.duration) || null,
    training_mode: course.modality,
    standard_price_centavos: course.priceCentavos,
    public_visible: true,
    active: true,
    source_document: "Updated List of Courses 2025",
    source_label: `${course.code} - ${course.course}`,
  }));
  const { error: ownError } = await db.from("courses").upsert(ownRows, { onConflict: "code,delivery_type" });
  if (ownError) throw ownError;

  const { error: centerError } = await db.from("partner_centers").upsert(PARTNER_CENTERS.map((name) => ({ name, active: true })), { onConflict: "name" });
  if (centerError) throw centerError;

  // Endorsed programs are no longer seeded (owner, 20 Oct 2026): Accounting or the Admin encode them in the portal.
  console.log(`Seeded ${IN_HOUSE_COURSES.length} New Wave courses and ${PARTNER_CENTERS.length} partner centers.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
