import { loadDemoData } from '../shared/demo-data.js'
import profilesCsv from '../demo/profiles.csv?raw'
import tasksCsv from '../demo/tasks.csv?raw'
import cardsCsv from '../demo/cards.csv?raw'
import applicationsCsv from '../demo/applications.csv?raw'
import type { Card, Topic } from './types'

// Use file content only, so refreshes do not reset local edits for an unchanged data set.
export const datasetVersion = (() => {
  const source = JSON.stringify([profilesCsv, tasksCsv, cardsCsv, applicationsCsv])
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193) >>> 0
  return `csv-${source.length}-${hash.toString(16).padStart(8, '0')}`
})()

// The browser and backend use the same CSV sources and loader.
export const { actors, tasks, applications } = loadDemoData({
  profiles: profilesCsv, tasks: tasksCsv, cards: cardsCsv, applications: applicationsCsv,
})

export const blankCard = (): Card => ({
  title: null, context: null, need: null, users: null,
  data: { availability: null, source: null }, result: { artifact: null, scope: null },
  success: { metric: null, target: null }, constraints: { deadlineMode: null, deadlineDate: null, technologyAccess: null },
  contact: { channel: null, consultation: null, feedback: null },
})

export const teams = actors.filter((actor) => actor.kind === 'team')
export const labelForTopic = (topic: Topic) => ({ education: 'Образование', career: 'Карьера', operations: 'Операции', analytics: 'Аналитика', other: 'Другое' })[topic]
