import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ai-sana-test-')), 'test.sqlite');
process.env.AI_MODE = 'template';
delete process.env.OPENAI_API_KEY;

const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');

test('полный путь: низкий рейтинг, AI fallback, рост баллов, два выбранных отклика', async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
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

    const answered = await request(`/api/tasks/${id}`, { method: 'PATCH', cookie: businessCookie, body: { revision: 2, answers: [{ questionId: analyzed.body.questions[0].id, value: 'Вручную подбираем материалы', skipped: false }] } });
    assert.equal(answered.body.task.revision, 3);
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

    const teamA = await request('/api/demo/session', { method: 'POST', body: { actorId: 'team-orbit' } });
    const teamB = await request('/api/demo/session', { method: 'POST', body: { actorId: 'team-sana' } });
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
    assert.ok(teamApplications.body.items.every((item) => item.teamId === 'team-orbit'));
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
