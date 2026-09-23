import type { Actor, Application, OwnerTask, Rating, Topic } from '../src/types'

export type DemoTask = OwnerTask & {
  businessId: string
  industry: string
  completeness: string
  isSynthetic: boolean
  confirmedTopic: Topic | null
  publishedTopic: Topic | null
  publishedRating: Rating | null
}
export type DemoApplication = Application & {
  clientRequestId: string
  decisionSource: string | null
  linkKind: string | null
  isSynthetic: boolean
}
export function parseCsv(input: string): Record<string, string>[]
export function loadDemoData(csv: { profiles: string; tasks: string; cards: string; applications: string }, timestamp?: string): {
  actors: Actor[]
  tasks: DemoTask[]
  applications: DemoApplication[]
}
