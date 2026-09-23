export type Topic = string
export type Level = 'needs_clarification' | 'workable' | 'ready' | 'priority'
export type Role = 'business' | 'team'
export type Status = 'pending' | 'selected' | 'rejected'

export type Card = {
  title: string | null
  context: string | null
  need: string | null
  users: string | null
  data: { availability: 'available' | 'planned' | 'unavailable' | null; source: string | null }
  result: { artifact: string | null; scope: string | null }
  success: { metric: string | null; target: string | null }
  constraints: { deadlineMode: 'fixed' | 'flexible' | null; deadlineDate: string | null; technologyAccess: string | null }
  contact: { channel: string | null; consultation: string | null; feedback: string | null }
}

export type RatingLine = { key: string; label: string; earned: number; max: number; missing: string[] }
export type Rating = { score: number; level: Level; breakdown: RatingLine[]; missingFields: string[]; scoringVersion: string }
export type AnswerOption = { label: string; value: string }
export type Question = { id: string; field: string; text: string; sourceRevision: number; options?: AnswerOption[]; origin?: 'live' | 'template'; refines?: boolean; baseValue?: string }
export type Answer = { questionId: string; value: string | null; skipped: boolean }

export type TaskSummary = {
  id: string; title: string; topic: Topic; rating: Rating; publicationStatus: 'draft' | 'published'
  publishedAt: string | null; applicationCount: number
  need?: string | null; result?: string | null; dataAvailability?: Card['data']['availability']; deadline?: string | null
  previewRating?: Rating; hasUnpublishedChanges?: boolean; updatedAt?: string; pendingApplicationCount?: number
}

export type OwnerTask = {
  id: string; draftText: string; topic: Topic; workingCard: Card; confirmedCard: Card | null
  questions: Question[]; questionHistory?: Question[]; answers: Answer[]; revision: number; confirmedRevision: number | null
  publicationStatus: 'draft' | 'published'; rating: Rating; publishedAt: string | null
  createdAt: string; updatedAt: string
  previewRating?: Rating; publishedRevision?: number | null; publishedCard?: Card | null
  hasUnpublishedChanges?: boolean; aiResult?: AiResult | null; manualFields?: string[]
}

export type PublicTask = { id: string; topic: Topic; card: Card; rating: Rating; publicationStatus: 'published'; publishedAt: string | null }
export type Application = {
  id: string; taskId: string; teamId: string; teamName: string; idea: string; plan: string; timeline: string
  prototypeUrl: string | null; status: Status; createdAt: string; decidedAt: string | null
}
export type Actor = { id: string; kind: Role; name: string; profile: string | Record<string, unknown> }
export type Evidence = { field: string; sourceId: string; quote: string }
export type AiResult = {
  sourceRevision: number; questions: Question[]; proposal: Card; warnings: string[]; mode: 'live' | 'cached' | 'template'; evidence?: Evidence[]
  suggestedTopic?: string | null
  originMode?: 'live' | 'template'; operation?: 'analyze' | 'compose'; generatedAt?: string; stale?: boolean
  inputSnapshot?: { draftText: string; topic: Topic; answers: Answer[]; manualFields: string[] }
}
