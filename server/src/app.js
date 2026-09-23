import express from 'express';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { CARD_PATHS, TOPICS, LEVELS, CardError, cleanText, emptyCard, getField, setField, mergeCard, scoreCard, validatePublishable } from './card.js';
import { db, now, encode, decode, transaction, actorFromRow, taskFromRow, questionHistoryFromRow, publicTaskFromRow, taskSummaryFromRow, applicationFromRow, newTaskRow } from './db.js';
import { AI_PROMPT_VERSION, MODEL_PRICES, liveResult, prepareLiveRequest, templateResult } from './ai.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const sessions = new Map();
const aiTimes = new Map();
const allAiTimes = [];

class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const fail = (status, code, message, fields) => { throw new ApiError(status, code, message, fields); };
const wrap = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
const parse = (schema, data) => schema.parse(data);
const finiteInt = z.coerce.number().int().min(0).max(100000);
const revisionBody = z.object({ revision: z.number().int().min(1) }).strict();

function actorFor(req) {
  const token = (req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith('ai_sana_session='))?.slice('ai_sana_session='.length);
  const actorId = token ? sessions.get(token) : null;
  return actorId ? actorFromRow(db.prepare('SELECT * FROM actors WHERE id=?').get(actorId)) : null;
}

function requireActor(req, kind) {
  const actor = actorFor(req);
  if (!actor) fail(401, 'SESSION_REQUIRED', 'Выберите демо-профиль');
  if (kind && actor.kind !== kind) fail(403, 'ROLE_FORBIDDEN', 'Это действие недоступно выбранному профилю');
  return actor;
}

function getTask(id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!row) fail(404, 'TASK_NOT_FOUND', 'Задача не найдена');
  return row;
}

function ownerTask(req, id) {
  const actor = requireActor(req, 'business');
  const row = getTask(id);
  if (row.business_id !== actor.id) fail(403, 'NOT_OWNER', 'Задача принадлежит другому бизнесу');
  return row;
}

function checkRevision(row, revision) {
  if (row.revision !== revision) fail(409, 'REVISION_CONFLICT', 'Задача изменилась. Обновите её и повторите действие.');
}

function jsonFields(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail(422, 'VALIDATION_ERROR', 'Ожидается JSON-объект');
  return req.body;
}

app.get('/api/health', wrap((_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ status: 'ok', db: 'ok' });
}));

app.get('/api/demo/actors', wrap((_req, res) => {
  const items = db.prepare('SELECT * FROM actors ORDER BY kind,name').all().map(actorFromRow);
  res.json({ items });
}));

app.post('/api/demo/session', wrap((req, res) => {
  const { actorId } = parse(z.object({ actorId: z.string().min(1) }).strict(), jsonFields(req));
  const actor = actorFromRow(db.prepare('SELECT * FROM actors WHERE id=?').get(actorId));
  if (!actor) fail(404, 'ACTOR_NOT_FOUND', 'Профиль не найден');
  const token = randomBytes(32).toString('hex');
  sessions.set(token, actor.id);
  res.cookie('ai_sana_session', token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
  res.json({ actor });
}));

app.post('/api/tasks', wrap((req, res) => {
  const actor = requireActor(req, 'business');
  const body = parse(z.object({ draftText: z.string().trim().min(1).max(6000), topic: z.enum(TOPICS) }).strict(), jsonFields(req));
  const row = newTaskRow({ id: randomUUID(), businessId: actor.id, draftText: body.draftText, topic: body.topic });
  res.status(201).json({ task: taskFromRow(row) });
}));

app.get('/api/tasks', wrap((req, res) => {
  const query = parse(z.object({ scope: z.enum(['mine', 'catalog']), topic: z.enum(TOPICS).optional(), level: z.enum(LEVELS).optional(), limit: finiteInt.default(20), offset: finiteInt.default(0) }).strict(), req.query);
  if (query.limit < 1 || query.limit > 100) fail(422, 'VALIDATION_ERROR', 'limit должен быть от 1 до 100');
  if (query.scope === 'mine') {
    const actor = requireActor(req, 'business');
    const where = 'WHERE t.business_id=?';
    const total = db.prepare(`SELECT COUNT(*) AS total FROM tasks t ${where}`).get(actor.id).total;
    const rows = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM applications a WHERE a.task_id=t.id) AS application_count, (SELECT COUNT(*) FROM applications a WHERE a.task_id=t.id AND a.status='pending') AS pending_application_count FROM tasks t ${where} ORDER BY t.updated_at DESC,t.id ASC LIMIT ? OFFSET ?`).all(actor.id, query.limit, query.offset);
    return res.json({ items: rows.map((row) => taskSummaryFromRow(row, 'mine')), total });
  }
  const clauses = ["t.publication_status='published'"];
  const params = [];
  if (query.topic) { clauses.push('t.published_topic=?'); params.push(query.topic); }
  if (query.level) {
    const bounds = { needs_clarification: [0, 39], workable: [40, 69], ready: [70, 89], priority: [90, 100] }[query.level];
    clauses.push('t.published_score BETWEEN ? AND ?'); params.push(...bounds);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS total FROM tasks t ${where}`).get(...params).total;
  const rows = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM applications a WHERE a.task_id=t.id) AS application_count FROM tasks t ${where} ORDER BY t.published_score DESC,t.published_at DESC,t.id ASC LIMIT ? OFFSET ?`).all(...params, query.limit, query.offset);
  return res.json({ items: rows.map((row) => taskSummaryFromRow(row, 'catalog')), total });
}));

app.get('/api/tasks/applications', wrap((req, res) => {
  const actor = requireActor(req);
  const pagination = parse(z.object({ limit: finiteInt.default(100), offset: finiteInt.default(0) }).strict(), req.query);
  if (pagination.limit < 1 || pagination.limit > 100) fail(422, 'VALIDATION_ERROR', 'limit должен быть от 1 до 100');
  const scope = actor.kind === 'business' ? 't.business_id=?' : "a.team_id=? AND t.publication_status='published'";
  const cardColumn = actor.kind === 'business' ? 't.working_card_json' : 't.published_card_json';
  const total = db.prepare(`SELECT COUNT(*) AS total FROM applications a JOIN tasks t ON t.id=a.task_id WHERE ${scope}`).get(actor.id).total;
  const rows = db.prepare(`SELECT a.*,team.name AS team_name,${cardColumn} AS task_card_json
    FROM applications a JOIN tasks t ON t.id=a.task_id JOIN actors team ON team.id=a.team_id
    WHERE ${scope} ORDER BY a.created_at DESC,a.id ASC LIMIT ? OFFSET ?`).all(actor.id, pagination.limit, pagination.offset);
  res.json({ items: rows.map((row) => ({ ...applicationFromRow(row), taskTitle: decode(row.task_card_json)?.title ?? 'Задача без названия' })), total });
}));

app.get('/api/tasks/:id', wrap((req, res) => {
  const row = getTask(req.params.id);
  const actor = actorFor(req);
  if (actor?.kind === 'business' && actor.id === row.business_id) return res.json({ task: taskFromRow(row) });
  const task = publicTaskFromRow(row);
  if (!task) fail(404, 'TASK_NOT_FOUND', 'Задача не найдена');
  return res.json({ task });
}));

app.patch('/api/tasks/:id', wrap((req, res) => {
  const body = parse(z.object({
    revision: z.number().int().min(1),
    sourceRevision: z.number().int().min(1).optional(),
    draftText: z.string().trim().min(1).max(6000).optional(),
    topic: z.enum(TOPICS).optional(),
    cardPatch: z.record(z.string(), z.unknown()).optional(),
    manualFields: z.array(z.enum(CARD_PATHS)).max(CARD_PATHS.length).optional(),
    answers: z.array(z.object({ questionId: z.string(), value: z.string().max(2000).nullable(), skipped: z.boolean() }).strict()).optional(),
  }).strict(), jsonFields(req));
  if (body.draftText === undefined && body.topic === undefined && body.cardPatch === undefined && body.answers === undefined && body.manualFields === undefined) fail(422, 'VALIDATION_ERROR', 'Укажите изменения');
  const row = ownerTask(req, req.params.id);
  checkRevision(row, body.revision);
  if (body.sourceRevision !== undefined) {
    checkRevision(row, body.sourceRevision);
    if (!body.cardPatch || body.draftText !== undefined || body.topic !== undefined || body.answers !== undefined) {
      fail(422, 'VALIDATION_ERROR', 'Применяйте предложение отдельно: revision, sourceRevision и cardPatch');
    }
  }
  const currentCard = decode(row.working_card_json);
  const protectedFields = new Set(body.manualFields ?? taskFromRow(row).manualFields);
  const card = body.cardPatch ? mergeCard(currentCard, body.cardPatch) : currentCard;
  if (body.sourceRevision !== undefined) {
    for (const path of CARD_PATHS) {
      if (protectedFields.has(path) || getField(currentCard, path) !== null) setField(card, path, getField(currentCard, path));
    }
  }
  // Legacy clients do not distinguish accepted suggestions from manual edits.
  // The new editor always sends the explicit manualFields list, including [].
  if (body.manualFields === undefined) {
    for (const path of CARD_PATHS) {
      if (getField(card, path) !== getField(currentCard, path)) protectedFields.add(path);
    }
  }
  const knownQuestions = questionHistoryFromRow(row);
  const incomingAnswers = body.answers?.map((answer) => {
    if (answer.skipped && answer.value) fail(422, 'VALIDATION_ERROR', 'Пропущенный вопрос не должен содержать ответ');
    if (!knownQuestions.some((q) => q.id === answer.questionId)) fail(422, 'VALIDATION_ERROR', 'Неизвестный вопрос');
    return { questionId: answer.questionId, value: answer.skipped ? null : cleanText(answer.value, 2000), skipped: answer.skipped };
  });
  if (incomingAnswers && new Set(incomingAnswers.map((answer) => answer.questionId)).size !== incomingAnswers.length) fail(422, 'VALIDATION_ERROR', 'Повторяющийся вопрос');
  const answersById = new Map(decode(row.answers_json).map((answer) => [answer.questionId, answer]));
  for (const answer of incomingAnswers ?? []) {
    answersById.delete(answer.questionId);
    answersById.set(answer.questionId, answer);
  }
  const answers = [...answersById.values()];
  const timestamp = now();
  db.prepare(`UPDATE tasks SET draft_text=?,topic=?,working_card_json=?,answers_json=?,manual_fields_json=?,protected_fields_json=?,revision=revision+1,updated_at=? WHERE id=?`)
    .run(body.draftText ?? row.draft_text, body.topic ?? row.topic, encode(card), encode(answers), encode([...protectedFields]), encode([...protectedFields]), timestamp, row.id);
  const next = getTask(row.id);
  res.json({ task: taskFromRow(next), previewRating: scoreCard(card) });
}));

app.post('/api/tasks/:id/confirm', wrap((req, res) => {
  const body = parse(revisionBody.extend({ confirmed: z.literal(true) }), jsonFields(req));
  const row = ownerTask(req, req.params.id);
  checkRevision(row, body.revision);
  const card = decode(row.working_card_json);
  const rating = scoreCard(card);
  transaction(() => {
    db.prepare(`UPDATE tasks SET confirmed_card_json=?,confirmed_topic=?,confirmed_revision=?,score=?,score_breakdown_json=?,score_missing_fields_json=?,scoring_version=?,updated_at=? WHERE id=?`)
      .run(encode(card), row.topic, row.revision, rating.score, encode(rating.breakdown), encode(rating.missingFields), rating.scoringVersion, now(), row.id);
  });
  res.json({ task: taskFromRow(getTask(row.id)), rating });
}));

app.post('/api/tasks/:id/publish', wrap((req, res) => {
  const { revision } = parse(revisionBody, jsonFields(req));
  const row = ownerTask(req, req.params.id);
  checkRevision(row, revision);
  if (row.confirmed_revision !== row.revision || !row.confirmed_card_json) fail(409, 'NOT_CONFIRMED', 'Подтвердите текущую версию карточки');
  validatePublishable(decode(row.confirmed_card_json));
  if (row.published_revision !== row.revision) {
    const timestamp = now();
    db.prepare("UPDATE tasks SET publication_status='published',published_card_json=?,published_topic=?,published_revision=?,published_rating_json=?,published_score=?,published_at=?,updated_at=? WHERE id=?")
      .run(row.confirmed_card_json, row.confirmed_topic, row.confirmed_revision, encode(taskFromRow(row).rating), row.score, timestamp, timestamp, row.id);
  }
  res.json({ task: taskFromRow(getTask(row.id)) });
}));

function limitAi(actorId) {
  const timestamp = Date.now();
  const recent = (aiTimes.get(actorId) || []).filter((time) => timestamp - time < 60000);
  while (allAiTimes.length && timestamp - allAiTimes[0] >= 60000) allAiTimes.shift();
  if (recent.length >= 3 || allAiTimes.length >= 20) fail(429, 'AI_RATE_LIMIT', 'Слишком много AI-запросов. Повторите через минуту.');
  recent.push(timestamp);
  aiTimes.set(actorId, recent);
  allAiTimes.push(timestamp);
}

export function analysisHash(task, mode) {
  const answerQuestions = task.questionHistory.filter((question) => task.answers.some((answer) => answer.questionId === question.id));
  const protectedFields = [...new Set([...(task.manualFields ?? []), ...(task.protectedFields ?? [])])];
  return createHash('sha256').update(encode({ promptVersion: AI_PROMPT_VERSION, model: process.env.OPENAI_MODEL || 'gpt-6-sol', mode, revision: task.revision, draftText: task.draftText, topic: task.topic, card: task.workingCard, protectedFields, answers: task.answers, answerQuestions, ...(mode === 'compose' ? { questions: task.questions } : {}) })).digest('hex');
}

app.post('/api/tasks/:id/analyze', wrap(async (req, res) => {
  const actor = requireActor(req, 'business');
  const body = parse(revisionBody.extend({ mode: z.enum(['analyze', 'compose']) }), jsonFields(req));
  const row = ownerTask(req, req.params.id);
  checkRevision(row, body.revision);
  const task = { ...taskFromRow(row), protectedFields: decode(row.protected_fields_json) };
  const hash = analysisHash(task, body.mode);
  const cache = decode(row.analysis_cache_json);
  const candidate = cache[body.mode]?.hash === hash ? cache[body.mode] : null;
  const cached = candidate && (process.env.AI_MODE !== 'template' || candidate.originMode === 'template') ? candidate : null;
  let mode = 'template';
  let result;
  let generatedAt;
  const fallbackWarnings = [];
  if (cached) {
    result = cached.result;
    generatedAt = cached.generatedAt;
    mode = cached.originMode === 'template' ? 'template' : 'cached';
  } else {
    if (process.env.AI_MODE !== 'template' && process.env.OPENAI_API_KEY) {
      limitAi(actor.id);
      let prepared;
      try {
        prepared = prepareLiveRequest(task, body.mode);
      } catch (error) {
        if (error.code !== 'AI_INPUT_TOO_LONG') throw error;
        fallbackWarnings.push('Материалов слишком много для одного AI-запроса. Использован шаблонный режим; сохранённый текст и ответы не сокращены.');
      }
      const total = db.prepare("SELECT COALESCE(SUM(COALESCE(actual_usd,reserved_usd)),0) AS usd FROM ai_usage WHERE provider='openai'").get().usd;
      const cap = Number(process.env.AI_BUDGET_CAP_USD || 15);
      const model = process.env.OPENAI_MODEL || 'gpt-6-sol';
      const price = MODEL_PRICES[model];
      const reserve = price && prepared ? (prepared.inputTokenUpperBound * price.input + prepared.maxOutputTokens * price.output) / 1000000 : Infinity;
      if (prepared && Number.isFinite(cap) && total + reserve <= cap) {
        const id = randomUUID();
        const started = Date.now();
        db.prepare('INSERT INTO ai_usage (id,task_id,provider,model,reserved_usd,duration_ms,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, row.id, 'openai', model, reserve, 0, 'reserved', now());
        try {
          const response = await liveResult(task, body.mode, { prepared });
          result = response.result;
          mode = 'live';
          const inputTokens = response.usage.inputTokens;
          const outputTokens = response.usage.outputTokens;
          const actual = inputTokens === null || outputTokens === null ? null : (inputTokens * price.input + outputTokens * price.output) / 1000000;
          db.prepare('UPDATE ai_usage SET request_id=?,input_tokens=?,output_tokens=?,actual_usd=?,duration_ms=?,status=? WHERE id=?')
            .run(response.usage.requestId, inputTokens, outputTokens, actual, response.usage.durationMs, actual === null ? 'unknown' : 'success', id);
        } catch (error) {
          db.prepare('UPDATE ai_usage SET duration_ms=?,status=? WHERE id=?').run(Date.now() - started, 'unknown', id);
          fallbackWarnings.push('AI не вернул подходящий результат. Использован шаблонный режим; проверьте предложенные поля.');
          console.warn('AI fallback:', error?.constructor?.name || 'Error');
        }
      } else if (prepared) {
        fallbackWarnings.push('AI-запрос недоступен при текущих настройках модели или лимите бюджета. Использован шаблонный режим.');
      }
    }
  }
  if (!result) result = templateResult(task, body.mode);
  generatedAt ??= now();
  const latest = getTask(row.id);
  if (latest.revision !== row.revision) fail(409, 'REVISION_CONFLICT', 'Задача изменилась во время AI-запроса');
  const history = questionHistoryFromRow(latest);
  const questions = body.mode === 'analyze' ? result.questions.map((q) => {
    const existing = history.find((item) => item.field === q.field && item.text === q.text) ?? history.find((item) => item.field === q.field);
    const question = { ...q, id: existing?.id ?? (mode === 'cached' ? q.id : `q:${q.field}`), sourceRevision: existing?.sourceRevision ?? row.revision };
    const index = history.findIndex((item) => item.id === question.id);
    if (index < 0) history.push(question);
    else history[index] = question;
    return question;
  }) : task.questions;
  const payload = { questions, proposal: result.proposal, warnings: [...result.warnings, ...fallbackWarnings], evidence: result.evidence };
  const lastAnalysis = { ...payload, operation: body.mode, sourceRevision: row.revision, generatedAt, mode: mode === 'cached' ? 'live' : mode };
  transaction(() => {
    if (body.mode === 'analyze') db.prepare('UPDATE tasks SET questions_json=?,question_history_json=? WHERE id=?').run(encode(history), encode(history), row.id);
    if (mode !== 'cached') {
      const latestCache = decode(latest.analysis_cache_json);
      latestCache[body.mode] = { hash, result: payload, generatedAt, originMode: mode };
      db.prepare('UPDATE tasks SET analysis_cache_json=? WHERE id=?').run(encode(latestCache), row.id);
    }
    db.prepare('UPDATE tasks SET last_analysis_json=?,ai_result_json=? WHERE id=?').run(encode(lastAnalysis), encode(lastAnalysis), row.id);
  });
  res.json({ ...lastAnalysis, stale: false, mode });
}));

const applicationBody = z.object({
  idea: z.string().trim().min(2).max(2000),
  plan: z.string().trim().min(2).max(2000),
  timeline: z.string().trim().min(2).max(200),
  prototypeUrl: z.url().max(2048).refine((url) => /^https?:\/\//i.test(url), 'Нужна ссылка http/https'),
  clientRequestId: z.string().min(8).max(100),
}).strict();

app.post('/api/tasks/:id/applications', wrap((req, res) => {
  const actor = requireActor(req, 'team');
  const body = parse(applicationBody, jsonFields(req));
  const row = getTask(req.params.id);
  if (row.publication_status !== 'published') fail(404, 'TASK_NOT_FOUND', 'Задача не опубликована');
  const prior = db.prepare('SELECT a.*,team.name AS team_name FROM applications a JOIN actors team ON team.id=a.team_id WHERE a.team_id=? AND a.client_request_id=?').get(actor.id, body.clientRequestId);
  if (prior) {
    const same = prior.task_id === row.id && prior.idea === body.idea && prior.plan === body.plan && prior.timeline === body.timeline && prior.prototype_url === body.prototypeUrl;
    if (!same) fail(409, 'REQUEST_ID_REUSED', 'Этот ID уже использован для другого предложения');
    return res.json({ application: applicationFromRow(prior) });
  }
  const id = randomUUID();
  db.prepare('INSERT INTO applications (id,task_id,team_id,idea,plan,timeline,prototype_url,client_request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, row.id, actor.id, body.idea, body.plan, body.timeline, body.prototypeUrl, body.clientRequestId, now());
  const saved = db.prepare('SELECT a.*,team.name AS team_name FROM applications a JOIN actors team ON team.id=a.team_id WHERE a.id=?').get(id);
  res.status(201).json({ application: applicationFromRow(saved) });
}));

app.get('/api/tasks/:id/applications', wrap((req, res) => {
  const actor = requireActor(req);
  const task = getTask(req.params.id);
  const pagination = parse(z.object({ limit: finiteInt.default(20), offset: finiteInt.default(0) }).strict(), req.query);
  if (pagination.limit < 1 || pagination.limit > 100) fail(422, 'VALIDATION_ERROR', 'limit должен быть от 1 до 100');
  if (actor.kind === 'business' && actor.id !== task.business_id) fail(403, 'NOT_OWNER', 'Отклики доступны владельцу задачи');
  if (actor.kind === 'team' && task.publication_status !== 'published') fail(404, 'TASK_NOT_FOUND', 'Задача не опубликована');
  const scope = actor.kind === 'team' ? 'a.task_id=? AND a.team_id=?' : 'a.task_id=?';
  const args = actor.kind === 'team' ? [task.id, actor.id] : [task.id];
  const total = db.prepare(`SELECT COUNT(*) AS total FROM applications a WHERE ${scope}`).get(...args).total;
  const rows = db.prepare(`SELECT a.*,team.name AS team_name FROM applications a JOIN actors team ON team.id=a.team_id WHERE ${scope} ORDER BY a.created_at DESC,a.id ASC LIMIT ? OFFSET ?`).all(...args, pagination.limit, pagination.offset);
  res.json({ items: rows.map(applicationFromRow), total });
}));

app.patch('/api/applications/:id', wrap((req, res) => {
  const actor = requireActor(req, 'business');
  const { status } = parse(z.object({ status: z.enum(['selected', 'rejected']) }).strict(), jsonFields(req));
  const row = db.prepare('SELECT a.*,t.business_id FROM applications a JOIN tasks t ON t.id=a.task_id WHERE a.id=?').get(req.params.id);
  if (!row) fail(404, 'APPLICATION_NOT_FOUND', 'Отклик не найден');
  if (row.business_id !== actor.id) fail(403, 'NOT_OWNER', 'Отклик принадлежит другой задаче');
  if (row.status !== status) db.prepare('UPDATE applications SET status=?,decided_at=? WHERE id=?').run(status, now(), row.id);
  const saved = db.prepare('SELECT a.*,team.name AS team_name FROM applications a JOIN actors team ON team.id=a.team_id WHERE a.id=?').get(row.id);
  res.json({ application: applicationFromRow(saved) });
}));

const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(resolve(clientDist, 'index.html'));
  });
}

app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API-маршрут не найден' } }));
app.use((error, _req, res, _next) => {
  if (error instanceof ZodError || error instanceof CardError) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: error instanceof CardError ? error.message : 'Проверьте поля запроса', fields: error instanceof ZodError ? z.flattenError(error).fieldErrors : {} } });
  if (error instanceof ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON' } });
  console.error('API error:', error?.constructor?.name || 'Error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' } });
});
