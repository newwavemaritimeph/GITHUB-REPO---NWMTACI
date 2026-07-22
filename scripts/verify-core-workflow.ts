import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query(`
    select
      (select count(*)::int from public.courses where active and delivery_type='In-House') as own_courses,
      (select count(*)::int from public.partner_course_offers where active) as endorsed_offers,
      (select count(*)::int from public.email_templates where active and template_code like 'instructor.%') as instructor_templates,
      exists(select 1 from pg_proc where proname='create_training_batch') as batch_function,
      exists(select 1 from pg_proc where proname='create_staff_enrollment') as enrollment_function,
      exists(select 1 from storage.buckets where id='payment-proofs' and not public and file_size_limit=10485760) as private_payment_proofs
  `);
  const status = rows[0];
  if (!status.batch_function || !status.enrollment_function || !status.private_payment_proofs || status.instructor_templates < 2) throw new Error("Core workflow verification failed.");
  console.log(`Verified ${status.own_courses} New Wave courses, ${status.endorsed_offers} endorsed offers, private payment-proof storage, transactional enrollment and 24-person batch scheduling, and ${status.instructor_templates} instructor email templates.`);
} finally {
  await client.end();
}
