import assert from 'node:assert/strict'
import test from 'node:test'
import { distinctTaskText, listAllPages } from '../src/listPages.ts'

test('all task and application pages beyond 100 records are available for local filters and counts', async () => {
  for (const prefix of ['task', 'application']) {
    const records = Array.from({ length: 237 }, (_, index) => ({ id: `${prefix}-${index}`, status: index >= 200 ? 'selected' : 'pending' }))
    const calls: Array<{ limit: number; offset: number }> = []
    const result = await listAllPages(async (page) => {
      calls.push(page)
      return { items: records.slice(page.offset, page.offset + page.limit), total: records.length }
    })
    assert.deepEqual(result.items, records)
    assert.equal(result.total, 237)
    assert.equal(result.items.filter((item) => item.status === 'selected').length, 37)
    assert.equal(result.items.find((item) => item.id === `${prefix}-236`)?.id, `${prefix}-236`)
    assert.deepEqual(calls, [{ limit: 100, offset: 0 }, { limit: 100, offset: 100 }, { limit: 100, offset: 200 }])
  }
})

test('pagination terminates on an empty page even if the reported total is stale', async () => {
  const offsets: number[] = []
  const result = await listAllPages(async ({ offset }) => {
    offsets.push(offset)
    return { items: offset === 0 ? [{ id: 'one' }, { id: 'two' }] : [], total: 250 }
  })
  assert.deepEqual(offsets, [0, 2])
  assert.deepEqual(result.items.map((item) => item.id), ['one', 'two'])
  let emptyCalls = 0
  assert.deepEqual(await listAllPages(async () => { emptyCalls += 1; return { items: [], total: 0 } }), { items: [], total: 0 })
  assert.equal(emptyCalls, 1)
})

test('short nonempty pages keep loading until total and a growing total does not extend the snapshot', async () => {
  const records = Array.from({ length: 5 }, (_, index) => ({ id: String(index) }))
  const offsets: number[] = []
  const result = await listAllPages(async ({ offset }) => {
    offsets.push(offset)
    return { items: records.slice(offset, offset + 2), total: offset ? 500 : 5 }
  })
  assert.deepEqual(offsets, [0, 2, 4])
  assert.deepEqual(result.items, records)
  assert.equal(result.total, 5)
})

test('overlapping IDs are not duplicated and repeated pages terminate', async () => {
  let calls = 0
  const result = await listAllPages(async () => {
    calls += 1
    return { items: [{ id: 'one' }, { id: 'two' }], total: 900 }
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.items.map((item) => item.id), ['one', 'two'])
})

test('page failures and invalid totals do not masquerade as complete lists', async () => {
  const failure = new Error('Не удалось загрузить страницу')
  await assert.rejects(listAllPages(async ({ offset }) => {
    if (offset) throw failure
    return { items: [{ id: 'one' }], total: 2 }
  }), (error) => error === failure)
  await assert.rejects(listAllPages(async () => ({ items: [], total: Number.NaN })), /количество записей/)
})

test('expected result does not repeat identical artifact and scope, while distinct details remain', () => {
  assert.equal(distinctTaskText(['Веб-прототип поиска.', '  веб-прототип   поиска.\n']), 'Веб-прототип поиска.')
  assert.equal(distinctTaskText([null, '  ', undefined]), '')
  assert.equal(distinctTaskText(['Веб-прототип поиска.', 'Поиск и фильтрация без регистрации.']), 'Веб-прототип поиска.\nПоиск и фильтрация без регистрации.')
})
