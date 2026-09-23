import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMeaningfulValue, isUnknownValue } from '../../shared/card-values.js';
import { CARD_PATHS, emptyCard, mergeCard, scoreCard, setField, validatePublishable } from '../src/card.js';
import { latestAnswerSources } from '../src/sources.js';
import { templateResult } from '../src/template.js';
import { composeLiveResult, prepareLiveRequest } from '../src/ai.js';

const unknownReplies = ['Не знаю.', ' Пока неизвестно! ', 'Пока не знаю...', 'Пока что не определено', 'НЕТ ИНФОРМАЦИИ.', 'Не уверен.', 'Не знаю, уточню позднее', 'Неизвестно; обсудим позже.', 'unknown.', 'I don’t know.', 'N/A', '—', '???', 'Тест.', '   '];
const task = (patch = {}) => ({ draftText: 'Нужен сайт для студентов.', workingCard: emptyCard(), questions: [], answers: [], ...patch });

test('unknown replies with punctuation cannot inflate any text part of the rating', () => {
  for (const value of unknownReplies) {
    const card = emptyCard();
    for (const path of CARD_PATHS) setField(card, path, value);
    assert.equal(isUnknownValue(value), true, value);
    assert.equal(hasMeaningfulValue(value), false, value);
    assert.equal(scoreCard(card).score, 0, value);
    assert.equal(scoreCard(card).missingFields.length, 14, value);
    assert.throws(() => validatePublishable(card), /название/, value);
    assert.deepEqual(mergeCard(emptyCard(), card), emptyCard(), value);
  }
});

test('negative facts and substantive clauses are preserved as known information', () => {
  for (const value of ['Без ограничений', 'Ограничений нет.', 'Данных нет, используем синтетику', 'Не знаю дату, но первая версия включает поиск.', 'Не знаю, но источник — CSV учебного отдела.', 'Нет', 'Неизвестно почему студенты теряют время']) {
    assert.equal(isUnknownValue(value), false, value);
    assert.equal(mergeCard(emptyCard(), { context: value }).context, value);
    assert.equal(scoreCard(mergeCard(emptyCard(), { context: value })).score, 10);
  }
  const card = mergeCard(emptyCard(), {
    data: { availability: 'unavailable', source: 'Данных нет, используем синтетику' },
    constraints: { deadlineMode: 'flexible', technologyAccess: 'Без ограничений' },
  });
  assert.equal(scoreCard(card).score, 30);
});

test('latest unknown answer withdraws an old generated value and cannot be cited by a live result', () => {
  for (const value of unknownReplies) {
    const old = 'Раньше сведения искали вручную.';
    const workingCard = mergeCard(emptyCard(), { context: old });
    const source = task({
      draftText: old,
      workingCard,
      questionHistory: [{ id: 'old', field: 'context' }],
      questions: [{ id: 'new', field: 'context' }],
      answers: [{ questionId: 'old', value: old }, { questionId: 'new', value }],
      aiResult: { proposal: structuredClone(workingCard), evidence: [{ field: 'context', sourceId: 'draft', quote: old }] },
    });
    assert.deepEqual(latestAnswerSources(source), [], value);
    const result = templateResult(source, 'compose');
    assert.equal(result.proposal.context, null, value);
    assert.equal(result.evidence.some(({ field }) => field === 'context'), false, value);
    const payload = JSON.parse(prepareLiveRequest(source, 'compose').input[1].content);
    assert.equal(payload.sources.some(({ id }) => id.startsWith('answer:')), false, value);
    // A model cannot undo the latest unknown reply by falling back to the old
    // draft, nor use this placeholder as evidence for a different field.
    assert.equal(composeLiveResult(source, [{ field: 'context', value: old, sourceId: 'draft', quote: old }]).proposal.context, null, value);
    assert.throws(() => composeLiveResult(source, [{ field: 'need', value: 'Выдуманная потребность', sourceId: 'answer:new', quote: value }]), /matching source/, value);
  }
});

test('AI cannot add placeholder facts or erase a useful negative answer', () => {
  const source = task({ questions: [{ id: 'data', field: 'data.source' }], answers: [{ questionId: 'data', value: 'Данных нет, используем синтетику' }] });
  assert.equal(templateResult(source, 'compose').proposal.data.source, source.answers[0].value);
  const result = composeLiveResult(source, [{ field: 'context', value: 'Пока неизвестно.', sourceId: 'draft', quote: source.draftText }]);
  assert.equal(result.proposal.context, null);
  assert.deepEqual(result.evidence, []);
});
