import assert from 'node:assert/strict'
import test from 'node:test'
import { aiModeLabel, aiNeedsRefresh, answerFeedback } from '../src/editorStatus.ts'
import type { EditorForm } from '../src/editorModel.ts'
import type { AiResult, OwnerTask, Question } from '../src/types.ts'

function fixture() {
  const form: EditorForm = {
    draftText: 'Студентам нужен поиск аудиторий.', topic: 'education', answers: [], manualFields: [],
    card: { title: 'Поиск аудиторий', context: null, need: null, users: null,
      data: { availability: null, source: null }, result: { artifact: null, scope: null },
      success: { metric: null, target: null }, constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null },
      contact: { channel: null, consultation: null, feedback: null } },
  }
  const result: AiResult = { sourceRevision: 1, proposal: structuredClone(form.card), mode: 'template', originMode: 'template', questions: [], warnings: [],
    inputSnapshot: { draftText: form.draftText, topic: form.topic, answers: [], manualFields: [] } }
  const task = { revision: 2 } as OwnerTask
  const question: Question = { id: 'q:context', field: 'context', text: 'Что происходит сейчас?', sourceRevision: 1 }
  return { form, result, task, question }
}

test('applying a proposal does not look outdated; changed source or answers do', () => {
  const { form, result, task } = fixture()
  result.stale = true // The save after applying the proposal increments the revision.
  assert.equal(aiNeedsRefresh(form, task, result), false)
  assert.equal(aiNeedsRefresh({ ...form, draftText: 'Теперь нужен другой результат.' }, task, result), true)
  assert.equal(aiNeedsRefresh({ ...form, answers: [{ questionId: 'q:context', value: 'Расписание ищут вручную.', skipped: false }] }, task, result), true)
  assert.equal(aiNeedsRefresh({ ...form, answers: [{ questionId: 'q:context', value: 'Не знаю.', skipped: false }] }, task, result), true)
  assert.equal(aiNeedsRefresh({ ...form, manualFields: ['title'] }, task, result), true)
  const edited = structuredClone(form)
  edited.card.title = 'Новое название'
  assert.equal(aiNeedsRefresh(edited, task, result), true)
})

test('legacy analysis metadata and cached provider provenance remain visible', () => {
  const { form, result, task } = fixture()
  delete result.inputSnapshot
  assert.equal(aiNeedsRefresh(form, task, result), true)
  assert.match(aiModeLabel({ ...result, mode: 'cached', originMode: 'live' }), /Живой AI/)
  assert.match(aiModeLabel({ ...result, mode: 'cached', originMode: 'template' }), /Шаблонный/)
})

test('answer feedback distinguishes protected fields, unknown input and actual transfer', () => {
  const { form, question } = fixture()
  form.answers = [{ questionId: question.id, value: 'Не знаю.', skipped: false }]
  assert.match(answerFeedback(question, form)!, /не добавляют баллов/)
  form.manualFields = ['context']
  form.card.context = 'Ручное описание'
  assert.match(answerFeedback(question, form)!, /ручная правка/)
  form.manualFields = []
  form.answers[0].value = 'Расписание ищут вручную.'
  form.card.context = form.answers[0].value
  assert.equal(answerFeedback(question, form), 'Ответ перенесён в карточку.')
})
