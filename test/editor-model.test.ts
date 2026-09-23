import assert from 'node:assert/strict'
import test from 'node:test'
import { answerIntoCard, evidenceFor, getField, mergeProposal, rebaseForm, setField, type EditorForm } from '../src/editorModel.ts'
import type { AiResult, Card, OwnerTask } from '../src/types.ts'

const blankCard = (): Card => ({
  title: null, context: null, need: null, users: null,
  data: { availability: null, source: null }, result: { artifact: null, scope: null },
  success: { metric: null, target: null },
  constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null },
  contact: { channel: null, consultation: null, feedback: null },
})
const form = (): EditorForm => ({ draftText: 'Нужен поиск свободных аудиторий', topic: 'education', card: blankCard(), answers: [], manualFields: [] })
const proposal = (card: Card): AiResult => ({ proposal: card, sourceRevision: 1, questions: [], warnings: [], mode: 'template', evidence: [] })
const taskFor = (local: EditorForm): OwnerTask => ({
  id: 'task-1', draftText: local.draftText, topic: local.topic, workingCard: local.card, confirmedCard: null,
  questions: [], answers: local.answers, revision: 1, confirmedRevision: null, publicationStatus: 'draft',
  rating: { score: 0, level: 'needs_clarification', breakdown: [], missingFields: [], scoringVersion: 'test' },
  publishedAt: null, createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
})

test('AI merging preserves a manual title and an intentionally cleared field', () => {
  const local = form()
  local.card.title = 'Название от бизнеса'
  local.manualFields = ['title', 'contact.channel']
  const generated = blankCard()
  generated.title = 'Название от AI'
  generated.contact.channel = 'ai@example.com'
  generated.users = 'Студенты'
  const merged = mergeProposal(local, proposal(generated))
  assert.equal(merged.form.card.title, 'Название от бизнеса')
  assert.equal(merged.form.card.contact.channel, null)
  assert.equal(merged.form.card.users, 'Студенты')
  assert.deepEqual(merged.changed, ['users'])
  assert.equal(local.card.users, null, 'merging must leave the caller state untouched')
})

test('AI response cannot replace typing that happened after its captured baseline', () => {
  const baseline = blankCard()
  baseline.need = 'Исходная проблема'
  const local = form()
  local.card = structuredClone(baseline)
  local.card.need = 'Уточнение, введённое пока AI отвечал'
  local.card.data.source = 'Новые данные во время запроса'
  const generated = structuredClone(baseline)
  generated.need = 'Формулировка AI'
  generated.data.availability = 'planned'
  generated.data.source = 'Старые данные из запроса'
  const merged = mergeProposal(local, proposal(generated), baseline)
  assert.equal(merged.form.card.need, local.card.need)
  assert.equal(merged.form.card.data.source, local.card.data.source)
  assert.equal(merged.form.card.data.availability, 'planned')
  assert.deepEqual(merged.changed, ['data.availability'])
})

test('explicit null from AI clears an invalidated source but preserves manual facts', () => {
  const local = form()
  local.card.result.artifact = 'Предложение из удалённого текста'
  local.card.users = 'Проверенная вручную группа'
  local.manualFields = ['users']
  const merged = mergeProposal(local, proposal(blankCard()))
  assert.equal(merged.form.card.result.artifact, null)
  assert.equal(merged.form.card.users, local.card.users)
  assert.deepEqual(merged.changed, ['result.artifact'])
})

test('nested card updates are immutable and independent of sibling fields', () => {
  const original = blankCard()
  original.data.source = 'Расписание учебного офиса'
  original.result.artifact = 'Веб-прототип'
  const next = setField(original, 'data.availability', 'available')
  assert.equal(getField(next, 'data.availability'), 'available')
  assert.equal(next.data.source, original.data.source)
  assert.equal(next.result.artifact, original.result.artifact)
  assert.equal(original.data.availability, null)
  next.result.artifact = 'Изменено отдельно'
  assert.equal(original.result.artifact, 'Веб-прототип')
})

test('typed answers accept valid enum choices and keep unknown values unknown', () => {
  let local = form()
  local = answerIntoCard(local, 'data.availability', 'available')
  assert.equal(local.card.data.availability, 'available')
  const beforeInvalid = local
  assert.equal(answerIntoCard(local, 'data.availability', 'случайный текст'), beforeInvalid)
  local = answerIntoCard(local, 'data.availability', 'Пока не знаю')
  assert.equal(local.card.data.availability, null)
  for (const unknown of ['не знаю', 'Неизвестно', 'нет информации']) {
    assert.equal(answerIntoCard(local, 'users', unknown).card.users, null)
  }
  assert.equal(answerIntoCard(local, 'constraints.deadlineMode', 'когда получится'), local)
  assert.equal(answerIntoCard(local, 'constraints.deadlineMode', 'fixed').card.constraints.deadlineMode, 'fixed')
})

test('switching to a flexible or unknown deadline clears the obsolete date', () => {
  const local = form()
  local.card.constraints = { deadlineMode: 'fixed', deadlineDate: '2026-10-01', technologyAccess: 'Технологии на выбор' }
  for (const mode of ['flexible', null]) {
    const next = answerIntoCard(local, 'constraints.deadlineMode', mode)
    assert.equal(next.card.constraints.deadlineMode, mode)
    assert.equal(next.card.constraints.deadlineDate, null)
    assert.equal(next.card.constraints.technologyAccess, 'Технологии на выбор')
  }
  assert.equal(answerIntoCard(local, 'constraints.deadlineMode', 'fixed').card.constraints.deadlineDate, '2026-10-01')
})

test('changing or skipping a metric clears only the target derived from that old answer', () => {
  const local = form()
  local.card.success = { metric: 'Четверо из пяти находят аудиторию', target: 'Четверо из пяти находят аудиторию' }
  for (const metric of ['Время поиска аудитории', null]) {
    const next = answerIntoCard(local, 'success.metric', metric)
    assert.equal(next.card.success.metric, metric)
    assert.equal(next.card.success.target, null)
  }
  local.card.success.target = 'Среднее время поиска до 2 минут'
  assert.equal(answerIntoCard(local, 'success.metric', null).card.success.target, 'Среднее время поиска до 2 минут')
  local.card.success.target = local.card.success.metric
  local.manualFields = ['success.target']
  assert.equal(answerIntoCard(local, 'success.metric', null).card.success.target, 'Четверо из пяти находят аудиторию')
})

test('answers preserve manual field edits including an explicit null', () => {
  const local = form()
  local.manualFields = ['data.availability', 'success.metric']
  local.card.success.metric = 'Вручную согласованный показатель'
  assert.equal(answerIntoCard(local, 'data.availability', 'available'), local)
  assert.equal(answerIntoCard(local, 'success.metric', 'Ответ из уточнения'), local)
})

test('revision rebase combines local edits with untouched remote fields and answers', () => {
  const base = form()
  base.card.title = 'Старое название'
  base.card.context = 'Исходный контекст'
  base.card.data = { availability: 'planned', source: 'Старый источник' }
  base.answers = [
    { questionId: 'q:users', value: 'Студенты', skipped: false },
    { questionId: 'q:success.metric', value: 'Исходный показатель', skipped: false },
  ]
  const local = structuredClone(base)
  local.card.title = 'Моё новое название'
  local.card.context = null
  local.card.data.source = 'Мой источник'
  local.topic = 'operations'
  local.manualFields = ['title', 'context', 'data.source']
  local.answers[1] = { questionId: 'q:success.metric', value: null, skipped: true }
  local.answers.push({ questionId: 'q:contact.feedback', value: 'Каждую пятницу', skipped: false })
  const remote = structuredClone(base)
  remote.card.title = 'Название из другого окна'
  remote.card.need = 'Новая потребность на сервере'
  remote.card.data.availability = 'available'
  remote.card.data.source = 'Удалённый источник'
  remote.draftText = 'Уточнённое исходное описание на сервере'
  remote.topic = 'career'
  remote.manualFields = ['need', 'data.availability', 'title']
  remote.answers[0] = { questionId: 'q:users', value: 'Студенты и преподаватели', skipped: false }
  remote.answers.push({ questionId: 'q:contact.consultation', value: 'Раз в неделю', skipped: false })
  const rebased = rebaseForm(local, base, remote)
  assert.equal(rebased.card.title, local.card.title)
  assert.equal(rebased.card.context, null)
  assert.equal(rebased.card.need, remote.card.need)
  assert.deepEqual(rebased.card.data, { availability: 'available', source: 'Мой источник' })
  assert.equal(rebased.draftText, remote.draftText)
  assert.equal(rebased.topic, 'operations')
  assert.deepEqual(new Set(rebased.manualFields), new Set([...local.manualFields, ...remote.manualFields]))
  const answers = new Map(rebased.answers.map(answer => [answer.questionId, answer]))
  assert.equal(answers.get('q:users')?.value, 'Студенты и преподаватели')
  assert.deepEqual(answers.get('q:success.metric'), { questionId: 'q:success.metric', value: null, skipped: true })
  assert.equal(answers.get('q:contact.feedback')?.value, 'Каждую пятницу')
  assert.equal(answers.get('q:contact.consultation')?.value, 'Раз в неделю')
  assert.equal(remote.card.title, 'Название из другого окна', 'rebase must not mutate the remote state')
})

test('revision rebase keeps a locally changed description and an untouched remote topic', () => {
  const base = form(), local = form(), remote = form()
  local.draftText = 'Моё новое описание'
  remote.draftText = 'Параллельное описание'
  remote.topic = 'analytics'
  const rebased = rebaseForm(local, base, remote)
  assert.equal(rebased.draftText, local.draftText)
  assert.equal(rebased.topic, 'analytics')
})

test('revision rebase preserves a newly protected null or restored original value', () => {
  const base = form()
  base.card.title = 'Первоначальное название'
  const local = structuredClone(base)
  local.manualFields = ['title', 'contact.channel']
  const remote = structuredClone(base)
  remote.card.title = 'Другое название'
  remote.card.contact.channel = 'suggested@example.com'
  remote.card.users = 'Студенты'
  const rebased = rebaseForm(local, base, remote)
  assert.equal(rebased.card.title, 'Первоначальное название')
  assert.equal(rebased.card.contact.channel, null)
  assert.equal(rebased.card.users, 'Студенты')
})

test('draft evidence disappears when the quoted source is edited away', () => {
  const local = form()
  local.draftText = 'Студенты ищут свободные аудитории'
  local.card.users = 'Студенты'
  const generated = proposal(structuredClone(local.card))
  generated.evidence = [{ field: 'users', sourceId: 'draft', quote: 'Студенты ищут свободные аудитории' }]
  const task = taskFor(local)
  assert.equal(evidenceFor('users', local, task, generated)?.quote, local.draftText)
  local.draftText = 'Теперь задача предназначена для сотрудников'
  assert.equal(evidenceFor('users', local, task, generated), undefined)
})

test('cached answer evidence cannot outlive a skipped or changed source answer', () => {
  const local = form()
  local.card.data.availability = 'available'
  local.answers = [{ questionId: 'q:data.availability', value: 'Данные уже есть', skipped: false }]
  const generated = proposal(structuredClone(local.card))
  generated.evidence = [{ field: 'data.availability', sourceId: 'answer:q:data.availability', quote: 'Данные уже есть' }]
  const task = taskFor(local)
  task.questions = [{ id: 'q:data.availability', field: 'data.availability', text: 'Есть ли данные?', sourceRevision: 1 }]
  assert.ok(evidenceFor('data.availability', local, task, generated))
  local.answers = [{ questionId: 'q:data.availability', value: null, skipped: true }]
  assert.equal(evidenceFor('data.availability', local, task, generated), undefined)
  local.answers = [{ questionId: 'q:data.availability', value: 'Данные будут позже', skipped: false }]
  assert.equal(evidenceFor('data.availability', local, task, generated), undefined)
})

test('derived target shows its metric answer even when a separate target question is unanswered', () => {
  const local = form()
  local.card.success = { metric: 'Четверо из пяти находят аудиторию', target: 'Четверо из пяти находят аудиторию' }
  local.answers = [{ questionId: 'q:success.metric', value: local.card.success.metric, skipped: false }]
  const task = taskFor(local)
  task.questions = [
    { id: 'q:success.target', field: 'success.target', text: 'Условие приёмки?', sourceRevision: 1 },
    { id: 'q:success.metric', field: 'success.metric', text: 'Показатель успеха?', sourceRevision: 1 },
  ]
  assert.equal(evidenceFor('success.target', local, task, null)?.sourceId, 'answer:q:success.metric')
  local.manualFields = ['success.target']
  assert.equal(evidenceFor('success.target', local, task, null), undefined)
})
