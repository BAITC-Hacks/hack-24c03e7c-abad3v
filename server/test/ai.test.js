import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_PATHS, emptyCard, getField } from '../src/card.js';
import { templateResult } from '../src/ai.js';

test('шаблон исправляет старый заголовок, показывает источники и сохраняет неизвестные сведения', () => {
  const draftText = 'Студенты не могут найти свободные аудитории. Нужен веб-прототип со списком помещений и временных слотов.';
  const task = {
    draftText, workingCard: { ...emptyCard(), title: 'Новая задача' },
    manualFields: [], questions: [], answers: [], aiResult: null,
  };
  const result = templateResult(task, 'analyze');
  assert.equal(result.proposal.title, 'Поиск свободных аудиторий');
  assert.equal(result.proposal.data.availability, null);
  assert.equal(result.proposal.success.target, null);
  assert.equal(result.proposal.constraints.deadlineDate, null);
  for (const field of CARD_PATHS.filter((path) => getField(result.proposal, path))) {
    const evidence = result.evidence.find((item) => item.field === field);
    assert.ok(evidence, `missing evidence for ${field}`);
    assert.equal(evidence.sourceId, 'draft');
    assert.ok(draftText.includes(evidence.quote), `quote for ${field} must be exact`);
  }
  task.manualFields = ['title', 'context'];
  task.workingCard.context = null;
  const protectedResult = templateResult(task, 'analyze');
  assert.equal(protectedResult.proposal.title, 'Новая задача');
  assert.equal(protectedResult.proposal.context, null);
});

test('ответы с отрицанием, пропуском и неизвестными сведениями не превращаются в придуманные факты', () => {
  const task = {
    draftText: 'Нужен помощник студентам.', workingCard: emptyCard(), manualFields: [],
    questions: [
      { id: 'data', field: 'data.availability' },
      { id: 'source', field: 'data.source' },
      { id: 'metric', field: 'success.metric' },
      { id: 'date', field: 'constraints.deadlineMode' },
    ],
    answers: [
      { questionId: 'data', value: 'Данные не доступны', skipped: false },
      { questionId: 'source', value: null, skipped: true },
      { questionId: 'metric', value: 'Пока не знаю', skipped: false },
      { questionId: 'date', value: '2026-02-31', skipped: false },
    ],
    aiResult: null,
  };
  const result = templateResult(task, 'compose');
  assert.equal(result.proposal.data.availability, 'unavailable');
  assert.equal(result.proposal.data.source, null);
  assert.equal(result.proposal.success.metric, null);
  assert.equal(result.proposal.success.target, null);
  assert.equal(result.proposal.constraints.deadlineDate, null);
  assert.ok(result.warnings.length > 0);
});

test('удалённый источник очищает прежнее предложение, сохраняя ручные поля', () => {
  const task = {
    draftText: 'Студенты не могут найти свободные аудитории. Нужен веб-прототип со списком помещений и временных слотов.',
    workingCard: emptyCard(), manualFields: [], questions: [{ id: 'metric', field: 'success.metric' }],
    answers: [{ questionId: 'metric', value: 'Из пяти студентов минимум четверо находят аудиторию без подсказки', skipped: false }],
    aiResult: null,
  };
  const first = templateResult(task, 'compose');
  task.workingCard = structuredClone(first.proposal);
  task.aiResult = first;
  task.manualFields = ['result.scope'];
  task.draftText = 'Нужен помощник студентам.';
  task.answers = [{ questionId: 'metric', value: null, skipped: true }];
  const next = templateResult(task, 'compose');
  assert.equal(next.proposal.result.artifact, null);
  assert.equal(next.proposal.success.metric, null);
  assert.equal(next.proposal.success.target, null);
  assert.equal(next.proposal.context, null);
  assert.equal(next.proposal.title, 'Помощник студентам');
  assert.equal(next.proposal.result.scope, first.proposal.result.scope);
  assert.equal(next.evidence.some((item) => item.field === 'result.scope'), false, 'manual fields must not be relabelled as AI output');
});
