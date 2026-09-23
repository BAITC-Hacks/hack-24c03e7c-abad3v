import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from './api'
import type { AiResult, Card, OwnerTask, Question, Topic } from './types'
import { Badge, EmptyState, Icon, PrimaryButton, SecondaryButton, topicOptions } from './ui'
import { answerIntoCard, evidenceFor, fieldLabel, formFromTask, getField, mergeProposal, readLocal, rebaseForm, setField, signature, writeLocal, type EditorForm } from './editorModel'
import './editor.css'

type Props = { taskId: string | null; actorId: string; step: string; registerSave: (save: (() => Promise<boolean>) | null) => void; onStep: (step: string) => void; onCreated: (id: string) => void; onBack: () => void; onSaved: () => void; onApplications: (id: string) => void; showToast: (message: string) => void }
type Recovery = { revision: number; form: EditorForm; base: EditorForm }
const options: Record<string, { value: string; label: string }[]> = {
  'data.availability': [{ value: 'available', label: 'Данные уже есть' }, { value: 'planned', label: 'Планируем получить' }, { value: 'unavailable', label: 'Данных нет' }],
  'constraints.deadlineMode': [{ value: 'flexible', label: 'Гибкий срок' }, { value: 'fixed', label: 'К определённой дате' }],
}
const displayValue = (path: string, value: string | null) => options[path]?.find(item => item.value === value)?.label || value

function Steps({ current }: { current: number }) {
  return <ol className="creation-steps" aria-label="Этапы создания">{['Описание', 'Уточнение', 'Проверка', 'Публикация'].map((label, index) => <li key={label} className={current === index ? 'current' : current > index ? 'complete' : ''} aria-current={current === index ? 'step' : undefined}><span>{current > index ? <Icon name="check" size={15} /> : `0${index + 1}`}</span>{label}</li>)}</ol>
}

function NewTask({ actorId, onCreated, onBack, registerSave, showToast }: Pick<Props, 'actorId' | 'onCreated' | 'onBack' | 'registerSave' | 'showToast'>) {
  const key = `ai-sana:new:${actorId}`
  const [input, setInput] = useState(() => readLocal<{ text: string; topic: Topic }>(key) || { text: '', topic: 'education' as Topic })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const creating = useRef(false), mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    registerSave(async () => { if (creating.current) { showToast('Дождитесь создания черновика.'); return false }; return true })
    return () => registerSave(null)
  }, [registerSave, showToast])
  useEffect(() => { writeLocal(key, input) }, [input, key])
  async function create() {
    if (creating.current || input.text.trim().length < 12) return
    creating.current = true; setBusy(true); setError('')
    try { const { task } = await api.createTask(input.text.trim(), input.topic); writeLocal(key, null); creating.current = false; if (mounted.current) onCreated(task.id) }
    catch (exception) { if (mounted.current) { setError(errorMessage(exception)); setBusy(false) } }
    finally { creating.current = false }
  }
  return <div className="page-content creation-page"><button className="back-link" onClick={onBack}>← Все задачи</button><Steps current={0} /><div className="creation-intro"><h1>Новая задача</h1><p>Опишите проблему. AI превратит ваш текст в задание для студенческой команды.</p></div><section className="description-surface"><label htmlFor="new-description">Какую задачу хотите передать студенческой команде?</label><textarea id="new-description" disabled={busy} autoFocus className="textarea" maxLength={6000} value={input.text} onChange={event => setInput({ ...input, text: event.target.value })} placeholder="Например: студенты долго ищут свободную аудиторию. Хотим веб-прототип со списком помещений и свободных временных слотов…" /><div className="description-meta"><span>{input.text ? 'Ввод сохранён в этом браузере' : 'Достаточно нескольких предложений'}</span><span>{input.text.length} / 6000</span></div><label className="field-label" htmlFor="new-topic">Тема</label><select id="new-topic" disabled={busy} className="select-control" value={input.topic} onChange={event => setInput({ ...input, topic: event.target.value as Topic })}>{topicOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{error && <div className="editor-error" role="alert">{error}</div>}<div className="description-actions"><span><Icon name="sparkle" /> Карточка и вопросы появятся на следующем шаге</span><PrimaryButton disabled={busy || input.text.trim().length < 12} onClick={() => void create()} icon="arrow">{busy ? 'Создаём черновик…' : 'Подготовить задание'}</PrimaryButton></div></section><div className="creation-promise"><Icon name="check" size={17} /><span>Вы проверите и подтвердите сведения перед публикацией.</span></div></div>
}

export function TaskEditor(props: Props) {
  return props.taskId ? <SavedTaskEditor {...props} taskId={props.taskId} /> : <NewTask {...props} />
}

function SavedTaskEditor({ taskId, actorId, step, registerSave, onStep, onBack, onSaved, onApplications, showToast }: Props & { taskId: string }) {
  const [task, setTask] = useState<OwnerTask | null>(null)
  const [form, setForm] = useState<EditorForm | null>(null)
  const [ai, setAi] = useState<AiResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<OwnerTask | null>(null)
  const [checked, setChecked] = useState(false)
  const [changed, setChanged] = useState<string[]>([])
  const [beforeAi, setBeforeAi] = useState<Card | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [activeQuestion, setActiveQuestion] = useState(0)
  const publishing = useRef(false)
  const current = useRef<EditorForm | null>(null), saved = useRef<EditorForm | null>(null), latest = useRef<OwnerTask | null>(null)
  const saving = useRef<Promise<OwnerTask | null> | null>(null), conflictRef = useRef<OwnerTask | null>(null), mounted = useRef(true), aiRunning = useRef(false)
  const storageKey = `ai-sana:editor:${actorId}:${taskId}`
  const review = step === 'review' || (!step && task?.publicationStatus === 'published')

  function remember(next: EditorForm) { writeLocal(storageKey, { revision: latest.current?.revision, form: next, base: saved.current || next }) }
  function update(next: EditorForm) {
    current.current = next; setForm(next); remember(next); setChecked(false)
    setSaveState(saved.current && signature(next) === signature(saved.current) ? 'saved' : 'pending')
  }
  function acceptTask(next: OwnerTask) { latest.current = next; if (mounted.current) setTask(next) }
  async function handleFailure(exception: unknown) {
    setError(errorMessage(exception))
    if ((exception as { status?: number })?.status === 409) {
      try { const response = await api.getTask(taskId); if ('workingCard' in response.task) { conflictRef.current = response.task; setConflict(response.task) } }
      catch { /* The local draft remains available for a retry. */ }
    }
  }

  async function persist(): Promise<OwnerTask | null> {
    if (conflictRef.current) return null
    if (saving.current) { await saving.current; return persist() }
    if (!latest.current || !current.current || !saved.current) return null
    if (signature(current.current) === signature(saved.current)) return latest.current
    const promise = (async () => {
      try {
        if (mounted.current) { setSaveState('saving'); setError('') }
        // Serialize saves and capture each submitted version; typing during a request stays local.
        while (current.current && saved.current && signature(current.current) !== signature(saved.current)) {
          const snapshot = structuredClone(current.current)
          const response = await api.patchTask(taskId, { revision: latest.current!.revision, draftText: snapshot.draftText, topic: snapshot.topic, cardPatch: snapshot.card, answers: snapshot.answers, manualFields: snapshot.manualFields })
          acceptTask({ ...response.task, previewRating: response.previewRating }); saved.current = snapshot
          if (current.current) remember(current.current)
        }
        writeLocal(storageKey, null)
        if (mounted.current) { setSaveState('saved'); onSaved() }
        return latest.current
      } catch (exception) {
        if ((exception as { status?: number }).status === 409) {
          try {
            const response = await api.getTask(taskId)
            if ('workingCard' in response.task) { conflictRef.current = response.task; if (mounted.current) setConflict(response.task) }
          } catch { /* Keep the local recovery copy if reloading also fails. */ }
        }
        if (mounted.current) { setSaveState('error'); setError(errorMessage(exception)) }
        return null
      }
    })()
    saving.current = promise
    try { return await promise } finally { saving.current = null }
  }

  async function runAi(mode: 'analyze' | 'compose', moveToReview = false) {
    if (aiRunning.current || conflictRef.current) return
    aiRunning.current = true; setBusy(true); setError('')
    try {
      const base = await persist()
      if (!base || !current.current) return
      const baseCard = structuredClone(current.current.card)
      const result = await api.analyze(taskId, base.revision, mode)
      if (!mounted.current) return
      const response = await api.getTask(taskId)
      if (!('workingCard' in response.task)) throw new Error('Карточка недоступна для редактирования')
      if (response.task.revision !== base.revision) {
        conflictRef.current = response.task; setConflict(response.task)
        throw new Error('Задача изменилась во время анализа. Ваш ввод сохранён; выберите, как объединить изменения.')
      }
      acceptTask(response.task); setAi(result); setBeforeAi(baseCard)
      const merged = mergeProposal(current.current, result, baseCard)
      setChanged(merged.changed); update(merged.form)
      await persist()
      if (moveToReview && !conflictRef.current) onStep('review')
    } catch (exception) { await handleFailure(exception) }
    finally { aiRunning.current = false; if (mounted.current) setBusy(false) }
  }

  useEffect(() => {
    mounted.current = true
    registerSave(async () => { if (aiRunning.current || publishing.current) { showToast('Дождитесь завершения текущего действия.'); return false }; return !latest.current || !!(await persist()) })
    let cancelled = false
    void (async () => {
      try {
        const response = await api.getTask(taskId)
        if (cancelled) return
        if (!('workingCard' in response.task)) throw new Error('У выбранного профиля нет доступа к редактору этой задачи.')
        const next = response.task, serverForm = formFromTask(next)
        const recovery = readLocal<Recovery>(storageKey)
        acceptTask(next); saved.current = serverForm; setAi(next.aiResult || null)
        if (recovery?.form?.card && recovery.form.draftText && signature(recovery.form) !== signature(serverForm)) {
          current.current = recovery.form; setForm(recovery.form); setSaveState('pending')
          if (recovery.revision !== next.revision) { saved.current = recovery.base || serverForm; conflictRef.current = next; setConflict(next) }
        } else {
          const restored = next.aiResult?.sourceRevision === next.revision ? mergeProposal(serverForm, next.aiResult).form : serverForm
          current.current = restored; setForm(restored)
          if (signature(restored) !== signature(serverForm)) { setSaveState('pending'); remember(restored) }
        }
        setLoading(false)
        if (!next.aiResult && !next.workingCard.title && !conflictRef.current) void runAi('analyze')
      } catch (exception) { if (!cancelled) { setError(errorMessage(exception)); setLoading(false) } }
    })()
    return () => { cancelled = true; mounted.current = false; registerSave(null) }
  }, [taskId])

  useEffect(() => {
    if (!form || loading || busy || conflict || saveState === 'error') return
    const timer = setTimeout(() => void persist(), 800)
    return () => clearTimeout(timer)
  }, [form, loading, busy, conflict])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (current.current && saved.current && signature(current.current) !== signature(saved.current)) event.preventDefault() }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [])

  function editField(path: string, value: string | null) {
    if (!current.current) return
    let card = setField(current.current.card, path, value)
    const manualFields = [...new Set([...current.current.manualFields, path])]
    if (path === 'constraints.deadlineMode' && value !== 'fixed') { card = setField(card, 'constraints.deadlineDate', null); manualFields.push('constraints.deadlineDate') }
    update({ ...current.current, card, manualFields })
  }
  function answer(question: Question, value: string | null, skipped = false) {
    if (!current.current) return
    let next = { ...current.current, answers: [...current.current.answers.filter(item => item.questionId !== question.id), { questionId: question.id, value: skipped ? null : value, skipped }] }
    next = answerIntoCard(next, question.field, skipped ? null : value)
    if (question.field === 'success.metric' && !next.manualFields.includes('success.target') && value && /\d|минимум|хотя бы|не менее|четверо|пятеро/i.test(value)) next = answerIntoCard(next, 'success.target', value)
    update(next); setChanged([question.field, ...(question.field === 'success.metric' ? ['success.target'] : [])])
  }
  async function resolveConflict(keepLocal: boolean) {
    if (!conflict || !current.current || !saved.current) return
    const serverForm = formFromTask(conflict)
    const next = keepLocal ? rebaseForm(current.current, saved.current, serverForm) : serverForm
    acceptTask(conflict); saved.current = serverForm; conflictRef.current = null; setConflict(null); setError(''); update(next)
    await persist()
  }
  async function publish() {
    if (!checked || busy) return
    publishing.current = true; setBusy(true); setError('')
    try {
      const next = await persist()
      if (!next) return
      const confirmed = await api.confirm(taskId, next.revision)
      acceptTask(confirmed.task)
      const published = await api.publish(taskId, confirmed.task.revision)
      acceptTask(published.task); onSaved(); onStep('published'); showToast('Карточка опубликована. Команды могут отправлять отклики.')
    } catch (exception) { await handleFailure(exception) }
    finally { publishing.current = false; setBusy(false) }
  }

  if (loading) return <div className="page-content"><EmptyState icon="clock" title="Открываем черновик" text="Восстанавливаем карточку и ваши ответы." /></div>
  if (!task || !form) return <div className="page-content"><EmptyState icon="file" title="Не удалось открыть задачу" text={error} action={<SecondaryButton onClick={onBack}>К моим задачам</SecondaryButton>} /></div>
  const dirty = saveState !== 'saved'
  const published = task.publicationStatus === 'published'
  const unpublished = published && (task.hasUnpublishedChanges || task.publishedRevision !== task.revision || dirty)
  const done = step === 'published' && published && !unpublished
  const questions = (ai?.questions?.length ? ai.questions : task.questions).slice(-5)
  const rating = task.previewRating
  const count = questions.filter(q => form.answers.some(a => a.questionId === q.id && (a.value || a.skipped))).length
  const statusText = { saved: 'Все изменения сохранены', pending: 'Есть изменения · сохраняем…', saving: 'Сохраняем…', error: 'Не удалось сохранить' }[saveState]

  return <div className="page-content creation-page">
    <div className="editor-topline"><button className="back-link" onClick={async () => { if (await persist()) onBack() }}>← Все задачи</button><span className={`save-state save-${saveState}`} role="status"><Icon name={saveState === 'saved' ? 'check' : 'clock'} size={15} />{statusText}</span></div>
    <div className="editor-title"><div><h1>{done ? 'Задача опубликована' : review ? 'Проверка и публикация' : 'Уточните несколько деталей'}</h1><p>{done ? 'Команды уже могут предложить свои решения.' : review ? 'Прочитайте задание, внесите правки и подтвердите сведения.' : 'AI подготовил основу задания. Ваши ответы дополнят её.'}</p></div><Badge tone={published ? 'blue' : 'neutral'}>{published ? 'Опубликована' : 'Черновик'}</Badge></div>
    <Steps current={done ? 3 : review ? 2 : 1} />
    {unpublished && <div className="unpublished-note"><Icon name="file" /><div><strong>Есть неопубликованные изменения</strong><p>Команды видят последнюю опубликованную карточку. Обновите её после проверки.</p></div>{!review && <SecondaryButton onClick={() => onStep('review')}>Проверить изменения</SecondaryButton>}</div>}
    {error && <div className="editor-error" role="alert"><span>{error}</span>{!conflict && <button className="text-button" onClick={() => void persist()}>Повторить сохранение</button>}</div>}
    {conflict && <section className="conflict-box" role="alert"><h3>Задача изменена в другом окне</h3><p>Ваш ввод сохранён в этом браузере. При объединении ваши изменённые поля будут иметь приоритет; остальные обновятся с сервера.</p><div><SecondaryButton onClick={() => void resolveConflict(true)}>Объединить мои правки</SecondaryButton><button className="text-button" onClick={() => void resolveConflict(false)}>Взять версию сервера</button></div></section>}
    {done ? <section className="publication-success"><span className="publication-check"><Icon name="check" size={28} /></span><h2>{form.card.title}</h2><p>{form.card.need || form.card.context}</p><div className="publication-stats"><span>Подтверждённая полнота</span><strong>{task.rating.score}<small> / 100</small></strong></div><PrimaryButton onClick={() => onApplications(task.id)} icon="inbox">Посмотреть отклики</PrimaryButton><button className="text-button" onClick={() => onStep('review')}>Вернуться к карточке</button></section> : <>
      <details className="source-disclosure"><summary><Icon name="file" size={17} />Исходное описание<span>Можно дополнить</span></summary><div><label className="field-label" htmlFor="source-draft">Ваш исходный текст</label><textarea id="source-draft" disabled={busy} className="textarea" maxLength={6000} value={form.draftText} onChange={event => update({ ...form, draftText: event.target.value })} /><label className="field-label" htmlFor="source-topic">Тема</label><select id="source-topic" disabled={busy} className="select-control" value={form.topic} onChange={event => update({ ...form, topic: event.target.value as Topic })}>{topicOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><SecondaryButton onClick={() => void runAi('analyze')} disabled={busy || !!conflict || !form.draftText.trim()}>Обновить предложения AI</SecondaryButton><p>Ручные правки защищены при повторном анализе.</p></div></details>
      <div className={`guided-editor ${review ? 'is-review' : ''}`}>
        {!review && <section className="clarification-panel"><div className="clarification-heading"><span className="ai-symbol"><Icon name="sparkle" size={21} /></span><div><h2>Уточнения</h2><span>{ai?.mode === 'template' ? 'Шаблонный помощник' : ai?.mode === 'cached' ? 'Сохранённое предложение AI' : ai ? 'AI-помощник' : 'Подготовка вопросов'}</span></div><span className="question-count">{count}/{questions.length}</span></div>{busy && <div className="ai-progress" role="status"><span className="live-dot" />Готовим предложения по вашим словам…</div>}{!questions.length && !busy && <div className="questions-placeholder"><p>Уточнения ещё не сформированы. Вы можете заполнить карточку или запросить предложения.</p><SecondaryButton onClick={() => void runAi('analyze')} disabled={!!conflict}>Подготовить вопросы</SecondaryButton></div>}
          <div className="question-stack">{questions.map((question, index) => {
            const response = form.answers.find(a => a.questionId === question.id)
            const answered = !!response?.value || !!response?.skipped
            return <details open={activeQuestion === index} className={`guided-question ${answered ? 'is-answered' : ''}`} key={question.id}><summary onClick={event => { event.preventDefault(); setActiveQuestion(index) }}><span className="question-number">{answered ? <Icon name="check" size={14} /> : index + 1}</span><span>{question.text}</span><Icon name="chevron" size={15} /></summary><div className="question-body"><label className="field-label" htmlFor={`answer-${question.id}`}>{fieldLabel(question.field)}</label><FieldInput id={`answer-${question.id}`} path={question.field} value={response?.value || ''} onChange={value => answer(question, value)} disabled={busy} />{question.field === 'constraints.deadlineMode' && form.card.constraints.deadlineMode === 'fixed' && <label className="date-answer">Дата сдачи<input aria-label="Дата сдачи" disabled={busy} className="text-input" type="date" value={form.card.constraints.deadlineDate || ''} onChange={event => editField('constraints.deadlineDate', event.target.value || null)} /></label>}<div className="question-foot"><button className="text-button" disabled={busy} onClick={() => { answer(question, null, !response?.skipped); if (!response?.skipped && index < questions.length - 1) setActiveQuestion(index + 1) }}>{response?.skipped ? 'Ответить на вопрос' : 'Пока не знаю'}</button>{index < questions.length - 1 && <button className="text-button" onClick={() => setActiveQuestion(index + 1)}>Следующий вопрос <Icon name="arrow" size={15} /></button>}</div>{response?.value && <p className="answer-applied"><Icon name="check" size={14} />Ответ добавлен в раздел «{fieldLabel(question.field)}»</p>}{form.manualFields.includes(question.field) && <small className="protected-hint">В карточке сохранена ваша ручная правка.</small>}</div></details>
          })}</div>
          <div className="clarification-bottom"><p>Достаточно известных сведений. Дополнить задачу можно и после публикации.</p><PrimaryButton className="button-block" icon="arrow" disabled={busy || !!conflict} onClick={() => void runAi('compose', true)}>{busy ? 'Готовим карточку…' : 'Перейти к проверке'}</PrimaryButton><button className="text-button" onClick={async () => { if (await persist()) onStep('review') }} disabled={busy || !!conflict}>Проверить без повторного анализа</button></div>
        </section>}
        <section className="live-card">
          <div className="document-toolbar"><span>{review ? 'Задание для студенческой команды' : 'Предпросмотр задания'}</span><span>{busy ? 'Обновляем…' : 'Редактируется вами'}</span></div>
          <header className="live-card-head"><div className="document-title-row"><h2>{form.card.title || 'Название задачи'}</h2><button className="text-button" aria-label="Изменить: Название задачи" disabled={busy} onClick={() => setEditing(editing === 'title' ? null : 'title')}>{editing === 'title' ? 'Готово' : 'Изменить'}</button></div>{editing === 'title' && <FieldInput id="card-title" path="title" value={form.card.title || ''} label="Название задачи" disabled={busy} onChange={value => editField('title', value)} />}{form.manualFields.includes('title') && <span className="manual-label">Название изменено вами</span>}{evidenceFor('title', form, task, ai) && <details className="field-evidence"><summary>Источник названия</summary><blockquote>{evidenceFor('title', form, task, ai)?.quote}</blockquote></details>}</header>
          {ai?.warnings.map((warning, index) => <div className="ai-warning" key={index}>{warning}</div>)}
          {changed.length > 0 && <details className="change-summary"><summary><Icon name="sparkle" size={15} />Последние изменения · {changed.length}</summary><ul>{changed.map(path => <li key={path}><strong>{fieldLabel(path)}</strong>{beforeAi && getField(beforeAi, path) && <del>{displayValue(path, getField(beforeAi, path))}</del>}<span>{displayValue(path, getField(form.card, path)) || 'Пока неизвестно'}</span></li>)}</ul></details>}
          <div className="card-content">{[
            { title: 'О задаче', paths: ['context', 'need', 'users'] },
            { title: 'Результат работы', paths: ['result.artifact', 'result.scope'] },
            { title: 'Критерии приёмки', paths: ['success.metric', 'success.target'] },
            { title: 'Данные и условия', paths: ['data.availability', 'data.source', 'constraints.deadlineMode', ...(form.card.constraints.deadlineMode === 'fixed' ? ['constraints.deadlineDate'] : []), 'constraints.technologyAccess'] },
            { title: 'Связь с заказчиком', paths: ['contact.channel', 'contact.consultation', 'contact.feedback'] },
          ].map(group => <section className="document-section" key={group.title}><h3>{group.title}</h3><div className="document-fields">{group.paths.map(path => {
            const evidence = evidenceFor(path, form, task, ai), value = getField(form.card, path), label = fieldLabel(path)
            return <article className={`card-section ${changed.includes(path) ? 'recently-changed' : ''}`} key={path}><div className="card-section-label"><h4>{label}</h4><button className="text-button" aria-label={`Изменить: ${label}`} disabled={busy} onClick={() => setEditing(editing === path ? null : path)}>{editing === path ? 'Готово' : 'Изменить'}</button></div>{editing === path ? <FieldInput id={`field-${path}`} path={path} value={value || ''} label={label} disabled={busy} onChange={value => editField(path, value)} /> : <p className={!value ? 'unknown-value' : ''}>{displayValue(path, value) || 'Пока неизвестно'}</p>}{form.manualFields.includes(path) && <span className="manual-label">Изменено вами</span>}{evidence && <details className="field-evidence"><summary>Источник предложения</summary><span>{evidence.sourceId === 'draft' ? 'Ваше описание' : evidence.sourceId.startsWith('answer:') ? 'Ваш ответ' : 'Сведения карточки'}</span><blockquote>{displayValue(path, evidence.quote)}</blockquote></details>}</article>
          })}</div></section>)}</div>
          {!review && <footer className="card-readiness"><span>Полнота черновика</span><strong>{rating?.score ?? '—'} / 100</strong><small>{dirty ? 'Пересчитывается после сохранения' : 'Подтвердите сведения на следующем шаге'}</small></footer>}
        </section>
        {review && <aside className="review-sidebar"><section className="readiness-panel"><h2>Полнота задания</h2><div className="readiness-number">{rating?.score ?? '—'}<small> / 100</small></div><p>{dirty ? 'Обновится после сохранения' : 'Показывает, насколько подробно описана задача.'}</p><div className="readiness-track"><span style={{ width: `${rating?.score || 0}%` }} /></div><details className="rating-breakdown"><summary>Как рассчитана полнота</summary>{rating?.breakdown.map(line => <section key={line.key}><div><strong>{line.label}</strong><span>{line.earned} / {line.max}</span></div>{line.missing.length > 0 ? line.missing.map(text => <p key={text}>{fieldLabel(text)}</p>) : <p>Сведения заполнены</p>}</section>)}</details>{task.confirmedCard && <div className="confirmed-score">Последнее подтверждение<strong>{task.rating.score} / 100</strong></div>}</section><section className="publish-panel"><h2>{published ? 'Обновить публикацию' : 'Поделиться с командами'}</h2><p>{published ? 'Новая версия станет доступна командам после вашего подтверждения.' : 'Команды увидят карточку и смогут предложить решение.'}</p><label className="review-confirm"><input type="checkbox" disabled={busy} checked={checked} onChange={event => setChecked(event.target.checked)} /><span>Я проверил(а) сведения и подтверждаю указанное. Неизвестные поля можно уточнить позже.</span></label><PrimaryButton className="button-block" disabled={!checked || busy || !!conflict || !form.card.title || form.card.title.trim().length < 3} onClick={() => void publish()} icon="arrow">{busy ? 'Сохраняем и публикуем…' : published ? 'Подтвердить и обновить' : 'Подтвердить и опубликовать'}</PrimaryButton><small>Публикация доступна при любой полноте описания.</small><button className="text-button" onClick={() => onStep('clarify')}>← Вернуться к уточнениям</button></section></aside>}
      </div>
    </>}
  </div>
}

function FieldInput({ path, id, value, label, onChange, disabled = false }: { path: string; id: string; value: string; label?: string; onChange: (value: string | null) => void; disabled?: boolean }) {
  if (options[path]) return <select id={id} aria-label={label} className="select-control" value={value} disabled={disabled} onChange={event => onChange(event.target.value || null)}><option value="">Пока неизвестно</option>{options[path].map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
  if (path === 'constraints.deadlineDate') return <input id={id} aria-label={label} className="text-input" type="date" value={value} disabled={disabled} onChange={event => onChange(event.target.value || null)} />
  if (path === 'title' || path === 'contact.channel') return <input id={id} aria-label={label} className="text-input" maxLength={path === 'title' ? 120 : 1000} value={value} disabled={disabled} onChange={event => onChange(event.target.value || null)} />
  return <textarea id={id} aria-label={label} className="textarea" rows={3} maxLength={1000} value={value} placeholder="Ваш ответ…" disabled={disabled} onChange={event => onChange(event.target.value || null)} />
}
