import { CARD_PATHS } from './card.js';

// The client appends an edited answer to the end of the saved array.
// A skipped/empty answer supplies no fact and does not replace an earlier one.
export function latestAnswerSources(task) {
  const questions = new Map([...(task.questionHistory ?? []), ...(task.questions ?? [])]
    .map((question) => [question.id, question]));
  const seen = new Set();
  const sources = [];
  for (const answer of [...(task.answers ?? [])].reverse()) {
    const question = questions.get(answer.questionId);
    if (!question || !CARD_PATHS.includes(question.field) || seen.has(question.field)
      || answer.skipped || typeof answer.value !== 'string' || !answer.value.trim()) continue;
    seen.add(question.field);
    sources.push({ id: `answer:${answer.questionId}`, field: question.field, question: question.text, text: answer.value });
  }
  return sources;
}
