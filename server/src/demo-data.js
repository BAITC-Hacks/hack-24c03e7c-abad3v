import { readFileSync } from 'node:fs';
import { loadDemoData } from '../../shared/demo-data.js';

// Both the API seed and the standalone frontend use the same CSV conversion.
export function loadServerDemoData(timestamp) {
  const files = Object.fromEntries(['profiles', 'tasks', 'cards', 'applications'].map((name) => [
    name, readFileSync(new URL(`../../demo/${name}.csv`, import.meta.url), 'utf8'),
  ]));
  return loadDemoData(files, timestamp);
}
