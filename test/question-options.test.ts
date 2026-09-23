import assert from 'node:assert/strict'
import test from 'node:test'
import { getQuestionOptions, normalizeQuestionOptions } from '../shared/question-options.js'
import { hasMeaningfulValue } from '../shared/card-values.js'

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

test('baseline role and unknown consultation options survive without becoming a format question', () => {
  const question = { field: 'contact.consultation', text: 'Кто сможет консультировать студенческую команду по процессу записи?' }
  const task = { draftText: 'Запись студентов на консультации преподавателя.' }
  const offered = [
    { label: 'Преподаватель', value: 'Преподаватель сможет отвечать на вопросы о процессе записи.' },
    { label: 'Представитель заказчика', value: 'Представитель заказчика сможет консультировать команду.' },
    { label: 'Пока неизвестно', value: 'Консультант пока не определён.' },
  ]
  const actual = normalizeQuestionOptions(question, task, offered)
  assert.deepEqual(actual.slice(0, 2), offered.slice(0, 2))
  assert.deepEqual(actual[2], { label: 'Пока неизвестно', value: 'Не знаю.' })
  assert.equal(hasMeaningfulValue(actual[2].value), false, 'an unknown role must not earn card points')
  assert.deepEqual(normalizeQuestionOptions(question, task, actual), actual)
  assert.doesNotMatch(actual.map(option => option.value).join(' '), /письменно|графику|короткие встречи/u)
})

test('baseline contact options keep cadence and an explicit absence of consultation', () => {
  const question = { field: 'contact.consultation', text: 'Сможет ли преподаватель консультировать команду по упражнениям и интерпретации ошибок?' }
  const candidates = [
    { label: 'Регулярно', value: 'Преподаватель сможет регулярно отвечать на вопросы команды и пояснять ошибки.' },
    { label: 'По запросу', value: 'Преподаватель сможет консультировать команду по отдельным вопросам.' },
    { label: 'Не планируется', value: 'Консультации преподавателя в ходе работы не планируются.' },
  ]
  assert.deepEqual(normalizeQuestionOptions(question, {}, candidates), candidates)
  assert.ok(getQuestionOptions(question).some(option => /не планируются/u.test(option.value)))
  const who = getQuestionOptions({ field: 'contact.feedback', text: 'Кто проверит прототип?' })
  assert.ok(who.some(option => /Специалист|Представитель/u.test(option.value)))
  const frequency = getQuestionOptions({ field: 'contact.consultation', text: 'Как часто команда сможет консультироваться с вами?' })
  assert.ok(frequency.some(option => /рабочие дни/u.test(option.value)), 'frequency must take precedence over сможет')
  const feedback = getQuestionOptions({ field: 'contact.feedback', text: 'Сможет ли заказчик дать обратную связь?' })
  assert.ok(feedback.some(option => /готовый прототип/u.test(option.value)))
  assert.doesNotMatch(feedback.map(option => option.value).join(' '), /консультировать/u)
})

test('contact choices reject invented identities and addresses while retaining roles', () => {
  const role = { label: 'Методист', value: 'Методист сможет проверить результат.' }
  const result = normalizeQuestionOptions({ field: 'contact.feedback', text: 'Кто проверит прототип?' }, {}, [
    role, { label: 'Ответственный', value: 'Иван проверит результат.' },
    { label: 'Проверяющий', value: 'Дмитрий проверит прототип.' },
    { label: 'Петров', value: 'Иван Петров ответит завтра.' },
    { label: 'Почта', value: 'Проверяющий доступен по teacher@example.org.' },
  ])
  assert.deepEqual(result[0], role)
  assert.doesNotMatch(result.map(option => option.value).join(' '), /Иван|Дмитрий|Петров|завтра|@/u)
})

test('vague demo or feedback metrics are replaced by contextual measurable options', () => {
  const valid = { label: 'Время поиска', value: 'Оценивать время, необходимое студенту для поиска свободной аудитории.' }
  const result = normalizeQuestionOptions({ field: 'success.metric' }, { draftText: 'Нужен поиск свободных аудиторий.' }, [
    valid,
    { label: 'Демонстрация', value: 'Возможность продемонстрировать предусмотренные сценарии работы.' },
    { label: 'Проверка преподавателем', value: 'Результаты проверки прототипа преподавателем.' },
    { label: 'Отзывы', value: 'Оценивать удобство прототипа по отзывам студентов.' },
  ])
  assert.deepEqual(result[0], valid)
  assert.equal(result.length, 3)
  assert.doesNotMatch(result.map(option => option.value).join(' '), /продемонстрировать|Результаты проверки|по отзывам/u)
  assert.match(result.map(option => option.value).join(' '), /Доля|Соответствие/u)
  const music = getQuestionOptions({ field: 'success.metric' }, { draftText: 'Прототип разбора ошибок ритма по аудиозаписям и MIDI.' })
  assert.ok(music.every(option => /ритм|упражнени/u.test(option.value)))
  const library = getQuestionOptions({ field: 'success.metric' }, { draftText: 'Библиотекарям нужен поиск книги и просмотр её доступности.' })
  assert.doesNotMatch(library.map(option => option.value).join(' '), /жанр|срез.*отч/u)
})

test('local refinements suggest checks and edge cases without replacing known field values', () => {
  for (const [field, vocabulary] of [
    ['data.source', /Провер|Подтверд/u], ['result.scope', /Уточним/u],
    ['constraints.technologyAccess', /провер|Сверим/iu], ['contact.feedback', /Зафиксируем|сверим|зафиксируем/u],
  ] as const) {
    const question = { field, refines: true, origin: 'template' as const }
    const offered = getQuestionOptions(question, { draftText: 'Поиск свободных аудиторий.' })
    assert.equal(offered.length, 3)
    assert.ok(offered.every(option => vocabulary.test(option.value)), field)
    assert.deepEqual(normalizeQuestionOptions(question, {}, offered), offered)
    assert.doesNotMatch(offered.map(option => option.value).join(' '), /Подготовим синтетическую|бронирование оставить|Команда выбирает технологии/u)
  }
  const refined = { field: 'contact.feedback', text: 'Кто подтвердит итог проверки?', refines: true, origin: 'live' as const }
  const candidate = { label: 'Методист', value: 'Методист подтвердит итог проверки.' }
  assert.deepEqual(normalizeQuestionOptions(refined, {}, [candidate]), [candidate], 'do not append unrelated generic formats to a model refinement')
  assert.deepEqual(getQuestionOptions({ field: 'users', refines: true }), [])
})
