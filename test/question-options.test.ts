import assert from 'node:assert/strict'
import test from 'node:test'
import { getQuestionOptions, normalizeQuestionOptions } from '../shared/question-options.js'

const domainExamples = [
  ['Нужен поиск свободных аудиторий по расписанию.', /аудитор|помещени|расписан/iu],
  ['Нужен помощник для подготовки к собеседованию.', /ответ|собеседован|интервью/iu],
  ['Продавцы магазина учитывают остатки товаров.', /товар|остатк|наличи/iu],
  ['Библиотекари считают выдачи книг по жанрам.', /библиотек|выдач|жанр/iu],
  ['Координатор собирает заявки волонтёров на смены.', /волонт|смен|участник/iu],
  ['Карьерный центр публикует стажировки для студентов.', /стажиров|объявлен|карьерн/iu],
  ['Нужно улучшить рабочий процесс.', /сценари|данны|результат/iu],
] as const
const textFields = ['title', 'context', 'need', 'users', 'data.source', 'result.artifact', 'result.scope', 'success.metric', 'success.target', 'constraints.technologyAccess', 'contact.consultation', 'contact.feedback']

test('template choices fit the task domain and remain bounded suggestions for every text field', () => {
  for (const [draftText, vocabulary] of domainExamples) {
    const context = { draftText }
    const metrics = getQuestionOptions({ field: 'success.metric' }, context)
    assert.equal(metrics.length, 3)
    assert.match(metrics.map(option => option.value).join(' '), vocabulary, draftText)
    for (const field of textFields) {
      const options = getQuestionOptions({ field }, context)
      assert.equal(options.length, 3, `${draftText}: ${field}`)
      assert.equal(new Set(options.map(option => option.value)).size, options.length)
      for (const option of options) {
        assert.ok(option.label.length > 0 && option.label.length <= 80, option.label)
        assert.ok(option.value.length > 0 && option.value.length <= 300, option.value)
        assert.doesNotMatch(option.value, /\d|@|https?:\/\/|[$€₽₸]/u)
      }
      assert.deepEqual(normalizeQuestionOptions({ field }, context), options, `${field}: fallback must not reject its own safe choices`)
    }
  }
})

test('the saved card can supply domain context without changing the task or card', () => {
  const card = Object.freeze({ title: 'Каталог стажировок', result: Object.freeze({ artifact: 'Веб-прототип поиска стажировок' }) })
  const task = Object.freeze({ draftText: 'Нужен прототип.', workingCard: card })
  const expected = getQuestionOptions({ field: 'data.source' }, task)
  assert.match(expected[0].value, /объявлен/iu)
  assert.deepEqual(getQuestionOptions({ field: 'data.source' }, { card }), expected)
  assert.deepEqual(getQuestionOptions({ field: 'data.source' }, { proposal: card }), expected)
  expected[0].label = 'Изменение внешнего массива'
  assert.notEqual(getQuestionOptions({ field: 'data.source' }, task)[0].label, expected[0].label)
  assert.deepEqual(getQuestionOptions({ field: 'data.source' }, { draftText: 'Нужен личный кабинет студента.' }), getQuestionOptions({ field: 'data.source' }), 'a personal account is not a physical classroom')
})

test('enum options stay canonical and contact addresses or exact dates stay manual', () => {
  assert.deepEqual(normalizeQuestionOptions({ field: 'data.availability' }, {}, [{ label: 'Данные есть', value: 'maybe' }]).map(option => option.value), ['available', 'planned', 'unavailable'])
  assert.deepEqual(normalizeQuestionOptions({ field: 'constraints.deadlineMode' }, {}, [{ label: 'Месяц', value: '2026-10-01' }]).map(option => option.value), ['flexible', 'fixed'])
  for (const field of ['contact.channel', 'constraints.deadlineDate', 'unknown', '__proto__', 'toString']) {
    assert.deepEqual(getQuestionOptions({ field }), [])
    assert.deepEqual(normalizeQuestionOptions({ field }, {}, [{ label: 'Выбрать', value: 'invented@example.org' }]), [])
  }
})

test('valid LLM suggestions survive normalization while duplicates and invented specifics do not', () => {
  const question = { field: 'success.metric' }
  const task = { draftText: 'Нужен учёт товаров.' }
  const valid = { label: ' Проверка расчёта ', value: ' Совпадение остатка  с контрольным расчётом. ' }
  const options = normalizeQuestionOptions(question, task, [
    valid,
    { label: 'Другой заголовок', value: 'Совпадение остатка с контрольным расчётом!' },
    { label: 'Точный план', value: 'Проверим на 25 товарах.' },
    { label: 'Точный бюджет', value: 'Бюджет — сто тысяч тенге.' },
    { label: 'Точная дата', value: 'Готово к 2026-10-01.' },
    { label: 'Контакт', value: 'Напишите на invented@example.org.' },
    { label: 'Пока неизвестно', value: 'Не знаю.' },
    { label: 'Слишком длинно', value: 'А'.repeat(301) },
    { label: 'А'.repeat(81), value: 'Проверить результат вручную.' },
    null,
  ])
  assert.equal(options.length, 3)
  assert.deepEqual(options[0], { label: 'Проверка расчёта', value: 'Совпадение остатка с контрольным расчётом.' })
  assert.doesNotMatch(options.map(option => option.value).join(' '), /25|тенге|2026|@/u)
  assert.equal(valid.value, ' Совпадение остатка  с контрольным расчётом. ', 'normalization must not mutate provider output')
  assert.deepEqual(normalizeQuestionOptions({ ...question, options }, task), options, 'saved valid suggestions survive reload')
})

test('candidate count is capped, malformed input falls back, and consultation options cannot invent people', () => {
  const task = { draftText: 'Нужен сайт.' }, question = { field: 'result.scope' }
  const candidates = ['Поиск по названию', 'Фильтр по теме', 'Просмотр сведений', 'Проверка ввода', 'Экспорт примеров'].map(value => ({ label: value, value }))
  assert.deepEqual(normalizeQuestionOptions(question, task, candidates), candidates.slice(0, 4))
  for (const bad of [null, {}, 'ответ', [false, {}, { label: 'Да' }]]) assert.deepEqual(normalizeQuestionOptions(question, task, bad), getQuestionOptions(question, task))
  const feedback = normalizeQuestionOptions({ field: 'contact.feedback' }, task, [{ label: 'Проверит Иван', value: 'Иван Петров ответит завтра.' }])
  assert.equal(feedback.length, 3)
  assert.doesNotMatch(feedback.map(option => option.value).join(' '), /Иван|Петров|завтра/u)
})
