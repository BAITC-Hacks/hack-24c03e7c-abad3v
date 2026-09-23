import assert from 'node:assert/strict'
import test from 'node:test'
import { inferTopic } from '../shared/topics.js'

test('skipping or not knowing an extra detail keeps the topic inferred from the known card', () => {
  for (const answer of [{ questionId: 'refine', value: null, skipped: true }, { questionId: 'refine', value: 'Не знаю.', skipped: false }]) {
    const task = {
      draftText: 'Нужен понятный рабочий интерфейс.',
      workingCard: { context: 'Магазин проверяет наличие товара вручную.' },
      questions: [{ id: 'refine', field: 'context', refines: true, baseValue: 'Магазин проверяет наличие товара вручную.' }],
      answers: [answer],
    }
    assert.equal(inferTopic(task), 'Розничная торговля')
    assert.equal(inferTopic({ ...task, questions: [{ id: 'refine', field: 'context', refines: false }] }), null, 'ordinary unknown answers still withdraw an unprotected source')
  }
})

test('an unknown archived refinement does not hide an earlier usable answer for the field', () => {
  const task = {
    draftText: 'Нужно упростить поиск сведений.', workingCard: {},
    questions: [],
    questionHistory: [{ id: 'known', field: 'context' }, { id: 'refine', field: 'context', refines: true, baseValue: 'Пациенты ищут расписание врачей.' }],
    answers: [{ questionId: 'known', value: 'Пациенты ищут расписание врачей.', skipped: false }, { questionId: 'refine', value: 'Пока неизвестно', skipped: false }],
  }
  assert.equal(inferTopic(task), 'Медицина')
  assert.equal(inferTopic({ ...task, manualFields: ['topic'] }), null, 'manual topic protection remains authoritative')
})
