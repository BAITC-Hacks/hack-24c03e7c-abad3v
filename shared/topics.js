import { hasMeaningfulValue } from './card-values.js';

export const TOPIC_MAX_LENGTH = 80;
const legacyLabels = {
  education: 'Образование', career: 'Карьера', operations: 'Операции',
  analytics: 'Аналитика', other: 'Тема не определена',
};

export function normalizeTopic(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/gu, ' ');
  if (!text) return null;
  if (text.length > TOPIC_MAX_LENGTH) throw new RangeError(`Тема должна содержать не более ${TOPIC_MAX_LENGTH} символов.`);
  return text;
}

export function labelForTopic(topic) {
  // Custom values also feed the controlled editor input: preserve spaces while typing.
  const text = typeof topic === 'string' ? topic : '';
  return Object.hasOwn(legacyLabels, text) ? legacyLabels[text] : text || legacyLabels.other;
}

// These are conservative fallback clues, not an enum of allowed topics.
// Live AI and an explicit source label may suggest any short topic name.
const rules = [
  ['Ветеринария', /ветеринар/iu],
  ['Медицина', /медицин|поликлиник|больниц|клиник|пациент|врач|здравоохран|лекарств|фармацевт|\bhealthcare\b|\bmedical\b|\bpatient\b/iu],
  ['Логистика', /логист|грузоперевоз|курьер|доставк|складск|склад(?:а|е|ы|ов|ской)?(?:\s|[.,;:]|$)|цепочк\S* постав|\blogistics\b|\bdelivery\b|\bwarehouse\b/iu],
  ['Финансы', /финанс|бухгалтер|кредит|плат[её]ж|бюджет|банковск|инвестиц|налог|страхован|\bfinanc\w*\b|\baccounting\b/iu],
  ['Розничная торговля', /розничн|магазин|покупател|товарн\S* остат|продаж|интернет-магазин|\bretail\b|\be-commerce\b/iu],
  ['Сельское хозяйство', /сельск\S* хозяйств|ферм(?:а|е|ы|ер)|агроном|урожай|посев|животновод|орошени|\bagriculture\b|\bfarming\b/iu],
  ['Экология', /экологи|переработк\S* (?:мусор|отход)|раздельн\S* сбор|мусор|отход|загрязнен|\brecycling\b|\benvironment\b/iu],
  ['Транспорт', /транспорт|автобус|пассажир|парковк|такси|дорожн\S* движен|\btransport\b|\bparking\b/iu],
  ['Туризм', /туризм|турист|гостиниц|отел[ьяе]|путешеств|экскурс|\btourism\b|\btravel\b|\bhotel\b/iu],
  ['Карьера и подбор персонала', /собеседован|стажиров|ваканси|резюме|трудоустрой|подбор\S* персонал|найм|карьер|\brecruit\w*\b|\binterview\b/iu],
  ['Образование', /образован|обучени|учебн|ученик|школьн|школ(?:а|е|ы|у)|преподавател|университет|колледж|урок|свободн\S* аудитор|\beducation\b|\bschool\b|\blearning\b/iu],
  ['Производство', /производств|завод|фабрик|станок|станк|цех(?:а|е|у|ов)?(?=$|[\s,.!?;:])|\bmanufactur\w*\b|\bfactory\b/iu],
  ['Строительство', /строительств|стройк|стройплощад|строительн|\bconstruction\b/iu],
  ['Кибербезопасность', /кибербезопас|фишинг|утечк\S* данн|вредоносн|защит\S* (?:данн|информац)|\bcybersecurity\b|\bphishing\b/iu],
  ['Юридические услуги', /юридическ|юрист|адвокат|судебн|договорн|\blegal\b/iu],
  ['Недвижимость', /недвижим|аренд\S* (?:квартир|помещен|жиль|офис)|риелтор|риэлтор|\breal estate\b/iu],
  ['Энергетика', /энергетик|электросет|электроэнерг|энергопотреб|солнечн\S* (?:панел|электростанц)|\benergy\b/iu],
  ['Городские сервисы', /городск\S* служб|коммунальн|благоустрой|жкх|муниципальн|\bmunicipal\b/iu],
  ['Маркетинг', /маркетинг|реклам|продвижен|таргетирован|\bmarketing\b/iu],
  ['Аналитика данных', /аналитик\S* данн|анализ\S* данн|визуализац\S* данн|\bdata analytics\b|\bdata analysis\b/iu],
];
const cardPaths = ['title', 'context', 'need', 'users', 'data.source', 'result.artifact', 'result.scope'];
const getField = (value, path) => path.split('.').reduce((object, key) => object?.[key], value);
const cleanSource = (value) => hasMeaningfulValue(value) ? value.replace(/https?:\/\/\S+|[^\s@]+@[^\s@]+/giu, '') : '';

function sourcesForTopic(task) {
  const questions = new Map([...(task.questionHistory || []), ...(task.questions || [])].map((question) => [question.id, question]));
  const latest = new Map();
  for (const answer of task.answers || []) {
    const question = questions.get(answer.questionId);
    // An unanswered refinement leaves the known base in place. It must not
    // withdraw an earlier answer or hide the field from topic detection.
    if (question?.refines && (answer.skipped || !hasMeaningfulValue(answer.value))) continue;
    const field = question?.field || (answer.questionId.startsWith('q:') ? answer.questionId.slice(2) : answer.questionId);
    latest.set(field, answer);
  }
  const sourceMap = new Map([['draft', typeof task.draftText === 'string' ? task.draftText : '']]);
  const primary = [cleanSource(task.draftText)];
  for (const [field, answer] of latest) {
    if (answer.skipped || !hasMeaningfulValue(answer.value)) continue;
    sourceMap.set(`answer:${answer.questionId}`, answer.value);
    if (!field.startsWith('contact.') && !field.startsWith('constraints.deadline') && field !== 'data.availability') primary.push(cleanSource(answer.value));
  }
  const card = task.workingCard || {};
  const secondary = [];
  for (const field of cardPaths) {
    const value = getField(card, field);
    const answer = latest.get(field);
    const manual = task.manualFields?.includes(field);
    if (!manual && answer && (answer.skipped || !hasMeaningfulValue(answer.value))) continue;
    const evidence = task.aiResult?.evidence?.find((item) => item.field === field);
    // A stale AI fact must not reintroduce a topic removed from its source.
    if (!manual && evidence && value === getField(task.aiResult?.proposal, field) && !evidence.sourceId.startsWith('card:') && !sourceMap.get(evidence.sourceId)?.includes(evidence.quote)) continue;
    secondary.push(cleanSource(value));
  }
  return { primary: [...new Set(primary.filter(Boolean))], secondary: [...new Set(secondary.filter(Boolean))] };
}

function topicIn(texts) {
  const text = texts.join('\n');
  // An explicit domain label remains open ended, e.g. "Отрасль: Ветеринария".
  const explicit = [...text.matchAll(/(?:^|[\n.;!?])\s*(?:тема|отрасль|сфера)(?:\s+(?:задачи|проекта|деятельности))?\s*[:—-]\s*([^\n.!?;,]+)/giu)].at(-1)?.[1];
  if (explicit && hasMeaningfulValue(explicit) && !/^(?:other|другое|без темы|(?:тема )?не (?:определена|указана))$/iu.test(explicit.trim())) {
    const label = explicit.trim().replace(/^[«"']|[»"']$/gu, '');
    if (label.length <= TOPIC_MAX_LENGTH && label.split(/\s+/u).length <= 8) return normalizeTopic(label);
  }
  let found = null;
  for (const [label, pattern] of rules) {
    for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      // Avoid embedded stems (e.g. "преобразование" is not "образование").
      if (match.index > 0 && /[\p{L}\p{N}]/u.test(text[match.index - 1])) continue;
      // Do not infer an industry from a directly negated mention.
      if (/(?:^|\s)(?:не|не про|не для|кроме)\s*$/iu.test(text.slice(Math.max(0, match.index - 20), match.index))) continue;
      if (!found || match.index < found.index) found = { label, index: match.index };
      break;
    }
  }
  return found?.label || null;
}

export function inferTopic(task = {}) {
  if (task.manualFields?.includes('topic')) return null;
  const sources = sourcesForTopic(task);
  return topicIn(sources.primary) || topicIn(sources.secondary);
}
