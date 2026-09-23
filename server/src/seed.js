import { db, encode, now, transaction } from './db.js';
import { emptyCard, mergeCard, scoreCard } from './card.js';
import { loadServerDemoData } from './demo-data.js';
import { removeUnchangedLegacyDemo } from './legacy-demo.js';

const timestamp = now();
const dataset = loadServerDemoData(timestamp);

// Reject inconsistent files before replacing any task, application or legacy row.
for (const task of dataset.tasks) {
  mergeCard(emptyCard(), task.workingCard);
  const actual = scoreCard(task.workingCard);
  if (actual.score !== task.rating.score || actual.level !== task.rating.level) {
    throw new Error(`CSV rating mismatch for ${task.id}: CSV ${task.rating.score}, backend ${actual.score}`);
  }
  if (!task.id.startsWith('demo-task-') || task.businessId !== 'business-demo' || !task.isSynthetic) {
    throw new Error(`Refusing to seed a task outside the synthetic demo namespace: ${task.id}`);
  }
}
for (const application of dataset.applications) {
  if (!application.id.startsWith('demo-app-') || !application.isSynthetic) throw new Error(`Refusing to seed a non-demo application: ${application.id}`);
}

const report = transaction(() => {
  const cleanup = removeUnchangedLegacyDemo(db);
  const changes = { insertedTasks: 0, updatedTasks: 0, insertedApplications: 0, updatedApplications: 0, cleanup };
  const taskColumns = [
    'id', 'business_id', 'draft_text', 'topic', 'confirmed_topic', 'working_card_json', 'confirmed_card_json',
    'revision', 'confirmed_revision', 'score', 'score_breakdown_json', 'score_missing_fields_json', 'scoring_version',
    'publication_status', 'published_card_json', 'published_topic', 'published_revision', 'published_rating_json', 'published_score',
    'questions_json', 'answers_json', 'question_history_json', 'manual_fields_json', 'protected_fields_json', 'analysis_cache_json',
    'ai_result_json', 'last_analysis_json', 'industry', 'completeness', 'is_synthetic', 'published_at', 'created_at', 'updated_at',
  ];
  const upsertTask = db.prepare(`INSERT INTO tasks (${taskColumns.join(',')}) VALUES (${taskColumns.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${taskColumns.filter((column) => column !== 'id').map((column) => `${column}=excluded.${column}`).join(',')}`);

  for (const task of dataset.tasks) {
    const existing = db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
    if (existing && existing.business_id !== 'business-demo') throw new Error(`Demo task ID belongs to another business: ${task.id}`);
    const values = {
      id: task.id, business_id: task.businessId, draft_text: task.draftText, topic: task.topic,
      confirmed_topic: task.confirmedTopic, working_card_json: encode(task.workingCard), confirmed_card_json: task.confirmedCard ? encode(task.confirmedCard) : null,
      score: task.rating.score, score_breakdown_json: encode(task.rating.breakdown), score_missing_fields_json: encode(task.rating.missingFields), scoring_version: task.rating.scoringVersion,
      publication_status: task.publicationStatus, published_card_json: task.publishedCard ? encode(task.publishedCard) : null,
      published_topic: task.publishedTopic, published_rating_json: task.publishedRating ? encode(task.publishedRating) : null,
      published_score: task.publishedRating?.score ?? 0, questions_json: '[]', answers_json: '[]', question_history_json: '[]',
      manual_fields_json: '[]', protected_fields_json: '[]', analysis_cache_json: '{}', ai_result_json: null, last_analysis_json: null,
      industry: task.industry, completeness: task.completeness, is_synthetic: 1,
    };
    const revisionMatches = existing && existing.confirmed_revision === (task.confirmedCard ? existing.revision : null)
      && existing.published_revision === (task.publishedCard ? existing.revision : null);
    const changed = !existing || !revisionMatches || Object.entries(values).some(([key, value]) => existing[key] !== value);
    if (!changed) continue;
    const revision = existing ? existing.revision + 1 : task.revision;
    Object.assign(values, {
      revision, confirmed_revision: task.confirmedCard ? revision : null, published_revision: task.publishedCard ? revision : null,
      published_at: task.publishedCard ? timestamp : null, created_at: existing?.created_at ?? task.createdAt, updated_at: timestamp,
    });
    upsertTask.run(...taskColumns.map((column) => values[column]));
    if (existing) changes.updatedTasks += 1;
    else changes.insertedTasks += 1;
  }

  const applicationColumns = [
    'id', 'task_id', 'team_id', 'idea', 'plan', 'timeline', 'prototype_url', 'status', 'client_request_id',
    'decision_source', 'link_kind', 'is_synthetic', 'created_at', 'decided_at',
  ];
  const upsertApplication = db.prepare(`INSERT INTO applications (${applicationColumns.join(',')}) VALUES (${applicationColumns.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${applicationColumns.filter((column) => column !== 'id').map((column) => `${column}=excluded.${column}`).join(',')}`);
  for (const application of dataset.applications) {
    const existing = db.prepare('SELECT * FROM applications WHERE id=?').get(application.id);
    const values = {
      id: application.id, task_id: application.taskId, team_id: application.teamId, idea: application.idea, plan: application.plan,
      timeline: application.timeline, prototype_url: application.prototypeUrl, status: application.status, client_request_id: application.clientRequestId,
      decision_source: application.decisionSource, link_kind: application.linkKind, is_synthetic: 1,
    };
    const changed = !existing || Object.entries(values).some(([key, value]) => existing[key] !== value);
    if (!changed) continue;
    Object.assign(values, {
      created_at: existing?.created_at ?? application.createdAt,
      decided_at: application.status === 'pending' ? null : existing?.status === application.status && existing.decided_at ? existing.decided_at : timestamp,
    });
    upsertApplication.run(...applicationColumns.map((column) => values[column]));
    if (existing) changes.updatedApplications += 1;
    else changes.insertedApplications += 1;
  }
  return changes;
});

console.log(`CSV demo synchronized: ${dataset.tasks.length} tasks, ${dataset.actors.filter((actor) => actor.kind === 'team').length} teams, ${dataset.applications.length} applications.`);
console.log(JSON.stringify(report));
if (report.cleanup.preserved.length) console.log(`Kept changed or referenced legacy records: ${report.cleanup.preserved.join(', ')}`);
