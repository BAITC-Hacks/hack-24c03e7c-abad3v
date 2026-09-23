import { mockApi } from './mockApi'
import { listAllPages } from './listPages'
import type { Actor, AiResult, Answer, Application, Card, Level, OwnerTask, PublicTask, Rating, TaskSummary, Topic } from './types'

const useMock = import.meta.env.VITE_API_MODE === 'mock'
const apiBase = import.meta.env.VITE_API_BASE || '/api'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw { status: response.status, ...body }
  return body as T
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const api = {
  getActors: () => useMock ? mockApi.getActors() : request<{ items: Actor[] }>('/demo/actors'),
  selectSession: (actorId: string) => useMock ? mockApi.selectSession(actorId) : request<{ actor: Actor }>('/demo/session', json({ actorId })),
  listTasks: (params: { scope: 'mine' | 'catalog'; topic?: Topic; level?: Level }) => {
    if (useMock) return mockApi.listTasks(params)
    const query = new URLSearchParams({ scope: params.scope })
    if (params.topic) query.set('topic', params.topic)
    if (params.level) query.set('level', params.level)
    return listAllPages<TaskSummary>(({ limit, offset }) => {
      const pageQuery = new URLSearchParams(query)
      pageQuery.set('limit', String(limit))
      pageQuery.set('offset', String(offset))
      return request<{ items: TaskSummary[]; total: number }>(`/tasks?${pageQuery}`)
    })
  },
  getTask: (id: string) => useMock ? mockApi.getTask(id) : request<{ task: OwnerTask | PublicTask }>(`/tasks/${id}`),
  createTask: (draftText: string, topic: Topic) => useMock ? mockApi.createTask({ draftText, topic }) : request<{ task: OwnerTask }>('/tasks', json({ draftText, topic })),
  patchTask: (id: string, body: { revision: number; draftText?: string; topic?: Topic; cardPatch?: Partial<Card>; answers?: Answer[]; manualFields?: string[] }) => useMock
    ? mockApi.patchTask(id, body)
    : request<{ task: OwnerTask; previewRating: Rating }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  analyze: (id: string, revision: number, mode: 'analyze' | 'compose') => useMock
    ? mockApi.analyze(id, revision, mode)
    : request<AiResult>(`/tasks/${id}/analyze`, json({ revision, mode })),
  confirm: (id: string, revision: number) => useMock
    ? mockApi.confirm(id, revision)
    : request<{ task: OwnerTask; rating: Rating }>(`/tasks/${id}/confirm`, json({ revision, confirmed: true })),
  publish: (id: string, revision: number) => useMock
    ? mockApi.publish(id, revision)
    : request<{ task: OwnerTask }>(`/tasks/${id}/publish`, json({ revision })),
  listApplications: (taskId?: string) => useMock
    ? mockApi.listApplications(taskId)
    : listAllPages<Application>(({ limit, offset }) => request<{ items: Application[]; total: number }>(`/tasks${taskId ? `/${taskId}` : ''}/applications?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`)),
  createApplication: (taskId: string, body: { idea: string; plan: string; timeline: string; prototypeUrl: string; clientRequestId: string }) => useMock
    ? mockApi.createApplication(taskId, body)
    : request<{ application: Application }>(`/tasks/${taskId}/applications`, json(body)),
  decideApplication: (id: string, status: 'selected' | 'rejected') => useMock
    ? mockApi.decideApplication(id, status)
    : request<{ application: Application }>(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify({ status }), headers: { 'Content-Type': 'application/json' } }),
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { error?: { message?: string }; message?: string }
    return value.error?.message || value.message || 'Не удалось выполнить запрос. Попробуйте ещё раз.'
  }
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.'
}
