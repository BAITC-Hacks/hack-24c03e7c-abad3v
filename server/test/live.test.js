import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCard, mergeCard } from '../src/card.js';
import { AI_REQUEST_MAX_BYTES, composeLiveProposal, composeLiveResult, liveResult, prepareLiveRequest } from '../src/ai.js';

const task = (patch = {}) => ({ draftText: 'Нужен сайт для студентов.', workingCard: emptyCard(), questions: [], answers: [], ...patch });
const fact = (field, value, sourceId = 'draft', quote = 'Нужен сайт для студентов.') => ({ field, value, sourceId, quote });

test('live proposal combines cited brief and archived answers without changing the task', () => {
  const source = task({
    questionHistory: [{ id: 'old', field: 'data.source', text: 'Какие материалы доступны?' }],
    questions: [{ id: 'new', field: 'success.metric', text: 'Как проверить результат?' }],
    answers: [{ questionId: 'old', value: 'Тестовая таблица расписания.', skipped: false }],
  });
  const proposal = composeLiveProposal(source, [
    fact('result.artifact', 'Сайт для студентов.'),
    fact('data.source', 'Тестовая таблица расписания.', 'answer:old', 'Тестовая таблица расписания.'),
  ]);
  assert.equal(proposal.result.artifact, 'Сайт для студентов.');
  assert.equal(proposal.data.source, 'Тестовая таблица расписания.');
  assert.deepEqual(source.workingCard, emptyCard());
});

test('live proposal preserves saved text and protected cleared fields', () => {
  const source = task({
    workingCard: mergeCard(emptyCard(), { title: 'Ручное название', data: { source: 'Материалы заказчика.' } }),
    protectedFields: ['result.artifact'],
  });
  const proposal = composeLiveProposal(source, [fact('title', 'AI-название'), fact('data.source', 'Другие материалы.'), fact('result.artifact', 'Веб-прототип.'), fact('users', 'Студенты.')]);
  assert.equal(proposal.title, 'Ручное название');
  assert.equal(proposal.data.source, 'Материалы заказчика.');
  assert.equal(proposal.result.artifact, null);
  assert.equal(proposal.users, 'Студенты.');
});

test('live facts require a matching source and a valid Card value', () => {
  assert.throws(() => composeLiveProposal(task(), [fact('need', 'Новая потребность', 'missing')]), /matching source/);
  assert.throws(() => composeLiveProposal(task(), [fact('need', 'Новая потребность', 'draft', 'Такого текста нет')]), /matching source/);
  assert.throws(() => composeLiveProposal(task(), [fact('need', 'Новая потребность', 'draft', ' ')]), /matching source/);
  assert.throws(() => composeLiveProposal(task(), [fact('data.availability', 'maybe')]), /статус данных/);
});

test('skipped or unknown answers and private contact cannot become live sources', () => {
  const source = task({
    questions: [{ id: 'skip', field: 'need' }, { id: 'contact', field: 'contact.channel' }],
    answers: [{ questionId: 'skip', value: 'Не использовать.', skipped: true }, { questionId: 'contact', value: 'private@example.org', skipped: false }, { questionId: 'orphan', value: 'Ответ без вопроса.', skipped: false }],
  });
  for (const [id, quote] of [['skip', 'Не использовать.'], ['contact', 'private@example.org'], ['orphan', 'Ответ без вопроса.']]) {
    assert.throws(() => composeLiveProposal(source, [fact('need', quote, `answer:${id}`, quote)]), /matching source/);
  }
  assert.equal(composeLiveProposal(source, [fact('contact.channel', 'invented@example.org')]).contact.channel, null);
});

test('evidence describes only accepted new values and keeps their exact source quotes', () => {
  const source = task({ workingCard: mergeCard(emptyCard(), { title: 'Своё название' }), protectedFields: ['need'] });
  const result = composeLiveResult(source, [
    fact('title', 'Новое название'), fact('need', 'Новая потребность'), fact('context', null),
    fact('users', ' Студенты. '), fact('users', 'Повторное значение'), fact('result.scope', '  '),
  ]);
  assert.deepEqual(result.evidence, [{ field: 'users', sourceId: 'draft', quote: source.draftText }]);
  assert.equal(result.proposal.users, 'Студенты.');
  assert.equal(result.proposal.result.scope, null);
});

const modelBody = (patch = {}) => ({ facts: [], missingFields: [], questions: [], warnings: [], ...patch });
const modelResponse = (body = modelBody(), patch = {}) => ({
  id: 'response-test', status: 'completed', output_text: JSON.stringify(body),
  usage: { input_tokens: 4500, output_tokens: 700 }, ...patch,
});
const stubClient = (create) => ({ responses: { create } });

test('live clarification options are normalized suggestions and do not become card facts', async () => {
  const source = task({ draftText: 'Нужен сайт для студентов, чтобы находить свободные аудитории.' });
  const metric = { label: 'Время поиска', value: 'Оценивать время, за которое студент находит свободную аудиторию.' };
  const questions = [
    { id: 'metric', field: 'success.metric', text: 'Как будем проверять удобство поиска?', options: [metric] },
    { id: 'data', field: 'data.availability', text: 'Данные уже готовы или их нужно собрать?', options: [{ label: 'Конечно', value: 'yes' }] },
    { id: 'contact', field: 'contact.channel', text: 'Как связаться с заказчиком?', options: [{ label: 'Email', value: 'invented@example.org' }] },
    { id: 'date', field: 'constraints.deadlineDate', text: 'К какой дате нужен результат?', options: [{ label: 'Дата', value: '2026-10-15' }] },
  ];
  let submitted;
  const { result } = await liveResult(source, 'analyze', { client: stubClient(async (request) => {
    submitted = request;
    return modelResponse(modelBody({ questions }));
  }) });
  assert.equal(submitted.max_output_tokens, 3200);
  const questionSchema = submitted.text.format.schema.properties.questions.items;
  assert.ok(questionSchema.required.includes('options'));
  assert.equal(questionSchema.properties.options.maxItems, 4);
  assert.ok(result.questions.find((question) => question.field === 'success.metric').options.some((option) => option.value === metric.value));
  assert.deepEqual(new Set(result.questions.find((question) => question.field === 'data.availability').options.map((option) => option.value)), new Set(['available', 'planned', 'unavailable']));
  assert.deepEqual(result.questions.find((question) => question.field === 'contact.channel').options, []);
  assert.deepEqual(result.questions.find((question) => question.field === 'constraints.deadlineDate').options, []);
  assert.deepEqual(result.proposal, emptyCard(), 'offered values are not confirmed facts');
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(source.workingCard, emptyCard());
  assert.deepEqual(source.answers, []);
  const nextInput = prepareLiveRequest({ ...source, questions: result.questions }, 'compose').input[1].content;
  assert.equal(nextInput.includes(metric.value), false, 'unselected options must not become sources in the next request');
});

test('older question responses without options receive usable fallback suggestions', async () => {
  const questions = ['need', 'context', 'data.availability'].map((field) => ({ id: field, field, text: `Какие сведения доступны: ${field}?` }));
  const { result } = await liveResult(task(), 'analyze', { client: stubClient(async () => modelResponse(modelBody({ questions }))) });
  for (const question of result.questions) {
    assert.ok(question.options.length > 0 && question.options.length <= 4);
    assert.ok(question.options.every((option) => typeof option.label === 'string' && typeof option.value === 'string'));
  }
});

test('invalid optional choices fall back without discarding valid cited facts', async () => {
  const questions = [
    { id: 'context', field: 'context', text: 'Как решается задача сейчас?', options: 'wrong shape' },
    { id: 'data', field: 'data.source', text: 'Какие данные доступны команде?', options: [{ label: 'x'.repeat(81), value: 'y'.repeat(301) }] },
    { id: 'metric', field: 'success.metric', text: 'Как проверить результат работы?', options: Array.from({ length: 5 }, () => ({ label: 'Вариант', value: 'Показатель' })) },
  ];
  const { result } = await liveResult(task(), 'analyze', { client: stubClient(async () => modelResponse(modelBody({ facts: [fact('users', 'Студенты.')], questions }))) });
  assert.equal(result.proposal.users, 'Студенты.');
  for (const question of result.questions) {
    assert.ok(question.options.length > 0 && question.options.length <= 4);
    assert.ok(question.options.every((option) => option.label.length <= 80 && option.value.length <= 300));
  }
});

test('live request accepts a full Russian description and five long saved answers without text duplication', async () => {
  const fields = ['data.source', 'result.scope', 'success.metric', 'constraints.technologyAccess', 'contact.feedback'];
  const source = task({
    draftText: 'Описание задачи для студентов. '.repeat(250).slice(0, 6000),
    questions: fields.map((field, index) => ({ id: `q${index}`, field, text: `Какие сведения доступны для поля ${field}?` })),
    answers: fields.map((field, index) => ({ questionId: `q${index}`, value: 'Подробный ответ заказчика. '.repeat(100).slice(0, 2000), skipped: false })),
    workingCard: mergeCard(emptyCard(), { context: 'Уникальная сохранённая формулировка.', contact: { channel: 'private@example.org' } }),
  });
  const prepared = prepareLiveRequest(source, 'compose');
  const payload = JSON.parse(prepared.input[1].content);
  assert.equal(payload.sources.find(({ id }) => id === 'draft').text.length, 6000);
  assert.equal(payload.sources.filter(({ id }) => id.startsWith('answer:')).length, 5);
  assert.equal(prepared.input[1].content.split('Уникальная сохранённая формулировка.').length, 2);
  assert.equal(prepared.input[1].content.includes('private@example.org'), false);
  assert.equal(Object.hasOwn(payload, 'currentCard'), false);
  assert.ok(payload.filledFields.includes('context'));
  let submitted;
  const result = await liveResult(source, 'compose', { prepared, client: stubClient(async (request) => {
    submitted = request;
    return modelResponse();
  }) });
  const bytes = Buffer.byteLength(JSON.stringify(submitted), 'utf8');
  assert.ok(bytes > 8000 && bytes <= AI_REQUEST_MAX_BYTES);
  assert.equal(prepared.inputTokenUpperBound, bytes + 1024);
  assert.equal(submitted.max_output_tokens, 1800);
  assert.deepEqual(result.result.evidence, []);
  assert.equal(result.usage.inputTokens, 4500);
});

test('only the latest usable answer for a field is submitted and can support a fact', () => {
  const source = task({
    questionHistory: [{ id: 'old', field: 'data.source', text: 'Откуда данные?' }],
    questions: [
      { id: 'new', field: 'data.source', text: 'Какие данные доступны сейчас?' },
      { id: 'skip', field: 'need', text: 'Что нужно изменить?' },
      { id: 'contact', field: 'contact.channel', text: 'Как связаться?' },
      { id: 'empty', field: 'users', text: 'Кто пользователи?' },
    ],
    answers: [
      { questionId: 'old', value: 'Старая таблица.', skipped: false },
      { questionId: 'new', value: 'Новая выгрузка.', skipped: false },
      { questionId: 'skip', value: 'Пропущенный ответ.', skipped: true },
      { questionId: 'contact', value: 'private@example.org', skipped: false },
      { questionId: 'orphan', value: 'Ответ без вопроса.', skipped: false },
      { questionId: 'empty', value: '   ', skipped: false },
    ],
  });
  const payload = JSON.parse(prepareLiveRequest(source, 'analyze').input[1].content);
  assert.deepEqual(payload.sources.filter(({ id }) => id.startsWith('answer:')), [
    { id: 'answer:new', field: 'data.source', question: 'Какие данные доступны сейчас?', text: 'Новая выгрузка.' },
  ]);
  assert.throws(() => composeLiveResult(source, [fact('data.source', 'Старая таблица.', 'answer:old', 'Старая таблица.')]), /matching source/);
  assert.deepEqual(composeLiveResult(source, [fact('data.source', 'Новая выгрузка.', 'answer:new', 'Новая выгрузка.')]).evidence, [
    { field: 'data.source', sourceId: 'answer:new', quote: 'Новая выгрузка.' },
  ]);
});

test('oversized complete requests fail before any provider call', async () => {
  const source = task({ draftText: 'я'.repeat(AI_REQUEST_MAX_BYTES) });
  assert.throws(() => prepareLiveRequest(source, 'compose'), { code: 'AI_INPUT_TOO_LONG' });
  let calls = 0;
  const client = stubClient(async () => { calls += 1; return modelResponse(); });
  await assert.rejects(liveResult(source, 'compose', { client }), { code: 'AI_INPUT_TOO_LONG' });
  // A supplied prepared request cannot bypass the same serialized-request limit.
  const prepared = prepareLiveRequest(task(), 'compose');
  prepared.input[1].content = source.draftText;
  await assert.rejects(liveResult(task(), 'compose', { prepared, client }), { code: 'AI_INPUT_TOO_LONG' });
  assert.equal(calls, 0);
});

test('live result validates citations against the submitted snapshot and returns accepted evidence', async () => {
  const source = task();
  const prepared = prepareLiveRequest(source, 'compose');
  source.draftText = 'После подготовки запроса текст изменился.';
  const result = await liveResult(source, 'compose', {
    prepared,
    client: stubClient(async () => modelResponse(modelBody({ facts: [fact('users', 'Студенты.')] }))),
  });
  assert.deepEqual(result.result.evidence, [{ field: 'users', sourceId: 'draft', quote: 'Нужен сайт для студентов.' }]);
  await assert.rejects(liveResult(source, 'compose', {
    prepared,
    client: stubClient(async () => modelResponse(modelBody({ facts: [fact('need', 'Правка после запроса', 'draft', source.draftText)] }))),
  }), /matching source/);
});

test('malformed and incomplete provider responses cannot become accepted results', async () => {
  const responses = [
    modelResponse(modelBody(), { status: 'incomplete' }),
    modelResponse(modelBody(), { output_text: '' }),
    modelResponse(modelBody(), { output_text: '{broken' }),
    modelResponse({ facts: [] }),
    modelResponse(modelBody({ facts: [fact('unknown', 'Значение')] })),
    modelResponse(modelBody({ unexpected: true })),
  ];
  for (const response of responses) {
    await assert.rejects(liveResult(task(), 'compose', { client: stubClient(async () => response) }));
  }
  const questions = [1, 2, 3].map((index) => ({ id: `q${index}`, field: 'need', text: 'Что нужно изменить?' }));
  for (const list of [[], questions]) {
    await assert.rejects(liveResult(task(), 'analyze', { client: stubClient(async () => modelResponse(modelBody({ questions: list }))) }), /distinct questions/);
  }
});

test('provider timeout propagates for the caller to use the local fallback', async () => {
  const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
  let calls = 0;
  await assert.rejects(liveResult(task(), 'compose', { client: stubClient(async () => { calls += 1; throw timeout; }) }), (error) => error === timeout);
  assert.equal(calls, 1);
});
