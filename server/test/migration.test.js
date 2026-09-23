import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyCard, scoreCard } from '../src/card.js';

test('миграция сохраняет опубликованный снимок существующей БД и не обновляет его при перезапуске', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'ai-sana-migration-')), 'legacy.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE tasks (
    id TEXT PRIMARY KEY, business_id TEXT, draft_text TEXT, topic TEXT, confirmed_topic TEXT,
    working_card_json TEXT, questions_json TEXT DEFAULT '[]', answers_json TEXT DEFAULT '[]',
    revision INTEGER, confirmed_card_json TEXT, confirmed_revision INTEGER,
    score INTEGER, score_breakdown_json TEXT, score_missing_fields_json TEXT, scoring_version TEXT,
    publication_status TEXT, analysis_cache_json TEXT DEFAULT '{}', published_at TEXT,
    created_at TEXT, updated_at TEXT
  )`);
  const card = { ...emptyCard(), title: 'Опубликованная задача', need: 'Найти аудиторию' };
  const rating = scoreCard(card);
  legacy.prepare(`INSERT INTO tasks
    (id,business_id,draft_text,topic,confirmed_topic,working_card_json,revision,confirmed_card_json,confirmed_revision,score,score_breakdown_json,score_missing_fields_json,scoring_version,publication_status,published_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('legacy-task', 'business-demo', 'Найти аудиторию', 'education', 'education', JSON.stringify(card), 1, JSON.stringify(card), 1, rating.score, JSON.stringify(rating.breakdown), JSON.stringify(rating.missingFields), 'v1', 'published', '2026-09-23', '2026-09-23', '2026-09-23');
  legacy.close();

  const script = `
    const { db, taskFromRow, publicTaskFromRow } = await import(${JSON.stringify(new URL('../src/db.js', import.meta.url).href)});
    const row = db.prepare('SELECT * FROM tasks WHERE id=?').get('legacy-task');
    console.log(JSON.stringify({ owner: taskFromRow(row), public: publicTaskFromRow(row) }));
    db.close();
  `;
  const reload = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath, AI_MODE: 'template' } }));
  const migrated = reload();
  assert.equal(migrated.public.card.title, 'Опубликованная задача');
  assert.equal(migrated.public.rating.score, rating.score);
  assert.equal(migrated.owner.publishedRevision, 1);
  assert.equal(migrated.owner.aiResult, null);
  assert.deepEqual(migrated.owner.manualFields, []);

  const migratedDb = new DatabaseSync(dbPath);
  const nextCard = { ...card, title: 'Ещё не опубликовано', context: 'Сейчас ищут вручную' };
  migratedDb.prepare('UPDATE tasks SET working_card_json=?,confirmed_card_json=?,revision=2,confirmed_revision=2 WHERE id=?')
    .run(JSON.stringify(nextCard), JSON.stringify(nextCard), 'legacy-task');
  migratedDb.close();
  const restarted = reload();
  assert.equal(restarted.public.card.title, 'Опубликованная задача');
  assert.equal(restarted.owner.workingCard.title, 'Ещё не опубликовано');
  assert.equal(restarted.owner.publishedRevision, 1);
  assert.equal(restarted.owner.hasUnpublishedChanges, true);
  assert.equal(restarted.owner.previewRating.score, rating.score + 10);
});
