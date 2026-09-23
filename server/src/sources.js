import { CARD_PATHS } from './card.js';
import { hasMeaningfulValue } from '../../shared/card-values.js';

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
    // Skipping an optional refinement withdraws only the addition, not the
    // already-known base statement or an older answer that established it.
    if (question.refines && (answer.skipped || !hasMeaningfulValue(answer.value))) continue;
    seen.add(question.field);
    sources.push({ id: `answer:${answer.questionId}`, field: question.field, question: question.text, text: answer.value, skipped: Boolean(answer.skipped) });
  }
  return sources;
}

export function latestAnswerSources(task) {
  return latestAnswerStates(task)
    .filter((answer) => !answer.skipped && hasMeaningfulValue(answer.text))
    .map(({ skipped, ...source }) => source);
}
