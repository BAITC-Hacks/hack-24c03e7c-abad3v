import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyCard, mergeCard } from '../src/card.js';
import { repairClarifications } from '../src/clarifications.js';
import { normalizeQuestionOptions } from '../../shared/question-options.js';

const task = (patch = {}) => ({ draftText: 'Нужен сайт поиска свободных аудиторий.', workingCard: emptyCard(), manualFields: [], questions: [], answers: [], ...patch });
const question = (field, text = `Что нужно уточнить для ${field}?`) => ({ id: `model:${field}`, field, text, options: [] });

test('retains valid model wording and supplements missing questions without changing grounded facts', () => {
  const source = task();
  const proposal = mergeCard(emptyCard(), { title: 'Свободные аудитории', need: 'Найти свободное помещение.' });
  const snapshot = structuredClone(proposal);
  const original = question('success.metric', 'Как студенты поймут, что поиск аудитории стал удобнее?');
  const result = repairClarifications(source, proposal, [original]);
  assert.deepEqual(result.questions[0], { ...original, origin: 'live', refines: false });
  assert.equal(result.questions.length, 3);
  assert.equal(result.questions.filter((item) => item.origin === 'template').length, 2);
  assert.ok(result.warnings.some((message) => message.includes('локальными')));
  assert.deepEqual(proposal, snapshot);
  assert.deepEqual(source.workingCard, emptyCard());
  assert.deepEqual(original, question('success.metric', 'Как студенты поймут, что поиск аудитории стал удобнее?'));
});

test('deduplicates fields and wording and returns no more than five model questions', () => {
  const candidates = [question('context'), question('context', 'Другой вопрос о контексте?'),
    question('users', '  Что нужно уточнить для context?  '), question('data.source'),
    question('success.metric'), question('result.scope'), question('contact.feedback'), question('need')];
  const result = repairClarifications(task(), emptyCard(), candidates);
  assert.equal(result.questions.length, 5);
  assert.equal(new Set(result.questions.map((item) => item.field)).size, 5);
  assert.ok(result.questions.every((item) => item.origin === 'live'));
  assert.deepEqual(result.warnings, []);
});

test('local questions use current proposal gaps, avoiding protected and withdrawn fields', () => {
  const source = task({
    protectedFields: ['data.source'], manualFields: ['users'],
    questions: [{ id: 'metric', field: 'success.metric' }, { id: 'context', field: 'context' }],
    answers: [{ questionId: 'metric', value: 'Пока не знаю', skipped: false }, { questionId: 'context', value: null, skipped: true }],
  });
  const proposal = mergeCard(emptyCard(), { data: { availability: 'available' }, result: { artifact: 'Веб-прототип' } });
  const result = repairClarifications(source, proposal, [question('data.source'), question('success.metric')]);
  assert.equal(result.questions.length, 3);
  assert.ok(result.questions.every((item) => !['data.availability', 'data.source', 'users', 'success.metric', 'context', 'result.artifact'].includes(item.field)));
  assert.ok(result.questions.every((item) => item.origin === 'template'));
  assert.ok(result.questions.every((item) => Array.isArray(item.options)));
});

test('a skipped archived refinement is not asked again and stale model metadata is replaced', () => {
  const source = task({
    questionHistory: [{ id: 'old-source', field: 'data.source', refines: true, baseValue: 'Исходный CSV.' }],
    answers: [{ questionId: 'old-source', value: null, skipped: true }],
  });
  const proposal = mergeCard(emptyCard(), { data: { availability: 'available', source: 'Исходный CSV.' } });
  const input = { ...question('success.metric'), refines: true, baseValue: 'Устаревшее значение.' };
  const result = repairClarifications(source, proposal, [input]);
  assert.ok(result.questions.every((item) => item.field !== 'data.source'));
  assert.equal(result.questions[0].refines, false);
  assert.equal(Object.hasOwn(result.questions[0], 'baseValue'), false);
  assert.equal(input.baseValue, 'Устаревшее значение.');
});

const fullCard = () => mergeCard(emptyCard(), {
  title: 'Свободные аудитории', context: 'Сведения уточняют вручную.', need: 'Упростить поиск.', users: 'Студенты.',
  data: { availability: 'available', source: 'Синтетическое расписание.' },
  result: { artifact: 'Веб-прототип.', scope: 'Поиск по корпусу и времени.' },
  success: { metric: 'Соответствие расписанию.', target: 'Результаты совпадают с контрольными примерами.' },
  constraints: { deadlineMode: 'flexible', technologyAccess: 'Без внутренних интеграций.' },
  contact: { channel: 'demo@example.org', consultation: 'Вопросы письменно.', feedback: 'Письменные замечания заказчика.' },
});

test('a full card gets detail refinements with stable relevant options rather than repeated facts', () => {
  const proposal = fullCard();
  const source = task({ workingCard: structuredClone(proposal) });
  const result = repairClarifications(source, proposal, []);
  assert.equal(result.questions.length, 3);
  assert.deepEqual(result.questions.map((item) => item.field), ['data.source', 'result.scope', 'constraints.technologyAccess']);
  assert.ok(result.questions.every((item) => item.origin === 'template' && item.refines));
  assert.ok(result.questions[0].text.includes('проверки'));
  const optionTopics = { 'data.source': /формат|полнот|пропуск|доступ|разрешен/iu,
    'result.scope': /нет подходящего|некорректн|недоступн/iu,
    'constraints.technologyAccess': /ограничен/iu };
  for (const item of result.questions) {
    assert.equal(item.baseValue, item.field === 'data.source' ? proposal.data.source : item.field === 'result.scope' ? proposal.result.scope : proposal.constraints.technologyAccess);
    assert.ok(item.options.length >= 2 && item.options.length <= 3);
    assert.ok(item.options.every((option) => optionTopics[item.field].test(option.value)), 'options should answer the refinement, not offer a replacement fact');
    assert.ok(item.options.every((option) => !/\d/u.test(option.value)));
    assert.deepEqual(normalizeQuestionOptions(item, source), item.options);
    assert.deepEqual(normalizeQuestionOptions({ ...item, options: normalizeQuestionOptions(item, source) }, source), item.options);
  }
  assert.deepEqual(proposal, fullCard());
});

test('feedback refinement offers ways to record a decision while retaining the known reviewer', () => {
  const proposal = fullCard();
  const source = task({ protectedFields: ['data.source'], workingCard: structuredClone(proposal) });
  const result = repairClarifications(source, proposal, []);
  const feedback = result.questions.find((item) => item.field === 'contact.feedback');
  assert.ok(feedback?.refines);
  assert.equal(feedback.baseValue, proposal.contact.feedback);
  assert.ok(feedback.options.every((option) => /замечан/iu.test(option.value)));
  assert.deepEqual(normalizeQuestionOptions(feedback, source), feedback.options);
});

test('meaningful model text refinements retain wording while known enums and title are excluded', () => {
  const proposal = fullCard();
  const originals = [question('success.metric'), question('users'), question('context')];
  const result = repairClarifications(task(), proposal, [question('title'), question('data.availability'), question('constraints.deadlineDate'), ...originals]);
  assert.deepEqual(result.questions, originals.map((item) => ({ ...item, origin: 'live', refines: true,
    baseValue: item.field === 'success.metric' ? proposal.success.metric : item.field === 'users' ? proposal.users : proposal.context })));
  assert.deepEqual(result.warnings, []);
});

test('no eligible questions preserves the proposal and honestly reports fewer than three', () => {
  const proposal = fullCard();
  const source = task({ protectedFields: ['title', 'context', 'need', 'users', 'data.availability', 'data.source', 'result.artifact', 'result.scope', 'success.metric', 'success.target', 'constraints.deadlineMode', 'constraints.deadlineDate', 'constraints.technologyAccess', 'contact.channel', 'contact.consultation', 'contact.feedback'] });
  const result = repairClarifications(source, proposal, [question('users')]);
  assert.deepEqual(result.questions, []);
  assert.ok(result.warnings.some((message) => message.includes('меньше трёх')));
  assert.deepEqual(proposal, fullCard());
});
