import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('existing SQLite tasks survive the additive migration and repeated startup', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'ai-sana-migration-')), 'legacy.sqlite');
  const moduleUrl = new URL('../src/db.js', import.meta.url).href;
  const run = (script) => execFileSync(process.execPath, ['--input-type=module', '-e', script, moduleUrl], {
    encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const original = JSON.parse(run(`
    const { db, newTaskRow, encode } = await import(process.argv[1]);
    newTaskRow({ id: 'legacy-task', businessId: 'business-demo', draftText: 'Исходное описание', topic: 'education' });
    db.prepare('UPDATE tasks SET questions_json=?, answers_json=?, revision=7 WHERE id=?').run(
      encode([{ id: 'old-question', field: 'data.source', text: 'Какие данные доступны?', sourceRevision: 6 }]),
      encode([{ questionId: 'old-question', value: 'Тестовая таблица', skipped: false }]), 'legacy-task'
    );
    // Reproduce the previous schema with a real task and saved answer.
    db.exec('ALTER TABLE tasks DROP COLUMN question_history_json; ALTER TABLE tasks DROP COLUMN protected_fields_json;');
    console.log(JSON.stringify(db.prepare('SELECT * FROM tasks WHERE id=?').get('legacy-task')));
    db.close();
  `));

  const inspect = `
    const { db, taskFromRow } = await import(process.argv[1]);
    const row = db.prepare('SELECT * FROM tasks WHERE id=?').get('legacy-task');
    console.log(JSON.stringify({ row, task: taskFromRow(row) }));
    db.close();
  `;
  const first = JSON.parse(run(inspect));
  const { question_history_json, protected_fields_json, ...preserved } = first.row;
  assert.deepEqual(preserved, original);
  assert.equal(question_history_json, '[]');
  assert.equal(protected_fields_json, '[]');
  assert.deepEqual(first.task.questionHistory, JSON.parse(original.questions_json));
  assert.deepEqual(first.task.answers, JSON.parse(original.answers_json));
  assert.deepEqual(JSON.parse(run(inspect)), first);
});
