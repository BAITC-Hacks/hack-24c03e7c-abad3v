import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyCard, scoreCard } from './card.js';

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

export function taskFromRow(row) {
  if (!row) return null;
  const workingCard = decode(row.working_card_json);
  return {
    id: row.id,
    draftText: row.draft_text,
    topic: row.topic,
    workingCard,
    previewRating: scoreCard(workingCard),
    confirmedCard: decode(row.confirmed_card_json),
    questions: decode(row.questions_json),
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
  if (!row?.confirmed_card_json || row.publication_status !== 'published') return null;
  const task = taskFromRow(row);
  return {
    id: task.id,
    topic: row.confirmed_topic,
    card: task.confirmedCard,
    rating: task.rating,
    publicationStatus: 'published',
    publishedAt: task.publishedAt,
  };
}

export function taskSummaryFromRow(row, scope) {
  const task = taskFromRow(row);
  const isCatalog = scope === 'catalog';
  const card = isCatalog ? task.confirmedCard : task.workingCard;
  return {
    id: row.id,
    title: card?.title || task.draftText.slice(0, 60),
    topic: isCatalog ? row.confirmed_topic : row.topic,
    rating: task.rating,
    ...(!isCatalog ? { previewRating: task.previewRating } : {}),
    publicationStatus: task.publicationStatus,
    publishedAt: task.publishedAt,
    applicationCount: Number(row.application_count || 0),
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
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export function ensureDemoActors() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM actors').get().count;
  if (count) return;
  const actors = [
    ['business-demo', 'business', 'Карьерный центр', { organization: 'Карьерный центр AI Sana' }],
    ['team-orbit', 'team', 'Orbit', { interests: ['career', 'education'], skills: ['React', 'UX'], technologies: ['JavaScript'] }],
    ['team-sana', 'team', 'Sana Labs', { interests: ['education'], skills: ['Python', 'AI'], technologies: ['Python', 'React'] }],
    ['team-step', 'team', 'Step', { interests: ['operations'], skills: ['Analytics'], technologies: ['JavaScript'] }],
    ['team-spark', 'team', 'Spark', { interests: ['career'], skills: ['Design'], technologies: ['Figma', 'React'] }],
    ['team-vector', 'team', 'Vector', { interests: ['analytics'], skills: ['Data'], technologies: ['Python'] }],
  ];
  transaction(() => {
    const insert = db.prepare('INSERT INTO actors (id,kind,name,profile_json,created_at) VALUES (?,?,?,?,?)');
    for (const actor of actors) insert.run(actor[0], actor[1], actor[2], encode(actor[3]), now());
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
