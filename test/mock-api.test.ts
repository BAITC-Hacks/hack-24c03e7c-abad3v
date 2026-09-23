import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import type { AiResult, OwnerTask } from '../src/types.ts'

test('mock keeps the current questions through compose and preserves archived answers', async () => {
  // Load the same CSV-backed module that Vite serves, without a browser or API.
  const browserGlobals = globalThis as unknown as { window?: { setTimeout: typeof setTimeout } }
  const previousWindow = browserGlobals.window
  browserGlobals.window = { setTimeout }
  const vite = await createServer({
    configFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'ai-sana-mock-test-')),
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom',
  })
  try {
    const { mockApi } = await vite.ssrLoadModule('/src/mockApi.ts')
    const created = await mockApi.createTask({ draftText: 'Нужен сайт для студентов со списком свободных аудиторий.', topic: 'education' })
    const id = created.task.id
    const first: AiResult = await mockApi.analyze(id, 1, 'analyze')
    const metric = first.questions.find((question) => question.field === 'success.metric')!
    assert.ok(metric)
    const answered = await mockApi.patchTask(id, {
      revision: 1, cardPatch: first.proposal,
      answers: [{ questionId: metric.id, value: '4 из 5 студентов находят аудиторию без подсказки.', skipped: false }],
    })
    const second: AiResult = await mockApi.analyze(id, answered.task.revision, 'analyze')
    assert.equal(second.questions.some((question) => question.id === metric.id), false)
    const composed: AiResult = await mockApi.analyze(id, answered.task.revision, 'compose')
    assert.deepEqual(composed.questions, second.questions)
    assert.equal(composed.proposal.success.metric, answered.task.answers[0].value)
    assert.equal(composed.originMode, 'template')
    assert.deepEqual(composed.inputSnapshot?.answers, answered.task.answers)
    const reopened: OwnerTask = (await mockApi.getTask(id)).task
    assert.deepEqual(reopened.questions, second.questions)
    assert.deepEqual(reopened.aiResult?.questions, second.questions)
    assert.ok(reopened.questionHistory?.some((question) => question.id === metric.id))
    const patched = await mockApi.patchTask(id, {
      revision: reopened.revision,
      answers: [{ questionId: second.questions[0].id, value: 'Не знаю.', skipped: false }],
      cardPatch: { context: 'Не знаю.' },
    })
    assert.equal(patched.task.answers.length, 2, 'partial updates do not erase the archived answer')
    const cleared = await mockApi.patchTask(id, { revision: patched.task.revision, cardPatch: { context: null } })
    assert.equal(patched.previewRating.score, cleared.previewRating.score, 'unknown text earns no context points')
    const withdrawn = await mockApi.patchTask(id, {
      revision: cleared.task.revision, cardPatch: composed.proposal,
      answers: [{ questionId: metric.id, value: 'Пока неизвестно.', skipped: false }],
    })
    const withdrawnResult: AiResult = await mockApi.analyze(id, withdrawn.task.revision, 'compose')
    assert.equal(withdrawnResult.proposal.success.metric, null)
    assert.equal(withdrawnResult.proposal.success.target, null, 'an unknown reply does not resurrect the earlier target')
  } finally {
    await vite.close()
    if (previousWindow === undefined) delete browserGlobals.window
    else browserGlobals.window = previousWindow
  }
})

test('mock answer suggestions stay optional, persist through reload and enter the card only after an explicit patch', async () => {
  const browserGlobals = globalThis as unknown as { window?: { setTimeout: typeof setTimeout } }
  const previousWindow = browserGlobals.window
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const saved = new Map<string, string>()
  browserGlobals.window = { setTimeout }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
  })
  const vite = await createServer({
    configFile: false, cacheDir: mkdtempSync(join(tmpdir(), 'ai-sana-mock-options-test-')),
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom',
  })
  try {
    const { mockApi } = await vite.ssrLoadModule('/src/mockApi.ts')
    const created = await mockApi.createTask({ draftText: 'Нужен сайт для студентов со списком свободных аудиторий.', topic: 'education' })
    const id = created.task.id
    const first: AiResult = await mockApi.analyze(id, 1, 'analyze')
    const availability = first.questions.find((question) => question.field === 'data.availability')!
    assert.ok(availability)
    const option = availability.options?.find((item) => item.value === 'planned')
    assert.ok(option, 'the availability question offers a user-selected planning answer')
    assert.ok(first.questions.every((question) => Array.isArray(question.options)))
    const untouched: OwnerTask = (await mockApi.getTask(id)).task
    assert.deepEqual(untouched.answers, [])
    assert.equal(untouched.workingCard.data.availability, null)
    assert.equal(first.proposal.data.availability, null)
    assert.equal(first.evidence?.some((item) => item.field === 'data.availability'), false)

    const unselected: AiResult = await mockApi.analyze(id, 1, 'compose')
    assert.deepEqual(unselected.questions, first.questions)
    assert.equal(unselected.proposal.data.availability, null, 'offered choices do not act as supplied facts')
    const answered = await mockApi.patchTask(id, {
      revision: 1, answers: [{ questionId: availability.id, value: option.value, skipped: false }],
    })
    assert.equal(answered.task.workingCard.data.availability, null, 'saving an answer does not implicitly apply a card patch')
    const composed: AiResult = await mockApi.analyze(id, answered.task.revision, 'compose')
    assert.deepEqual(composed.questions, first.questions)
    assert.equal(composed.proposal.data.availability, 'planned')
    assert.deepEqual(composed.evidence?.find((item) => item.field === 'data.availability'), {
      field: 'data.availability', sourceId: `answer:${availability.id}`, quote: option.value,
    })
    assert.equal((await mockApi.getTask(id)).task.workingCard.data.availability, null)

    const next: AiResult = await mockApi.analyze(id, answered.task.revision, 'analyze')
    assert.equal(next.questions.some((question) => question.id === availability.id), false)
    const applied = await mockApi.patchTask(id, {
      revision: answered.task.revision, cardPatch: { data: composed.proposal.data },
    })
    assert.equal(applied.task.workingCard.data.availability, 'planned')

    // A new module instance rebuilds its stores from the serialized browser cache.
    const { mockApi: restoredApi } = await vite.ssrLoadModule('/src/mockApi.ts?restore-options')
    const restored: OwnerTask = (await restoredApi.getTask(id)).task
    assert.deepEqual(restored.questions, next.questions)
    assert.deepEqual(restored.aiResult?.questions, next.questions)
    assert.deepEqual(restored.questionHistory?.find((question) => question.id === availability.id)?.options, availability.options)
    assert.deepEqual(restored.answers, [{ questionId: availability.id, value: option.value, skipped: false }])
    assert.equal(restored.workingCard.data.availability, 'planned')
  } finally {
    await vite.close()
    if (previousWindow === undefined) delete browserGlobals.window
    else browserGlobals.window = previousWindow
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
