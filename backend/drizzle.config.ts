import 'dotenv/config';
import type { Config } from 'drizzle-kit';

// Drizzle Kit only — runtime config lives in src/db/index.js.
// Schema is JS-with-Drizzle (no TS toolchain on backend), so we point
// drizzle-kit at the .js schema file. Generated SQL lands in
// src/db/migrations/ and is applied by src/db/migrate.js.

export default {
  schema: './src/db/schema.js',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      'postgres://feynmap:feynmap@localhost:5432/feynmap',
  },
  strict: true,
  verbose: true,
} satisfies Config;
