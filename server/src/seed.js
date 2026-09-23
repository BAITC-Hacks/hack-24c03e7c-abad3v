import { db, encode, now, transaction } from './db.js';
import { emptyCard, mergeCard, scoreCard } from './card.js';

const examples = [
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

const proposals = [
  ['seed-app-1', 'seed-task-1', 'team-vector', 'Предлагаем карту потребностей студентов.', 'Интервью, прототип, проверка.', '2 недели', 'pending'],
  ['seed-app-2', 'seed-task-2', 'team-orbit', 'Сделаем интерактивный тренажёр.', 'Макет, реализация, проверка.', '2 недели', 'selected'],
  ['seed-app-3', 'seed-task-2', 'team-sana', 'Добавим подбор вопросов по навыкам.', 'Данные, прототип, проверка.', '3 недели', 'selected'],
  ['seed-app-4', 'seed-task-3', 'team-step', 'Сделаем запись по слотам.', 'Форма, календарная сетка, проверка.', '2 недели', 'rejected'],
  ['seed-app-5', 'seed-task-4', 'team-spark', 'Соберём понятный экран аналитики.', 'Макет, графики, тесты.', '3 недели', 'pending'],
];

transaction(() => {
  const insertTask = db.prepare(`INSERT OR IGNORE INTO tasks
    (id,business_id,draft_text,topic,confirmed_topic,working_card_json,confirmed_card_json,revision,confirmed_revision,score,score_breakdown_json,score_missing_fields_json,scoring_version,publication_status,published_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const example of examples) {
    const card = mergeCard(emptyCard(), example.fields);
    const rating = scoreCard(card);
    const timestamp = now();
    insertTask.run(example.id, 'business-demo', example.draft, example.topic, example.topic, encode(card), encode(card), 1, 1, rating.score, encode(rating.breakdown), encode(rating.missingFields), 'v1', 'published', timestamp, timestamp, timestamp);
  }
  const insertProposal = db.prepare(`INSERT OR IGNORE INTO applications
    (id,task_id,team_id,idea,plan,timeline,prototype_url,status,client_request_id,created_at,decided_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [id, taskId, teamId, idea, plan, timeline, status] of proposals) {
    const timestamp = now();
    insertProposal.run(id, taskId, teamId, idea, plan, timeline, `https://example.org/demo/${id}`, status, id, timestamp, status === 'pending' ? null : timestamp);
  }
});

console.log('Demo seed ready: 5 published tasks, 5 teams, 5 proposals (idempotent).');
