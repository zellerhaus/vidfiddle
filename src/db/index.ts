import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

type DbClient = PostgresJsDatabase<typeof schema>;

declare global {
  var __vidfiddle_postgres__: ReturnType<typeof postgres> | undefined;
  var __vidfiddle_db__: DbClient | undefined;
}

function getDb(): DbClient {
  if (globalThis.__vidfiddle_db__) return globalThis.__vidfiddle_db__;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Configure it before using the Drizzle database client."
    );
  }

  const client =
    globalThis.__vidfiddle_postgres__ ??
    postgres(databaseUrl, {
      prepare: false,
      onnotice: () => {}, // "already exists, skipping" notices from migrations are expected
    });
  const instance = drizzle(client, { schema });

  // Reuse one connection pool across Next.js dev hot reloads and between route modules.
  globalThis.__vidfiddle_postgres__ = client;
  globalThis.__vidfiddle_db__ = instance;
  return instance;
}

// Connect on first use rather than at import, so `next build` works without a database.
const db = new Proxy({} as DbClient, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Closes the connection pool, for scripts and the worker's shutdown. */
async function closeDb(): Promise<void> {
  await globalThis.__vidfiddle_postgres__?.end();
  globalThis.__vidfiddle_postgres__ = undefined;
  globalThis.__vidfiddle_db__ = undefined;
}

export { db, getDb, closeDb };
export type { DbClient };
