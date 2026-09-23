import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeProposal, rebaseForm, recordAnswer, type EditorForm } from '../src/editorModel.ts'
import { aiNeedsRefresh } from '../src/editorStatus.ts'
import type { AiResult, OwnerTask, Question } from '../src/types.ts'

function fixture() {
  const form: EditorForm = {
    draftText: 'Сотрудники магазина вручную проверяют наличие товара.', topic: 'other', answers: [], manualFields: [],
    card: { title: 'Учёт остатков', context: 'Остатки проверяют вручную.', need: null, users: null,
      data: { availability: null, source: null }, result: { artifact: null, scope: null },
      success: { metric: null, target: null }, constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null },
      contact: { channel: null, consultation: null, feedback: null } },
  }
  const question: Question = { id: 'q:refine-context', field: 'context', text: 'Что сложнее всего при проверке остатков?', sourceRevision: 1, origin: 'template', refines: true, baseValue: form.card.context! }
  const result: AiResult = { sourceRevision: 1, proposal: structuredClone(form.card), suggestedTopic: 'Розничная торговля', mode: 'template', questions: [question], warnings: [],
    inputSnapshot: { draftText: form.draftText, topic: form.topic, answers: [], manualFields: [] } }
  return { form, question, result }
}

test('an AI topic can be applied while the clarification retains its base and answer behavior', () => {
  const { form, question, result } = fixture()
  const merged = mergeProposal(form, result)
  assert.equal(merged.form.topic, 'Розничная торговля')
  assert.deepEqual(merged.changed, ['topic'])
  const refined = recordAnswer(merged.form, question, 'Сложно найти расхождения.')
  assert.equal(refined.topic, 'Розничная торговля')
  assert.equal(refined.card.context, `${question.baseValue}\n\nСложно найти расхождения.`)
  assert.equal(recordAnswer(refined, question, null, true).card.context, question.baseValue)
  assert.equal(question.baseValue, form.card.context)
})

test('manual topics, including an explicitly cleared topic, survive AI merge and revision rebase', () => {
  const { form, result } = fixture()
  const local = structuredClone(form)
  local.manualFields = ['topic']
  assert.equal(mergeProposal(local, result).form.topic, 'other')
  const remote = structuredClone(form)
  remote.topic = 'Розничная торговля'
  assert.equal(rebaseForm(local, form, remote).topic, 'other')
  local.topic = 'Инвентаризация небольших магазинов'
  assert.equal(mergeProposal(local, result).form.topic, local.topic)
  assert.equal(rebaseForm(local, form, remote).topic, local.topic)
})

test('applying an inferred topic keeps analysis current, while a refinement or manual topic changes its inputs', () => {
  const { form, question, result } = fixture()
  const applied = mergeProposal(form, result).form
  const task = { revision: 2 } as OwnerTask
  assert.equal(aiNeedsRefresh(applied, task, result), false)
  assert.equal(aiNeedsRefresh(recordAnswer(applied, question, 'Сверка занимает много времени.'), task, result), true)
  assert.equal(aiNeedsRefresh({ ...applied, topic: 'Логистика', manualFields: ['topic'] }, task, result), true)
})
