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
    db.exec('ALTER TABLE tasks DROP COLUMN question_history_json; ALTER TABLE tasks DROP COLUMN protected_fields_json; ALTER TABLE tasks DROP COLUMN last_analysis_json;');
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
  const { question_history_json, protected_fields_json, last_analysis_json, ...preserved } = first.row;
  assert.deepEqual(preserved, original);
  assert.equal(question_history_json, '[]');
  assert.equal(protected_fields_json, '[]');
  assert.equal(last_analysis_json, null);
  assert.equal(first.task.lastAnalysis, null);
  assert.deepEqual(first.task.questionHistory, JSON.parse(original.questions_json));
  assert.deepEqual(first.task.answers, JSON.parse(original.answers_json));
  assert.deepEqual(JSON.parse(run(inspect)), first);

  // A completed proposal survives separate processes, not just a second HTTP GET.
  const analysis = { operation: 'compose', sourceRevision: 7, generatedAt: '2026-09-23T10:00:00.000Z', mode: 'template', questions: [], proposal: first.task.workingCard, warnings: ['Проверьте данные.'], evidence: [] };
  run(`
    const { db } = await import(process.argv[1]);
    db.prepare('UPDATE tasks SET last_analysis_json=? WHERE id=?').run(${JSON.stringify(JSON.stringify(analysis))}, 'legacy-task');
    db.close();
  `);
  assert.deepEqual(JSON.parse(run(inspect)).task.lastAnalysis, { ...analysis, stale: false });
  run(`
    const { db } = await import(process.argv[1]);
    db.prepare('UPDATE tasks SET revision=8 WHERE id=?').run('legacy-task');
    db.close();
  `);
  assert.deepEqual(JSON.parse(run(inspect)).task.lastAnalysis, { ...analysis, stale: true });
});
