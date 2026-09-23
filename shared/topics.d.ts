export const TOPIC_MAX_LENGTH: 80
export type TopicContext = {
  draftText?: string | null
  topic?: string | null
  workingCard?: {
    title?: string | null; context?: string | null; need?: string | null; users?: string | null
    data?: { source?: string | null }
    result?: { artifact?: string | null; scope?: string | null }
  } | null
  answers?: { questionId: string; value: string | null; skipped: boolean }[]
  questions?: { id: string; field: string }[]
  questionHistory?: { id: string; field: string }[]
  manualFields?: string[]
  aiResult?: {
    proposal?: TopicContext['workingCard']
    evidence?: { field: string; sourceId: string; quote: string }[]
  } | null
}
/** Trims/collapses whitespace; returns null for empty input, throws RangeError over 80 characters. */
export function normalizeTopic(value: unknown): string | null
export function labelForTopic(topic: string | null | undefined): string
/** Suggests only from meaningful source text; a manually protected topic returns null. */
export function inferTopic(task?: TopicContext): string | null
