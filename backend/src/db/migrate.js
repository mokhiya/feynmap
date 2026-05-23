// Apply Drizzle migrations from src/db/migrations/.
//
// Usage:
//   npm run db:migrate
//
// Generate new migrations after editing schema.js:
//   npm run db:generate

import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url =
  process.env.DATABASE_URL ||
  'postgres://feynmap:feynmap@localhost:5432/feynmap';

const migrationClient = postgres(url, { max: 1 });

try {
  await migrate(drizzle(migrationClient), {
    migrationsFolder: './src/db/migrations',
  });
  console.log('✓ migrations applied');
} catch (err) {
  console.error('✗ migration failed:', err);
  process.exitCode = 1;
} finally {
  await migrationClient.end();
}
