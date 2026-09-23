import type { Actor, Application, Card, Level, OwnerTask, Rating, RatingLine, TaskSummary, Topic } from './types'

const makeRating = (score: number, missingFields: string[] = []): Rating => {
  const level: Level = score < 40 ? 'needs_clarification' : score < 70 ? 'workable' : score < 90 ? 'ready' : 'priority'
  const values = [Math.round(score * .2), Math.round(score * .2), Math.round(score * .15), Math.round(score * .15), Math.round(score * .1), Math.round(score * .1), score - Math.round(score * .2) * 2 - Math.round(score * .15) * 2 - Math.round(score * .1) * 2]
  const keys = [
    ['contextNeed', 'Контекст и потребность', ['context', 'need']], ['data', 'Данные и материалы', ['data.availability', 'data.source']],
    ['result', 'Ожидаемый результат', ['result.artifact', 'result.scope']], ['success', 'Критерии успеха', ['success.metric', 'success.target']],
    ['constraints', 'Ограничения', ['constraints.deadlineMode', 'constraints.technologyAccess']], ['users', 'Пользователи', ['users']],
    ['contact', 'Связь с бизнесом', ['contact.channel', 'contact.consultation', 'contact.feedback']],
  ] as const
  const breakdown: RatingLine[] = keys.map(([key, label, fields], i) => ({ key, label, earned: Math.max(0, values[i]), max: [20, 20, 15, 15, 10, 10, 10][i], missing: missingFields.filter((f) => (fields as readonly string[]).includes(f)).slice(0, 2) }))
  return { score, level, breakdown, missingFields, scoringVersion: 'v1' }
}

export const blankCard = (): Card => ({
  title: null, context: null, need: null, users: null,
  data: { availability: null, source: null }, result: { artifact: null, scope: null },
  success: { metric: null, target: null }, constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null },
  contact: { channel: null, consultation: null, feedback: null },
})

const makeCard = (title: string, context: string, need: string, users: string, artifact: string, score: number): Card => ({
  title, context, need, users,
  data: { availability: score > 65 ? 'available' : 'planned', source: score > 65 ? 'Обезличенные данные партнёров' : null },
  result: { artifact, scope: 'Рабочий прототип и короткая инструкция' },
  success: { metric: score > 70 ? 'Доля успешно пройденных сценариев' : null, target: score > 70 ? 'Не менее 8 из 10' : null },
  constraints: { deadlineMode: 'flexible', deadlineDate: null, technologyAccess: 'Технологии на выбор команды' },
  contact: { channel: 'project@aisana.kz', consultation: 'Еженедельная встреча', feedback: score > 65 ? 'Ответ в течение 2 рабочих дней' : null },
})

const now = new Date().toISOString()
export const actors: Actor[] = [
  { id: 'business-career', kind: 'business', name: 'Карьерный центр', profile: 'Представитель бизнеса' },
  { id: 'business-school', kind: 'business', name: 'Школа будущего', profile: 'Представитель бизнеса' },
  { id: 'team-orbit', kind: 'team', name: 'Команда Orbit', profile: 'Студенческая команда' },
  { id: 'team-qadam', kind: 'team', name: 'Команда Qadam', profile: 'Студенческая команда' },
  { id: 'team-syntax', kind: 'team', name: 'Команда Syntax', profile: 'Студенческая команда' },
  { id: 'team-nomad', kind: 'team', name: 'Команда Nomad', profile: 'Студенческая команда' },
  { id: 'team-pixel', kind: 'team', name: 'Команда Pixel', profile: 'Студенческая команда' },
]

const seed = [
  { id: 'task-1', title: 'Понятный выбор профессии для старшеклассников', topic: 'education' as Topic, score: 82, status: 'published' as const, context: 'Ученики 10–11 классов выбирают профессию по разрозненным советам и не видят свои сильные стороны.', need: 'Помочь школьникам исследовать карьерные направления и сделать осознанный следующий шаг.', users: 'Ученики 10–11 классов и школьные карьерные консультанты.', artifact: 'Интерактивный профориентационный помощник', missing: ['contact.feedback'] },
  { id: 'task-2', title: 'Умный навигатор по учебным материалам', topic: 'education' as Topic, score: 64, status: 'published' as const, context: 'Преподаватели тратят время на поиск подходящих материалов для разных уровней группы.', need: 'Сократить время подготовки занятия без потери качества.', users: 'Преподаватели и учащиеся колледжа.', artifact: 'Демо-сервис подбора материалов', missing: ['data.source', 'success.target'] },
  { id: 'task-3', title: 'Очередь обращений в центр поддержки', topic: 'operations' as Topic, score: 38, status: 'published' as const, context: 'Заявки приходят в несколько каналов и часть теряется.', need: 'Собрать обращения в одном месте и упростить первичный разбор.', users: 'Сотрудники и посетители центра.', artifact: 'Кликабельный прототип кабинета', missing: ['data.availability', 'data.source', 'success.metric', 'contact.consultation'] },
  { id: 'task-4', title: 'Короткая диагностика цифровых навыков', topic: 'analytics' as Topic, score: 91, status: 'published' as const, context: 'Командам обучения сложно понять, какие цифровые навыки нужно развивать в первую очередь.', need: 'Собрать короткую диагностику и показать индивидуальные рекомендации.', users: 'Студенты первого курса.', artifact: 'Веб-диагностика с рекомендациями', missing: [] },
  { id: 'task-5', title: 'Онбординг новых волонтёров', topic: 'career' as Topic, score: 26, status: 'draft' as const, context: 'Новые волонтёры получают информацию из разных чатов.', need: 'Сделать первые шаги понятными.', users: 'Новые волонтёры.', artifact: 'Сценарий онбординга', missing: ['data.availability', 'data.source', 'result.scope', 'success.metric', 'success.target', 'constraints.technologyAccess', 'contact.channel', 'contact.consultation', 'contact.feedback'] },
  { id: 'task-6', title: 'Обратная связь после занятий', topic: 'education' as Topic, score: 0, status: 'draft' as const, context: 'После занятия преподавателю трудно быстро собрать обратную связь.', need: 'Пока формулируем задачу вместе с командами.', users: 'Преподаватели и учащиеся.', artifact: 'Пока не определён', missing: ['context', 'need', 'data.availability', 'data.source', 'result.scope', 'success.metric', 'success.target', 'constraints.deadlineMode', 'constraints.technologyAccess', 'contact.channel', 'contact.consultation', 'contact.feedback'] },
  { id: 'task-7', title: 'Планирование групповых проектов', topic: 'education' as Topic, score: 0, status: 'draft' as const, context: 'Студентам сложно распределять задачи внутри учебной команды.', need: 'Нужно изучить варианты совместного планирования.', users: 'Студенческие команды.', artifact: 'Пока не определён', missing: ['context', 'need', 'data.availability', 'data.source', 'result.scope', 'success.metric', 'success.target', 'constraints.deadlineMode', 'constraints.technologyAccess', 'contact.channel', 'contact.consultation', 'contact.feedback'] },
  { id: 'task-8', title: 'Доступность учебного расписания', topic: 'operations' as Topic, score: 0, status: 'draft' as const, context: 'Расписание меняется, а студенты узнают об этом из разных каналов.', need: 'Собрать понятный способ сообщать об изменениях.', users: 'Студенты и учебный офис.', artifact: 'Пока не определён', missing: ['context', 'need', 'data.availability', 'data.source', 'result.scope', 'success.metric', 'success.target', 'constraints.deadlineMode', 'constraints.technologyAccess', 'contact.channel', 'contact.consultation', 'contact.feedback'] },
  { id: 'task-9', title: 'Подготовка к первой стажировке', topic: 'career' as Topic, score: 0, status: 'draft' as const, context: 'Начинающие кандидаты не знают, как готовиться к собеседованию.', need: 'Помочь сделать подготовку понятнее и практичнее.', users: 'Студенты, которые ищут первую стажировку.', artifact: 'Пока не определён', missing: ['context', 'need', 'data.availability', 'data.source', 'result.scope', 'success.metric', 'success.target', 'constraints.deadlineMode', 'constraints.technologyAccess', 'contact.channel', 'contact.consultation', 'contact.feedback'] },
] as const

export const tasks: OwnerTask[] = seed.map((item) => {
  const card = makeCard(item.title, item.context, item.need, item.users, item.artifact, item.score)
  const rating = makeRating(item.score, [...item.missing])
  return {
    id: item.id, draftText: `${item.context} ${item.need}`, topic: item.topic, workingCard: card,
    confirmedCard: item.status === 'published' ? card : null, questions: [], answers: [], revision: 1,
    confirmedRevision: item.status === 'published' ? 1 : null, publicationStatus: item.status, rating,
    publishedAt: item.status === 'published' ? now : null, createdAt: now, updatedAt: now,
  }
})

export const teams = actors.filter((actor) => actor.kind === 'team')
export const applications: Application[] = [
  { id: 'app-1', taskId: 'task-1', teamId: 'team-orbit', teamName: 'Команда Orbit', idea: 'Лёгкая профориентационная карта с вопросами о сильных сторонах.', plan: 'Интервью → прототип → проверка на учениках.', timeline: '3 недели', prototypeUrl: 'https://figma.com', status: 'pending', createdAt: now, decidedAt: null },
  { id: 'app-2', taskId: 'task-1', teamId: 'team-qadam', teamName: 'Команда Qadam', idea: 'Подбор направлений через короткие реальные кейсы профессий.', plan: 'Соберём сценарии, проверим их с консультантами и соберём веб-демо.', timeline: '2 недели', prototypeUrl: null, status: 'selected', createdAt: now, decidedAt: now },
  { id: 'app-3', taskId: 'task-2', teamId: 'team-syntax', teamName: 'Команда Syntax', idea: 'Поиск по уровню сложности и целям урока.', plan: 'Таксономия материалов и кликабельный поиск.', timeline: '2 недели', prototypeUrl: null, status: 'pending', createdAt: now, decidedAt: null },
  { id: 'app-4', taskId: 'task-4', teamId: 'team-nomad', teamName: 'Команда Nomad', idea: 'Мини-диагностика с понятной картой навыков.', plan: 'Согласуем компетенции, соберём сценарий, протестируем прототип.', timeline: '10 дней', prototypeUrl: null, status: 'pending', createdAt: now, decidedAt: null },
  { id: 'app-5', taskId: 'task-3', teamId: 'team-pixel', teamName: 'Команда Pixel', idea: 'Единая очередь с умной категоризацией.', plan: 'Соберём прототип и прогоним его на примерах обращений.', timeline: '3 недели', prototypeUrl: null, status: 'rejected', createdAt: now, decidedAt: now },
]

export const toSummary = (task: OwnerTask): TaskSummary => ({
  id: task.id, title: task.confirmedCard?.title || task.workingCard.title || task.draftText.slice(0, 60),
  topic: task.confirmedCard ? task.topic : task.topic, rating: task.confirmedCard ? task.rating : makeRating(0),
  publicationStatus: task.publicationStatus, publishedAt: task.publishedAt,
  applicationCount: applications.filter((app) => app.taskId === task.id).length,
})

export const labelForTopic = (topic: Topic) => ({ education: 'Образование', career: 'Карьера', operations: 'Операции', analytics: 'Аналитика', other: 'Другое' })[topic]
