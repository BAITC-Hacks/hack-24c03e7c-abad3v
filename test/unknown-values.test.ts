import assert from 'node:assert/strict'
import test from 'node:test'
import { answerIntoCard, evidenceFor, mergeProposal, recordAnswer, type EditorForm } from '../src/editorModel.ts'
import type { AiResult, OwnerTask } from '../src/types.ts'

const form = (): EditorForm => ({
  draftText: 'Нужен сайт для студентов.', topic: 'education', answers: [], manualFields: [],
  card: { title: null, context: null, need: null, users: null, data: { availability: null, source: null }, result: { artifact: null, scope: null }, success: { metric: null, target: null }, constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null }, contact: { channel: null, consultation: null, feedback: null } },
})

test('unknown answers clear previously generated text and derived targets despite case or punctuation', () => {
  const local = form()
  local.card.context = 'Старые сведения'
  local.card.success = { metric: 'Четверо из пяти справляются', target: 'Четверо из пяти справляются' }
  for (const value of ['Не знаю.', 'Пока неизвестно', 'НЕТ ИНФОРМАЦИИ!', 'Не знаю, уточню позднее', '—', '   ']) {
    assert.equal(answerIntoCard(local, 'context', value).card.context, null, value)
    assert.deepEqual(answerIntoCard(local, 'success.metric', value).card.success, { metric: null, target: null }, value)
  }
  local.manualFields = ['context']
  assert.equal(answerIntoCard(local, 'context', 'Не знаю.'), local, 'unknown answers cannot replace a protected manual edit')
})

test('known negatives survive answer transfer and cached AI placeholders do not refill the card', () => {
  const local = form()
  assert.equal(answerIntoCard(local, 'constraints.technologyAccess', 'Без ограничений').card.constraints.technologyAccess, 'Без ограничений')
  assert.equal(answerIntoCard(local, 'data.source', 'Данных нет, используем синтетику').card.data.source, 'Данных нет, используем синтетику')
  const proposal = structuredClone(local.card)
  proposal.context = 'Пока неизвестно.'
  const ai: AiResult = { proposal, mode: 'template', questions: [], warnings: [], evidence: [], sourceRevision: 1 }
  assert.equal(mergeProposal(local, ai).form.card.context, null)
})

test('a saved answer still explains a card field after its question leaves the active batch', () => {
  const local = form()
  local.card.data.source = 'CSV учебного отдела'
  local.answers = [{ questionId: 'archived-source', value: local.card.data.source, skipped: false }]
  const task: OwnerTask = {
    id: 'task', draftText: local.draftText, topic: local.topic, workingCard: local.card, confirmedCard: null,
    questions: [{ id: 'current-metric', field: 'success.metric', text: 'Как измерить результат?', sourceRevision: 2 }],
    questionHistory: [{ id: 'archived-source', field: 'data.source', text: 'Какие материалы доступны?', sourceRevision: 1 }],
    answers: local.answers, revision: 2, confirmedRevision: null, publicationStatus: 'draft',
    rating: { score: 0, level: 'needs_clarification', breakdown: [], missingFields: [], scoringVersion: 'test' },
    publishedAt: null, createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
  }
  assert.deepEqual(evidenceFor('data.source', local, task, null), { field: 'data.source', sourceId: 'answer:archived-source', quote: 'CSV учебного отдела' })
  local.answers[0].value = '  CSV учебного отдела  '
  assert.equal(evidenceFor('data.source', local, task, null)?.quote, '  CSV учебного отдела  ', 'a trimmed card value keeps the exact unsaved answer quote')
})

test('answering a manually protected metric saves the reply without changing either success field', () => {
  const local = form()
  local.card.success = { metric: 'Ручной показатель', target: 'Сохранённое условие приёмки' }
  local.manualFields = ['success.metric']
  local.answers = [{ questionId: 'metric', value: 'Старый ответ', skipped: false }]
  const question = { id: 'metric', field: 'success.metric', text: 'Как проверить результат?', sourceRevision: 1 }
  const next = recordAnswer(local, question, 'Четверо из пяти справляются')
  assert.deepEqual(next.card.success, local.card.success)
  assert.deepEqual(next.answers, [{ questionId: 'metric', value: 'Четверо из пяти справляются', skipped: false }])
  assert.equal(local.answers[0].value, 'Старый ответ', 'the captured source form is immutable')
})

test('recording a metric derives its target only for a usable reply and preserves an explicit manual target', () => {
  const local = form()
  const question = { id: 'metric', field: 'success.metric', text: 'Как проверить результат?', sourceRevision: 1 }
  const value = '  Четверо из пяти справляются  '
  const next = recordAnswer(local, question, value)
  assert.deepEqual(next.card.success, { metric: value.trim(), target: value.trim() })
  assert.equal(next.answers[0].value, value, 'the saved answer retains the exact source text')
  assert.deepEqual(recordAnswer(next, question, value, true).card.success, { metric: null, target: null }, 'skipping must not immediately recreate the derived target')
  assert.deepEqual(recordAnswer(next, question, 'Пока неизвестно.').card.success, { metric: null, target: null })
  local.manualFields = ['success.target']
  local.card.success.target = 'Проверить все согласованные сценарии'
  assert.deepEqual(recordAnswer(local, question, value).card.success, { metric: value.trim(), target: local.card.success.target })
})
