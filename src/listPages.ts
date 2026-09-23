export type ListPage<T> = { items: T[]; total: number }

// Keep one bounded snapshot of the reported total. Newly inserted records can be
// picked up on refresh instead of extending an in-progress request indefinitely.
export async function listAllPages<T extends { id: string }>(
  fetchPage: (page: { limit: number; offset: number }) => Promise<ListPage<T>>,
): Promise<ListPage<T>> {
  const items: T[] = []
  const seen = new Set<string>()
  let offset = 0
  let total: number | undefined
  do {
    const page = await fetchPage({ limit: 100, offset })
    if (!Number.isSafeInteger(page.total) || page.total < 0) throw new Error('Сервер вернул некорректное количество записей.')
    total ??= page.total
    if (!page.items.length) break
    const previousCount = items.length
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
    offset += page.items.length
    // Protect against a server that ignores offset and keeps returning page one.
    if (items.length === previousCount) break
  } while (offset < total)
  return { items, total: total ?? 0 }
}

export function distinctTaskText(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  return parts.flatMap((part) => {
    const text = part?.trim()
    if (!text) return []
    const key = text.replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU')
    if (seen.has(key)) return []
    seen.add(key)
    return [text]
  }).join('\n')
}
