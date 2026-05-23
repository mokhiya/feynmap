// FeynMap — Phase 1 schema
//
// Conventions (see CLAUDE.md):
//   - Multi-tenant from day one. Every business entity carries `org_id`.
//   - UUID PKs via pgcrypto.gen_random_uuid() (extension created by initdb).
//   - timestamps: created_at, updated_at — UTC, defaultNow().
//   - Soft state via `status` enums; we do NOT soft-delete users in v1
//     (block + AuditLog covers it).
//
// Permissions model:
//   permissions   — GLOBAL catalog (15 codes, not org-scoped).
//   roles         — per-org, with a `code` matching one of the 6 seed roles.
//   role_permissions — many-to-many + scope (own/team/org).
//   user_roles    — many-to-many (a user can hold >1 role).
//
// Mentor binding is its own table (not a column on users) so a user can
// have multiple mentors and the mapping is auditable independently.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ---------- enums ----------

export const userStatus = pgEnum('user_status', ['active', 'blocked', 'invited']);

export const roleCode = pgEnum('role_code', [
  'super_admin', // platform owner — sees across orgs (single-org runtime in v1)
  'admin',       // org admin — users, roles, billing
  'assessor',    // owns competencies, reviews assessment results
  'hr',          // analytics, assignments
  'mentor',      // assigns + reviews own learners
  'learner_free',
  'learner_assigned',
]);

export const permissionScope = pgEnum('permission_scope', ['own', 'team', 'org']);

export const auditAction = pgEnum('audit_action', [
  'user.create',
  'user.update',
  'user.block',
  'user.unblock',
  'user.password_reset',
  'user.import',
  'role.assign',
  'role.revoke',
  'mentor.bind',
  'mentor.unbind',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  // Reserved for later phases — declared up front so AuditLog enum
  // doesn't churn migrations every milestone:
  'kb.upload',
  'kb.delete',
  'kb.reindex',
  'assignment.create',
  'assessment.override',
  'session.convert_to_assessment', // practice -> assessment (M2.5.1)
]);

// ---------- core: organization ----------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex('organizations_slug_idx').on(t.slug),
  }),
);

// ---------- users ----------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    locale: text('locale').notNull().default('ru'), // 'ru' | 'en' | 'uz'
    status: userStatus('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Email is unique per-org (so two orgs can have the same email).
    emailPerOrgIdx: uniqueIndex('users_org_email_idx').on(t.orgId, t.email),
    orgIdx: index('users_org_idx').on(t.orgId),
  }),
);

// ---------- RBAC ----------

// Permissions are a global catalog. The exact 15 codes are populated by
// the seeder; declaring them here as text keeps schema flexible if the
// matrix evolves between phases.
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),        // e.g. 'kb.upload', 'session.review'
    description: text('description').notNull().default(''),
  },
  (t) => ({
    codeIdx: uniqueIndex('permissions_code_idx').on(t.code),
  }),
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: roleCode('code').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgCodeIdx: uniqueIndex('roles_org_code_idx').on(t.orgId, t.code),
  }),
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    scope: permissionScope('scope').notNull().default('own'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId, t.scope] }),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
    userIdx: index('user_roles_user_idx').on(t.userId),
  }),
);

// ---------- mentor binding ----------

export const mentorBindings = pgTable(
  'mentor_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    mentorId: uuid('mentor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pairIdx: uniqueIndex('mentor_bindings_pair_idx').on(t.mentorId, t.learnerId),
    learnerIdx: index('mentor_bindings_learner_idx').on(t.learnerId),
    orgIdx: index('mentor_bindings_org_idx').on(t.orgId),
  }),
);

// ---------- audit log ----------
//
// Append-only. `meta` is JSONB so we can record action-specific payload
// (e.g. for assessment.override: before/after score, comment) without
// migrations per action type. PII goes inside `meta` only if necessary.

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: auditAction('action').notNull(),
    targetType: text('target_type'), // 'user' | 'role' | 'document' | 'session' | ...
    targetId: text('target_id'),     // free-form so we can log non-UUID refs
    meta: jsonb('meta').notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgCreatedIdx: index('audit_logs_org_created_idx').on(t.orgId, t.createdAt),
    actorIdx: index('audit_logs_actor_idx').on(t.actorUserId),
    actionIdx: index('audit_logs_action_idx').on(t.action),
  }),
);
