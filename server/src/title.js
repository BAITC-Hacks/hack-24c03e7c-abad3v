import { getField } from './card.js';
import { addFact, protectedPaths } from './proposal.js';
import { hasMeaningfulValue } from '../../shared/card-values.js';

// A local extractive safety net, never a second paid generation. Only use an
// already-grounded product/problem description, not arbitrary draft instructions.
export function fillMissingTitle(task, result, sources) {
  if (hasMeaningfulValue(result.proposal.title) || protectedPaths(task).has('title')) return false;
  for (const field of ['result.artifact', 'need']) {
    const value = getField(result.proposal, field);
    if (!hasMeaningfulValue(value)) continue;
    const prior = result.evidence.find((entry) => entry.field === field);
    const source = prior ? sources.find((entry) => entry.id === prior.sourceId) : sources.find((entry) => entry.id === `card:${field}`);
    const quote = prior?.quote ?? value;
    if (!source?.text.includes(quote)) continue;
    let title = value.trim().replace(/^(?:(?:нам|мне) )?(?:нужен|нужна|нужно|нужны|хотим|хочу)\s+/iu, '').replace(/[.!?]+$/u, '');
    if (title.length > 120) title = `${title.slice(0, 117).replace(/\s+\S*$/u, '').trim()}…`;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    addFact(task, result, 'title', title, source.id, quote);
    return hasMeaningfulValue(result.proposal.title);
  }
  return false;
}
