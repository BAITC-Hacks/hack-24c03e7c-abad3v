import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyCard, scoreCard } from './card.js';
import { loadServerDemoData } from './demo-data.js';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(serverRoot, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^("|')(.*)\1$/, '$2');
    }
  }
}

const dbPath = resolve(serverRoot, process.env.DB_PATH || './data/ai-sana.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS actors (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('business','team')),
    name TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES actors(id),
    draft_text TEXT NOT NULL,
    topic TEXT NOT NULL,
    confirmed_topic TEXT,
    working_card_json TEXT NOT NULL,
    questions_json TEXT NOT NULL DEFAULT '[]',
    answers_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 1,
    confirmed_card_json TEXT,
    confirmed_revision INTEGER,
    score INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 100),
    score_breakdown_json TEXT NOT NULL,
    score_missing_fields_json TEXT NOT NULL,
    scoring_version TEXT NOT NULL DEFAULT 'v1',
    publication_status TEXT NOT NULL DEFAULT 'draft' CHECK(publication_status IN ('draft','published')),
    analysis_cache_json TEXT NOT NULL DEFAULT '{}',
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    team_id TEXT NOT NULL REFERENCES actors(id),
    idea TEXT NOT NULL,
    plan TEXT NOT NULL,
    timeline TEXT NOT NULL,
    prototype_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','selected','rejected')),
    client_request_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    UNIQUE(team_id, client_request_id)
  );
  CREATE TABLE IF NOT EXISTS ai_usage (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    request_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reserved_usd REAL NOT NULL,
    actual_usd REAL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('reserved','success','failed','unknown')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_catalog ON tasks(publication_status,score DESC,published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_applications_task ON applications(task_id);
  CREATE INDEX IF NOT EXISTS idx_applications_team ON applications(team_id);
`);

// Additive migration preserves existing hackathon data and its public version.
const taskColumns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name));
for (const [name, definition] of Object.entries({
  published_card_json: 'TEXT',
  published_topic: 'TEXT',
  published_revision: 'INTEGER',
  published_rating_json: 'TEXT',
  published_score: 'INTEGER NOT NULL DEFAULT 0',
  ai_result_json: 'TEXT',
  last_analysis_json: 'TEXT',
  manual_fields_json: "TEXT NOT NULL DEFAULT '[]'",
  question_history_json: "TEXT NOT NULL DEFAULT '[]'",
  active_questions_json: 'TEXT',
  protected_fields_json: "TEXT NOT NULL DEFAULT '[]'",
  industry: 'TEXT',
  completeness: 'TEXT',
  is_synthetic: 'INTEGER NOT NULL DEFAULT 0',
})) {
  if (!taskColumns.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
}
for (const row of db.prepare("SELECT * FROM tasks WHERE publication_status='published' AND published_card_json IS NULL AND confirmed_card_json IS NOT NULL").all()) {
  const rating = scoreCard(JSON.parse(row.confirmed_card_json));
  db.prepare('UPDATE tasks SET published_card_json=?,published_topic=?,published_revision=?,published_rating_json=?,published_score=? WHERE id=?')
    .run(row.confirmed_card_json, row.confirmed_topic, row.confirmed_revision, JSON.stringify(rating), rating.score, row.id);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_public_snapshot ON tasks(publication_status,published_score DESC,published_at DESC)');
db.exec('UPDATE tasks SET last_analysis_json=ai_result_json WHERE last_analysis_json IS NULL AND ai_result_json IS NOT NULL');
db.exec('UPDATE tasks SET ai_result_json=last_analysis_json WHERE ai_result_json IS NULL AND last_analysis_json IS NOT NULL');

// Earlier versions mixed the active batch and its archive in questions_json.
// Recover the last exact analyze batch before falling back to the legacy list;
// never discard historical questions, because saved answers refer to their IDs.
for (const row of db.prepare('SELECT * FROM tasks WHERE active_questions_json IS NULL').all()) {
  const legacy = JSON.parse(row.questions_json);
  const analysis = JSON.parse(row.last_analysis_json || 'null');
  const cache = JSON.parse(row.analysis_cache_json);
  const batch = analysis?.operation === 'analyze' ? analysis.questions : cache.analyze?.result?.questions;
  const active = Array.isArray(batch) && batch.length <= 5 ? batch : legacy.slice(-5);
  const history = [...new Map([...JSON.parse(row.question_history_json), ...legacy, ...active].map((question) => [question.id, question])).values()];
  db.prepare('UPDATE tasks SET active_questions_json=?,questions_json=?,question_history_json=? WHERE id=?')
    .run(JSON.stringify(active), JSON.stringify(active), JSON.stringify(history), row.id);
  if (analysis) {
    const restored = JSON.stringify({ ...analysis, questions: active });
    db.prepare('UPDATE tasks SET last_analysis_json=?,ai_result_json=? WHERE id=?').run(restored, restored, row.id);
  }
}

const applicationColumns = new Set(db.prepare('PRAGMA table_info(applications)').all().map((column) => column.name));
for (const [name, definition] of Object.entries({ decision_source: 'TEXT', link_kind: 'TEXT', is_synthetic: 'INTEGER NOT NULL DEFAULT 0' })) {
  if (!applicationColumns.has(name)) db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${definition}`);
}

export const now = () => new Date().toISOString();
export const encode = (value) => JSON.stringify(value);
export const decode = (value) => value === null ? null : JSON.parse(value);

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function actorFromRow(row) {
  if (!row) return null;
  return { id: row.id, kind: row.kind, name: row.name, profile: decode(row.profile_json) };
}

export function questionHistoryFromRow(row) {
  return [...new Map([...decode(row.question_history_json), ...decode(row.questions_json), ...(decode(row.active_questions_json) || [])]
    .map((question) => [question.id, question])).values()];
}

export function taskFromRow(row) {
  if (!row) return null;
  const savedAnalysis = decode(row.last_analysis_json) ?? decode(row.ai_result_json);
  const lastAnalysis = savedAnalysis ? { ...savedAnalysis, stale: savedAnalysis.sourceRevision !== row.revision } : null;
  return {
    id: row.id,
    draftText: row.draft_text,
    industry: row.industry,
    completeness: row.completeness,
    isSynthetic: Boolean(row.is_synthetic),
    topic: row.topic,
    workingCard: decode(row.working_card_json),
    confirmedCard: decode(row.confirmed_card_json),
    publishedCard: decode(row.published_card_json),
    publishedRevision: row.published_revision,
    hasUnpublishedChanges: row.publication_status === 'published' && row.published_revision !== row.revision,
    previewRating: scoreCard(decode(row.working_card_json)),
    aiResult: lastAnalysis,
    lastAnalysis,
    manualFields: [...new Set([...decode(row.manual_fields_json), ...decode(row.protected_fields_json)])],
    questions: decode(row.active_questions_json) ?? decode(row.questions_json),
    questionHistory: questionHistoryFromRow(row),
    answers: decode(row.answers_json),
    revision: row.revision,
    confirmedRevision: row.confirmed_revision,
    publicationStatus: row.publication_status,
    rating: {
      score: row.score,
      level: row.score < 40 ? 'needs_clarification' : row.score < 70 ? 'workable' : row.score < 90 ? 'ready' : 'priority',
      breakdown: decode(row.score_breakdown_json),
      missingFields: decode(row.score_missing_fields_json),
      scoringVersion: row.scoring_version,
    },
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicTaskFromRow(row) {
  if (!row?.published_card_json || row.publication_status !== 'published') return null;
  const task = taskFromRow(row);
  return {
    id: task.id,
    industry: row.industry,
    completeness: row.completeness,
    isSynthetic: Boolean(row.is_synthetic),
    topic: row.published_topic,
    card: task.publishedCard,
    rating: decode(row.published_rating_json),
    publicationStatus: 'published',
    publishedAt: task.publishedAt,
  };
}

export function taskSummaryFromRow(row, scope) {
  const task = taskFromRow(row);
  const isCatalog = scope === 'catalog';
  const card = isCatalog ? task.publishedCard : task.workingCard;
  const publicRating = decode(row.published_rating_json);
  return {
    id: row.id,
    title: card?.title || task.draftText.slice(0, 60),
    industry: row.industry,
    completeness: row.completeness,
    isSynthetic: Boolean(row.is_synthetic),
    topic: isCatalog ? row.published_topic : row.topic,
    rating: isCatalog ? publicRating : task.rating,
    previewRating: isCatalog ? publicRating : task.previewRating,
    need: card?.need ?? null,
    result: card?.result.artifact ?? null,
    dataAvailability: card?.data.availability ?? null,
    deadline: card?.constraints.deadlineMode === 'flexible' ? 'Гибкий срок' : card?.constraints.deadlineDate ?? null,
    hasUnpublishedChanges: isCatalog ? false : task.hasUnpublishedChanges,
    updatedAt: isCatalog ? task.publishedAt : task.updatedAt,
    publicationStatus: task.publicationStatus,
    publishedAt: task.publishedAt,
    applicationCount: Number(row.application_count || 0),
    pendingApplicationCount: Number(row.pending_application_count || 0),
  };
}

export function applicationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    teamId: row.team_id,
    teamName: row.team_name,
    idea: row.idea,
    plan: row.plan,
    timeline: row.timeline,
    prototypeUrl: row.prototype_url,
    status: row.status,
    decisionSource: row.decision_source,
    linkKind: row.link_kind,
    isSynthetic: Boolean(row.is_synthetic),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export function ensureDemoActors() {
  const { actors } = loadServerDemoData(now());
  transaction(() => {
    const insert = db.prepare(`INSERT INTO actors (id,kind,name,profile_json,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,profile_json=excluded.profile_json`);
    for (const actor of actors) insert.run(actor.id, actor.kind, actor.name, encode(actor.profile), now());
  });
}

ensureDemoActors();

export function newTaskRow({ id, businessId, draftText, topic }) {
  const card = emptyCard();
  const rating = scoreCard(card);
  const timestamp = now();
  db.prepare(`INSERT INTO tasks
    (id,business_id,draft_text,topic,working_card_json,score_breakdown_json,score_missing_fields_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, businessId, draftText, topic, encode(card), encode(rating.breakdown), encode(rating.missingFields), timestamp, timestamp);
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
}
