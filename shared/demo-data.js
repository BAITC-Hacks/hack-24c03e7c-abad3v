import { normalizeTopic } from './topics.js';

// Portable CSV reader shared by the Node seed and Vite's offline demo.
export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ''; closed = false; };
  const pushRow = () => { pushField(); if (row.some((value) => value.trim())) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') { pushRow(); if (char === '\r' && text[index + 1] === '\n') index++; }
    else if (closed) { if (char !== ' ' && char !== '\t') throw new Error('CSV: лишний символ после кавычки'); }
    else if (char === '"') { if (field) throw new Error('CSV: кавычка внутри неэкранированного поля'); quoted = true; }
    else field += char;
  }
  if (quoted) throw new Error('CSV: незакрытая кавычка');
  if (field || row.length || closed) pushRow();
  if (!rows.length) throw new Error('CSV: отсутствует заголовок');
  const headers = rows.shift().map((value) => value.trim());
  if (headers.some((value) => !value) || new Set(headers).size !== headers.length) throw new Error('CSV: пустые или повторяющиеся заголовки');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV: строка ${index + 2}, неверное количество полей`);
    return Object.fromEntries(headers.map((name, column) => [name, values[column]]));
  });
}

const groups = [
  ['contextNeed', 'Контекст и потребность', 20, ['context', 'need']],
  ['data', 'Данные и материалы', 20, ['data.availability', 'data.source']],
  ['result', 'Ожидаемый результат', 15, ['result.artifact', 'result.scope']],
  ['success', 'Критерии успеха', 15, ['success.metric', 'success.target']],
  ['constraints', 'Ограничения', 10, ['constraints.deadlineMode', 'constraints.deadlineDate', 'constraints.technologyAccess']],
  ['users', 'Пользователи', 10, ['users']],
  ['contact', 'Связь с бизнесом', 10, ['contact.channel', 'contact.consultation', 'contact.feedback']],
];
const optional = (value) => value?.trim() || null;
const list = (value) => value.split('|').map((item) => item.trim()).filter(Boolean);
const required = (value, label) => { if (!value?.trim()) throw new Error(`Демо CSV: отсутствует ${label}`); return value.trim(); };
function integer(value, label, min = 0, max = Infinity) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`Демо CSV: некорректное число ${label}`);
  return Number(value);
}
function bool(value, label) {
  if (!['true', 'false'].includes(value)) throw new Error(`Демо CSV: ${label} должен быть true или false`);
  return value === 'true';
}
function choice(value, allowed, label, nullable = false) {
  if (nullable && !value) return null;
  if (!allowed.includes(value)) throw new Error(`Демо CSV: недопустимое значение ${label}: ${value}`);
  return value;
}
function table(text, name, columns) {
  let rows;
  try { rows = parseCsv(text); } catch (error) { throw new Error(`${name}: ${error.message}`); }
  if (!rows.length) throw new Error(`${name}: нет записей`);
  const seen = new Set();
  for (const row of rows) {
    for (const column of columns) if (!(column in row)) throw new Error(`${name}: отсутствует колонка ${column}`);
    required(row.id, `${name}.id`);
    if (seen.has(row.id)) throw new Error(`${name}: повторяется id ${row.id}`);
    seen.add(row.id);
  }
  return rows;
}

export function loadDemoData(csv, timestamp = new Date().toISOString()) {
  const profileRows = table(csv.profiles, 'profiles.csv', ['id', 'name', 'interests', 'skills', 'technologies', 'isSynthetic']);
  const taskRows = table(csv.tasks, 'tasks.csv', ['id', 'industry', 'topic', 'draftText', 'completeness', 'isSynthetic']);
  const cardRows = table(csv.cards, 'cards.csv', ['id', 'industry', 'topic', 'title', 'context', 'need', 'users', 'dataAvailability', 'dataSource', 'resultArtifact', 'resultScope', 'successMetric', 'successTarget', 'deadlineMode', 'deadlineDate', 'technologyAccess', 'contactChannel', 'contactConsultation', 'contactFeedback', 'confirmed', 'revision', 'confirmedRevision', 'publicationStatus', 'readinessScore', 'readinessLevel', 'readinessLabel', 'missingFields', 'scoringVersion', 'isSynthetic', ...groups.map(([key]) => `score_${key}`)]);
  const applicationRows = table(csv.applications, 'applications.csv', ['id', 'taskId', 'teamId', 'teamName', 'idea', 'plan', 'timeline', 'prototypeUrl', 'status', 'decisionSource', 'linkKind', 'isSynthetic']);
  const actors = [
    { id: 'business-demo', kind: 'business', name: 'Карьерный центр', profile: { organization: 'Карьерный центр AI Sana', isSynthetic: true } },
    ...profileRows.map((row) => ({ id: row.id, kind: 'team', name: required(row.name, `${row.id}.name`), profile: { interests: list(row.interests), skills: list(row.skills), technologies: list(row.technologies), isSynthetic: bool(row.isSynthetic, `${row.id}.isSynthetic`) } })),
  ];
  const cardsById = new Map(cardRows.map((row) => [row.id, row]));
  const tasks = taskRows.map((source) => {
    const row = cardsById.get(source.id);
    if (!row) throw new Error(`cards.csv: нет карточки ${source.id}`);
    const topic = normalizeTopic(required(source.topic, `${source.id}.topic`));
    if (normalizeTopic(required(row.topic, `${row.id}.topic`)) !== topic || row.industry !== source.industry || row.isSynthetic !== source.isSynthetic) throw new Error(`Демо CSV: сведения tasks/cards расходятся для ${row.id}`);
    const card = {
      title: optional(row.title), context: optional(row.context), need: optional(row.need), users: optional(row.users),
      data: { availability: choice(row.dataAvailability, ['available', 'planned', 'unavailable'], 'dataAvailability', true), source: optional(row.dataSource) },
      result: { artifact: optional(row.resultArtifact), scope: optional(row.resultScope) },
      success: { metric: optional(row.successMetric), target: optional(row.successTarget) },
      constraints: { deadlineMode: choice(row.deadlineMode, ['fixed', 'flexible'], 'deadlineMode', true), deadlineDate: optional(row.deadlineDate), technologyAccess: optional(row.technologyAccess) },
      contact: { channel: optional(row.contactChannel), consultation: optional(row.contactConsultation), feedback: optional(row.contactFeedback) },
    };
    if (card.constraints.deadlineDate) {
      const date = new Date(`${card.constraints.deadlineDate}T00:00:00.000Z`);
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== card.constraints.deadlineDate) throw new Error(`Демо CSV: некорректная дата ${row.id}`);
    }
    const missingFields = list(row.missingFields);
    const breakdown = groups.map(([key, label, max, fields]) => ({ key, label, max, earned: integer(row[`score_${key}`], `${row.id}.score_${key}`, 0, max), missing: missingFields.filter((path) => fields.includes(path)) }));
    const score = integer(row.readinessScore, `${row.id}.readinessScore`, 0, 100);
    const level = score < 40 ? 'needs_clarification' : score < 70 ? 'workable' : score < 90 ? 'ready' : 'priority';
    if (breakdown.reduce((sum, line) => sum + line.earned, 0) !== score || row.readinessLevel !== level) throw new Error(`Демо CSV: несогласованный рейтинг ${row.id}`);
    const rating = { score, level, breakdown, missingFields, scoringVersion: required(row.scoringVersion, `${row.id}.scoringVersion`) };
    const confirmed = bool(row.confirmed, `${row.id}.confirmed`);
    const publicationStatus = choice(row.publicationStatus, ['draft', 'published'], 'publicationStatus');
    const published = publicationStatus === 'published';
    const revision = integer(row.revision, `${row.id}.revision`, 1);
    const confirmedRevision = confirmed ? integer(row.confirmedRevision, `${row.id}.confirmedRevision`, 1, revision) : null;
    if (published && (!confirmed || !card.title)) throw new Error(`Демо CSV: опубликованная задача ${row.id} должна быть подтверждена и иметь название`);
    return {
      id: row.id, businessId: 'business-demo', draftText: required(source.draftText, `${row.id}.draftText`), topic,
      industry: source.industry, completeness: source.completeness, isSynthetic: bool(source.isSynthetic, `${row.id}.isSynthetic`),
      workingCard: card, confirmedCard: confirmed ? structuredClone(card) : null, confirmedTopic: confirmed ? topic : null,
      publishedCard: published ? structuredClone(card) : null, publishedTopic: published ? topic : null,
      revision, confirmedRevision, publishedRevision: published ? confirmedRevision : null, publicationStatus,
      rating, previewRating: structuredClone(rating), publishedRating: published ? structuredClone(rating) : null,
      hasUnpublishedChanges: published && revision !== confirmedRevision, aiResult: null, questions: [], answers: [], manualFields: [],
      publishedAt: published ? timestamp : null, createdAt: timestamp, updatedAt: timestamp,
    };
  });
  if (cardRows.length !== tasks.length) throw new Error('Демо CSV: в cards.csv есть карточки без исходной задачи');
  const taskIds = new Set(tasks.map((task) => task.id));
  const teams = new Map(actors.filter((actor) => actor.kind === 'team').map((actor) => [actor.id, actor]));
  const applications = applicationRows.map((row) => {
    if (!taskIds.has(row.taskId)) throw new Error(`applications.csv: неизвестная задача ${row.taskId}`);
    if (!teams.has(row.teamId) || teams.get(row.teamId).name !== row.teamName) throw new Error(`applications.csv: неизвестная команда или неверное имя ${row.teamId}`);
    const status = choice(row.status, ['pending', 'selected', 'rejected'], 'status');
    const prototypeUrl = required(row.prototypeUrl, `${row.id}.prototypeUrl`);
    if (!/^https?:$/.test(new URL(prototypeUrl).protocol)) throw new Error(`applications.csv: недопустимая ссылка ${row.id}`);
    return {
      id: row.id, taskId: row.taskId, teamId: row.teamId, teamName: row.teamName,
      idea: required(row.idea, `${row.id}.idea`), plan: required(row.plan, `${row.id}.plan`), timeline: required(row.timeline, `${row.id}.timeline`),
      prototypeUrl, status, clientRequestId: row.id, decisionSource: optional(row.decisionSource), linkKind: optional(row.linkKind), isSynthetic: bool(row.isSynthetic, `${row.id}.isSynthetic`),
      createdAt: timestamp, decidedAt: status === 'pending' ? null : timestamp,
    };
  });
  return { actors, tasks, applications };
}
