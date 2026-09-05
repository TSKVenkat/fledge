/**
 * One schema file, because knowing the whole shape of the data should not
 * require opening a directory.
 *
 * Conventions: closed sets are pgEnum, ids are uuid with a database default,
 * columns are named in snake_case explicitly, timestamps carry a zone, and
 * anything that must be true is a constraint rather than a convention held in
 * the application.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['admin', 'teacher', 'student']);
export const classRole = pgEnum('class_role', ['teacher', 'student']);
export const projectKind = pgEnum('project_kind', ['python', 'web']);
export const submissionState = pgEnum('submission_state', [
  'not_started', 'in_progress', 'submitted', 'returned',
]);
export const shareVisibility = pgEnum('share_visibility', [
  'link', 'password', 'authenticated',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Nullable: a child does not need an email address to learn to program, and
  // requiring one makes a school ask parents for data it should not hold.
  email: text('email'),
  // A teacher hands these out on paper. Unique among users, like an email.
  username: text('username'),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('student'),
  isActive: boolean('is_active').notNull().default(true),
  // Set on accounts a teacher created in bulk.
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Partial, because both columns are nullable and many rows will have neither.
  uniqueIndex('users_email_key').on(t.email).where(sql`${t.email} is not null`),
  uniqueIndex('users_username_key').on(t.username).where(sql`${t.username} is not null`),
  check('users_identifier', sql`${t.email} is not null or ${t.username} is not null`),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // The cookie holds a random token; this holds only its sha256. A leaked dump
  // therefore contains nothing that can be replayed as a login.
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
  index('sessions_user_idx').on(t.userId),
  index('sessions_expires_idx').on(t.expiresAt),
]);

export const classes = pgTable('classes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  /**
   * A low-entropy credential by necessity: children read it off a whiteboard,
   * so it cannot be long or case-sensitive. That weakness is paid for
   * elsewhere -- it can be rotated and disabled, joining is rate limited per
   * address, and a wrong, disabled and non-existent code are indistinguishable
   * in the response. Do not "improve" this by making it longer; improve it by
   * keeping those three properties.
   */
  joinCode: text('join_code').notNull(),
  joinCodeEnabled: boolean('join_code_enabled').notNull().default(true),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('classes_join_code_key').on(t.joinCode)]);

export const classMembers = pgTable('class_members', {
  classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: classRole('role').notNull().default('student'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Composite key rather than a surrogate id: a double-tapped Join is then a
  // no-op instead of a duplicate row.
  primaryKey({ columns: [t.classId, t.userId] }),
  index('class_members_user_idx').on(t.userId),
]);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Null means anonymous: someone who opened the site and started typing.
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  classId: uuid('class_id').references(() => classes.id, { onDelete: 'set null' }),
  kind: projectKind('kind').notNull().default('python'),
  title: text('title').notNull().default('Untitled'),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  forkedFromId: uuid('forked_from_id'),
  /** Anonymous ownership, using the same mechanism as a share link. */
  editTokenHash: text('edit_token_hash'),
  editTokenCt: text('edit_token_ct'),
  editTokenIv: text('edit_token_iv'),
  editTokenTag: text('edit_token_tag'),
  /** Anonymous projects only; what the sweeper looks for. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('projects_edit_token_key').on(t.editTokenHash).where(sql`${t.editTokenHash} is not null`),
  index('projects_owner_idx').on(t.ownerId, t.createdAt.desc()).where(sql`${t.deletedAt} is null`),
  // Partial, so the sweep costs what there is to sweep rather than table size.
  index('projects_expiry_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
]);

export const projectFiles = pgTable('project_files', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  content: text('content'),
  contentType: text('content_type').notNull().default('text/x-python'),
  sizeBytes: integer('size_bytes').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.projectId, t.path] })]);

export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  // The hash is the only lookup key; the sealed copy exists so an owner can be
  // shown their own link again without us storing it in the clear.
  tokenHash: text('token_hash').notNull(),
  tokenCt: text('token_ct').notNull().default(''),
  tokenIv: text('token_iv').notNull().default(''),
  tokenTag: text('token_tag').notNull().default(''),
  visibility: shareVisibility('visibility').notNull().default('link'),
  passwordHash: text('password_hash'),
  allowFork: boolean('allow_fork').notNull().default(true),
  allowEmbed: boolean('allow_embed').notNull().default(true),
  embedOptions: jsonb('embed_options').notNull().default(sql`'{}'::jsonb`),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Revoked rather than deleted, so a link that stopped working can be
  // explained rather than merely vanishing.
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('share_links_token_hash_key').on(t.tokenHash),
  index('share_links_project_idx').on(t.projectId),
]);

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  templateProjectId: uuid('template_project_id').notNull().references(() => projects.id),
  title: text('title').notNull(),
  instructions: text('instructions').notNull().default(''),
  dueAt: timestamp('due_at', { withTimezone: true }),
  /** Null means a draft, invisible to students. */
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('assignments_class_idx').on(t.classId).where(sql`${t.deletedAt} is null`)]);

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentId: uuid('assignment_id').notNull().references(() => assignments.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  state: submissionState('state').notNull().default('not_started'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // This is the idempotency mechanism: opening an assignment twice, or
  // double-clicking it, cannot produce a student two forks.
  uniqueIndex('submissions_assignment_student_key').on(t.assignmentId, t.studentId),
  index('submissions_assignment_idx').on(t.assignmentId),
]);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions), projects: many(projects), memberships: many(classMembers),
}));
export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  files: many(projectFiles), shares: many(shareLinks),
}));
export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, { fields: [projectFiles.projectId], references: [projects.id] }),
}));
