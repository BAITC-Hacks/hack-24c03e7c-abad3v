import { CARD_PATHS, getField, mergeCard, setField } from './card.js';
import { latestAnswerSources, latestAnswerStates } from './sources.js';
import { hasMeaningfulValue } from '../../shared/card-values.js';

export const protectedPaths = (task) => new Set([...(task.protectedFields ?? []), ...(task.manualFields ?? [])]);

export function sourcesFor(task) {
  const sources = [
    ...(hasMeaningfulValue(task.draftText) ? [{ id: 'draft', text: task.draftText }] : []),
    ...latestAnswerSources(task).filter(({ field }) => field !== 'contact.channel'),
  ];
  for (const field of CARD_PATHS) {
    if (field === 'contact.channel') continue;
    const value = getField(task.workingCard, field);
    if (hasMeaningfulValue(value)) sources.push({ id: `card:${field}`, field, text: value });
  }
  return sources;
}

export function startingProposal(task) {
  const proposal = structuredClone(task.workingCard);
  const sourceMap = new Map(sourcesFor(task).map((source) => [source.id, source.text]));
  const protectedFields = protectedPaths(task);
  const withdrawnFields = new Set(latestAnswerStates(task).filter((answer) => answer.skipped || !hasMeaningfulValue(answer.text)).map((answer) => answer.field));
  const previousResult = task.aiResult ?? task.lastAnalysis;
  for (const prior of previousResult?.evidence ?? []) {
    const generated = prior.sourceId === 'draft' || prior.sourceId.startsWith('answer:');
    const unchanged = getField(previousResult.proposal, prior.field) === getField(proposal, prior.field);
    if (generated && unchanged && !protectedFields.has(prior.field) && (withdrawnFields.has(prior.field) || !sourceMap.get(prior.sourceId)?.includes(prior.quote))) setField(proposal, prior.field, null);
  }
  const evidence = (previousResult?.evidence ?? []).filter((prior) => !protectedFields.has(prior.field)
    && getField(proposal, prior.field) && sourceMap.get(prior.sourceId)?.includes(prior.quote)
    && getField(previousResult.proposal, prior.field) === getField(proposal, prior.field));
  return { proposal, evidence };
}

export function canSuggest(task, proposal, field) {
  if (protectedPaths(task).has(field)) return false;
  const value = getField(proposal, field);
  if (!hasMeaningfulValue(value)) return true;
  const previousResult = task.aiResult ?? task.lastAnalysis;
  const prior = previousResult?.evidence?.find((item) => item.field === field);
  return Boolean(prior && !prior.sourceId.startsWith('card:') && value === getField(previousResult.proposal, field));
}

export function addFact(task, result, field, value, sourceId, quote) {
  if (!hasMeaningfulValue(value) || !quote?.trim() || protectedPaths(task).has(field)) return;
  const latestAnswer = latestAnswerStates(task).find((answer) => answer.field === field);
  if (latestAnswer && (latestAnswer.skipped || !hasMeaningfulValue(latestAnswer.text))) return;
  const parts = field.split('.');
  const patch = parts.length === 1 ? { [field]: value } : { [parts[0]]: { [parts[1]]: value } };
  Object.assign(result.proposal, mergeCard(result.proposal, patch));
  result.evidence = result.evidence.filter((item) => item.field !== field);
  result.evidence.push({ field, sourceId, quote });
}
