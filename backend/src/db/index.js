// Runtime DB client.
//
// Single shared `postgres` connection pool + Drizzle wrapper. Import
// `db` anywhere on the backend; never instantiate your own.
//
//   import { db } from './db/index.js';
//   import { users } from './db/schema.js';
//   const list = await db.select().from(users).where(...);

import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const url =
  process.env.DATABASE_URL ||
  'postgres://feynmap:feynmap@localhost:5432/feynmap';

// `max: 10` is enough for dev + early prod; tune when we have load data.
// `prepare: false` keeps things simple for `postgres-js` + Drizzle in
// transaction-pooler scenarios (pgbouncer, Neon). Harmless on direct conn.
export const sql = postgres(url, { max: 10, prepare: false });

export const db = drizzle(sql, { schema });
