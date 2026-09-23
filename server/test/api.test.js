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
    const top = await request('/api/tasks?scope=catalog&level=priority&topic=education');
    assert.equal(top.body.total, 1);

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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
