import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CARD_PATHS } from '../src/card.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ai-sana-test-')), 'test.sqlite');
process.env.AI_MODE = 'template';
delete process.env.OPENAI_API_KEY;

const { app, analysisHash } = await import('../src/app.js');
const { db, taskFromRow } = await import('../src/db.js');

test('полный путь: низкий рейтинг, AI fallback, рост баллов, два выбранных отклика', async (t) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  let externalRequests = 0;
  const guardedFetch = t.mock.method(globalThis, 'fetch', (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url?.startsWith(`${base}/`)) return originalFetch(input, options);
    externalRequests += 1;
    throw new Error('External network is disabled in API tests');
  });
  async function request(path, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    const business = await request('/api/demo/session', { method: 'POST', body: { actorId: 'business-demo' } });
    assert.equal(business.status, 200);
    const businessCookie = business.cookie;

    const invalid = await request('/api/tasks', { method: 'POST', cookie: businessCookie, body: { draftText: 'Черновик', topic: 'unknown' } });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');

    const created = await request('/api/tasks', { method: 'POST', cookie: businessCookie, body: { draftText: 'Нужно приложение для студентов', topic: 'education' } });
    assert.equal(created.status, 201);
    const id = created.body.task.id;
    assert.equal(created.body.task.revision, 1);
    assert.equal(created.body.task.rating.score, 0);
    assert.equal(created.body.task.lastAnalysis, null);

    const noTitle = await request(`/api/tasks/${id}/confirm`, { method: 'POST', cookie: businessCookie, body: { revision: 1, confirmed: true } });
    assert.equal(noTitle.body.rating.score, 0);
    const blockedPublish = await request(`/api/tasks/${id}/publish`, { method: 'POST', cookie: businessCookie, body: { revision: 1 } });
    assert.equal(blockedPublish.status, 422);

    const titled = await request(`/api/tasks/${id}`, { method: 'PATCH', cookie: businessCookie, body: { revision: 1, cardPatch: { title: 'Помощник студентам' } } });
    assert.equal(titled.body.task.revision, 2);
    assert.equal(titled.body.previewRating.score, 0);
    const confirmed = await request(`/api/tasks/${id}/confirm`, { method: 'POST', cookie: businessCookie, body: { revision: 2, confirmed: true } });
    assert.equal(confirmed.body.rating.score, 0);
    const published = await request(`/api/tasks/${id}/publish`, { method: 'POST', cookie: businessCookie, body: { revision: 2 } });
    assert.equal(published.status, 200);
    const catalog = await request('/api/tasks?scope=catalog&level=needs_clarification');
    assert.equal(catalog.body.total, 1);
    assert.equal(catalog.body.items[0].id, id);

    const analyzed = await request(`/api/tasks/${id}/analyze`, { method: 'POST', cookie: businessCookie, body: { revision: 2, mode: 'analyze' } });
    assert.equal(analyzed.status, 200);
    assert.equal(analyzed.body.mode, 'template');
    assert.ok(analyzed.body.questions.length >= 3);
    const restoredAnalysis = (await request(`/api/tasks/${id}`, { cookie: businessCookie })).body.task.lastAnalysis;
    assert.deepEqual(restoredAnalysis, analyzed.body);
    assert.equal(restoredAnalysis.operation, 'analyze');
    assert.equal(restoredAnalysis.stale, false);
    assert.ok(Number.isFinite(Date.parse(restoredAnalysis.generatedAt)));

    const answered = await request(`/api/tasks/${id}`, { method: 'PATCH', cookie: businessCookie, body: { revision: 2, answers: [{ questionId: analyzed.body.questions[0].id, value: 'Вручную подбираем материалы', skipped: false }] } });
    assert.equal(answered.body.task.revision, 3);
    assert.deepEqual(answered.body.task.lastAnalysis, { ...restoredAnalysis, stale: true });
    const stale = await request(`/api/tasks/${id}/publish`, { method: 'POST', cookie: businessCookie, body: { revision: 2 } });
    assert.equal(stale.status, 409);

    const enriched = await request(`/api/tasks/${id}`, { method: 'PATCH', cookie: businessCookie, body: { revision: 3, cardPatch: {
      context: 'Материалы подбирают вручную.', need: 'Упростить подготовку к занятиям.', users: 'Студенты первых курсов.',
      data: { availability: 'available', source: 'Учебные планы и синтетические упражнения.' },
      result: { artifact: 'Веб-прототип.', scope: 'Подбор пяти упражнений без входа в аккаунт.' },
      success: { metric: 'Проверка десяти сценариев.', target: 'Не менее восьми проходят.' },
      constraints: { deadlineMode: 'flexible', technologyAccess: 'Внутренние системы не используются.' },
      contact: { channel: 'career@example.org', consultation: 'Созвон раз в неделю.', feedback: 'Ответ по почте за два дня.' },
    } } });
    assert.equal(enriched.body.previewRating.score, 100);
    assert.equal(enriched.body.task.rating.score, 0);
    const beforeConfirm = await request('/api/tasks?scope=catalog&level=needs_clarification');
    assert.equal(beforeConfirm.body.total, 1);
    const stillPublicOldVersion = await request(`/api/tasks/${id}`);
    assert.equal(stillPublicOldVersion.body.task.card.context, null);
    assert.equal(stillPublicOldVersion.body.task.rating.score, 0);
    assert.equal(Object.hasOwn(stillPublicOldVersion.body.task, 'lastAnalysis'), false);
    assert.equal(Object.hasOwn(stillPublicOldVersion.body.task, 'evidence'), false);
    assert.equal(Object.hasOwn(catalog.body.items[0], 'lastAnalysis'), false);
    const confirmedFull = await request(`/api/tasks/${id}/confirm`, { method: 'POST', cookie: businessCookie, body: { revision: 4, confirmed: true } });
    assert.equal(confirmedFull.body.rating.score, 100);
    assert.equal(confirmedFull.body.rating.breakdown.reduce((sum, row) => sum + row.earned, 0), 100);
    assert.equal(confirmedFull.body.task.hasUnpublishedChanges, true);
    assert.equal(confirmedFull.body.task.publishedRevision, 2);
    const afterConfirm = await request(`/api/tasks/${id}`);
    assert.equal(afterConfirm.body.task.card.context, null);
    assert.equal(afterConfirm.body.task.rating.score, 0, 'confirmation must not update the public snapshot');
    const unpublishedTop = await request('/api/tasks?scope=catalog&level=priority&topic=education');
    assert.equal(unpublishedTop.body.total, 0);
    const republished = await request(`/api/tasks/${id}/publish`, { method: 'POST', cookie: businessCookie, body: { revision: 4 } });
    assert.equal(republished.body.task.hasUnpublishedChanges, false);
    assert.equal(republished.body.task.publishedRevision, 4);
    const top = await request('/api/tasks?scope=catalog&level=priority&topic=education');
    assert.equal(top.body.total, 1);
    assert.equal(top.body.items[0].need, 'Упростить подготовку к занятиям.');
    assert.equal(top.body.items[0].result, 'Веб-прототип.');
    assert.equal(top.body.items[0].dataAvailability, 'available');
    assert.equal(top.body.items[0].deadline, 'Гибкий срок');

    const teamA = await request('/api/demo/session', { method: 'POST', body: { actorId: 'demo-team-02' } });
    const teamB = await request('/api/demo/session', { method: 'POST', body: { actorId: 'demo-team-03' } });
    const bodyA = { idea: 'Тренажёр задач', plan: 'Макет и тест', timeline: '2 недели', prototypeUrl: 'https://example.org/a', clientRequestId: 'demo-request-a' };
    const appA = await request(`/api/tasks/${id}/applications`, { method: 'POST', cookie: teamA.cookie, body: bodyA });
    const retry = await request(`/api/tasks/${id}/applications`, { method: 'POST', cookie: teamA.cookie, body: bodyA });
    assert.equal(appA.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.application.id, appA.body.application.id);
    const appB = await request(`/api/tasks/${id}/applications`, { method: 'POST', cookie: teamB.cookie, body: { ...bodyA, idea: 'План изучения', clientRequestId: 'demo-request-b' } });
    assert.equal(appB.status, 201);
    const forbidden = await request(`/api/applications/${appA.body.application.id}`, { method: 'PATCH', cookie: teamA.cookie, body: { status: 'selected' } });
    assert.equal(forbidden.status, 403);

    for (const application of [appA, appB]) {
      const decision = await request(`/api/applications/${application.body.application.id}`, { method: 'PATCH', cookie: businessCookie, body: { status: 'selected' } });
      assert.equal(decision.status, 200);
    }
    const all = await request(`/api/tasks/${id}/applications`, { cookie: businessCookie });
    assert.equal(all.body.total, 2);
    assert.equal(all.body.items.filter((item) => item.status === 'selected').length, 2);
    const own = await request(`/api/tasks/${id}/applications`, { cookie: teamA.cookie });
    assert.equal(own.body.total, 1);

    // The collection has its own route before /tasks/:id and never trusts a requested owner.
    const guestApplications = await request('/api/tasks/applications');
    assert.equal(guestApplications.status, 401);
    db.prepare('INSERT INTO actors (id,kind,name,profile_json,created_at) VALUES (?,?,?,?,?)')
      .run('business-other', 'business', 'Другой бизнес', '{}', new Date().toISOString());
    const otherBusiness = await request('/api/demo/session', { method: 'POST', body: { actorId: 'business-other' } });
    const otherTask = await request('/api/tasks', { method: 'POST', cookie: otherBusiness.cookie, body: { draftText: 'Задача другого бизнеса', topic: 'career' } });
    const otherId = otherTask.body.task.id;
    await request(`/api/tasks/${otherId}`, { method: 'PATCH', cookie: otherBusiness.cookie, body: { revision: 1, cardPatch: { title: 'Другая задача' } } });
    await request(`/api/tasks/${otherId}/confirm`, { method: 'POST', cookie: otherBusiness.cookie, body: { revision: 2, confirmed: true } });
    await request(`/api/tasks/${otherId}/publish`, { method: 'POST', cookie: otherBusiness.cookie, body: { revision: 2 } });
    const otherApplication = await request(`/api/tasks/${otherId}/applications`, { method: 'POST', cookie: teamA.cookie, body: { ...bodyA, clientRequestId: 'demo-other-business' } });
    assert.equal(otherApplication.status, 201);
    await request(`/api/tasks/${id}`, { method: 'PATCH', cookie: businessCookie, body: { revision: 4, cardPatch: { title: 'Рабочее название' }, manualFields: ['title'] } });
    const businessApplications = await request('/api/tasks/applications', { cookie: businessCookie });
    assert.equal(businessApplications.status, 200);
    assert.equal(businessApplications.body.total, 2);
    assert.ok(businessApplications.body.items.every((item) => item.taskId === id && item.taskTitle === 'Рабочее название'));
    const otherBusinessApplications = await request('/api/tasks/applications', { cookie: otherBusiness.cookie });
    assert.equal(otherBusinessApplications.body.total, 1);
    assert.equal(otherBusinessApplications.body.items[0].taskId, otherId);
    const teamApplications = await request('/api/tasks/applications', { cookie: teamA.cookie });
    assert.equal(teamApplications.body.total, 2);
    assert.ok(teamApplications.body.items.every((item) => item.teamId === 'demo-team-02'));
    assert.equal(teamApplications.body.items.find((item) => item.taskId === id).taskTitle, 'Помощник студентам', 'team must see published title');
    const page = await request('/api/tasks/applications?limit=1&offset=1', { cookie: teamA.cookie });
    assert.equal(page.body.total, 2);
    assert.equal(page.body.items.length, 1);
    const spoofed = await request('/api/tasks/applications?businessId=business-other', { cookie: businessCookie });
    assert.equal(spoofed.status, 422);
    const foreignTaskApplications = await request(`/api/tasks/${otherId}/applications`, { cookie: businessCookie });
    assert.equal(foreignTaskApplications.status, 403);

    const draftText = 'Сейчас студенты тратят время на поиск свободных аудиторий. Нужен веб-прототип со списком помещений и временных слотов.';
    const classroom = await request('/api/tasks', { method: 'POST', cookie: businessCookie, body: { draftText, topic: 'education' } });
    const classroomId = classroom.body.task.id;
    let revision = 1;
    const suggestion = await request(`/api/tasks/${classroomId}/analyze`, { method: 'POST', cookie: businessCookie, body: { revision, mode: 'analyze' } });
    assert.equal(suggestion.status, 200);
    assert.equal(suggestion.body.proposal.title, 'Поиск свободных аудиторий');
    assert.ok(suggestion.body.proposal.users.includes('студенты'));
    assert.equal(suggestion.body.proposal.result.artifact, 'веб-прототип');
    assert.equal(suggestion.body.proposal.data.availability, null);
    assert.equal(suggestion.body.proposal.constraints.deadlineMode, null);
    assert.equal(suggestion.body.proposal.success.target, null);
    assert.ok(suggestion.body.evidence.length >= 5);
    for (const fact of suggestion.body.evidence) assert.ok(draftText.includes(fact.quote));
    const cached = await request(`/api/tasks/${classroomId}/analyze`, { method: 'POST', cookie: businessCookie, body: { revision, mode: 'analyze' } });
    assert.equal(cached.body.mode, 'template');
    assert.deepEqual(cached.body.questions, suggestion.body.questions);
    const restored = await request(`/api/tasks/${classroomId}`, { cookie: businessCookie });
    assert.deepEqual(restored.body.task.aiResult, suggestion.body);
    assert.equal(restored.body.task.workingCard.title, null, 'analysis does not apply its proposal');
    const apply = await request(`/api/tasks/${classroomId}`, { method: 'PATCH', cookie: businessCookie, body: { revision, cardPatch: suggestion.body.proposal } });
    revision = apply.body.task.revision;
    assert.ok(apply.body.task.previewRating.score > 0);
    assert.equal(apply.body.task.rating.score, 0);
    const reload = await request(`/api/tasks/${classroomId}`, { cookie: businessCookie });
    assert.equal(reload.body.task.previewRating.score, apply.body.task.previewRating.score);
    const successQuestion = suggestion.body.questions.find((question) => question.field === 'success.metric');
    const dataQuestion = suggestion.body.questions.find((question) => question.field === 'data.availability');
    const deadlineQuestion = suggestion.body.questions.find((question) => question.field === 'constraints.deadlineMode');
    assert.ok(successQuestion && dataQuestion && deadlineQuestion);
    const success = 'Из пяти студентов минимум четверо находят аудиторию без подсказки';
    const answer = await request(`/api/tasks/${classroomId}`, { method: 'PATCH', cookie: businessCookie, body: { revision, answers: [{ questionId: successQuestion.id, value: success, skipped: false }], cardPatch: { title: 'Моё название', context: null }, manualFields: ['title', 'context'] } });
    revision = answer.body.task.revision;
    const typed = await request(`/api/tasks/${classroomId}`, { method: 'PATCH', cookie: businessCookie, body: { revision, answers: [{ questionId: dataQuestion.id, value: 'planned', skipped: false }, { questionId: deadlineQuestion.id, value: '2026-10-15', skipped: false }], cardPatch: { result: { scope: 'Только один корпус' } } } });
    revision = typed.body.task.revision;
    assert.equal(typed.body.task.answers.length, 3, 'partial answer updates keep earlier answers');
    assert.equal(typed.body.task.workingCard.result.artifact, 'веб-прототип', 'nested patch preserves sibling');
    const regenerated = await request(`/api/tasks/${classroomId}/analyze`, { method: 'POST', cookie: businessCookie, body: { revision, mode: 'analyze' } });
    assert.equal(regenerated.body.proposal.title, 'Моё название');
    assert.equal(regenerated.body.proposal.context, null, 'intentional manual clear survives AI');
    assert.equal(regenerated.body.proposal.success.metric, success);
    assert.equal(regenerated.body.proposal.success.target, success);
    assert.equal(regenerated.body.proposal.data.availability, 'planned');
    assert.equal(regenerated.body.proposal.constraints.deadlineMode, 'fixed');
    assert.equal(regenerated.body.proposal.constraints.deadlineDate, '2026-10-15');
    const composed = await request(`/api/tasks/${classroomId}/analyze`, { method: 'POST', cookie: businessCookie, body: { revision, mode: 'compose' } });
    assert.equal(composed.body.proposal.success.target, success);
    assert.ok(composed.body.evidence.some((item) => item.field === 'success.target' && item.sourceId === `answer:${successQuestion.id}` && item.quote === success));
    const savedQuestions = await request(`/api/tasks/${classroomId}`, { cookie: businessCookie });
    assert.ok(savedQuestions.body.task.questions.some((question) => question.id === successQuestion.id));
    const flexible = await request(`/api/tasks/${classroomId}`, { method: 'PATCH', cookie: businessCookie, body: { revision, answers: [{ questionId: deadlineQuestion.id, value: 'flexible', skipped: false }] } });
    const flexibleResult = await request(`/api/tasks/${classroomId}/analyze`, { method: 'POST', cookie: businessCookie, body: { revision: flexible.body.task.revision, mode: 'compose' } });
    assert.equal(flexibleResult.body.proposal.constraints.deadlineMode, 'flexible');
    assert.equal(flexibleResult.body.proposal.constraints.deadlineDate, null);
    await t.test('cached analysis restores the same proposal, timestamp and question IDs', async () => {
      const createdDraft = await request('/api/tasks', { method: 'POST', cookie: businessCookie, body: {
        draftText: 'Нужен сайт для студентов.', topic: 'education',
      } });
      const task = createdDraft.body.task;
      const path = `/api/tasks/${task.id}`;
      const generatedAt = '2026-09-23T10:00:00.000Z';
      const questions = ['data.source', 'success.metric', 'result.scope'].map((field, i) => ({ id: `cached-${i}`, field, text: `Уточните ${field}`, sourceRevision: 1 }));
      const result = {
        questions, proposal: { ...task.workingCard, title: 'Сайт для студентов' }, warnings: [],
        evidence: [{ field: 'title', sourceId: 'draft', quote: 'Нужен сайт для студентов.' }],
      };
      // A cached response must restore active questions even after another analysis.
      const alternate = [{ id: 'alternate', field: 'users', text: 'Кто использует решение?', sourceRevision: 1 }];
      db.prepare('UPDATE tasks SET questions_json=?, question_history_json=?, analysis_cache_json=? WHERE id=?').run(
        JSON.stringify(alternate), JSON.stringify(alternate),
        JSON.stringify({ analyze: { hash: analysisHash({ ...task, protectedFields: [] }, 'analyze'), result, generatedAt } }), task.id,
      );
      const previousMode = process.env.AI_MODE;
      process.env.AI_MODE = 'auto';
      try {
        const cached = await request(`${path}/analyze`, { method: 'POST', cookie: businessCookie, body: { revision: 1, mode: 'analyze' } });
        assert.equal(cached.status, 200);
        assert.equal(cached.body.mode, 'cached');
        assert.equal(cached.body.generatedAt, generatedAt);
        assert.deepEqual(cached.body.questions, questions);
        assert.deepEqual(cached.body.evidence, result.evidence);
        const reopened = (await request(path, { cookie: businessCookie })).body.task;
        assert.equal(reopened.revision, 1);
        assert.equal(reopened.workingCard.title, null);
        assert.equal(reopened.rating.score, 0);
        assert.deepEqual(reopened.lastAnalysis, { ...cached.body, mode: 'live' });
        assert.deepEqual(reopened.questions.filter((question) => question.id.startsWith('cached-')), questions);
        assert.ok(reopened.questions.some((question) => question.id === 'alternate'));
        assert.ok(reopened.questionHistory.some((q) => q.id === 'alternate'));
        const answered = await request(path, { method: 'PATCH', cookie: businessCookie, body: {
          revision: 1, answers: [{ questionId: 'cached-0', value: 'Тестовая таблица', skipped: false }],
        } });
        assert.equal(answered.status, 200);
        assert.equal(answered.body.task.lastAnalysis.stale, true);
        const stale = await request(path, { method: 'PATCH', cookie: businessCookie, body: {
          revision: 2, sourceRevision: reopened.lastAnalysis.sourceRevision, cardPatch: result.proposal,
        } });
        assert.equal(stale.status, 409);
      } finally {
        process.env.AI_MODE = previousMode;
      }
    });

    await t.test('oversized accumulated AI input falls back without a call or budget reservation', async () => {
      db.prepare('INSERT INTO actors (id,kind,name,profile_json,created_at) VALUES (?,?,?,?,?)')
        .run('business-long-input', 'business', 'Проверка длинного ввода', '{}', new Date().toISOString());
      const session = await request('/api/demo/session', { method: 'POST', body: { actorId: 'business-long-input' } });
      const cookie = session.cookie;
      const created = await request('/api/tasks', { method: 'POST', cookie, body: { draftText: 'Я'.repeat(6000), topic: 'education' } });
      assert.equal(created.status, 201);
      const task = created.body.task;
      const path = `/api/tasks/${task.id}`;
      const questions = CARD_PATHS.filter((field) => field !== 'contact.channel').map((field, i) => ({ id: `long-${i}`, field, text: `Уточните ${field}`, sourceRevision: 1 }));
      db.prepare('UPDATE tasks SET question_history_json=? WHERE id=?').run(JSON.stringify(questions), task.id);
      const answers = questions.map((question) => ({ questionId: question.id, value: 'Я'.repeat(2000), skipped: false }));
      const saved = await request(path, { method: 'PATCH', cookie, body: { revision: 1, answers } });
      assert.equal(saved.status, 200);
      const previousEnv = { AI_MODE: process.env.AI_MODE, OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: process.env.OPENAI_MODEL };
      Object.assign(process.env, { AI_MODE: 'auto', OPENAI_API_KEY: 'test-no-network', OPENAI_MODEL: 'gpt-6-sol' });
      try {
        const analyzed = await request(`${path}/analyze`, { method: 'POST', cookie, body: { revision: 2, mode: 'compose' } });
        assert.equal(analyzed.status, 200);
        assert.equal(analyzed.body.mode, 'template');
        assert.ok(analyzed.body.warnings.some((warning) => warning.includes('слишком много')));
        const reopened = (await request(path, { cookie })).body.task;
        assert.equal(reopened.draftText, task.draftText);
        assert.deepEqual(reopened.answers, answers);
        assert.deepEqual(reopened.lastAnalysis, analyzed.body);
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_usage WHERE task_id=?').get(task.id).count, 0);
      } finally {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    await t.test('предварительный рейтинг сохраняется при повторном открытии и не попадает в каталог', async () => {
      const draft = await request('/api/tasks', { method: 'POST', cookie: businessCookie, body: {
        draftText: 'Студентам нужно находить свободные аудитории.', topic: 'education',
      } });
      assert.equal(draft.status, 201);
      const path = `/api/tasks/${draft.body.task.id}`;
      assert.equal(draft.body.task.previewRating.score, 0);
      assert.equal(draft.body.task.rating.score, 0);

      const saved = await request(path, { method: 'PATCH', cookie: businessCookie, body: {
        revision: 1, cardPatch: {
          title: 'Поиск свободных аудиторий', context: 'Расписание уточняют вручную.',
          need: 'Помочь находить свободные помещения.', users: 'Студенты университета.',
        },
      } });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.task.previewRating.score, 30);
      assert.equal(saved.body.task.rating.score, 0);
      assert.deepEqual(saved.body.previewRating, saved.body.task.previewRating);

      const reopened = await request(path, { cookie: businessCookie });
      assert.equal(reopened.status, 200);
      assert.deepEqual(reopened.body.task.previewRating, saved.body.task.previewRating);
      assert.equal(reopened.body.task.rating.score, 0);
      assert.equal(reopened.body.task.confirmedRevision, null);
      const mine = await request('/api/tasks?scope=mine', { cookie: businessCookie });
      const ownSummary = mine.body.items.find((item) => item.id === draft.body.task.id);
      assert.deepEqual(ownSummary.previewRating, saved.body.task.previewRating);
      assert.equal(ownSummary.rating.score, 0);
      assert.equal((await request(path, { cookie: teamA.cookie })).status, 404);

      const confirmDraft = await request(`${path}/confirm`, { method: 'POST', cookie: businessCookie, body: { revision: 2, confirmed: true } });
      assert.equal(confirmDraft.status, 200);
      assert.deepEqual(confirmDraft.body.task.previewRating, confirmDraft.body.task.rating);
      const publishDraft = await request(`${path}/publish`, { method: 'POST', cookie: businessCookie, body: { revision: 2 } });
      assert.equal(publishDraft.status, 200);
      assert.equal(publishDraft.body.task.previewRating.score, 30);

      const edited = await request(path, { method: 'PATCH', cookie: businessCookie, body: { revision: 2, cardPatch: { users: null } } });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.task.previewRating.score, 20);
      assert.equal(edited.body.task.rating.score, 30);
      assert.equal(edited.body.task.confirmedRevision, 2);
      assert.equal(edited.body.task.revision, 3);
      const reopenedEdit = await request(path, { cookie: businessCookie });
      assert.deepEqual(reopenedEdit.body.task.previewRating, edited.body.task.previewRating);
      assert.ok(reopenedEdit.body.task.previewRating.missingFields.includes('users'));

      for (const cookie of [undefined, teamA.cookie]) {
        const publicDetail = await request(path, { cookie });
        assert.equal(publicDetail.status, 200);
        assert.equal(publicDetail.body.task.rating.score, 30);
        assert.equal(publicDetail.body.task.card.users, 'Студенты университета.');
        assert.equal(Object.hasOwn(publicDetail.body.task, 'previewRating'), false);
        assert.equal(Object.hasOwn(publicDetail.body.task, 'questionHistory'), false);
        assert.equal(Object.hasOwn(publicDetail.body.task, 'protectedFields'), false);
      }
      // Каталог использует подтверждённые баллы и при запросе владельца.
      const publicList = await request('/api/tasks?scope=catalog', { cookie: businessCookie });
      const publicSummary = publicList.body.items.find((item) => item.id === draft.body.task.id);
      assert.equal(publicSummary.rating.score, 30);
      assert.deepEqual(publicSummary.previewRating, publicSummary.rating, 'catalog preview must never expose working-card completeness');

      const reconfirmed = await request(`${path}/confirm`, { method: 'POST', cookie: businessCookie, body: { revision: 3, confirmed: true } });
      assert.equal(reconfirmed.status, 200);
      assert.equal(reconfirmed.body.task.rating.score, 20);
      assert.deepEqual(reconfirmed.body.task.previewRating, reconfirmed.body.task.rating);
      const updatedPublic = await request(path);
      assert.equal(updatedPublic.body.task.rating.score, 30);
      assert.equal(updatedPublic.body.task.card.users, 'Студенты университета.');
      const publishedUpdate = await request(`${path}/publish`, { method: 'POST', cookie: businessCookie, body: { revision: 3 } });
      assert.equal(publishedUpdate.status, 200);
      const afterPublication = await request(path);
      assert.equal(afterPublication.body.task.rating.score, 20);
      assert.equal(afterPublication.body.task.card.users, null);
    });
    await t.test('сохранение ответов допускает больше двадцати известных архивных вопросов', async () => {
      const createdDraft = await request('/api/tasks', { method: 'POST', cookie: businessCookie, body: {
        draftText: 'Нужен сайт со свободными аудиториями.', topic: 'education',
      } });
      assert.equal(createdDraft.status, 201);
      const path = `/api/tasks/${createdDraft.body.task.id}`;
      const history = Array.from({ length: 25 }, (_, index) => ({
        id: `archived-question-${index}`, field: 'data.source',
        text: `Какие материалы были доступны в версии ${index + 1}?`, sourceRevision: 1,
      }));
      db.prepare('UPDATE tasks SET question_history_json=? WHERE id=?')
        .run(JSON.stringify(history), createdDraft.body.task.id);
      const answers = history.map((question, index) => ({
        questionId: question.id, value: `Тестовая таблица версии ${index + 1}.`, skipped: false,
      }));
      const saved = await request(path, { method: 'PATCH', cookie: businessCookie, body: { revision: 1, answers } });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.body.task.answers, answers);
      const reopened = await request(path, { cookie: businessCookie });
      assert.deepEqual(reopened.body.task.answers, answers);

      const duplicate = await request(path, { method: 'PATCH', cookie: businessCookie, body: { revision: 2, answers: [...answers, answers[0]] } });
      assert.equal(duplicate.status, 422);
      const unknown = await request(path, { method: 'PATCH', cookie: businessCookie, body: {
        revision: 2, answers: [...answers, { questionId: 'unknown-question', value: 'Нет источника.', skipped: false }],
      } });
      assert.equal(unknown.status, 422);
    });

    await t.test('compose объединяет описание и архивные ответы, сохраняя ручные правки', async () => {
      // Separate profile keeps the production rate limit enabled in this scenario.
      db.prepare('INSERT INTO actors (id,kind,name,profile_json,created_at) VALUES (?,?,?,?,?)')
        .run('business-composition', 'business', 'Учебный отдел', '{}', new Date().toISOString());
      const session = await request('/api/demo/session', { method: 'POST', body: { actorId: 'business-composition' } });
      const cookie = session.cookie;
      const createdDraft = await request('/api/tasks', { method: 'POST', cookie, body: {
        draftText: 'Студентам сложно найти аудиторию. Сейчас расписание уточняют вручную. Нужен сайт со свободными аудиториями. Для первого прототипа достаточно списка и временных слотов.', topic: 'education',
      } });
      const path = `/api/tasks/${createdDraft.body.task.id}`;
      const manual = await request(path, { method: 'PATCH', cookie, body: { revision: 1, cardPatch: { need: 'Моя формулировка потребности.', context: 'Ручной контекст.' } } });
      assert.equal(manual.status, 200);
      const cleared = await request(path, { method: 'PATCH', cookie, body: { revision: 2, cardPatch: { context: null } } });
      assert.equal(cleared.status, 200);

      const first = await request(`${path}/analyze`, { method: 'POST', cookie, body: { revision: 3, mode: 'analyze' } });
      assert.equal(first.status, 200);
      assert.equal(first.body.proposal.context, null);
      assert.equal(first.body.proposal.need, 'Моя формулировка потребности.');
      const dataQuestion = first.body.questions.find((question) => question.field === 'data.source');
      assert.ok(dataQuestion);
      const answers = [{ questionId: dataQuestion.id, value: 'Тестовая таблица от учебного отдела.', skipped: false }];
      // The existing UI sends full cards: unchanged null fields must remain fillable.
      const answered = await request(path, { method: 'PATCH', cookie, body: { revision: 3, answers, cardPatch: cleared.body.task.workingCard } });
      assert.equal(answered.status, 200);
      const second = await request(`${path}/analyze`, { method: 'POST', cookie, body: { revision: 4, mode: 'analyze' } });
      assert.equal(second.status, 200);
      assert.equal(second.body.questions.some((question) => question.id === dataQuestion.id), false);
      for (const question of second.body.questions) {
        const previous = first.body.questions.find((item) => item.field === question.field && item.text === question.text);
        if (previous) assert.equal(question.id, previous.id);
      }
      const reopened = await request(path, { cookie });
      assert.ok(reopened.body.task.questionHistory.some((question) => question.id === dataQuestion.id));
      assert.deepEqual(reopened.body.task.answers, answers);
      const resaved = await request(path, { method: 'PATCH', cookie, body: { revision: 4, answers } });
      assert.equal(resaved.status, 200, 'ответ на архивный вопрос должен сохраняться без 422');

      const composed = await request(`${path}/analyze`, { method: 'POST', cookie, body: { revision: 5, mode: 'compose' } });
      assert.equal(composed.status, 200);
      assert.equal(composed.body.proposal.need, 'Моя формулировка потребности.');
      assert.equal(composed.body.proposal.context, null);
      assert.match(composed.body.proposal.result.artifact, /сайт/);
      assert.equal(composed.body.proposal.data.source, answers[0].value);
      assert.ok(composed.body.proposal.title);
      const beforeApply = await request(path, { cookie });
      assert.equal(beforeApply.body.task.workingCard.data.source, null);
      assert.equal(beforeApply.body.task.rating.score, 0);
      assert.deepEqual(beforeApply.body.task.lastAnalysis, composed.body);
      assert.equal(composed.body.operation, 'compose');
      assert.deepEqual(composed.body.evidence.find((entry) => entry.field === 'data.source'), {
        field: 'data.source', sourceId: `answer:${dataQuestion.id}`, quote: answers[0].value,
      });
      assert.equal(composed.body.evidence.some((entry) => ['need', 'context'].includes(entry.field)), false);

      const applied = await request(path, { method: 'PATCH', cookie, body: {
        revision: 5, sourceRevision: composed.body.sourceRevision,
        cardPatch: { ...composed.body.proposal, need: 'AI пытается заменить ручное поле.', context: 'AI пытается заполнить очищенное поле.' },
      } });
      assert.equal(applied.status, 200);
      assert.equal(applied.body.task.workingCard.need, 'Моя формулировка потребности.');
      assert.equal(applied.body.task.workingCard.context, null);
      assert.equal(applied.body.task.workingCard.data.source, answers[0].value);
      assert.equal(applied.body.task.rating.score, 0);
      assert.equal(applied.body.task.lastAnalysis.stale, true);

      const changed = await request(path, { method: 'PATCH', cookie, body: { revision: 6, cardPatch: { users: 'Преподаватели университета.' } } });
      assert.equal(changed.status, 200);
      const stale = await request(path, { method: 'PATCH', cookie, body: { revision: 7, sourceRevision: composed.body.sourceRevision, cardPatch: composed.body.proposal } });
      assert.equal(stale.status, 409);
      const afterStale = await request(path, { cookie });
      assert.equal(afterStale.body.task.revision, 7);
      assert.equal(afterStale.body.task.workingCard.users, 'Преподаватели университета.');
    });
  } finally {
    guardedFetch.mock.restore();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
  assert.equal(externalRequests, 0, 'API tests must never call an external provider');
});
