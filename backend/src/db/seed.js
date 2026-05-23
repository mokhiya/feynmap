// Seeder — idempotent. Re-runnable.
//
// Usage:
//   npm run db:seed
//
// What it does:
//   1. Inserts the 16 global permissions (ON CONFLICT DO NOTHING by code).
//   2. Ensures a default org exists (SEED_ORG_SLUG, default 'feynmap-dev').
//   3. For that org: inserts 6 roles + role_permissions per the matrix
//      from DEV_PROMPT_corporate.md §3.
//   4. Optionally creates a dev admin (SEED_DEV_ADMIN=true,
//      NODE_ENV=development). Skipped silently in production.
//
// Matrix and permission codes signed off with techlead (see CLAUDE.md
// Phase 1). 16 codes — `role.assign` is split out of `user.manage` so
// HR's "manage users but not roles" is data, not a hidden if/else.

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { eq, and } from 'drizzle-orm';
import { db, sql } from './index.js';
import {
  organizations,
  users,
  permissions,
  roles,
  rolePermissions,
  userRoles,
  auditLogs,
} from './schema.js';

// ---------- 16 permissions ----------

const PERMISSIONS = [
  ['kb.manage', 'Upload, curate, reindex and delete KB documents'],
  ['kb.view', 'View KB documents and topic catalog'],
  ['topic.manage', 'Create and edit topics and lessons'],
  ['competency.manage', 'Define and edit competencies'],
  ['assignment.create', 'Assign topics and lessons to users'],
  ['assignment.view', 'View assignments'],
  ['session.run', 'Run a learning session (chat + assess)'],
  ['session.self_select', 'Pick a topic from the catalog yourself'],
  ['results.self', 'View own session results'],
  ['results.team', 'View team aggregated results'],
  ['results.org', 'View org-wide aggregated results'],
  ['assessment.override', 'Review and override Assessor auto-score (HITL)'],
  ['report.export', 'Export reports'],
  ['user.manage', 'Create, edit, block, deactivate users (NOT role assignment)'],
  ['role.assign', 'Assign roles to users'],
  ['org.manage', 'Edit organization settings'],
];

// ---------- role × permission × scope ----------
//
// Tuple shape: [roleCode, permissionCode, scope]
// Scope ∈ {'own', 'team', 'org'}.
//
// Source: DEV_PROMPT_corporate.md §3 matrix, with techlead-signed
// interpretations noted in CLAUDE.md.

const MATRIX = [
  // --- admin ---
  ['admin', 'kb.manage', 'org'],
  ['admin', 'kb.view', 'org'],
  ['admin', 'topic.manage', 'org'],
  ['admin', 'competency.manage', 'org'],
  ['admin', 'assignment.create', 'org'],
  ['admin', 'assignment.view', 'org'],
  ['admin', 'session.run', 'own'],
  ['admin', 'session.self_select', 'own'],
  ['admin', 'results.org', 'org'],
  ['admin', 'assessment.override', 'org'],
  ['admin', 'report.export', 'org'],
  ['admin', 'user.manage', 'org'],
  ['admin', 'role.assign', 'org'],
  ['admin', 'org.manage', 'org'],

  // --- hr ---
  ['hr', 'kb.view', 'org'],
  ['hr', 'topic.manage', 'org'],
  ['hr', 'assignment.create', 'org'],
  ['hr', 'assignment.view', 'org'],
  ['hr', 'results.org', 'org'],
  ['hr', 'report.export', 'org'],
  ['hr', 'user.manage', 'org'], // people, not roles — role.assign withheld

  // --- assessor ---
  ['assessor', 'kb.view', 'org'],
  ['assessor', 'topic.manage', 'org'],
  ['assessor', 'competency.manage', 'org'],
  ['assessor', 'assignment.create', 'org'],
  ['assessor', 'assignment.view', 'own'], // "свои" = assignments they created
  ['assessor', 'session.run', 'own'],
  ['assessor', 'session.self_select', 'own'],
  ['assessor', 'results.org', 'org'],
  ['assessor', 'assessment.override', 'org'],
  ['assessor', 'report.export', 'org'],

  // --- mentor ---
  ['mentor', 'kb.view', 'org'],
  ['mentor', 'topic.manage', 'team'],
  ['mentor', 'assignment.create', 'team'],
  ['mentor', 'assignment.view', 'team'],
  ['mentor', 'session.run', 'own'],
  ['mentor', 'results.team', 'team'],
  ['mentor', 'report.export', 'team'],

  // --- learner_free ---
  ['learner_free', 'kb.view', 'org'], // catalog
  ['learner_free', 'assignment.view', 'own'],
  ['learner_free', 'session.run', 'own'],
  ['learner_free', 'session.self_select', 'own'],
  ['learner_free', 'results.self', 'own'],
  ['learner_free', 'report.export', 'own'],

  // --- learner_assigned ---
  ['learner_assigned', 'assignment.view', 'own'],
  ['learner_assigned', 'session.run', 'own'],
  ['learner_assigned', 'results.self', 'own'],
];

const ROLE_DISPLAY = {
  super_admin: 'Super Admin',
  admin: 'Administrator',
  hr: 'HR',
  assessor: 'Assessor',
  mentor: 'Mentor',
  learner_free: 'Learner (free)',
  learner_assigned: 'Learner (assigned)',
};

const SEED_ROLES = [
  'admin',
  'hr',
  'assessor',
  'mentor',
  'learner_free',
  'learner_assigned',
];
// super_admin is created lazily — only if SEED_SUPER_ADMIN=true. It
// crosses org boundaries and we don't want one to exist by accident.

// ---------- helpers ----------

async function upsertPermissions() {
  console.log('• permissions');
  for (const [code, description] of PERMISSIONS) {
    await db
      .insert(permissions)
      .values({ code, description })
      .onConflictDoNothing({ target: permissions.code });
  }
  const count = await db.select().from(permissions);
  console.log(`  → ${count.length} permission rows total`);
}

async function ensureOrg(slug, name) {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (existing) {
    console.log(`• org "${slug}" exists`);
    return existing;
  }
  const [created] = await db
    .insert(organizations)
    .values({ slug, name })
    .returning();
  console.log(`• org "${slug}" created`);
  return created;
}

async function upsertRolesForOrg(org) {
  console.log(`• roles for org "${org.slug}"`);
  for (const code of SEED_ROLES) {
    await db
      .insert(roles)
      .values({ orgId: org.id, code, name: ROLE_DISPLAY[code] })
      .onConflictDoNothing({ target: [roles.orgId, roles.code] });
  }
  const created = await db.select().from(roles).where(eq(roles.orgId, org.id));
  console.log(`  → ${created.length}/6 roles present`);
  return created;
}

async function applyMatrix(org, orgRoles) {
  console.log(`• role_permissions for org "${org.slug}"`);
  const roleByCode = new Map(orgRoles.map((r) => [r.code, r]));
  const allPerms = await db.select().from(permissions);
  const permByCode = new Map(allPerms.map((p) => [p.code, p]));

  let inserted = 0;
  for (const [roleCode, permCode, scope] of MATRIX) {
    const role = roleByCode.get(roleCode);
    const perm = permByCode.get(permCode);
    if (!role) throw new Error(`role missing: ${roleCode}`);
    if (!perm) throw new Error(`permission missing: ${permCode}`);
    const result = await db
      .insert(rolePermissions)
      .values({ roleId: role.id, permissionId: perm.id, scope })
      .onConflictDoNothing();
    // postgres-js doesn't return rowCount reliably across drivers; we
    // just trust onConflictDoNothing and report the matrix size.
    inserted += 1;
  }
  console.log(`  → ${MATRIX.length} matrix entries applied (idempotent)`);
}

async function maybeCreateDevAdmin(org) {
  if (process.env.SEED_DEV_ADMIN !== 'true') {
    console.log('• dev admin skipped (SEED_DEV_ADMIN != "true")');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    console.log('• dev admin skipped (NODE_ENV=production)');
    return;
  }
  const email = process.env.SEED_DEV_EMAIL || 'admin@feynmap.local';
  const password = process.env.SEED_DEV_PASSWORD;
  if (!password) {
    console.log(
      '• dev admin skipped — set SEED_DEV_PASSWORD in .env (and rotate after first login)',
    );
    return;
  }

  // Idempotent: if user already exists, do nothing (don't change their pw).
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, org.id), eq(users.email, email)))
    .limit(1);
  if (existing) {
    console.log(`• dev admin "${email}" already exists — skip`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [created] = await db
    .insert(users)
    .values({
      orgId: org.id,
      email,
      passwordHash,
      fullName: 'Dev Admin',
      locale: 'ru',
      status: 'active',
    })
    .returning();

  const [adminRole] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.orgId, org.id), eq(roles.code, 'admin')))
    .limit(1);
  if (!adminRole) throw new Error('admin role missing for org');

  await db.insert(userRoles).values({
    userId: created.id,
    roleId: adminRole.id,
    assignedBy: null,
  });

  await db.insert(auditLogs).values({
    orgId: org.id,
    actorUserId: null, // system action
    action: 'user.create',
    targetType: 'user',
    targetId: created.id,
    meta: { reason: 'seed', email, roles: ['admin'] },
  });

  console.log(`• dev admin "${email}" created (role: admin)`);
  console.log('  ⚠ rotate this password after first login');
}

// ---------- main ----------

async function main() {
  const slug = process.env.SEED_ORG_SLUG || 'feynmap-dev';
  const name = process.env.SEED_ORG_NAME || 'FeynMap (dev)';

  console.log('FeynMap seeder');
  console.log('==============');

  await upsertPermissions();
  const org = await ensureOrg(slug, name);
  const orgRoles = await upsertRolesForOrg(org);
  await applyMatrix(org, orgRoles);
  await maybeCreateDevAdmin(org);

  console.log('\n✓ seed complete');
}

try {
  await main();
} catch (err) {
  console.error('\n✗ seed failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
