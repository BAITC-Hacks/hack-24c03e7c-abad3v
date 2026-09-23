import { hasMeaningfulValue, normalizeKnownValue } from '../../shared/card-values.js';

export const TOPICS = ['education', 'career', 'operations', 'analytics', 'other'];
export const LEVELS = ['needs_clarification', 'workable', 'ready', 'priority'];

const structure = {
  title: null,
  context: null,
  need: null,
  users: null,
  data: { availability: null, source: null },
  result: { artifact: null, scope: null },
  success: { metric: null, target: null },
  constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null },
  contact: { channel: null, consultation: null, feedback: null },
};

export const emptyCard = () => structuredClone(structure);
export const CARD_PATHS = [
  'title', 'context', 'need', 'users',
  'data.availability', 'data.source',
  'result.artifact', 'result.scope',
  'success.metric', 'success.target',
  'constraints.deadlineMode', 'constraints.deadlineDate', 'constraints.technologyAccess',
  'contact.channel', 'contact.consultation', 'contact.feedback',
];

export function getField(card, path) {
  return path.split('.').reduce((value, key) => value?.[key], card);
}

export function setField(card, path, value) {
  const parts = path.split('.');
  const parent = parts.slice(0, -1).reduce((item, key) => item[key], card);
  parent[parts.at(-1)] = value;
}

export function cleanText(value, max = 1000) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new CardError('Ожидается строка или null');
  const text = value.trim();
  if (text.length > max) throw new CardError(`Слишком длинное поле: максимум ${max} символов`);
  return text || null;
}

export class CardError extends Error {}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function mergeCard(card, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new CardError('cardPatch должен быть объектом');
  const next = structuredClone(card);
  function walk(value, prefix = '') {
    for (const [key, fieldValue] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
        if (!CARD_PATHS.some((item) => item.startsWith(`${path}.`))) throw new CardError(`Неизвестное поле ${path}`);
        walk(fieldValue, path);
      } else {
        if (!CARD_PATHS.includes(path)) throw new CardError(`Неизвестное поле ${path}`);
        const normalized = normalizeKnownValue(cleanText(fieldValue, path === 'title' ? 120 : 1000));
        if (path === 'data.availability' && normalized && !['available', 'planned', 'unavailable'].includes(normalized)) throw new CardError('Некорректный статус данных');
        if (path === 'constraints.deadlineMode' && normalized && !['fixed', 'flexible'].includes(normalized)) throw new CardError('Некорректный тип срока');
        if (path === 'constraints.deadlineDate' && normalized && !validDate(normalized)) throw new CardError('Срок должен быть действительной датой YYYY-MM-DD');
        setField(next, path, normalized);
      }
    }
  }
  walk(patch);
  return next;
}

const filled = hasMeaningfulValue;
const hasContact = (value) => filled(value) && (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^https?:\/\//i.test(value));
const checks = [
  {
    key: 'contextNeed', label: 'Контекст и потребность',
    parts: [
      ['context', 10, 'Опишите, что происходит сейчас', filled],
      ['need', 10, 'Опишите, что нужно изменить', filled],
    ],
  },
  {
    key: 'data', label: 'Данные и материалы',
    parts: [
      ['data.availability', 10, 'Укажите доступность данных', (v) => ['available', 'planned', 'unavailable'].includes(v)],
      ['data.source', 10, 'Назовите источник или план получения', filled],
    ],
  },
  {
    key: 'result', label: 'Ожидаемый результат',
    parts: [
      ['result.artifact', 10, 'Укажите вид результата', filled],
      ['result.scope', 5, 'Уточните границы результата', filled],
    ],
  },
  {
    key: 'success', label: 'Критерии успеха',
    parts: [
      ['success.metric', 10, 'Укажите проверяемый показатель', filled],
      ['success.target', 5, 'Опишите условие приёмки', filled],
    ],
  },
  {
    key: 'constraints', label: 'Ограничения',
    parts: [
      ['constraints.deadlineMode', 5, 'Укажите срок', (v, card) => v === 'flexible' || (v === 'fixed' && validDate(card.constraints.deadlineDate))],
      ['constraints.technologyAccess', 5, 'Опишите технологии или доступы', filled],
    ],
  },
  {
    key: 'users', label: 'Пользователи',
    parts: [['users', 10, 'Укажите целевую группу', filled]],
  },
  {
    key: 'contact', label: 'Связь с бизнесом',
    parts: [
      ['contact.channel', 4, 'Укажите рабочий контакт', hasContact],
      ['contact.consultation', 3, 'Формат консультаций', filled],
      ['contact.feedback', 3, 'Порядок обратной связи', filled],
    ],
  },
];

export function scoreCard(card) {
  const missingFields = [];
  const breakdown = checks.map((category) => {
    let earned = 0;
    const missing = [];
    for (const [path, weight, hint, test] of category.parts) {
      if (test(getField(card, path), card)) earned += weight;
      else { missing.push(hint); missingFields.push(path); }
    }
    return { key: category.key, label: category.label, earned, max: category.parts.reduce((sum, part) => sum + part[1], 0), missing };
  });
  const score = breakdown.reduce((sum, row) => sum + row.earned, 0);
  const level = score < 40 ? 'needs_clarification' : score < 70 ? 'workable' : score < 90 ? 'ready' : 'priority';
  return { score, level, breakdown, missingFields, scoringVersion: 'v1' };
}

export function validatePublishable(card) {
  if (!filled(card.title) || card.title.length < 3) throw new CardError('Для публикации укажите название от 3 символов');
}
