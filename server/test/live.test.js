import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCard, mergeCard } from '../src/card.js';
import { composeLiveProposal } from '../src/ai.js';

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
