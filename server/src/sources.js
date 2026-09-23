import { CARD_PATHS } from './card.js';

// The client appends an edited answer to the end of the saved array.
// The latest skip/clear explicitly withdraws a previous answer for the field.
export function latestAnswerStates(task) {
  const questions = new Map([...(task.questionHistory ?? []), ...(task.questions ?? [])]
    .map((question) => [question.id, question]));
  const seen = new Set();
  const sources = [];
  for (const answer of [...(task.answers ?? [])].reverse()) {
    const question = questions.get(answer.questionId);
    if (!question || !CARD_PATHS.includes(question.field) || seen.has(question.field)) continue;
    seen.add(question.field);
    sources.push({ id: `answer:${answer.questionId}`, field: question.field, question: question.text, text: answer.value, skipped: Boolean(answer.skipped) });
  }
  return sources;
}

export function latestAnswerSources(task) {
  return latestAnswerStates(task)
    .filter((answer) => !answer.skipped && typeof answer.text === 'string' && answer.text.trim())
    .map(({ skipped, ...source }) => source);
}
