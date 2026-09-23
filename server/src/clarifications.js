import { CARD_PATHS, getField } from './card.js';
import { protectedPaths } from './proposal.js';
import { hasMeaningfulValue } from '../../shared/card-values.js';
import { getQuestionOptions } from '../../shared/question-options.js';

const missingQuestions = [
  ['data.availability', 'Есть ли данные или материалы, с которыми команда сможет работать?'],
  ['data.source', 'Какие материалы команда сможет использовать и как получит к ним доступ?'],
  ['success.metric', 'По какому проверяемому показателю оцените результат?'],
  ['result.artifact', 'Что именно команда должна передать вам в конце работы?'],
  ['context', 'Как задача решается сейчас и что в этом процессе не работает?'],
  ['need', 'Какую конкретную проблему нужно решить?'],
  ['users', 'Кто будет пользоваться результатом и в какой ситуации?'],
  ['result.scope', 'Какие функции входят в первый прототип, а какие можно отложить?'],
  ['success.target', 'Какое условие будет означать, что результат можно принять?'],
  ['constraints.deadlineMode', 'Есть ли жёсткий срок выполнения или срок гибкий?'],
  ['constraints.deadlineDate', 'К какой точной дате нужен результат?'],
  ['constraints.technologyAccess', 'Какие ограничения по технологиям и доступам нужно учесть?'],
  ['contact.feedback', 'Кто сможет проверить прототип и как даст обратную связь?'],
  ['contact.consultation', 'Как команда сможет уточнять вопросы в ходе работы?'],
  ['contact.channel', 'Какой рабочий email или ссылку можно использовать для связи?'],
  ['title', 'Какое короткое название точнее всего передаёт задачу?'],
];
const refinements = [
  ['data.source', 'Какие проверки понадобятся перед использованием этих материалов?'],
  ['result.scope', 'Какие исключения и пограничные ситуации нужно учесть в этом объёме?'],
  ['constraints.technologyAccess', 'Как команда проверит перечисленные ограничения перед запуском?'],
  ['contact.feedback', 'Как фиксировать замечания и подтвердить итог проверки?'],
];
const noRefinement = new Set(['title', 'data.availability', 'constraints.deadlineMode', 'constraints.deadlineDate', 'contact.channel']);
const textKey = (text) => text.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU').replace(/[.!?…]+$/gu, '');

// Repair question coverage independently from fact extraction. The grounded
// proposal is read-only: generating another question must not rewrite its facts.
export function repairClarifications(task, proposal, validQuestions = []) {
  const blocked = protectedPaths(task);
  const previousQuestions = new Map([...(task.questionHistory ?? []), ...(task.questions ?? [])]
    .map((question) => [question.id, question]));
  const answeredFields = new Set();
  for (const answer of [...(task.answers ?? [])].reverse()) {
    const previous = previousQuestions.get(answer.questionId);
    if (!previous || answeredFields.has(previous.field)) continue;
    answeredFields.add(previous.field);
    if (answer.skipped || !hasMeaningfulValue(answer.value)) blocked.add(previous.field);
  }
  const questions = [], fields = new Set(), texts = new Set();
  const filled = (field) => hasMeaningfulValue(getField(proposal, field));
  const add = (question, origin) => {
    if (!question || !CARD_PATHS.includes(question.field) || blocked.has(question.field)
      || typeof question.text !== 'string' || !question.text.trim()
      || fields.has(question.field) || texts.has(textKey(question.text))) return;
    if (filled(question.field) && noRefinement.has(question.field)) return;
    if (question.field === 'constraints.deadlineDate' && getField(proposal, 'constraints.deadlineMode') === 'flexible') return;
    const { baseValue: _previousBase, ...copy } = structuredClone(question);
    questions.push({ ...copy, origin, refines: filled(question.field),
      ...(filled(question.field) ? { baseValue: getField(proposal, question.field) } : {}) });
    fields.add(question.field);
    texts.add(textKey(question.text));
  };
  for (const question of validQuestions) {
    if (questions.length === 5) break;
    add(question, 'live');
  }
  const liveCount = questions.length;
  const localQuestion = (field, text, refines = false) => {
    const question = { id: `q:${field}`, field, text, refines, origin: 'template' };
    return { ...question, options: getQuestionOptions(question, { ...task, proposal, workingCard: proposal }) };
  };
  for (const [field, text] of missingQuestions) {
    if (questions.length >= 3) break;
    if (filled(field) || field === 'constraints.deadlineDate' && getField(proposal, 'constraints.deadlineMode') !== 'fixed') continue;
    add(localQuestion(field, text), 'template');
  }
  for (const [field, text] of refinements) {
    if (questions.length >= 3) break;
    if (filled(field)) add(localQuestion(field, text, true), 'template');
  }
  const warnings = [];
  if (questions.length > liveCount) warnings.push('AI-вопросы дополнены локальными уточнениями; происхождение каждого вопроса отмечено отдельно.');
  if (questions.length < 3) warnings.push('Без повторения пропущенных вопросов и изменения ручных полей удалось предложить меньше трёх уточнений. Сохранённые сведения оставлены без изменений.');
  return { questions, warnings };
}
