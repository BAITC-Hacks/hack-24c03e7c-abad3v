import { emptyCard, mergeCard, scoreCard } from './card.js';

// Exact fingerprints of the retired sample dataset. Never inserted or served.
const legacyTasks = [
  {
    id: 'seed-task-1', topic: 'education', draft: 'Нужно приложение для студентов.',
    fields: { title: 'Помощник для учёбы' },
  },
  {
    id: 'seed-task-2', topic: 'career', draft: 'Хотим помочь выпускникам готовиться к собеседованиям.',
    fields: {
      title: 'Тренажёр собеседований',
      context: 'Консультант вручную подбирает вопросы выпускникам.',
      need: 'Упростить самостоятельную подготовку студентов.',
      users: 'Студенты выпускного курса IT.',
      result: { artifact: 'Веб-прототип тренажёра.' },
    },
  },
  {
    id: 'seed-task-3', topic: 'operations', draft: 'Нужен инструмент для записи на консультации.',
    fields: {
      title: 'Запись на консультации',
      context: 'Заявки приходят в разные чаты, время иногда дублируется.',
      need: 'Собрать запись в одном месте.',
      users: 'Студенты и консультанты.',
      data: { availability: 'available', source: 'Синтетические примеры расписаний от бизнес-заказчика.' },
      result: { artifact: 'Веб-прототип записи.', scope: 'Выбор свободного слота и подтверждение.' },
    },
  },
  {
    id: 'seed-task-4', topic: 'analytics', draft: 'Нужна аналитика посещаемости курсов.',
    fields: {
      title: 'Аналитика посещаемости',
      context: 'Отчёт по посещаемости сейчас собирается вручную.',
      need: 'Показывать изменения посещаемости по курсам.',
      users: 'Методисты образовательного центра.',
      data: { availability: 'available', source: 'Синтетическая таблица отметок по занятиям.' },
      result: { artifact: 'Панель с графиками.', scope: 'Только история посещений и фильтр по курсу.' },
      success: { metric: 'Проверка десяти сценариев с фильтрацией.', target: 'Не менее восьми проходят.' },
    },
  },
  {
    id: 'seed-task-5', topic: 'career', draft: 'Создать тренажёр собеседований по подробному брифу.',
    fields: {
      title: 'Тренажёр собеседований по IT',
      context: 'Карьерный консультант подбирает вопросы вручную.',
      need: 'Дать выпускникам инструмент для самостоятельной тренировки.',
      users: 'Студенты выпускного курса IT.',
      data: { availability: 'available', source: '20 обезличенных вакансий и 40 согласованных вопросов.' },
      result: { artifact: 'Веб-прототип тренировки.', scope: 'Пять вопросов с объяснением; без интеграции с ATS.' },
      success: { metric: 'Проверка десяти сценариев.', target: 'Не менее восьми сценариев проходят.' },
      constraints: { deadlineMode: 'flexible', technologyAccess: 'Синтетические данные, без доступа к внутренним системам.' },
      contact: { channel: 'career@example.org', consultation: '20 минут раз в неделю.', feedback: 'Ответ по почте в течение двух рабочих дней.' },
    },
  },
];

const legacyApplications = [
  ['seed-app-1', 'seed-task-1', 'team-vector', 'Предлагаем карту потребностей студентов.', 'Интервью, прототип, проверка.', '2 недели', 'pending'],
  ['seed-app-2', 'seed-task-2', 'team-orbit', 'Сделаем интерактивный тренажёр.', 'Макет, реализация, проверка.', '2 недели', 'selected'],
  ['seed-app-3', 'seed-task-2', 'team-sana', 'Добавим подбор вопросов по навыкам.', 'Данные, прототип, проверка.', '3 недели', 'selected'],
  ['seed-app-4', 'seed-task-3', 'team-step', 'Сделаем запись по слотам.', 'Форма, календарная сетка, проверка.', '2 недели', 'rejected'],
  ['seed-app-5', 'seed-task-4', 'team-spark', 'Соберём понятный экран аналитики.', 'Макет, графики, тесты.', '3 недели', 'pending'],
];

const legacyActors = [
  ['team-orbit', 'Orbit', { interests: ['career', 'education'], skills: ['React', 'UX'], technologies: ['JavaScript'] }],
  ['team-sana', 'Sana Labs', { interests: ['education'], skills: ['Python', 'AI'], technologies: ['Python', 'React'] }],
  ['team-step', 'Step', { interests: ['operations'], skills: ['Analytics'], technologies: ['JavaScript'] }],
  ['team-spark', 'Spark', { interests: ['career'], skills: ['Design'], technologies: ['Figma', 'React'] }],
  ['team-vector', 'Vector', { interests: ['analytics'], skills: ['Data'], technologies: ['Python'] }],
];

const sameJson = (raw, expected) => {
  try { return JSON.stringify(JSON.parse(raw)) === JSON.stringify(expected); } catch { return false; }
};

function unchangedTask(row, source) {
  if (!row) return false;
  const card = mergeCard(emptyCard(), source.fields);
  const rating = scoreCard(card);
  return row.business_id === 'business-demo' && row.draft_text === source.draft && row.topic === source.topic
    && row.confirmed_topic === source.topic && row.published_topic === source.topic
    && row.revision === 1 && row.confirmed_revision === 1 && row.published_revision === 1
    && row.publication_status === 'published' && row.score === rating.score && row.published_score === rating.score
    && sameJson(row.working_card_json, card) && sameJson(row.confirmed_card_json, card) && sameJson(row.published_card_json, card)
    && ['questions_json', 'answers_json', 'question_history_json', 'manual_fields_json', 'protected_fields_json'].every((key) => sameJson(row[key], []))
    && row.ai_result_json === null && row.last_analysis_json === null;
}

// Called only inside the explicit CSV-seed transaction. Changed records and all
// unrelated IDs are retained, including user drafts and their AI usage history.
export function removeUnchangedLegacyDemo(db) {
  const report = { removedTasks: [], removedApplications: [], removedActors: [], preserved: [] };
  for (const [id, taskId, teamId, idea, plan, timeline, status] of legacyApplications) {
    const row = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
    if (!row) continue;
    const unchanged = row.task_id === taskId && row.team_id === teamId && row.idea === idea && row.plan === plan
      && row.timeline === timeline && row.status === status && row.client_request_id === id
      && row.prototype_url === `https://example.org/demo/${id}`;
    if (unchanged) {
      db.prepare('DELETE FROM applications WHERE id=?').run(id);
      report.removedApplications.push(id);
    } else report.preserved.push(id);
  }
  for (const source of legacyTasks) {
    const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(source.id);
    if (!row) continue;
    const references = db.prepare('SELECT (SELECT COUNT(*) FROM applications WHERE task_id=?) + (SELECT COUNT(*) FROM ai_usage WHERE task_id=?) AS count').get(source.id, source.id).count;
    if (unchangedTask(row, source) && references === 0) {
      db.prepare('DELETE FROM tasks WHERE id=?').run(source.id);
      report.removedTasks.push(source.id);
    } else report.preserved.push(source.id);
  }
  for (const [id, name, profile] of legacyActors) {
    const row = db.prepare('SELECT * FROM actors WHERE id=?').get(id);
    if (!row) continue;
    const references = db.prepare('SELECT (SELECT COUNT(*) FROM applications WHERE team_id=?) + (SELECT COUNT(*) FROM tasks WHERE business_id=?) AS count').get(id, id).count;
    if (row.kind === 'team' && row.name === name && sameJson(row.profile_json, profile) && references === 0) {
      db.prepare('DELETE FROM actors WHERE id=?').run(id);
      report.removedActors.push(id);
    } else report.preserved.push(id);
  }
  return report;
}
