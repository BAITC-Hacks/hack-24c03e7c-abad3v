import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCard, mergeCard } from '../src/card.js';
import { templateResult } from '../src/template.js';

const task = (patch = {}) => ({ draftText: '', workingCard: emptyCard(), questions: [], answers: [], ...patch });
const brief = 'Студентам сложно находить свободные учебные аудитории между парами. Сейчас информацию о занятости помещений приходится уточнять вручную. Нужен простой сайт, где студент сможет посмотреть свободные аудитории и время, когда в них можно заниматься. Для первого прототипа достаточно списка аудиторий с корпусом, номером и доступными временными слотами. Данные можно пока использовать тестовые.';

test('template copies the brief into an editable proposal without invented facts', () => {
  const source = task({ draftText: brief });
  const result = templateResult(source, 'analyze');
  assert.match(result.proposal.title, /Студентам сложно/);
  assert.match(result.proposal.context, /сложно находить/);
  assert.match(result.proposal.need, /Нужен простой сайт/);
  assert.match(result.proposal.users, /Студентам/);
  assert.match(result.proposal.result.artifact, /Нужен простой сайт/);
  assert.match(result.proposal.result.scope, /списка аудиторий/);
  assert.equal(result.proposal.data.availability, null);
  assert.equal(result.proposal.success.metric, null);
  assert.equal(result.proposal.constraints.deadlineDate, null);
  assert.deepEqual(source.workingCard, emptyCard());
  assert.ok(result.questions.length >= 3 && result.questions.length <= 5);
  assert.equal(new Set(result.questions.map(({ field }) => field)).size, result.questions.length);
  assert.deepEqual(mergeCard(emptyCard(), result.proposal), result.proposal);
});

test('template also extracts another domain and conserves source phrases', () => {
  const source = task({ draftText: 'Менеджеры тратят время на сверку заявок вручную. Нужна панель для сотрудников отдела продаж. Первая версия включает поиск и фильтр заявок. Данные уже доступны из CSV.' });
  const { proposal } = templateResult(source, 'compose');
  assert.match(proposal.users, /Менеджеры/);
  assert.match(proposal.result.artifact, /Нужна панель/);
  assert.match(proposal.result.scope, /поиск и фильтр/);
  assert.equal(proposal.data.availability, 'available');
  assert.match(proposal.data.source, /CSV/);
  for (const value of [proposal.title, proposal.context, proposal.need, proposal.users, proposal.result.artifact, proposal.result.scope, proposal.data.source]) assert.ok(source.draftText.includes(value));
});

test('both modes combine answers and brief even if the first proposal was never applied', () => {
  const source = task({
    draftText: brief,
    questions: [{ id: 'metric', field: 'success.metric', text: 'Как проверить?' }, { id: 'source', field: 'data.source', text: 'Откуда данные?' }],
    answers: [{ questionId: 'metric', value: 'Четверо из пяти студентов находят аудиторию без подсказок.' }, { questionId: 'source', value: 'Тестовую таблицу подготовит учебный отдел.' }],
  });
  for (const mode of ['analyze', 'compose']) {
    const { proposal, questions } = templateResult(source, mode);
    assert.match(proposal.result.artifact, /Нужен простой сайт/);
    assert.equal(proposal.success.metric, source.answers[0].value);
    assert.equal(proposal.data.source, source.answers[1].value);
    if (mode === 'compose') assert.deepEqual(questions, []);
  }
});

test('manual text and explicitly cleared protected fields survive generation', () => {
  const source = task({
    draftText: brief,
    workingCard: mergeCard(emptyCard(), { title: 'Моё название', need: 'Ручная формулировка' }),
    protectedFields: ['context', 'result.artifact'],
    questions: [{ id: 'need', field: 'need' }, { id: 'artifact', field: 'result.artifact' }],
    answers: [{ questionId: 'need', value: 'Новое предложение' }, { questionId: 'artifact', value: 'Мобильное приложение' }],
  });
  const { proposal } = templateResult(source, 'compose');
  assert.equal(proposal.title, 'Моё название');
  assert.equal(proposal.need, 'Ручная формулировка');
  assert.equal(proposal.context, null);
  assert.equal(proposal.result.artifact, null);
});

test('archived questions retain their answer mapping and current unknown answers stay unknown', () => {
  const source = task({
    questionHistory: [{ id: 'old', field: 'success.metric' }, { id: 'old-data', field: 'data.availability' }],
    questions: [{ id: 'new', field: 'data.availability' }, { id: 'skip', field: 'contact.feedback' }],
    answers: [{ questionId: 'old', value: 'Время поиска аудитории' }, { questionId: 'old-data', value: 'available' }, { questionId: 'new', value: 'Не знаю' }, { questionId: 'skip', value: 'Куратор', skipped: true }],
  });
  const result = templateResult(source, 'compose');
  assert.equal(result.proposal.success.metric, 'Время поиска аудитории');
  assert.equal(result.proposal.data.availability, null);
  assert.equal(result.proposal.contact.feedback, null);
  assert.ok(result.warnings.some((warning) => warning.includes('data.availability')));
});

test('enum answers accept only explicit, unambiguous values and valid dates', () => {
  function answer(field, value) {
    return templateResult(task({ questions: [{ id: 'q', field }], answers: [{ questionId: 'q', value }] }), 'compose');
  }
  assert.equal(answer('data.availability', 'Данные уже доступны').proposal.data.availability, 'available');
  assert.equal(answer('data.availability', 'Данные будут предоставлены').proposal.data.availability, 'planned');
  assert.equal(answer('data.availability', 'Реальные данные пока не подготовлены').proposal.data.availability, 'unavailable');
  for (const value of ['Наверное, данные доступны', 'Если получится, договоримся', 'Данные доступны, но реальные данные недоступны', 'Недоступны данные', 'Не подготовлены данные']) {
    const result = answer('data.availability', value);
    assert.equal(result.proposal.data.availability, null);
    assert.ok(result.warnings.length);
  }
  assert.equal(answer('constraints.deadlineMode', 'Жёсткого срока пока нет. Ориентируемся на 2 недели.').proposal.constraints.deadlineMode, 'flexible');
  assert.equal(answer('constraints.deadlineMode', 'Через 2 недели').proposal.constraints.deadlineMode, null);
  const fixed = answer('constraints.deadlineMode', 'Нужен к 2026-10-12');
  assert.equal(fixed.proposal.constraints.deadlineMode, 'fixed');
  assert.equal(fixed.proposal.constraints.deadlineDate, '2026-10-12');
  assert.equal(answer('constraints.deadlineDate', '12.10.2026').proposal.constraints.deadlineDate, '2026-10-12');
  assert.equal(answer('constraints.deadlineDate', '2026-02-30').proposal.constraints.deadlineDate, null);
  assert.equal(answer('constraints.deadlineDate', '2026-10-12 или 2026-10-20').proposal.constraints.deadlineDate, null);
});

test('long answers and titles are normalized to Card limits with visible warnings', () => {
  const source = task({
    draftText: 'Нужен '.repeat(90),
    questions: [{ id: 'a', field: 'data.source' }],
    answers: [{ questionId: 'a', value: `  ${'Пример '.repeat(300)}\n\n` }],
  });
  const result = templateResult(source, 'compose');
  assert.ok(result.proposal.title.length <= 120);
  assert.ok(result.proposal.data.source.length <= 1000);
  assert.ok(result.warnings.some((warning) => warning.includes('title')));
  assert.ok(result.warnings.some((warning) => warning.includes('data.source')));
  assert.deepEqual(mergeCard(emptyCard(), result.proposal), result.proposal);
});

test('direct date answers take precedence over a date mentioned in another answer', () => {
  const source = task({
    questions: [{ id: 'date', field: 'constraints.deadlineDate' }, { id: 'mode', field: 'constraints.deadlineMode' }],
    answers: [{ questionId: 'date', value: 'Не знаю пока, уточню у заказчика' }, { questionId: 'mode', value: 'Нужен к 2026-10-12' }],
  });
  assert.equal(templateResult(source, 'compose').proposal.constraints.deadlineDate, null);
  source.answers[0].value = '2026-11-01';
  assert.equal(templateResult(source, 'compose').proposal.constraints.deadlineDate, '2026-11-01');
});

test('both modes return exact raw draft evidence despite whitespace normalization', () => {
  const rawDraft = '\n  Студентам   сложно находить аудитории.\r\nНужен   сайт для студентов.\nДанные   уже доступны из CSV.';
  for (const mode of ['analyze', 'compose']) {
    const result = templateResult(task({ draftText: rawDraft }), mode);
    assert.equal(result.proposal.context, 'Студентам сложно находить аудитории.');
    const context = result.evidence.find(({ field }) => field === 'context');
    assert.deepEqual(context, { field: 'context', sourceId: 'draft', quote: '  Студентам   сложно находить аудитории.' });
    const availability = result.evidence.find(({ field }) => field === 'data.availability');
    assert.equal(result.proposal.data.availability, 'available');
    assert.equal(availability.quote, 'Данные   уже доступны из CSV.');
    for (const item of result.evidence) {
      assert.equal(item.sourceId, 'draft');
      assert.ok(rawDraft.includes(item.quote));
      assert.ok(item.quote.length <= 6000);
    }
    assert.equal(new Set(result.evidence.map(({ field }) => field)).size, result.evidence.length);
  }
});

test('merged scope cites a contiguous raw span covering every selected sentence', () => {
  const rawDraft = 'Первая версия включает поиск.\nСвязь через учебный отдел.\r\nИз первого прототипа нужно исключить регистрацию.';
  const result = templateResult(task({ draftText: rawDraft }), 'compose');
  assert.equal(result.proposal.result.scope, 'Первая версия включает поиск. Из первого прототипа нужно исключить регистрацию.');
  assert.deepEqual(result.evidence.find(({ field }) => field === 'result.scope'), {
    field: 'result.scope', sourceId: 'draft', quote: rawDraft,
  });
});

test('answer evidence retains its exact source and overrides matching draft facts', () => {
  const rawAnswer = '  Проверим время\n  поиска по пяти сценариям.  ';
  const source = task({
    draftText: 'Показатель: число регистраций. Данные уже доступны из CSV.',
    questionHistory: [{ id: 'archived-metric', field: 'success.metric' }],
    answers: [{ questionId: 'archived-metric', value: rawAnswer }],
  });
  const result = templateResult(source, 'analyze');
  assert.equal(result.proposal.success.metric, 'Проверим время поиска по пяти сценариям.');
  assert.deepEqual(result.evidence.find(({ field }) => field === 'success.metric'), {
    field: 'success.metric', sourceId: 'answer:archived-metric', quote: rawAnswer,
  });
  assert.equal(result.evidence.filter(({ field }) => field === 'success.metric').length, 1);
});

test('derived enum and date values cite the raw answer that supplied them', () => {
  const source = task({
    questions: [{ id: 'availability', field: 'data.availability' }, { id: 'deadline', field: 'constraints.deadlineMode' }],
    answers: [{ questionId: 'availability', value: ' Данные\n уже доступны. ' }, { questionId: 'deadline', value: 'Нужен   к 12.10.2026' }],
  });
  const result = templateResult(source, 'compose');
  assert.equal(result.proposal.data.availability, 'available');
  assert.equal(result.proposal.constraints.deadlineMode, 'fixed');
  assert.equal(result.proposal.constraints.deadlineDate, '2026-10-12');
  for (const field of ['constraints.deadlineMode', 'constraints.deadlineDate']) {
    assert.deepEqual(result.evidence.find((item) => item.field === field), {
      field, sourceId: 'answer:deadline', quote: source.answers[1].value,
    });
  }
  assert.equal(result.evidence.find(({ field }) => field === 'data.availability').quote, source.answers[0].value);
});

test('saved, protected, skipped and unknown fields get no generated provenance', () => {
  const source = task({
    draftText: 'Нужен сайт для студентов. Сейчас сведения ищут вручную. Показатель: время поиска.',
    workingCard: mergeCard(emptyCard(), { title: 'Ручное название', users: 'Ручная группа' }),
    protectedFields: ['context'],
    questions: [{ id: 'metric', field: 'success.metric' }, { id: 'feedback', field: 'contact.feedback' }],
    answers: [{ questionId: 'metric', value: 'Не знаю, уточню позднее' }, { questionId: 'feedback', value: 'Куратор', skipped: true }],
  });
  const result = templateResult(source, 'compose');
  for (const field of ['title', 'users', 'context', 'success.metric', 'contact.feedback']) {
    assert.ok(!result.evidence.some((item) => item.field === field));
  }
  assert.equal(result.proposal.title, 'Ручное название');
  assert.equal(result.proposal.users, 'Ручная группа');
  assert.equal(result.proposal.context, null);
  assert.equal(result.proposal.success.metric, null);
  assert.equal(result.proposal.contact.feedback, null);
});

test('direct deadline date evidence wins over a date mentioned in the mode answer', () => {
  const source = task({
    questions: [{ id: 'date', field: 'constraints.deadlineDate' }, { id: 'mode', field: 'constraints.deadlineMode' }],
    answers: [{ questionId: 'date', value: ' 01.11.2026 ' }, { questionId: 'mode', value: 'Нужен к 2026-10-12' }],
  });
  const result = templateResult(source, 'compose');
  assert.equal(result.proposal.constraints.deadlineDate, '2026-11-01');
  assert.deepEqual(result.evidence.find(({ field }) => field === 'constraints.deadlineDate'), {
    field: 'constraints.deadlineDate', sourceId: 'answer:date', quote: source.answers[0].value,
  });
});

test('draft deadline evidence preserves the exact raw date phrase and quote bounds', () => {
  const source = task({ draftText: `Нужен сайт.\r\nСрок   фиксированный: 12.10.2026. ${'Дополнительный текст. '.repeat(400)}` });
  const result = templateResult(source, 'compose');
  assert.equal(result.proposal.constraints.deadlineDate, '2026-10-12');
  for (const field of ['constraints.deadlineMode', 'constraints.deadlineDate']) {
    assert.deepEqual(result.evidence.find((item) => item.field === field), {
      field, sourceId: 'draft', quote: 'Срок   фиксированный: 12.10.2026.',
    });
  }
  for (const { quote } of result.evidence) {
    assert.ok(source.draftText.includes(quote));
    assert.ok(quote.length <= 6000);
  }
});
