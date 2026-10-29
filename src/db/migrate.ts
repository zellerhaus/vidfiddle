import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb } from "./index";

const MIGRATIONS_FOLDER = resolve(process.env.MIGRATIONS_DIR ?? "drizzle");

/**
 * Applies pending migrations. A database created before Drizzle (the original Supabase setup)
 * already has the baseline schema, so the baseline is recorded as applied instead of re-run.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();
  const [{ adopted }] = await db.execute<{ adopted: boolean }>(sql`
    select to_regclass('public.videos') is not null
       and to_regclass('drizzle.__drizzle_migrations') is null as adopted
  `);

  if (adopted) {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const baseline = journal.entries[0];
    const hash = createHash("sha256")
      .update(readFileSync(join(MIGRATIONS_FOLDER, `${baseline.tag}.sql`), "utf8"))
      .digest("hex");
    // Same table layout drizzle-orm's migrator creates and reads.
    await db.execute(sql`create schema if not exists drizzle`);
    await db.execute(sql`
      create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)
    `);
    await db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${baseline.when})`);
    console.log(`[migrate] Existing database detected; recorded baseline ${baseline.tag} as applied`);
  }

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
