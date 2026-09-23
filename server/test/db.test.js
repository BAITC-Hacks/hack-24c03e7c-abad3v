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
    db.exec('ALTER TABLE tasks DROP COLUMN question_history_json; ALTER TABLE tasks DROP COLUMN active_questions_json; ALTER TABLE tasks DROP COLUMN protected_fields_json; ALTER TABLE tasks DROP COLUMN last_analysis_json;');
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
  const { question_history_json, active_questions_json, protected_fields_json, last_analysis_json, ...preserved } = first.row;
  assert.deepEqual(preserved, original);
  assert.equal(question_history_json, original.questions_json);
  assert.equal(active_questions_json, original.questions_json);
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

test('legacy question archives recover the exact last batch after analyze or compose', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'ai-sana-question-migration-')), 'legacy.sqlite');
  const moduleUrl = new URL('../src/db.js', import.meta.url).href;
  const run = (script) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, moduleUrl], {
    encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const original = run(`
    const { db, newTaskRow, encode } = await import(process.argv[1]);
    const fields = ['need', 'context', 'users', 'data.source', 'result.scope', 'success.metric', 'contact.feedback'];
    const history = fields.map((field, index) => ({ id: 'old-' + index, field, text: 'Уточните ' + field, sourceRevision: 1 }));
    const active = [history[0], history[3], history[6]];
    const answers = [{ questionId: history[2].id, value: 'Студенты', skipped: false }];
    for (const operation of ['analyze', 'compose']) {
      const row = newTaskRow({ id: operation, businessId: 'business-demo', draftText: 'Исходное описание', topic: 'education' });
      const analysis = { operation, sourceRevision: 2, generatedAt: '2026-09-23T10:00:00.000Z', mode: 'template', questions: operation === 'analyze' ? active : history, proposal: JSON.parse(row.working_card_json), evidence: [], warnings: [] };
      db.prepare('UPDATE tasks SET questions_json=?,question_history_json=?,answers_json=?,last_analysis_json=?,ai_result_json=?,analysis_cache_json=?,revision=2 WHERE id=?')
        .run(encode(history), encode(history), encode(answers), encode(analysis), encode(analysis), encode({ analyze: { result: { questions: active } } }), operation);
    }
    db.exec('ALTER TABLE tasks DROP COLUMN active_questions_json');
    console.log(encode({ history, active, answers }));
    db.close();
  `);
  const inspect = `
    const { db, taskFromRow } = await import(process.argv[1]);
    console.log(JSON.stringify(db.prepare('SELECT * FROM tasks ORDER BY id').all().map(taskFromRow)));
    db.close();
  `;
  const migrated = run(inspect);
  for (const task of migrated) {
    assert.deepEqual(task.questions, original.active);
    assert.deepEqual(task.aiResult.questions, original.active);
    assert.deepEqual(task.questionHistory, original.history);
    assert.deepEqual(task.answers, original.answers);
    assert.equal(task.revision, 2);
    assert.equal(task.aiResult.generatedAt, '2026-09-23T10:00:00.000Z');
  }
  assert.deepEqual(run(inspect), migrated, 'restarting must not repeat or reorder the migration');
});
