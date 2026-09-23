import { CARD_PATHS, emptyCard, getField, scoreCard, setField } from './card.js';

const questionText = {
  title: 'Как коротко назвать задачу, чтобы команда поняла её назначение?',
  context: 'Как задача решается сейчас и что в этом процессе не работает?',
  need: 'Какую конкретную проблему нужно решить?',
  users: 'Для какой группы людей предназначено решение?',
  'data.availability': 'Есть ли уже данные или материалы для разработки прототипа?',
  'data.source': 'Какие конкретные данные или примеры доступны и откуда их взять?',
  'result.artifact': 'Что именно должна сдать команда в конце работы?',
  'result.scope': 'Какие функции входят в первый прототип, а какие нет?',
  'success.metric': 'По какому проверяемому показателю оцените результат?',
  'success.target': 'Какое значение или условие означает, что результат принят?',
  'constraints.deadlineMode': 'Есть ли жёсткий срок выполнения или срок гибкий?',
  'constraints.deadlineDate': 'К какой дате нужен результат? Укажите дату в формате YYYY-MM-DD.',
  'constraints.technologyAccess': 'Какие есть ограничения по технологиям и доступам?',
  'contact.channel': 'Какой рабочий email или ссылку для связи можно указать?',
  'contact.consultation': 'Как часто команда сможет консультироваться с вами?',
  'contact.feedback': 'Кто сможет проверить прототип и как даст обратную связь?',
};

const priority = [
  'context', 'data.source', 'success.metric', 'result.artifact', 'users',
  'data.availability', 'constraints.deadlineMode', 'constraints.technologyAccess',
  'contact.feedback', 'need', 'result.scope', 'success.target', 'contact.consultation',
];
const enumFields = new Set(['data.availability', 'constraints.deadlineMode', 'constraints.deadlineDate']);
const normalize = (text) => typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
const unknown = (text) => !text
  || /^(?:пока )?(?:не знаю|не знаем|неизвестно|не определено|не определились|нет информации|нет ответа|не уверен|затрудняюсь ответить)/iu.test(text)
  || /^(?:потом|обсудим позже|уточним позже|unknown|not sure|i don.t know|n\/?a|[-—?]+)[.!?]*$/iu.test(text);
const uncertain = (text) => /(?:не знаю|не знаем|неизвестн|возможно|может быть|вероятно|наверно|предположительно|не уверен|не могу сказать|не можем сказать|если |не все |\?)/iu.test(text);

function parseAvailability(text) {
  const value = text.toLowerCase();
  if (['available', 'planned', 'unavailable'].includes(value)) return value;
  if (uncertain(value)) return null;
  const matches = new Set();
  if (/^(?:да|есть|доступны|уже доступны)[.!]?$/u.test(value)
    || /(?:данные|материалы|примеры) (?:уже )?(?:есть|доступны|подготовлены|собраны)/u.test(value)
    || /(?<![\p{L}])есть (?:готовые |тестовые |реальные )?(?:данные|материалы|примеры)/u.test(value)) matches.add('available');
  if (/^(?:нет|недоступны|пока нет)[.!]?$/u.test(value)
    || /(?:данных|материалов|примеров) (?:пока |сейчас )?нет/u.test(value)
    || /нет (?:данных|материалов|примеров)/u.test(value)
    || /(?:данные|материалы|примеры) (?:пока |ещё |сейчас )?(?:недоступны|не доступны|не подготовлены|отсутствуют|не собраны)/u.test(value)) matches.add('unavailable');
  if (/^(?:запланированы|планируются)[.!]?$/u.test(value)
    || /(?:данные|материалы|примеры) (?:будут (?:предоставлены|подготовлены|собраны)|планируется (?:подготовить|собрать|предоставить))/u.test(value)
    || /(?:подготовим|соберём|соберем|предоставим) (?:тестовые |реальные )?(?:данные|материалы|примеры)/u.test(value)) matches.add('planned');
  return matches.size === 1 ? [...matches][0] : null;
}

function parseDate(text) {
  if (uncertain(text)) return null;
  const dates = new Set([
    ...text.matchAll(/(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)/gu),
  ].map((match) => match[1]));
  for (const match of text.matchAll(/(?<!\d)(\d{2})\.(\d{2})\.(\d{4})(?!\d)/gu)) dates.add(`${match[3]}-${match[2]}-${match[1]}`);
  if (dates.size !== 1) return null;
  const value = [...dates][0];
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function parseDeadline(text) {
  const value = text.toLowerCase().replaceAll('ё', 'е');
  if (['fixed', 'flexible'].includes(value)) return value;
  if (uncertain(value)) return null;
  const flexible = /^(?:нет|гибкий)[.!]?$/u.test(value)
    || /(?:срок (?:пока )?гибкий|сроки (?:пока )?гибкие|нет (?:жесткого |фиксированного )?срока|(?:жесткого |фиксированного )?срока (?:пока )?нет|без (?:жесткого |фиксированного )?срока)/u.test(value);
  if (flexible) return 'flexible';
  if (/^(?:да|фиксированный|жесткий)[.!]?$/u.test(value)
    || /(?:срок (?:фиксированный|жесткий)|есть жесткий срок)/u.test(value)
    || parseDate(value)) return 'fixed';
  return null;
}

function parseEnum(field, text) {
  if (field === 'data.availability') return parseAvailability(text);
  if (field === 'constraints.deadlineMode') return parseDeadline(text);
  return parseDate(text);
}

// These rules copy source sentences; they do not invent a polished brief or infer dates.
const draftRules = {
  context: /(?:сейчас|в настоящее время|вручную|приходится|сложно|трудно|неудобно|теряют|теряется|не хватает|проблема|currently|manually|struggle)/iu,
  need: /(?:нуж(?:ен|на|но|ны)|необходимо|хотим|требуется|нужно|цель|хочется|need|want)/iu,
  users: /(?:пользователи\s*[:—-]|для\s+(?:студент|ученик|учащ|преподавател|учител|сотрудник|менеджер|оператор|клиент|куратор|наставник|абитуриент)|(?:студент|ученик|учащ|преподавател|учител|сотрудник|менеджер|оператор|клиент|куратор|наставник|абитуриент)[\p{L}]*\s+(?:сложно|трудно|нужно|хотят|могут|сможет|смогут|должны|тратят|теряют|ведут)|users\s*:|for students|for teachers|for employees)/iu,
  'data.source': /(?:данные|материалы|примеры|расписани[ея]|таблиц[аы]|dataset|data).*(?:из |источник|предостав|открыт|тестов|синтетичес|вымышлен|csv|excel|api)|(?:источник данных|тестов[\p{L}]* данные|синтетичес[\p{L}]* данные)/iu,
  'result.artifact': /(?:нуж(?:ен|на|но|ны)|разработать|создать|сделать|реализовать|результат|прототип).*(?:сайт|сервис|приложение|бот|дашборд|панель|отч[её]т|модель|прототип|тренаж[её]р|систем[ауы]|расширение)|(?:deliver|build|create).*(?:website|app|dashboard|report|prototype|bot)/iu,
  'result.scope': /(?:для (?:первого )?прототипа|перв(?:ый|ого) прототип|первая версия|включить|исключить|входит|входят|не входит|не входят|в рамках|ограничимся|достаточно|mvp|first prototype)/iu,
  'success.metric': /(?:успех\s*[:—-]|критери[йи] успеха|показатель|оценим|измерим|измерять|будем оценивать|проверим|проверить на|success metric)/iu,
  'success.target': /(?:успех\s*[:—-]|результат принят|считаем успешным|успех — если|успех - если|минимум \d|не менее \d|не больше \d|не более \d)/iu,
  'constraints.technologyAccess': /(?:запрещено|нельзя|не подключаться|не загружать|только открытые|персональные данные|ограничения по|ограничения\s*[:—-]|технологии\s*[:—-])/iu,
  'contact.consultation': /(?:консультац|встреча|встречи|встречаться).*(?:раз в|кажд|еженедель|ежеднев)|(?:раз в|кажд|еженедель|ежеднев).*(?:консультац|встреч)/iu,
  'contact.feedback': /(?:обратн[\p{L}]* связь|прототип проверят|прототип проверит|результат проверит)/iu,
};

export function templateResult(task, mode) {
  const proposal = emptyCard();
  for (const field of CARD_PATHS) setField(proposal, field, getField(task.workingCard, field) ?? null);
  const protectedFields = new Set(task.protectedFields ?? []);
  const unresolved = new Set();
  const warnings = [];
  const warn = (message) => { if (!warnings.includes(message)) warnings.push(message); };
  const mayFill = (field) => !protectedFields.has(field) && !normalize(getField(proposal, field));
  function fill(field, value) {
    if (!mayFill(field) || unknown(value)) return;
    const text = normalize(value);
    const max = field === 'title' ? 120 : 1000;
    if (text.length > max) warn(`Поле ${field} сокращено до ${max} символов; проверьте формулировку.`);
    setField(proposal, field, text.slice(0, max).trim());
  }

  // Latest saved answers take precedence, including an explicit unknown answer.
  const questions = new Map([...(task.questionHistory ?? []), ...(task.questions ?? [])].map((question) => [question.id, question]));
  const answeredFields = new Set();
  let dateFromDeadlineAnswer = null;
  for (const answer of [...(task.answers ?? [])].reverse()) {
    const field = questions.get(answer.questionId)?.field;
    if (!CARD_PATHS.includes(field) || answeredFields.has(field) || answer.skipped || !normalize(answer.value)) continue;
    answeredFields.add(field);
    if (!mayFill(field)) continue;
    const value = normalize(answer.value);
    if (unknown(value)) {
      unresolved.add(field);
      if (enumFields.has(field)) warn(`Ответ для ${field} не определён; поле оставлено пустым.`);
      continue;
    }
    if (enumFields.has(field)) {
      const parsed = parseEnum(field, value);
      if (!parsed) {
        unresolved.add(field);
        warn(`Не удалось однозначно определить ${field} из ответа; уточните поле вручную.`);
      } else {
        fill(field, parsed);
        if (field === 'constraints.deadlineMode' && parsed === 'fixed') {
          dateFromDeadlineAnswer = parseDate(value);
        }
      }
    } else fill(field, value);
  }
  if (dateFromDeadlineAnswer && !answeredFields.has('constraints.deadlineDate')) fill('constraints.deadlineDate', dateFromDeadlineAnswer);

  const draft = normalize(task.draftText);
  const sentences = typeof task.draftText === 'string'
    ? task.draftText.split(/(?<=[.!?])\s+|\r?\n/u).map(normalize).filter((sentence) => !unknown(sentence)) : [];
  if (sentences.length && !unresolved.has('title')) fill('title', sentences[0]);
  for (const [field, pattern] of Object.entries(draftRules)) {
    if (unresolved.has(field)) continue;
    const candidates = sentences.filter((sentence) => pattern.test(sentence));
    if (candidates.length) fill(field, field === 'result.scope' ? candidates.join(' ') : candidates[0]);
  }
  if (draft && !unknown(draft)) {
    if (!unresolved.has('data.availability') && mayFill('data.availability')) {
      const dataText = sentences.filter((sentence) => /(?:данн|материал|пример)/iu.test(sentence)).join(' ');
      const availability = parseAvailability(dataText);
      if (availability) fill('data.availability', availability);
      else if (dataText) warn('Доступность данных не указана однозначно в описании; уточните data.availability.');
    }
    const deadlineText = sentences.filter((sentence) => /(?:срок|дедлайн|нужен к|нужна к|нужно к|готов к|готова к|до \d|deadline)/iu.test(sentence)).join(' ');
    if (deadlineText) {
      const deadline = parseDeadline(deadlineText);
      if (!unresolved.has('constraints.deadlineMode') && deadline) fill('constraints.deadlineMode', deadline);
      else if (!deadline && mayFill('constraints.deadlineMode') && !unresolved.has('constraints.deadlineMode')) warn('Тип срока не указан однозначно в описании; уточните constraints.deadlineMode.');
      if (!unresolved.has('constraints.deadlineDate') && getField(proposal, 'constraints.deadlineMode') === 'fixed') {
        const date = parseDate(deadlineText);
        if (date) fill('constraints.deadlineDate', date);
      }
    }
  }
  if (proposal.constraints.deadlineMode === 'fixed' && !proposal.constraints.deadlineDate) warn('Указан фиксированный срок, но точная дата неизвестна; заполните её вручную.');

  if (mode === 'compose') return { questions: [], proposal, warnings };
  const missing = new Set(scoreCard(proposal).missingFields);
  const fields = priority.filter((field) => missing.has(field)).slice(0, 5);
  if (proposal.constraints.deadlineMode === 'fixed' && !proposal.constraints.deadlineDate) {
    const index = fields.indexOf('constraints.deadlineMode');
    if (index >= 0) fields[index] = 'constraints.deadlineDate';
  }
  for (const field of priority) {
    if (fields.length >= 3) break;
    if (!fields.includes(field)) fields.push(field);
  }
  return {
    questions: fields.map((field, index) => ({ id: `q${index + 1}`, field, text: questionText[field] })),
    proposal,
    warnings,
  };
}
