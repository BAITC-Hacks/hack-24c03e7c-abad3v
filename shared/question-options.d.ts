export type QuestionOption = { label: string; value: string }
export type OptionQuestion = { field: string; text?: string; options?: unknown }
type ContextCard = {
  title?: string | null; context?: string | null; need?: string | null; users?: string | null
  result?: { artifact?: string | null; scope?: string | null }
}
export type QuestionOptionsContext = {
  draftText?: string | null
  workingCard?: ContextCard | null
  card?: ContextCard | null
  proposal?: ContextCard | null
}
export function getQuestionOptions(question: OptionQuestion, taskContext?: QuestionOptionsContext): QuestionOption[]
export function normalizeQuestionOptions(question: OptionQuestion, taskContext?: QuestionOptionsContext, candidateOptions?: unknown): QuestionOption[]
