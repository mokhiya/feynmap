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
  integer,
  doublePrecision,
  bigint,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// pgvector custom type. bge-m3 produces 1024-dim float vectors.
// We pass dimensions per-column so future swaps to a smaller/larger
// model are one-line changes.
export const vector = customType({
  dataType(config) {
    const dim = config?.dimensions ?? 1024;
    return `vector(${dim})`;
  },
  toDriver(value) {
    if (value == null) return null;
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    if (value == null) return null;
    if (Array.isArray(value)) return value;
    // pg returns "[0.1,0.2,...]" as text
    const s = String(value).replace(/^\[|\]$/g, '');
    return s ? s.split(',').map(Number) : [];
  },
});

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
  'assignment.complete',
  'assessment.override',
  'assessment.appeal',
  'assessment.appeal_resolve',
  'topic.create',
  'topic.update',
  'topic.delete',
  'lesson.create',
  'lesson.update',
  'lesson.delete',
  'session.start',
  'session.finalize',
  'session.flag_suspicious',
  'session.convert_to_assessment', // practice -> assessment (M2.5.1)
]);

export const documentStatus = pgEnum('document_status', [
  'uploaded',
  'parsing',
  'indexed',
  'failed',
]);

export const topicStatus = pgEnum('topic_status', ['draft', 'published', 'archived']);

export const lessonStatus = pgEnum('lesson_status', ['draft', 'published', 'archived']);

export const sessionMode = pgEnum('session_mode', ['practice', 'assessment']);

export const sessionStatus = pgEnum('session_status', [
  'in_progress',
  'auto_scored',
  'pending_review',
  'finalized',
  'abandoned',
]);

export const assessmentStatus = pgEnum('assessment_status', [
  'auto',
  'pending_review',
  'approved',
  'overridden',
]);

export const appealStatus = pgEnum('appeal_status', [
  'open',
  'accepted',
  'rejected',
]);

export const assignmentStatus = pgEnum('assignment_status', [
  'assigned',
  'in_progress',
  'completed',
  'overdue',
  'cancelled',
]);

export const assignmentTargetType = pgEnum('assignment_target_type', ['topic', 'lesson']);

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

// ============================================================
// Phase 2 — Knowledge Base
// ============================================================

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    storagePath: text('storage_path').notNull(),
    plainText: text('plain_text'),                 // extracted full text (preview / debug)
    status: documentStatus('status').notNull().default('uploaded'),
    error: text('error'),
    version: integer('version').notNull().default(1), // M5 KB versioning
    chunkCount: integer('chunk_count').notNull().default(0),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('documents_org_idx').on(t.orgId),
    statusIdx: index('documents_status_idx').on(t.status),
  }),
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    tokens: integer('tokens').notNull().default(0),
    page: integer('page'),
    heading: text('heading'),
    embedding: vector('embedding', { dimensions: 1024 }), // bge-m3
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    docChunkIdx: uniqueIndex('document_chunks_doc_idx_idx').on(t.documentId, t.chunkIndex),
    orgIdx: index('document_chunks_org_idx').on(t.orgId),
  }),
);

// ============================================================
// Phase 3 — Topics, Competencies, Lessons
// ============================================================

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    locale: text('locale').notNull().default('ru'),
    status: topicStatus('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('topics_org_idx').on(t.orgId),
    orgStatusIdx: index('topics_org_status_idx').on(t.orgId, t.status),
  }),
);

export const topicDocuments = pgTable(
  'topic_documents',
  {
    topicId: uuid('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.topicId, t.documentId] }),
    docIdx: index('topic_documents_doc_idx').on(t.documentId),
  }),
);

export const competencies = pgTable(
  'competencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    weight: doublePrecision('weight').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('competencies_org_idx').on(t.orgId),
    topicIdx: index('competencies_topic_idx').on(t.topicId),
  }),
);

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    introContent: text('intro_content').notNull().default(''),
    status: lessonStatus('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('lessons_org_idx').on(t.orgId),
  }),
);

export const lessonTopics = pgTable(
  'lesson_topics',
  {
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.lessonId, t.topicId] }),
  }),
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    storagePath: text('storage_path').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    lessonIdx: index('attachments_lesson_idx').on(t.lessonId),
  }),
);

// ============================================================
// Phase 4 — Assignments
// ============================================================

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    assignerId: uuid('assigner_id').notNull().references(() => users.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: assignmentTargetType('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: assignmentStatus('status').notNull().default('assigned'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('assignments_org_idx').on(t.orgId),
    assigneeIdx: index('assignments_assignee_idx').on(t.assigneeId),
    statusIdx: index('assignments_status_idx').on(t.status),
  }),
);

// ============================================================
// Phase 5 — Sessions + AssessmentResults
// ============================================================

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    topicLabel: text('topic_label').notNull().default(''), // human-readable copy for analytics
    mode: sessionMode('mode').notNull().default('practice'),
    status: sessionStatus('status').notNull().default('in_progress'),
    locale: text('locale').notNull().default('ru'),
    transcript: jsonb('transcript').notNull().default([]), // [{role, content}, ...]
    // Anti-fraud signals collected during session (M2.3)
    flags: jsonb('flags').notNull().default({}),
    // Wellbeing telemetry (M2.5.3-4)
    wellbeing: jsonb('wellbeing').notNull().default({}),
    docVersions: jsonb('doc_versions').notNull().default({}), // {docId: version} pinned at session start (M5)
    assignmentId: uuid('assignment_id').references(() => assignments.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index('sessions_org_idx').on(t.orgId),
    userIdx: index('sessions_user_idx').on(t.userId),
    modeStatusIdx: index('sessions_mode_status_idx').on(t.mode, t.status),
  }),
);

export const assessmentResults = pgTable(
  'assessment_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    competencies: jsonb('competencies').notNull().default([]), // [{name, score, evidence, criterion, gap, source_refs}]
    strengths: jsonb('strengths').notNull().default([]),
    gaps: jsonb('gaps').notNull().default([]),
    recommendations: jsonb('recommendations').notNull().default([]),
    nextFocus: text('next_focus'),
    sourceRefs: jsonb('source_refs').notNull().default([]), // [{docId, chunkIndex, page}]
    status: assessmentStatus('status').notNull().default('auto'),
    overriddenBy: uuid('overridden_by').references(() => users.id, { onDelete: 'set null' }),
    overrideComment: text('override_comment'),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: uniqueIndex('assessment_results_session_idx').on(t.sessionId),
    userIdx: index('assessment_results_user_idx').on(t.userId),
    statusIdx: index('assessment_results_status_idx').on(t.status),
  }),
);

// Appeals — learner pushes back on an Assessor decision (M2.2)
export const assessmentAppeals = pgTable(
  'assessment_appeals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resultId: uuid('result_id').notNull().references(() => assessmentResults.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: appealStatus('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    resultIdx: index('appeals_result_idx').on(t.resultId),
    statusIdx: index('appeals_status_idx').on(t.status),
  }),
);

// ============================================================
// M3.2 — Role-target leveling
// ============================================================

export const roleTargets = pgTable(
  'role_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    roleLabel: text('role_label').notNull(), // free-form job role ("Backend dev", "PM"…)
    competencyId: uuid('competency_id').references(() => competencies.id, { onDelete: 'cascade' }),
    competencyName: text('competency_name').notNull(), // denorm copy for free-floating comps
    targetScore: integer('target_score').notNull().default(70), // 0..100
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgRoleIdx: index('role_targets_org_role_idx').on(t.orgId, t.roleLabel),
  }),
);

// ============================================================
// M3.3 — Spaced repetition
// ============================================================

export const spacedReviews = pgTable(
  'spaced_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    competencyName: text('competency_name').notNull(),
    lastScore: integer('last_score').notNull().default(0),
    reviewAt: timestamp('review_at', { withTimezone: true }).notNull(),
    intervalDays: integer('interval_days').notNull().default(1),
    easeFactor: doublePrecision('ease_factor').notNull().default(2.5),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userReviewIdx: index('spaced_reviews_user_review_idx').on(t.userId, t.reviewAt),
  }),
);

