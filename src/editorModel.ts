import type { AiResult, Answer, Card, Evidence, OwnerTask, Question, Topic } from './types'
import { normalizeKnownValue } from '../shared/card-values.js'

export type EditorForm = { draftText: string; topic: Topic; card: Card; answers: Answer[]; manualFields: string[] }
export const fields = [
  ['title', 'Название задачи'], ['context', 'Текущая ситуация'], ['need', 'Проблема и потребность'], ['users', 'Для кого'],
  ['result.artifact', 'Что сдаст команда'], ['result.scope', 'Что входит в результат'], ['success.metric', 'Показатель успеха'], ['success.target', 'Условие приёмки'],
  ['data.availability', 'Доступность данных'], ['data.source', 'Материалы и источник'], ['constraints.deadlineMode', 'Срок'], ['constraints.deadlineDate', 'Дата сдачи'], ['constraints.technologyAccess', 'Технологии и доступы'],
  ['contact.channel', 'Рабочий контакт'], ['contact.consultation', 'Консультации'], ['contact.feedback', 'Обратная связь'],
] as const
export const fieldLabel = (path: string) => path === 'topic' ? 'Тема для поиска' : fields.find(([key]) => key === path)?.[1] || path
export function getField(card: Card, path: string): string | null { return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : null, card) as string | null }
export function setField(card: Card, path: string, value: string | null): Card {
  const next = structuredClone(card)
  const [first, second] = path.split('.')
  if (second) (next[first as keyof Card] as Record<string, string | null>)[second] = value
  else (next as unknown as Record<string, unknown>)[first] = value
  return next
}
export const formFromTask = (task: OwnerTask): EditorForm => ({ draftText: task.draftText, topic: task.topic, card: structuredClone(task.workingCard), answers: task.answers || [], manualFields: task.manualFields || [] })
export const signature = (form: EditorForm) => JSON.stringify(form)
export function mergeProposal(form: EditorForm, result: AiResult, baseline: Card = form.card) {
  let card = structuredClone(form.card)
  const changed: string[] = []
  for (const [path] of fields) {
    const value = normalizeKnownValue(getField(result.proposal, path))
    if (form.manualFields.includes(path) || getField(card, path) !== getField(baseline, path) || value === getField(card, path)) continue
    card = setField(card, path, value); changed.push(path)
  }
  let topic = form.topic
  if (result.suggestedTopic !== undefined && !form.manualFields.includes('topic')) {
    topic = result.suggestedTopic?.trim() || 'other'
    if (topic !== form.topic) changed.push('topic')
  }
  return { form: { ...form, card, topic }, changed }
}
export function answerIntoCard(form: EditorForm, field: string, value: string | null): EditorForm {
  if (form.manualFields.includes(field)) return form
  value = normalizeKnownValue(value)
  if (field === 'data.availability' && value && !['available', 'planned', 'unavailable'].includes(value)) return form
  if (field === 'constraints.deadlineMode' && value && !['fixed', 'flexible'].includes(value)) return form
  let card = setField(form.card, field, value)
  if (field === 'success.metric' && !form.manualFields.includes('success.target') && form.card.success.target === form.card.success.metric) card = setField(card, 'success.target', null)
  if (field === 'constraints.deadlineMode' && value !== 'fixed') card = setField(card, 'constraints.deadlineDate', null)
  return { ...form, card }
}
export function recordAnswer(form: EditorForm, question: Question, value: string | null, skipped = false): EditorForm {
  let next: EditorForm = {
    ...form,
    answers: [...form.answers.filter(answer => answer.questionId !== question.id), { questionId: question.id, value: skipped ? null : value, skipped }],
  }
  next = answerIntoCard(next, question.field, skipped ? null : value)
  const knownValue = normalizeKnownValue(value)
  if (question.field === 'success.metric' && !skipped && !form.manualFields.includes('success.metric')
    && !form.manualFields.includes('success.target') && knownValue && /\d|минимум|хотя бы|не менее|четверо|пятеро/i.test(knownValue)) {
    next = answerIntoCard(next, 'success.target', knownValue)
  }
  return next
}
export function evidenceFor(path: string, form: EditorForm, task: OwnerTask, result: AiResult | null): Evidence | undefined {
  if (form.manualFields.includes(path)) return undefined
  const value = getField(form.card, path)
  const questions = [...(task.questionHistory || []), ...task.questions].filter(q => q.field === path || (path === 'success.target' && form.card.success.target === form.card.success.metric && q.field === 'success.metric'))
  const answer = form.answers.find(a => questions.some(q => q.id === a.questionId) && !a.skipped && a.value && value && value === normalizeKnownValue(a.value))
  if (answer?.value) return { field: path, sourceId: `answer:${answer.questionId}`, quote: answer.value }
  return result?.evidence?.find(item => {
    if (item.field !== path || !value || getField(result.proposal, path) !== value || !item.quote) return false
    const source = item.sourceId === 'draft' ? form.draftText
      : item.sourceId.startsWith('answer:') ? form.answers.find(a => a.questionId === item.sourceId.slice(7) && !a.skipped)?.value
      : item.sourceId.startsWith('card:') ? getField(form.card, item.sourceId.slice(5))
      : null
    return Boolean(source?.includes(item.quote))
  })
}
export function rebaseForm(local: EditorForm, base: EditorForm, remote: EditorForm): EditorForm {
  let card = structuredClone(remote.card)
  for (const [path] of fields) {
    const newlyProtected = local.manualFields.includes(path) && !base.manualFields.includes(path)
    if (newlyProtected || getField(local.card, path) !== getField(base.card, path)) card = setField(card, path, getField(local.card, path))
  }
  const answers = new Map(remote.answers.map(a => [a.questionId, a]))
  local.answers.forEach(a => { if (JSON.stringify(a) !== JSON.stringify(base.answers.find(b => b.questionId === a.questionId))) answers.set(a.questionId, a) })
  const topicEdited = local.topic !== base.topic || local.manualFields.includes('topic') && !base.manualFields.includes('topic')
  return { card, answers: [...answers.values()], draftText: local.draftText !== base.draftText ? local.draftText : remote.draftText, topic: topicEdited ? local.topic : remote.topic, manualFields: [...new Set([...local.manualFields, ...remote.manualFields])] }
}
export function readLocal<T>(key: string): T | null { try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null } catch { return null } }
export function writeLocal(key: string, value: unknown) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)) } catch { /* Server saving stays available when browser storage is disabled. */ } }
