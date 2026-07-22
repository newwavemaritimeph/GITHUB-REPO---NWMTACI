import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const migration = process.argv[2];
if (!migration || !/^\d{12,14}_[a-z0-9_]+\.sql$/.test(migration)) throw new Error("Pass one migration filename from supabase/migrations.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const sql = await readFile(resolve("supabase/migrations", migration), "utf8");
  await client.query(sql);
  console.log(`Applied ${migration}`);
} finally {
  await client.end();
}
