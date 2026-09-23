import assert from 'node:assert/strict'
import test from 'node:test'
import { recordAnswer, getField, type EditorForm } from '../src/editorModel.ts'
import { getQuestionOptions } from '../shared/question-options.js'
import type { Question } from '../src/types.ts'

const blank = (): EditorForm => ({ draftText: 'Студентам нужен поиск свободных аудиторий.', topic: 'education', manualFields: [], answers: [],
  card: { title: null, context: null, need: null, users: null, data: { availability: null, source: null },
    result: { artifact: null, scope: null }, success: { metric: null, target: null },
    constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null }, contact: { channel: null, consultation: null, feedback: null } } })

test('only an explicit answer choice fills a field; editing and skipping still work', () => {
  const form = blank()
  const question: Question = { id: 'q:success.metric', field: 'success.metric', text: 'Как проверить результат?', sourceRevision: 1 }
  const choices = getQuestionOptions(question, { draftText: form.draftText, workingCard: form.card })
  assert.ok(choices.length >= 2)
  assert.equal(form.card.success.metric, null)
  assert.deepEqual(form.answers, [])
  const selected = recordAnswer(form, question, choices[0].value)
  assert.equal(selected.card.success.metric, choices[0].value)
  assert.equal(selected.answers[0].value, choices[0].value)
  const edited = recordAnswer(selected, question, 'Доля студентов, нашедших аудиторию без подсказки.')
  assert.equal(edited.answers.length, 1)
  assert.equal(edited.card.success.metric, 'Доля студентов, нашедших аудиторию без подсказки.')
  const skipped = recordAnswer(edited, question, null, true)
  assert.equal(skipped.card.success.metric, null)
  assert.equal(skipped.answers[0].skipped, true)
})

test('option selection respects manual protection and enum values', () => {
  const form = blank()
  form.card.data.source = 'Подтверждённый источник из ручной правки.'
  form.manualFields = ['data.source']
  const sourceQuestion: Question = { id: 'q:data.source', field: 'data.source', text: 'Откуда получить данные?', sourceRevision: 1 }
  const selected = recordAnswer(form, sourceQuestion, getQuestionOptions(sourceQuestion, { draftText: form.draftText })[0].value)
  assert.equal(selected.card.data.source, form.card.data.source)
  assert.equal(selected.answers.length, 1)
  for (const field of ['data.availability', 'constraints.deadlineMode']) {
    const question: Question = { id: `q:${field}`, field, text: 'Уточните условия.', sourceRevision: 1 }
    for (const option of getQuestionOptions(question, { draftText: form.draftText })) {
      const answered = recordAnswer(blank(), question, option.value)
      assert.equal(getField(answered.card, field), option.value)
    }
  }
})
