import { actors, applications, blankCard, labelForTopic, tasks, toSummary } from './fixtures'
import type { AiResult, Answer, Application, Card, Level, OwnerTask, PublicTask, Rating, TaskSummary, Topic } from './types'

let activeActor = actors[0]
let taskStore = structuredClone(tasks)
let applicationStore = structuredClone(applications)
let nextTask = 6
let nextApplication = 6

const wait = <T,>(value: T): Promise<T> => new Promise((resolve) => window.setTimeout(() => resolve(structuredClone(value)), 180))
const levelForScore = (score: number): Rating['level'] => score < 40 ? 'needs_clarification' : score < 70 ? 'workable' : score < 90 ? 'ready' : 'priority'

// Mock-only scoring mirrors the API response shape. The UI never computes a score.
function scoreCard(card: Card): Rating {
  const fields: Array<[string, string, string[]]> = [
    ['contextNeed', 'Контекст и потребность', ['context', 'need']],
    ['data', 'Данные и материалы', ['data.availability', 'data.source']],
    ['result', 'Ожидаемый результат', ['result.artifact', 'result.scope']],
    ['success', 'Критерии успеха', ['success.metric', 'success.target']],
    ['constraints', 'Ограничения', ['constraints.deadlineMode', 'constraints.technologyAccess']],
    ['users', 'Пользователи', ['users']],
    ['contact', 'Связь с бизнесом', ['contact.channel', 'contact.consultation', 'contact.feedback']],
  ]
  const caps = [20, 20, 15, 15, 10, 10, 10]
  const missingLabels: Record<string, string> = {
    context: 'Опишите текущую ситуацию', need: 'Уточните, что нужно изменить', 'data.availability': 'Укажите доступность данных', 'data.source': 'Назовите источник или план получения',
    'result.artifact': 'Опишите результат для команды', 'result.scope': 'Уточните границы результата', 'success.metric': 'Укажите проверяемый показатель', 'success.target': 'Опишите условие приёмки',
    'constraints.deadlineMode': 'Укажите срок', 'constraints.technologyAccess': 'Опишите технологии или доступы', users: 'Укажите пользователей', 'contact.channel': 'Укажите рабочий контакт',
    'contact.consultation': 'Опишите формат консультаций', 'contact.feedback': 'Уточните порядок обратной связи',
  }
  const missingFields: string[] = []
  const breakdown = fields.map(([key, label, paths], index) => {
    const present = paths.filter((path) => {
      const parts = path.split('.')
      let value: unknown = card
      for (const part of parts) value = (value as Record<string, unknown> | null)?.[part]
      return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
    })
    const absent = paths.filter((path) => !present.includes(path))
    missingFields.push(...absent)
    return { key, label, earned: Math.round(caps[index] * present.length / paths.length), max: caps[index], missing: absent.map((path) => missingLabels[path]) }
  })
  const score = breakdown.reduce((sum, item) => sum + item.earned, 0)
  return { score, level: levelForScore(score), breakdown, missingFields, scoringVersion: 'mock-v1' }
}

function mergeCard(base: Card, patch: Partial<Card>): Card {
  return {
    ...base, ...patch,
    data: { ...base.data, ...patch.data }, result: { ...base.result, ...patch.result },
    success: { ...base.success, ...patch.success }, constraints: { ...base.constraints, ...patch.constraints },
    contact: { ...base.contact, ...patch.contact },
  }
}

function requireBusiness() {
  if (activeActor?.kind !== 'business') throw { status: 403, error: { code: 'ROLE_FORBIDDEN', message: 'Это действие доступно бизнесу.' } }
}
function requireTeam() {
  if (activeActor?.kind !== 'team') throw { status: 403, error: { code: 'ROLE_FORBIDDEN', message: 'Это действие доступно команде.' } }
}
function requireTask(id: string) {
  const task = taskStore.find((item) => item.id === id)
  if (!task) throw { status: 404, error: { code: 'NOT_FOUND', message: 'Задача не найдена.' } }
  return task
}
function ownerTask(task: OwnerTask) {
  if (activeActor?.kind !== 'business') throw { status: 403, error: { code: 'ROLE_FORBIDDEN', message: 'Задача не принадлежит профилю.' } }
  return task
}

const questionTemplates = [
  { field: 'success.metric', text: 'По какому признаку вы поймёте, что решение действительно помогло?' },
  { field: 'data.availability', text: 'Какие данные или материалы уже доступны команде?' },
  { field: 'contact.feedback', text: 'Как часто команда сможет получать обратную связь от вас?' },
]

export const mockApi = {
  async getActors() { return wait({ items: actors }) },
  async selectSession(actorId: string) {
    const actor = actors.find((item) => item.id === actorId)
    if (!actor) throw { status: 404, error: { code: 'ACTOR_NOT_FOUND', message: 'Демо-профиль не найден.' } }
    activeActor = actor
    return wait({ actor })
  },
  async listTasks(params: { scope: 'mine' | 'catalog'; topic?: Topic; level?: Level }) {
    let items: TaskSummary[]
    if (params.scope === 'mine') {
      requireBusiness()
      items = taskStore.map(toSummary)
    } else {
      items = taskStore.filter((item) => item.publicationStatus === 'published' && item.confirmedCard).map((item) => ({
        ...toSummary(item), title: item.confirmedCard?.title || '', topic: item.topic, rating: item.rating,
      })).sort((a, b) => b.rating.score - a.rating.score || (b.publishedAt || '').localeCompare(a.publishedAt || ''))
      if (params.topic) items = items.filter((item) => item.topic === params.topic)
      if (params.level) items = items.filter((item) => item.rating.level === params.level)
    }
    return wait({ items, total: items.length })
  },
  async getTask(id: string) {
    const task = requireTask(id)
    if (activeActor?.kind === 'business') return wait({ task: ownerTask(task) })
    if (!task.confirmedCard || task.publicationStatus !== 'published') throw { status: 404, error: { code: 'NOT_FOUND', message: 'Опубликованная задача не найдена.' } }
    const publicTask: PublicTask = { id: task.id, topic: task.topic, card: task.confirmedCard, rating: task.rating, publicationStatus: 'published', publishedAt: task.publishedAt }
    return wait({ task: publicTask })
  },
  async createTask(input: { draftText: string; topic: Topic }) {
    requireBusiness()
    const timestamp = new Date().toISOString()
    const card = blankCard()
    const task: OwnerTask = {
      id: `task-${nextTask++}`, draftText: input.draftText, topic: input.topic, workingCard: card, confirmedCard: null,
      questions: [], answers: [], revision: 1, confirmedRevision: null, publicationStatus: 'draft', rating: scoreCard(card),
      publishedAt: null, createdAt: timestamp, updatedAt: timestamp,
    }
    taskStore = [task, ...taskStore]
    return wait({ task })
  },
  async patchTask(id: string, body: { revision: number; draftText?: string; topic?: Topic; cardPatch?: Partial<Card>; answers?: Answer[] }) {
    requireBusiness()
    const task = requireTask(id)
    if (task.revision !== body.revision) throw { status: 409, error: { code: 'REVISION_CONFLICT', message: 'Задача изменилась. Загрузите актуальную версию.' } }
    if (body.draftText !== undefined) task.draftText = body.draftText
    if (body.topic !== undefined) task.topic = body.topic
    if (body.cardPatch) task.workingCard = mergeCard(task.workingCard, body.cardPatch)
    if (body.answers !== undefined) task.answers = body.answers
    task.revision += 1
    task.updatedAt = new Date().toISOString()
    return wait({ task, previewRating: scoreCard(task.workingCard) })
  },
  async analyze(id: string, revision: number, mode: 'analyze' | 'compose') {
    requireBusiness()
    const task = requireTask(id)
    if (task.revision !== revision) throw { status: 409, error: { code: 'REVISION_CONFLICT', message: 'Задача изменилась. Загрузите актуальную версию.' } }
    const proposal = mergeCard(task.workingCard, {
      title: task.workingCard.title || task.draftText.slice(0, 72) || 'Новая задача',
      context: task.workingCard.context || task.draftText || null,
      need: task.workingCard.need || task.draftText || null,
    })
    const questions = questionTemplates.map((item, index) => ({ id: `${id}-q${index + 1}`, field: item.field, text: item.text, sourceRevision: revision }))
    const result: AiResult = { sourceRevision: revision, questions: mode === 'analyze' ? questions : [], proposal, warnings: [], mode: 'template' }
    return wait(result)
  },
  async confirm(id: string, revision: number) {
    requireBusiness()
    const task = requireTask(id)
    if (task.revision !== revision) throw { status: 409, error: { code: 'REVISION_CONFLICT', message: 'Задача изменилась. Загрузите актуальную версию.' } }
    if (!task.workingCard.title || task.workingCard.title.trim().length < 3) throw { status: 422, error: { code: 'VALIDATION_ERROR', message: 'Название должно содержать не менее 3 символов.' } }
    task.confirmedCard = structuredClone(task.workingCard)
    task.confirmedRevision = task.revision
    task.rating = scoreCard(task.confirmedCard)
    task.updatedAt = new Date().toISOString()
    return wait({ task, rating: task.rating })
  },
  async publish(id: string, revision: number) {
    requireBusiness()
    const task = requireTask(id)
    if (task.revision !== revision || task.confirmedRevision !== revision) throw { status: 409, error: { code: 'REVISION_CONFLICT', message: 'Сначала подтвердите актуальную версию задачи.' } }
    task.publicationStatus = 'published'
    task.publishedAt ||= new Date().toISOString()
    return wait({ task })
  },
  async listApplications(taskId?: string) {
    let items = applicationStore
    if (activeActor?.kind === 'business') {
      requireBusiness()
      if (taskId) items = items.filter((item) => item.taskId === taskId)
      else items = items.filter((item) => taskStore.find((task) => task.id === item.taskId)?.publicationStatus === 'published')
    } else {
      requireTeam()
      items = items.filter((item) => item.teamId === activeActor.id)
    }
    return wait({ items, total: items.length })
  },
  async createApplication(taskId: string, input: { idea: string; plan: string; timeline: string; prototypeUrl: string | null; clientRequestId: string }) {
    requireTeam()
    const task = requireTask(taskId)
    if (task.publicationStatus !== 'published') throw { status: 404, error: { code: 'NOT_FOUND', message: 'Задача недоступна для отклика.' } }
    if (applicationStore.some((item) => item.taskId === taskId && item.teamId === activeActor.id)) throw { status: 409, error: { code: 'DUPLICATE_APPLICATION', message: 'Ваша команда уже отправила отклик.' } }
    const application: Application = {
      ...input, id: `app-${nextApplication++}`, taskId, teamId: activeActor.id, teamName: activeActor.name,
      status: 'pending', createdAt: new Date().toISOString(), decidedAt: null,
    }
    applicationStore = [application, ...applicationStore]
    return wait({ application })
  },
  async decideApplication(id: string, status: 'selected' | 'rejected') {
    requireBusiness()
    const application = applicationStore.find((item) => item.id === id)
    if (!application) throw { status: 404, error: { code: 'NOT_FOUND', message: 'Отклик не найден.' } }
    application.status = status
    application.decidedAt = new Date().toISOString()
    return wait({ application })
  },
}

export const topicTitle = labelForTopic
