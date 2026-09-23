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

test('полный путь: низкий рейтинг, AI fallback, рост баллов, два выбранных отклика', async (t) => {
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
      assert.equal(Object.hasOwn(publicSummary, 'previewRating'), false);

      const reconfirmed = await request(`${path}/confirm`, { method: 'POST', cookie: businessCookie, body: { revision: 3, confirmed: true } });
      assert.equal(reconfirmed.status, 200);
      assert.equal(reconfirmed.body.task.rating.score, 20);
      assert.deepEqual(reconfirmed.body.task.previewRating, reconfirmed.body.task.rating);
      const updatedPublic = await request(path);
      assert.equal(updatedPublic.body.task.rating.score, 20);
      assert.equal(updatedPublic.body.task.card.users, null);
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

      const applied = await request(path, { method: 'PATCH', cookie, body: {
        revision: 5, sourceRevision: composed.body.sourceRevision,
        cardPatch: { ...composed.body.proposal, need: 'AI пытается заменить ручное поле.', context: 'AI пытается заполнить очищенное поле.' },
      } });
      assert.equal(applied.status, 200);
      assert.equal(applied.body.task.workingCard.need, 'Моя формулировка потребности.');
      assert.equal(applied.body.task.workingCard.context, null);
      assert.equal(applied.body.task.workingCard.data.source, answers[0].value);
      assert.equal(applied.body.task.rating.score, 0);

      const changed = await request(path, { method: 'PATCH', cookie, body: { revision: 6, cardPatch: { users: 'Преподаватели университета.' } } });
      assert.equal(changed.status, 200);
      const stale = await request(path, { method: 'PATCH', cookie, body: { revision: 7, sourceRevision: composed.body.sourceRevision, cardPatch: composed.body.proposal } });
      assert.equal(stale.status, 409);
      const afterStale = await request(path, { cookie });
      assert.equal(afterStale.body.task.revision, 7);
      assert.equal(afterStale.body.task.workingCard.users, 'Преподаватели университета.');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
