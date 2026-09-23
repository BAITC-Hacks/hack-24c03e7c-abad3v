import { actors, applications, blankCard, datasetVersion, labelForTopic, tasks } from './fixtures'
import { hasMeaningfulValue } from '../shared/card-values.js'
import { normalizeQuestionOptions } from '../shared/question-options.js'
import { inferTopic, normalizeTopic } from '../shared/topics.js'
import type { AiResult, Answer, Application, Card, Level, OwnerTask, PublicTask, Rating, TaskSummary, Topic } from './types'

type Evidence = { field: string; sourceId: string; quote: string }
type StoredTask = OwnerTask & {
  previewRating?: Rating; publishedRevision?: number | null; publishedCard?: Card | null
  publishedRating?: Rating | null; publishedTopic?: Topic | null; confirmedTopic?: Topic | null
  hasUnpublishedChanges?: boolean; aiResult?: AiResult | null; manualFields?: string[]; businessId?: string
}
type StoredApplication = Application & { clientRequestId?: string }
type StoredCache = {
  tasks?: StoredTask[]; applications?: StoredApplication[]; actorId?: string
  datasetVersion?: string; canonicalTaskIds?: string[]; canonicalApplicationIds?: string[]
}
const storageKey = 'ai-sana.mock.v3'
const legacyStorageKey = 'ai-sana.mock.v2'
const businessActor = actors.find((actor) => actor.kind === 'business')!
let activeActor = businessActor
let taskStore: StoredTask[] = structuredClone(tasks)
let applicationStore: StoredApplication[] = structuredClone(applications)
let pendingBackup: { key: string; raw: string } | null = null

function knownActor(id?: string) {
  // Only map identities that actually exist in both data sets.
  const legacyIds: Record<string, string> = { 'business-career': businessActor.id, 'business-school': businessActor.id, 'team-qadam': 'demo-team-01', 'team-orbit': 'demo-team-02' }
  return actors.find((actor) => actor.id === id || actor.id === (id ? legacyIds[id] : undefined))
}
function cachedTasks(saved: StoredCache): StoredTask[] {
  return Array.isArray(saved.tasks) ? saved.tasks.filter((task) => task?.id && task.workingCard && Array.isArray(task.answers)) : []
}
function cachedApplications(saved: StoredCache): StoredApplication[] {
  return Array.isArray(saved.applications) ? saved.applications.filter((application) => application?.id && application.taskId && application.teamId) : []
}
function normalizeTaskOwner(task: StoredTask): StoredTask {
  const owner = knownActor(task.businessId)
  return { ...task, businessId: owner?.kind === 'business' ? owner.id : businessActor.id }
}
function validApplications(items: StoredApplication[]): StoredApplication[] {
  return items.flatMap((application) => {
    const team = knownActor(application.teamId)
    if (team?.kind !== 'team' || !taskStore.some((task) => task.id === application.taskId)) return []
    return [{ ...application, teamId: team.id, teamName: team.name }]
  })
}
function restoreCache(saved: StoredCache, legacy: boolean) {
  let restoredTasks = cachedTasks(saved)
  let restoredApplications = cachedApplications(saved)
  if (legacy) {
    // Never let the previous hardcoded seeds replace the CSV defaults. Keep changed
    // tasks and user-created records; the complete v2 cache remains an untouched backup.
    restoredTasks = restoredTasks.filter((task) => !tasks.some((seed) => seed.id === task.id) && (
      !/^task-[1-9]$/.test(task.id) || task.revision > 1 || task.answers.length > 0 || task.manualFields?.length || task.aiResult ||
      task.updatedAt !== task.createdAt || task.publicationStatus !== (/^task-[1-4]$/.test(task.id) ? 'published' : 'draft')
    ))
    restoredApplications = restoredApplications.filter((application) => !applications.some((seed) => seed.id === application.id) && (
      !/^app-[1-5]$/.test(application.id) || application.status !== (application.id === 'app-2' ? 'selected' : application.id === 'app-5' ? 'rejected' : 'pending') ||
      application.decidedAt !== null && application.decidedAt !== application.createdAt
    ))
  } else if (saved.datasetVersion !== datasetVersion) {
    // Include the previous canonical IDs so rows removed from CSV cannot return
    // from storage as if they were user-created tasks or applications.
    const oldTaskIds = Array.isArray(saved.canonicalTaskIds) ? saved.canonicalTaskIds : restoredTasks.filter((task) => /^demo-task-/.test(task.id)).map((task) => task.id)
    const oldApplicationIds = Array.isArray(saved.canonicalApplicationIds) ? saved.canonicalApplicationIds : restoredApplications.filter((application) => /^demo-app-/.test(application.id)).map((application) => application.id)
    const canonicalTasks = new Set([...tasks.map((task) => task.id), ...oldTaskIds])
    const canonicalApplications = new Set([...applications.map((application) => application.id), ...oldApplicationIds])
    restoredTasks = restoredTasks.filter((task) => !canonicalTasks.has(task.id))
    restoredApplications = restoredApplications.filter((application) => !canonicalApplications.has(application.id))
  }
  taskStore = [...new Map([...taskStore, ...restoredTasks.map(normalizeTaskOwner)].map((task) => [task.id, task])).values()]
  applicationStore = [...new Map([...applicationStore, ...validApplications(restoredApplications)].map((application) => [application.id, application])).values()]
  activeActor = knownActor(saved.actorId) || activeActor
}

// Mock data stays local to this browser. Private browsing and disabled storage still work.
try {
  const raw = localStorage.getItem(storageKey)
  if (raw) {
    const saved = JSON.parse(raw) as StoredCache
    if (saved.datasetVersion !== datasetVersion) pendingBackup = { key: `${storageKey}.backup.${saved.datasetVersion || 'unversioned'}`, raw }
    restoreCache(saved, false)
  }
  else {
    const legacy = localStorage.getItem(legacyStorageKey)
    if (legacy) restoreCache(JSON.parse(legacy) as StoredCache, true)
  }
} catch { /* A corrupt or unavailable local cache must not block the demo. */ }

function persist() {
  try {
    // If backing up fails (for example, storage is full), preserve the old v3
    // snapshot instead of overwriting it without its recovery copy.
    if (pendingBackup) { localStorage.setItem(pendingBackup.key, pendingBackup.raw); pendingBackup = null }
    localStorage.setItem(storageKey, JSON.stringify({
      tasks: taskStore, applications: applicationStore, actorId: activeActor.id, datasetVersion,
      canonicalTaskIds: tasks.map((task) => task.id), canonicalApplicationIds: applications.map((application) => application.id),
    }))
  }
  catch { /* Continue in memory when browser storage is unavailable. */ }
}

const nextId = (items: Array<{ id: string }>, prefix: string) => Math.max(0, ...items.map((item) => Number(item.id.replace(`${prefix}-`, '')) || 0)) + 1
let nextTask = nextId(taskStore, 'task')
let nextApplication = nextId(applicationStore, 'app')
const wait = <T,>(value: T): Promise<T> => new Promise((resolve) => window.setTimeout(() => resolve(structuredClone(value)), 180))
const levelForScore = (score: number): Rating['level'] => score < 40 ? 'needs_clarification' : score < 70 ? 'workable' : score < 90 ? 'ready' : 'priority'
const fieldValue = (card: Card, path: string): string | null => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key], card) as string | null
function setField(card: Card, path: string, value: string | null) {
  const parts = path.split('.')
  const parent = parts.slice(0, -1).reduce<unknown>((object, key) => (object as Record<string, unknown>)[key], card) as Record<string, unknown>
  parent[parts[parts.length - 1]] = value
}
const filled = hasMeaningfulValue
const validDate = (value: string | null): boolean => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

// The mock API owns its scoring, using the same weights and checks as the backend.
function scoreCard(card: Card): Rating {
  const fields: Array<[string, string, Array<[string, number, string]>]> = [
    ['contextNeed', 'Контекст и потребность', [['context', 10, 'Опишите текущую ситуацию'], ['need', 10, 'Уточните, что нужно изменить']]],
    ['data', 'Данные и материалы', [['data.availability', 10, 'Укажите доступность данных'], ['data.source', 10, 'Назовите источник или план получения']]],
    ['result', 'Ожидаемый результат', [['result.artifact', 10, 'Опишите результат для команды'], ['result.scope', 5, 'Уточните границы результата']]],
    ['success', 'Критерии успеха', [['success.metric', 10, 'Укажите проверяемый показатель'], ['success.target', 5, 'Опишите условие приёмки']]],
    ['constraints', 'Ограничения', [['constraints.deadlineMode', 5, 'Укажите срок'], ['constraints.technologyAccess', 5, 'Опишите технологии или доступы']]],
    ['users', 'Пользователи', [['users', 10, 'Укажите пользователей']]],
    ['contact', 'Связь с бизнесом', [['contact.channel', 4, 'Укажите рабочий контакт'], ['contact.consultation', 3, 'Опишите формат консультаций'], ['contact.feedback', 3, 'Уточните порядок обратной связи']]],
  ]
  const missingFields: string[] = []
  const breakdown = fields.map(([key, label, paths]) => {
    let earned = 0
    const missing: string[] = []
    for (const [path, weight, hint] of paths) {
      const value = fieldValue(card, path)
      let present = filled(value)
      if (path === 'data.availability') present = ['available', 'planned', 'unavailable'].includes(value || '')
      if (path === 'constraints.deadlineMode') present = value === 'flexible' || value === 'fixed' && validDate(card.constraints.deadlineDate)
      if (path === 'contact.channel') present = present && (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '') || /^https?:\/\//i.test(value || ''))
      if (present) earned += weight
      else { missingFields.push(path); missing.push(hint) }
    }
    return { key, label, earned, max: paths.reduce((sum, [, weight]) => sum + weight, 0), missing }
  })
  const score = breakdown.reduce((sum, item) => sum + item.earned, 0)
  return { score, level: levelForScore(score), breakdown, missingFields, scoringVersion: 'mock-v2' }
}

function mergeCard(base: Card, patch: Partial<Card>): Card {
  return { ...base, ...patch, data: { ...base.data, ...patch.data }, result: { ...base.result, ...patch.result }, success: { ...base.success, ...patch.success }, constraints: { ...base.constraints, ...patch.constraints }, contact: { ...base.contact, ...patch.contact } }
}

function refresh(task: StoredTask): StoredTask {
  task.previewRating = scoreCard(task.workingCard)
  task.hasUnpublishedChanges = task.publicationStatus === 'published' && task.publishedRevision !== task.revision
  return task
}
function withQuestionOptions(question: AiResult['questions'][number], task: StoredTask) {
  return { ...question, options: normalizeQuestionOptions(question, task) }
}
for (const task of taskStore) {
  if (!Array.isArray(task.questionHistory)) {
    task.questionHistory = structuredClone(task.questions)
    const savedBatch = task.aiResult?.questions
    task.questions = savedBatch?.length && savedBatch.length <= 5 ? structuredClone(savedBatch) : task.questions.slice(-5)
    if (task.aiResult) task.aiResult.questions = structuredClone(task.questions)
  }
  if (task.publishedCard === undefined) task.publishedCard = task.publicationStatus === 'published' ? structuredClone(task.confirmedCard) : null
  if (task.publishedRevision === undefined) task.publishedRevision = task.publicationStatus === 'published' ? task.confirmedRevision : null
  if (task.publishedRating === undefined) task.publishedRating = task.publishedCard ? structuredClone(task.rating) : null
  task.publishedTopic ||= task.topic
  task.confirmedTopic ||= task.topic
  task.manualFields ||= []
  task.questions = task.questions.map((question) => withQuestionOptions(question, task))
  task.questionHistory = task.questionHistory?.map((question) => withQuestionOptions(question, task))
  if (task.aiResult) task.aiResult.questions = task.aiResult.questions.map((question) => withQuestionOptions(question, task))
  refresh(task)
}
persist()

function requireBusiness() {
  if (activeActor.kind !== 'business') throw { status: 403, error: { code: 'ROLE_FORBIDDEN', message: 'Это действие доступно бизнесу.' } }
}
function requireTeam() {
  if (activeActor.kind !== 'team') throw { status: 403, error: { code: 'ROLE_FORBIDDEN', message: 'Это действие доступно команде.' } }
}
function requireTask(id: string) {
  const task = taskStore.find((item) => item.id === id)
  if (!task) throw { status: 404, error: { code: 'NOT_FOUND', message: 'Задача не найдена.' } }
  return refresh(task)
}
function requireRevision(task: StoredTask, revision: number) {
  if (task.revision !== revision) throw { status: 409, error: { code: 'REVISION_CONFLICT', message: 'Задача изменилась. Загрузите актуальную версию.' } }
}
function requireTopic(value: unknown): Topic {
  try {
    const topic = normalizeTopic(value)
    if (topic) return topic
  } catch { /* Use the same validation response as the backend. */ }
  throw { status: 422, error: { code: 'VALIDATION_ERROR', message: 'Укажите тему от 1 до 80 символов.' } }
}
function summarize(task: StoredTask, published = false): TaskSummary {
  const card = published ? task.publishedCard! : task.workingCard
  const rating = published ? task.publishedRating || scoreCard(card) : task.rating
  return {
    id: task.id, title: card.title || task.draftText.slice(0, 60), topic: published ? task.publishedTopic || task.topic : task.topic,
    rating, publicationStatus: task.publicationStatus, publishedAt: task.publishedAt,
    applicationCount: applicationStore.filter((application) => application.taskId === task.id).length,
    pendingApplicationCount: applicationStore.filter((application) => application.taskId === task.id && application.status === 'pending').length,
    need: card.need, result: card.result.artifact, dataAvailability: card.data.availability,
    deadline: card.constraints.deadlineMode === 'flexible' ? 'Гибкий срок' : card.constraints.deadlineDate,
    previewRating: published ? rating : scoreCard(card), hasUnpublishedChanges: !published && task.hasUnpublishedChanges,
    updatedAt: task.updatedAt,
  }
}

const questionText: Record<string, string> = {
  context: 'Как задача решается сейчас и что в этом процессе не работает?',
  need: 'Какую конкретную проблему нужно решить?',
  users: 'Кто будет пользоваться решением?',
  'data.availability': 'Есть ли данные или материалы для работы команды?',
  'data.source': 'Какие именно данные доступны или как команда сможет их получить?',
  'result.artifact': 'Что команда должна показать в конце работы?',
  'result.scope': 'Какие функции входят в первый результат?',
  'success.metric': 'Как проверите результат? Например: из пяти студентов минимум четверо находят аудиторию без подсказки.',
  'success.target': 'Какое конкретное условие будет означать, что результат принят?',
  'constraints.deadlineMode': 'Есть ли точный срок или команда может предложить свой?',
  'constraints.deadlineDate': 'К какой дате нужен результат?',
  'constraints.technologyAccess': 'Есть ли ограничения по технологиям или доступам?',
  'contact.channel': 'По какому рабочему email или ссылке с вами связаться?',
  'contact.consultation': 'Как часто команда сможет консультироваться с вами?',
  'contact.feedback': 'Как и когда команда получит вашу обратную связь?',
}

function templateResult(task: StoredTask, mode: 'analyze' | 'compose'): AiResult {
  const proposal = structuredClone(task.workingCard)
  const previousEvidence = task.aiResult?.evidence || []
  const protectedFields = new Set(task.manualFields || [])
  const questionFields = new Map([...(task.questionHistory || []), ...task.questions].map((question) => [question.id, question.field]))
  const latestAnswers = new Map<string, Answer>()
  for (const answer of task.answers) {
    const field = questionFields.get(answer.questionId) || (answer.questionId.startsWith('q:') ? answer.questionId.slice(2) : undefined)
    if (field && field in questionText) latestAnswers.set(field, answer)
  }
  const blockedFields = new Set<string>()
  for (const [field, answer] of latestAnswers) if (answer.skipped || !filled(answer.value)) {
    blockedFields.add(field)
    if (field === 'success.metric') blockedFields.add('success.target')
    if (field === 'constraints.deadlineMode') blockedFields.add('constraints.deadlineDate')
  }
  for (const field of blockedFields) if (!protectedFields.has(field)) setField(proposal, field, null)
  const sources = new Map([['draft', task.draftText], ...[...latestAnswers.values()].filter((answer) => !answer.skipped && filled(answer.value)).map((answer) => [`answer:${answer.questionId}`, answer.value!] as [string, string])])
  const evidence: Evidence[] = []
  for (const item of previousEvidence) {
    if (protectedFields.has(item.field) || blockedFields.has(item.field)) continue
    if (sources.get(item.sourceId)?.includes(item.quote)) evidence.push(item)
    else if (task.aiResult && fieldValue(proposal, item.field) === fieldValue(task.aiResult.proposal, item.field)) setField(proposal, item.field, null)
  }
  const propose = (field: string, value: string | null, sourceId: string, quote: string, replace = false) => {
    if (!filled(value) || protectedFields.has(field) || blockedFields.has(field)) return
    const current = fieldValue(proposal, field)
    if (current && current !== 'Новая задача' && !replace && !previousEvidence.some((item) => item.field === field && item.sourceId === sourceId)) return
    setField(proposal, field, value)
    const previous = evidence.findIndex((item) => item.field === field)
    if (previous >= 0) evidence.splice(previous, 1)
    evidence.push({ field, sourceId, quote })
  }
  const draft = task.draftText.trim()
  const sentences = draft.match(/[^.!?\n]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || []
  const sentenceFor = (pattern: RegExp) => sentences.find((sentence) => pattern.test(sentence))
  if (draft) {
    const first = sentences[0] || draft
    const title = /аудитор/i.test(draft) && /свободн|поиск|найти|наход/i.test(draft) ? 'Поиск свободных аудиторий' : first.replace(/^(хотим|нужно|нужен|нужна|хочу)\s+/i, '').replace(/[.!?]$/, '').slice(0, 115)
    propose('title', title.charAt(0).toUpperCase() + title.slice(1), 'draft', /аудитор/i.test(draft) ? sentenceFor(/аудитор/i) || first : first)
    propose('context', draft.slice(0, 1000), 'draft', draft.slice(0, 1000))
    const need = sentenceFor(/нуж|хотим|хочу|помоч|упрост|сократ|автоматиз|решить/i) || first
    propose('need', need.slice(0, 1000), 'draft', need)
    const userSentence = sentenceFor(/студент|ученик|школьник|преподавател|сотрудник|волонт[её]р/i)
    if (userSentence) {
      const groups = [['студент', 'Студенты'], ['ученик|школьник', 'Школьники'], ['преподавател', 'Преподаватели'], ['сотрудник', 'Сотрудники'], ['волонт[её]р', 'Волонтёры']]
      propose('users', groups.filter(([pattern]) => new RegExp(pattern, 'i').test(userSentence)).map(([, label]) => label).join(', '), 'draft', userSentence)
    }
    const artifact = sentenceFor(/прототип|веб[- ]?сервис|приложени|сайт|дашборд|отч[её]т|макет|бот\b/i)
    if (artifact) propose('result.artifact', artifact.slice(0, 1000), 'draft', artifact)
    const scope = sentenceFor(/список|функци|включа|показыва|временн\S* слот/i)
    if (scope) propose('result.scope', scope.slice(0, 1000), 'draft', scope)
  }

  for (const [field, answer] of latestAnswers) {
    if (answer.skipped || !filled(answer.value)) continue
    const value = answer.value!.trim()
    const source = `answer:${answer.questionId}`
    if (field === 'data.availability') {
      const normalized = ['available', 'planned', 'unavailable'].includes(value) ? value : /нет|недоступ|отсутств/i.test(value) ? 'unavailable' : /план|собер|собрат|позже|будут/i.test(value) ? 'planned' : /есть|доступ|готов/i.test(value) ? 'available' : null
      propose(field, normalized, source, value, true)
    } else if (field === 'constraints.deadlineMode' || field === 'constraints.deadlineDate') {
      const dateMatch = value.match(/\d{4}-\d{2}-\d{2}/)?.[0]
      const russianDate = value.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/)
      const date = dateMatch || (russianDate ? `${russianDate[3]}-${russianDate[2]}-${russianDate[1]}` : null)
      if (validDate(date)) {
        propose('constraints.deadlineMode', 'fixed', source, value, true)
        propose('constraints.deadlineDate', date, source, value, true)
      } else if (value === 'flexible' || /гибк|нет срока|не огранич|по договор/i.test(value)) {
        propose('constraints.deadlineMode', 'flexible', source, value, true)
        if (!protectedFields.has('constraints.deadlineDate')) proposal.constraints.deadlineDate = null
      } else if (value === 'fixed') propose('constraints.deadlineMode', 'fixed', source, value, true)
    } else {
      propose(field, value, source, value, true)
      if (field === 'success.metric' && /\d|минимум|не менее|не больше|четверо|четыре|кажд|все |без подсказ/i.test(value)) propose('success.target', value, source, value, true)
    }
  }
  const priorities = ['data.availability', 'success.metric', 'result.artifact', 'constraints.deadlineMode', 'data.source', 'users', 'result.scope', 'success.target', 'constraints.technologyAccess', 'contact.channel', 'contact.consultation', 'contact.feedback', 'need', 'context']
  if (proposal.constraints.deadlineMode === 'fixed' && !validDate(proposal.constraints.deadlineDate)) priorities.unshift('constraints.deadlineDate')
  const questions = mode === 'compose' ? structuredClone(task.questions) : priorities.filter((field) => !filled(fieldValue(proposal, field))).slice(0, 5).map((field) => withQuestionOptions({ id: `q:${field}`, field, text: questionText[field], sourceRevision: task.revision }, task))
  return {
    sourceRevision: task.revision, questions, proposal, evidence, warnings: [], mode: 'template', originMode: 'template', operation: mode, generatedAt: new Date().toISOString(), stale: false,
    suggestedTopic: inferTopic(task),
    inputSnapshot: structuredClone({ draftText: task.draftText, topic: task.topic, answers: task.answers, manualFields: task.manualFields || [] }),
  }
}

export const mockApi = {
  async getActors() { return wait({ items: actors }) },
  async selectSession(actorId: string) {
    const actor = actors.find((item) => item.id === actorId)
    if (!actor) throw { status: 404, error: { code: 'ACTOR_NOT_FOUND', message: 'Демо-профиль не найден.' } }
    activeActor = actor
    persist()
    return wait({ actor })
  },
  async listTasks(params: { scope: 'mine' | 'catalog'; topic?: Topic; level?: Level }) {
    let items: TaskSummary[]
    if (params.scope === 'mine') {
      requireBusiness()
      items = taskStore.map((task) => summarize(refresh(task)))
    } else {
      items = taskStore.filter((task) => task.publicationStatus === 'published' && task.publishedCard).map((task) => summarize(task, true)).sort((a, b) => b.rating.score - a.rating.score || (b.publishedAt || '').localeCompare(a.publishedAt || ''))
      if (params.topic) items = items.filter((item) => item.topic === params.topic)
      if (params.level) items = items.filter((item) => item.rating.level === params.level)
    }
    return wait({ items, total: items.length })
  },
  async getTask(id: string) {
    const task = requireTask(id)
    if (activeActor.kind === 'business') return wait({ task })
    if (!task.publishedCard || task.publicationStatus !== 'published') throw { status: 404, error: { code: 'NOT_FOUND', message: 'Опубликованная задача не найдена.' } }
    const publicTask: PublicTask = { id: task.id, topic: task.publishedTopic || task.topic, card: task.publishedCard, rating: task.publishedRating || scoreCard(task.publishedCard), publicationStatus: 'published', publishedAt: task.publishedAt }
    return wait({ task: publicTask })
  },
  async createTask(input: { draftText: string; topic?: Topic }) {
    requireBusiness()
    if (input.draftText.trim().length < 10) throw { status: 422, error: { code: 'VALIDATION_ERROR', message: 'Опишите задачу хотя бы в одном коротком предложении.' } }
    const topic = input.topic === undefined ? 'other' : requireTopic(input.topic)
    const timestamp = new Date().toISOString()
    const card = blankCard()
    const task: StoredTask = {
      id: `task-${nextTask++}`, businessId: activeActor.id, draftText: input.draftText.trim(), topic, workingCard: card, confirmedCard: null,
      questions: [], questionHistory: [], answers: [], revision: 1, confirmedRevision: null, publicationStatus: 'draft', rating: scoreCard(card),
      publishedCard: null, publishedRating: null, publishedRevision: null, aiResult: null, manualFields: [],
      publishedAt: null, createdAt: timestamp, updatedAt: timestamp,
    }
    refresh(task)
    taskStore = [task, ...taskStore]
    persist()
    return wait({ task })
  },
  async patchTask(id: string, body: { revision: number; draftText?: string; topic?: Topic; cardPatch?: Partial<Card>; answers?: Answer[]; manualFields?: string[] }) {
    requireBusiness()
    const task = requireTask(id)
    requireRevision(task, body.revision)
    const topic = body.topic === undefined ? undefined : requireTopic(body.topic)
    if (body.draftText !== undefined) task.draftText = body.draftText
    if (topic !== undefined) task.topic = topic
    if (body.cardPatch) task.workingCard = mergeCard(task.workingCard, body.cardPatch)
    if (body.answers !== undefined) {
      const submitted = new Set(body.answers.map((answer) => answer.questionId))
      task.answers = [...task.answers.filter((answer) => !submitted.has(answer.questionId)), ...body.answers]
    }
    if (body.manualFields !== undefined) task.manualFields = [...new Set([...(task.manualFields || []), ...body.manualFields])]
    task.revision += 1
    task.updatedAt = new Date().toISOString()
    refresh(task)
    persist()
    return wait({ task, previewRating: task.previewRating! })
  },
  async analyze(id: string, revision: number, mode: 'analyze' | 'compose') {
    requireBusiness()
    const task = requireTask(id)
    requireRevision(task, revision)
    const result = templateResult(task, mode)
    if (mode === 'analyze') {
      const allQuestions = new Map([...(task.questionHistory || []), ...task.questions].map((question) => [question.id, question]))
      for (const question of result.questions) allQuestions.set(question.id, question)
      task.questionHistory = [...allQuestions.values()]
      task.questions = structuredClone(result.questions)
    }
    task.aiResult = result
    persist()
    return wait(result)
  },
  async confirm(id: string, revision: number) {
    requireBusiness()
    const task = requireTask(id)
    requireRevision(task, revision)
    if (!task.workingCard.title || task.workingCard.title.trim().length < 3) throw { status: 422, error: { code: 'VALIDATION_ERROR', message: 'Название должно содержать не менее 3 символов.' } }
    task.confirmedCard = structuredClone(task.workingCard)
    task.confirmedRevision = task.revision
    task.confirmedTopic = task.topic
    task.rating = scoreCard(task.confirmedCard)
    task.updatedAt = new Date().toISOString()
    persist()
    return wait({ task, rating: task.rating })
  },
  async publish(id: string, revision: number) {
    requireBusiness()
    const task = requireTask(id)
    requireRevision(task, revision)
    if (task.confirmedRevision !== revision || !task.confirmedCard) throw { status: 409, error: { code: 'REVISION_CONFLICT', message: 'Сначала подтвердите актуальную версию задачи.' } }
    task.publicationStatus = 'published'
    task.publishedCard = structuredClone(task.confirmedCard)
    task.publishedRating = structuredClone(task.rating)
    task.publishedTopic = task.confirmedTopic || task.topic
    task.publishedRevision = revision
    task.publishedAt = new Date().toISOString()
    task.updatedAt = task.publishedAt
    refresh(task)
    persist()
    return wait({ task })
  },
  async listApplications(taskId?: string) {
    let items = applicationStore
    if (activeActor.kind === 'business') {
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
    const application: Application = { ...input, id: `app-${nextApplication++}`, taskId, teamId: activeActor.id, teamName: activeActor.name, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null }
    applicationStore = [application, ...applicationStore]
    persist()
    return wait({ application })
  },
  async decideApplication(id: string, status: 'selected' | 'rejected') {
    requireBusiness()
    const application = applicationStore.find((item) => item.id === id)
    if (!application) throw { status: 404, error: { code: 'NOT_FOUND', message: 'Отклик не найден.' } }
    application.status = status
    application.decidedAt = new Date().toISOString()
    persist()
    return wait({ application })
  },
}

export const topicTitle = labelForTopic
