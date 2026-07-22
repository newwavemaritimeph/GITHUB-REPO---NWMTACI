import { createClient } from "@supabase/supabase-js";
import { ENDORSEMENT_OFFERS, PARTNER_CENTERS } from "../lib/endorsement-catalog";
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

  const canonical = [...new Set(ENDORSEMENT_OFFERS.map((offer) => offer.course))].map((name, index) => ({
    code: `END-${String(index + 1).padStart(3, "0")}`,
    name,
    category_id: categoryId.get("Partner or Endorsed"),
    delivery_type: "Partner or Endorsed",
    duration_label: ENDORSEMENT_OFFERS.find((offer) => offer.course === name)?.duration ?? "Varies",
    standard_price_centavos: ENDORSEMENT_OFFERS.find((offer) => offer.course === name)?.trainingFeeCentavos ?? 0,
    training_mode: "Partner schedule",
    public_visible: true,
    active: true,
    source_document: "Price & Rebates Matrix - July 2026",
    source_label: name,
  }));
  const { error: canonicalError } = await db.from("courses").upsert(canonical, { onConflict: "code,delivery_type" });
  if (canonicalError) throw canonicalError;

  const [{ data: courses, error: coursesError }, { data: centers, error: centersError }] = await Promise.all([
    db.from("courses").select("id,name").eq("delivery_type", "Partner or Endorsed"),
    db.from("partner_centers").select("id,name"),
  ]);
  if (coursesError || centersError) throw coursesError ?? centersError;
  const courseIds = new Map((courses ?? []).map((course) => [course.name, course.id]));
  const centerIds = new Map((centers ?? []).map((center) => [center.name, center.id]));
  const offers = ENDORSEMENT_OFFERS.map((offer) => ({
    course_id: courseIds.get(offer.course),
    partner_center_id: centerIds.get(offer.center),
    duration_label: offer.duration,
    training_fee_centavos: offer.trainingFeeCentavos,
    rebate_centavos: offer.rebateCentavos,
    source_document: "Price & Rebates Matrix - July 2026",
    source_row: offer.sourceRow,
    source_label: offer.sourceLabel,
    effective_from: "2026-07-01",
    active: true,
  }));
  const { error: offersError } = await db.from("partner_course_offers").upsert(offers, { onConflict: "partner_center_id,course_id,effective_from" });
  if (offersError) throw offersError;
  console.log(`Seeded ${IN_HOUSE_COURSES.length} New Wave courses and ${ENDORSEMENT_OFFERS.length} endorsed offers.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
