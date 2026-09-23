import type { AiResult, OwnerTask, Question } from './types.ts'
import { fields, getField, type EditorForm } from './editorModel.ts'
import { hasMeaningfulValue, normalizeKnownValue } from '../shared/card-values.js'

export function aiModeLabel(result: AiResult | null): string {
  if (!result) return 'Помощник ещё не запускался'
  const mode = result.originMode || result.mode
  if (mode === 'template') return 'Шаблонный помощник'
  if (mode === 'live') return result.mode === 'cached' ? 'Живой AI · сохранённый ответ' : 'Живой AI'
  return 'Сохранённое предложение AI'
}

export function aiNeedsRefresh(form: EditorForm, task: OwnerTask, result: AiResult | null): boolean {
  if (!result) return false
  const snapshot = result.inputSnapshot
  if (snapshot) {
    const answers = (items: EditorForm['answers']) => JSON.stringify(items
      .map(item => ({ id: item.questionId, value: item.skipped ? null : normalizeKnownValue(item.value), skipped: item.skipped }))
      .sort((a, b) => a.id.localeCompare(b.id)))
    if (form.draftText.trim() !== snapshot.draftText.trim() || form.topic !== snapshot.topic
      || answers(form.answers) !== answers(snapshot.answers)
      || JSON.stringify([...form.manualFields].sort()) !== JSON.stringify([...snapshot.manualFields].sort())) return true
    // Applying this proposal increments the task revision, but does not make the analysis outdated.
    return fields.some(([path]) => normalizeKnownValue(getField(form.card, path)) !== normalizeKnownValue(getField(result.proposal, path)))
  }
  return result.stale ?? result.sourceRevision !== task.revision
}

export function answerFeedback(question: Question, form: EditorForm): string | null {
  const response = form.answers.find(answer => answer.questionId === question.id)
  if (!response || (!response.value && !response.skipped)) return null
  if (form.manualFields.includes(question.field)) return 'Ответ учтён. В карточке оставлена ваша ручная правка.'
  if (response.skipped || !hasMeaningfulValue(response.value)) return 'Сведения пока неизвестны и не добавляют баллов за это поле.'
  return normalizeKnownValue(getField(form.card, question.field)) === normalizeKnownValue(response.value)
    ? 'Ответ перенесён в карточку.'
    : 'Ответ учтён для следующего анализа.'
}
