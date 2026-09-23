import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import OpenAI from 'openai';
import { cases } from './cases.js';
import { AI_PROMPT_VERSION, AI_TIMEOUT_MS, MODEL_PRICES, liveResult, prepareLiveRequest } from '../src/ai.js';
import { getField } from '../src/card.js';

const args = process.argv.slice(2);
const value = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const selected = cases.filter((item) => !value('case', '') || value('case', '').split(',').includes(item.id));
if (!selected.length) throw new Error('No matching cases');
if (!args.includes('--live')) {
  console.log(JSON.stringify({ notice: 'Dry run. Add --live to make paid API requests using server/.env. No template fallback is counted as a live success.', cases: selected.map(({ id, mode, review }) => ({ id, mode, review })) }, null, 2));
  process.exit(0);
}

// Import only after explicit --live: reuse the app's env loading and global spend ledger.
const { db } = await import('../src/db.js');
const model = process.env.OPENAI_MODEL || 'gpt-6-sol';
const price = MODEL_PRICES[model];
const runCap = Number(value('budget', '0.50'));
const globalCap = Number(process.env.AI_BUDGET_CAP_USD || 15);
if (!process.env.OPENAI_API_KEY || !price || process.env.AI_MODE === 'template') throw new Error('A key, a budgeted model and live AI mode are required');
if (![runCap, globalCap].every((cap) => Number.isFinite(cap) && cap > 0)) throw new Error('Budget caps must be positive finite numbers');
const output = resolve(value('out', `server/data/evals/${new Date().toISOString().replaceAll(':', '-')}.json`));
mkdirSync(dirname(output), { recursive: true });
let codeRevision = null;
try { codeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Running outside a Git checkout is supported. */ }
const report = { startedAt: new Date().toISOString(), codeRevision, promptVersion: AI_PROMPT_VERSION, model, reasoningEffort: 'none', timeoutMs: AI_TIMEOUT_MS, maxRetries: 0, runCapUsd: runCap, estimatedUsd: 0, synthetic: true, results: [] };
const save = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
let recentStarts = [];
let providerFailures = 0;

for (const item of selected) {
  const prepared = prepareLiveRequest(item.task, item.mode);
  const reserve = (prepared.inputTokenUpperBound * price.input + prepared.maxOutputTokens * price.output) / 1e6;
  // This runner serializes its reservations and includes application spending.
  // The application has a separate reservation path; do not run paid sessions concurrently.
  const usageId = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  const total = db.prepare("SELECT COALESCE(SUM(COALESCE(actual_usd,reserved_usd)),0) AS usd FROM ai_usage WHERE provider='openai'").get().usd;
  if (total + reserve > globalCap || report.estimatedUsd + reserve > runCap) {
    db.exec('ROLLBACK');
    report.stopped = 'Budget cap';
    break;
  }
  db.prepare('INSERT INTO ai_usage (id,task_id,provider,model,reserved_usd,duration_ms,status,created_at) VALUES (?,NULL,?,?,?,?,?,?)')
    .run(usageId, 'openai', model, reserve, 0, 'reserved', new Date().toISOString());
  db.exec('COMMIT');
  // Keep this diagnostic at the app's per-actor rate: at most three starts/minute.
  recentStarts = recentStarts.filter((time) => Date.now() - time < 60000);
  if (recentStarts.length >= 3) {
    const wait = Math.max(0, 60050 - (Date.now() - recentStarts[0]));
    console.log(`Pacing requests: ${Math.ceil(wait / 1000)}s`);
    await delay(wait);
  }
  recentStarts.push(Date.now());
  const started = Date.now();
  let raw;
  const entry = { id: item.id, mode: item.mode, input: item.task, review: item.review, sources: JSON.parse(prepared.input[1].content).sources };
  try {
    const response = await liveResult(item.task, item.mode, { prepared, client: { responses: { create: async (request) => {
      report.requestContract ??= { systemPrompt: request.input[0].content, format: request.text.format };
      raw = await client.responses.create(request);
      return raw;
    } } } });
    entry.status = 'live';
    entry.result = response.result;
    entry.checks = [
      { rule: 'title-present', pass: Boolean(response.result.proposal.title?.trim()) },
      ...(item.mode === 'analyze' ? [{ rule: 'three-to-five-distinct-questions', pass: response.result.questions.length >= 3 && response.result.questions.length <= 5 && new Set(response.result.questions.map(({ field }) => field)).size === response.result.questions.length }] : []),
      ...(item.requiredFields ?? []).map((field) => ({ rule: 'known-field-present', field, pass: Boolean(getField(response.result.proposal, field)?.trim()) })),
      ...Object.entries(item.expected ?? {}).map(([field, expected]) => ({ rule: 'exact', field, pass: getField(response.result.proposal, field) === expected, expected, actual: getField(response.result.proposal, field) })),
      ...Object.entries(item.allowed ?? {}).map(([field, allowed]) => ({ rule: 'allowed', field, pass: allowed.includes(getField(response.result.proposal, field)), expected: allowed, actual: getField(response.result.proposal, field) })),
      ...(item.nullFields ?? []).map((field) => ({ rule: 'unknown-stays-null', field, pass: getField(response.result.proposal, field) === null, actual: getField(response.result.proposal, field) })),
      ...(item.warningRequired ? [{ rule: 'contradiction-warning', pass: response.result.warnings.length > 0 }] : []),
    ];
  } catch (error) {
    entry.status = raw ? 'rejected-output' : 'provider-error';
    entry.wouldUseTemplateFallback = true;
    entry.error = { name: error.name, status: error.status ?? null, code: error.code ?? null,
      message: String(error.message).replaceAll(process.env.OPENAI_API_KEY, '[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1000) };
    if (!raw) providerFailures++;
  }
  const inputTokens = raw?.usage?.input_tokens ?? null;
  const outputTokens = raw?.usage?.output_tokens ?? null;
  const actual = inputTokens === null || outputTokens === null ? null : (inputTokens * price.input + outputTokens * price.output) / 1e6;
  entry.durationMs = Date.now() - started;
  entry.usage = { inputTokens, outputTokens, estimatedUsd: actual ?? reserve, conservativeReservation: actual === null };
  if (raw) {
    entry.providerStatus = raw.status;
    entry.incompleteDetails = raw.incomplete_details;
    try { entry.rawModelOutput = JSON.parse(raw.output_text); } catch { entry.rawModelOutput = raw.output_text; }
  }
  db.prepare('UPDATE ai_usage SET request_id=?,input_tokens=?,output_tokens=?,actual_usd=?,duration_ms=?,status=? WHERE id=?')
    .run(raw?.id ?? null, inputTokens, outputTokens, actual, entry.durationMs, actual === null ? 'unknown' : 'success', usageId);
  report.estimatedUsd += actual ?? reserve;
  report.results.push(entry);
  save();
  console.log(JSON.stringify({ case: item.id, status: entry.status, ms: entry.durationMs, failedChecks: entry.checks?.filter((check) => !check.pass), error: entry.error, estimatedUsd: entry.usage.estimatedUsd }));
  if (providerFailures >= 2 || [400, 401, 403, 404, 429].includes(entry.error?.status)) {
    report.stopped = 'Provider/configuration failures; inspect before spending more';
    break;
  }
}
report.completedAt = new Date().toISOString();
save();
db.close();
console.log(`Saved ${report.results.length}/${selected.length} cases to ${output}; estimated/reserved $${report.estimatedUsd.toFixed(6)}`);
if (report.stopped || report.results.some((entry) => entry.status !== 'live' || entry.checks?.some((check) => !check.pass))) process.exitCode = 1;
