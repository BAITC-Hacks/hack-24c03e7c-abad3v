import { CARD_PATHS, getField, mergeCard, setField } from './card.js';

export const protectedPaths = (task) => new Set([...(task.protectedFields ?? []), ...(task.manualFields ?? [])]);

export function sourcesFor(task) {
  const sources = [{ id: 'draft', text: task.draftText }];
  const questions = new Map([...(task.questionHistory ?? []), ...(task.questions ?? [])].map((question) => [question.id, question]));
  for (const answer of task.answers ?? []) {
    const question = questions.get(answer.questionId);
    if (!answer.skipped && answer.value && question && question.field !== 'contact.channel') {
      sources.push({ id: `answer:${answer.questionId}`, field: question.field, question: question.text, text: answer.value });
    }
  }
  for (const field of CARD_PATHS) {
    if (field === 'contact.channel') continue;
    const value = getField(task.workingCard, field);
    if (value) sources.push({ id: `card:${field}`, text: value });
  }
  return sources;
}

export function startingProposal(task) {
  const proposal = structuredClone(task.workingCard);
  const sourceMap = new Map(sourcesFor(task).map((source) => [source.id, source.text]));
  const protectedFields = protectedPaths(task);
  for (const prior of task.aiResult?.evidence ?? []) {
    const generated = prior.sourceId === 'draft' || prior.sourceId.startsWith('answer:');
    const unchanged = getField(task.aiResult.proposal, prior.field) === getField(proposal, prior.field);
    if (generated && unchanged && !protectedFields.has(prior.field) && !sourceMap.get(prior.sourceId)?.includes(prior.quote)) setField(proposal, prior.field, null);
  }
  const evidence = CARD_PATHS.filter((field) => getField(proposal, field)).map((field) => {
    const prior = task.aiResult?.evidence?.find((item) => item.field === field);
    return prior && sourceMap.get(prior.sourceId)?.includes(prior.quote) && getField(task.aiResult.proposal, field) === getField(proposal, field)
      ? prior : { field, sourceId: `card:${field}`, quote: getField(proposal, field) };
  });
  return { proposal, evidence };
}

export function canSuggest(task, proposal, field) {
  if (protectedPaths(task).has(field)) return false;
  const value = getField(proposal, field);
  if (value === null || value === '') return true;
  const prior = task.aiResult?.evidence?.find((item) => item.field === field);
  return Boolean(prior && !prior.sourceId.startsWith('card:') && value === getField(task.aiResult.proposal, field));
}

export function addFact(task, result, field, value, sourceId, quote) {
  if (!value || !quote || protectedPaths(task).has(field)) return;
  const parts = field.split('.');
  const patch = parts.length === 1 ? { [field]: value } : { [parts[0]]: { [parts[1]]: value } };
  Object.assign(result.proposal, mergeCard(result.proposal, patch));
  result.evidence = result.evidence.filter((item) => item.field !== field);
  result.evidence.push({ field, sourceId, quote });
}
