import assert from 'node:assert/strict'
import test from 'node:test'
import { questionAnswerDetail, questionAnswerValue, recordAnswer, refinementBase, type EditorForm } from '../src/editorModel.ts'
import { answerFeedback } from '../src/editorStatus.ts'
import type { Question } from '../src/types.ts'

const base = 'Заявки собирают в разных чатах.'
const question = (): Question => ({ id: 'q:refine', field: 'context', text: 'Где в этом процессе теряется больше всего времени?', sourceRevision: 2, origin: 'template', refines: true, baseValue: base })
const form = (): EditorForm => ({
  draftText: base, topic: 'operations', answers: [], manualFields: [],
  card: { title: null, context: base, need: null, users: null, data: { availability: null, source: null }, result: { artifact: null, scope: null }, success: { metric: null, target: null }, constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null }, contact: { channel: null, consultation: null, feedback: null } },
})

test('refinement appends to its immutable base and stores the complete answer for evidence and reload', () => {
  const original = form(), q = question()
  const next = recordAnswer(original, q, 'Много времени уходит на поиск повторных заявок.')
  const combined = `${base}\n\nМного времени уходит на поиск повторных заявок.`
  assert.equal(next.card.context, combined)
  assert.equal(next.answers[0].value, combined)
  assert.equal(questionAnswerDetail(q, next.answers[0].value), 'Много времени уходит на поиск повторных заявок.', 'the editable input shows only the extra detail')
  assert.equal(questionAnswerValue(q, 'Много времени уходит на поиск повторных заявок.'), combined, 'choice selection compares the full combined value')
  assert.equal(q.baseValue, base)
  assert.equal(original.card.context, base)
  assert.deepEqual(original.answers, [])
  assert.match(answerFeedback(q, next)!, /Уточнение добавлено/)
})

test('editing a refinement or choosing a replacement detail never duplicates or accumulates the base', () => {
  const q = question()
  const first = recordAnswer(form(), q, 'Проверяем повторы вручную.')
  const fullEdit = `${base}\n\nПроверяем повторы и исправляем ошибки. `
  const edited = recordAnswer(first, q, fullEdit)
  assert.equal(edited.answers[0].value, fullEdit, 'keep spaces needed while typing')
  assert.equal(edited.card.context, fullEdit.trim())
  assert.equal(questionAnswerDetail(q, edited.answers[0].value), 'Проверяем повторы и исправляем ошибки. ')
  const replaced = recordAnswer(edited, q, 'Долго ищем актуальный статус.')
  assert.equal(replaced.card.context, `${base}\n\nДолго ищем актуальный статус.`)
  assert.equal(replaced.answers.length, 1)
  assert.equal(replaced.card.context?.split(base).length, 2)
  assert.equal(recordAnswer(replaced, q, base).card.context, base)
  assert.equal(questionAnswerDetail(q, base), '')
})

test('skipped and unknown refinements restore known base information without inventing new evidence', () => {
  const q = question(), refined = recordAnswer(form(), q, 'Проверяем повторы вручную.')
  const skipped = recordAnswer(refined, q, null, true)
  assert.equal(skipped.card.context, base)
  assert.deepEqual(skipped.answers[0], { questionId: q.id, value: null, skipped: true })
  assert.match(answerFeedback(q, skipped)!, /Исходные сведения сохранены/)
  assert.doesNotMatch(answerFeedback(q, skipped)!, /балл/)
  for (const unknown of ['Не знаю.', 'Пока неизвестно', '']) {
    const next = recordAnswer(refined, q, unknown)
    assert.equal(next.card.context, base)
    assert.equal(next.answers[0].value, unknown)
    assert.equal(next.answers[0].skipped, false)
    if (unknown) assert.match(answerFeedback(q, next)!, /Исходные сведения сохранены/)
  }
})

test('manual fields survive refinement input, skipping and unknown replies', () => {
  const original = form(), q = question()
  original.card.context = 'Описание исправлено заказчиком вручную.'
  original.manualFields = ['context']
  for (const [value, skipped] of [['Новая деталь', false], ['Не знаю.', false], [null, true]] as const) {
    const next = recordAnswer(original, q, value, skipped)
    assert.equal(next.card.context, original.card.context)
    assert.equal(next.answers.length, 1)
    assert.match(answerFeedback(q, next)!, /ручная правка/)
  }
})

test('an oversized combined answer is saved intact while the card awaits an explicit manual edit', () => {
  const original = form(), q = question()
  q.baseValue = 'Исходная информация. '.repeat(45).trim()
  original.card.context = q.baseValue
  const detail = 'Дополнительное пояснение. '.repeat(10).trim()
  const next = recordAnswer(original, q, detail)
  assert.ok(next.answers[0].value!.length > 1000 && next.answers[0].value!.length < 2000)
  assert.equal(next.answers[0].value, `${q.baseValue}\n\n${detail}`)
  assert.equal(next.card.context, original.card.context)
  assert.match(answerFeedback(q, next)!, /сохранён целиком.*вручную/)
  assert.doesNotMatch(answerFeedback(q, next)!, /Уточнение добавлено/)
})

test('refinement metadata cannot concatenate native enums, dates or contact addresses', () => {
  const original = form()
  for (const [field, value] of [['data.availability', 'planned'], ['constraints.deadlineMode', 'flexible'], ['constraints.deadlineDate', '2026-10-01'], ['contact.channel', 'owner@example.org']]) {
    const q = { ...question(), field }
    assert.equal(refinementBase(q), null)
    assert.equal(questionAnswerValue(q, value), value)
    assert.equal(recordAnswer(original, q, value).answers[0].value, value)
  }
})

test('a metric refinement with a number cannot silently replace the acceptance target', () => {
  const original = form()
  original.card.success = { metric: 'Время поиска записи', target: 'Прохождение согласованных сценариев' }
  const q = { ...question(), field: 'success.metric', baseValue: original.card.success.metric! }
  const next = recordAnswer(original, q, 'Засекаем время на 5 контрольных записях.')
  assert.equal(next.card.success.metric, 'Время поиска записи\n\nЗасекаем время на 5 контрольных записях.')
  assert.equal(next.card.success.target, original.card.success.target)
})
