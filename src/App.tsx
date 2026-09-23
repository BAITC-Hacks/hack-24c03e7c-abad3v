import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, errorMessage } from './api'
import { actors as demoActors, labelForTopic } from './fixtures'
import type { Actor, AiResult, Answer, Application, Card, Level, OwnerTask, PublicTask, Rating, Role, TaskSummary, Topic } from './types'

type Page = 'workspace' | 'editor' | 'catalog' | 'applications'

const topicOptions: Array<{ value: Topic; label: string }> = [
  { value: 'education', label: 'Образование' }, { value: 'career', label: 'Карьера' }, { value: 'operations', label: 'Операции' },
  { value: 'analytics', label: 'Аналитика' }, { value: 'other', label: 'Другое' },
]
const levelOptions: Array<{ value: Level; label: string }> = [
  { value: 'needs_clarification', label: 'Нужно уточнить' }, { value: 'workable', label: 'Можно брать' },
  { value: 'ready', label: 'Готово к старту' }, { value: 'priority', label: 'Высокая готовность' },
]
const levelName: Record<Level, string> = { needs_clarification: 'Нужно уточнить', workable: 'Можно брать', ready: 'Готово к старту', priority: 'Высокая готовность' }

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    file: <><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7M8 14h8M8 17h6"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.5 5.1-5.1 2.5 2.5-5.1z"/></>,
    inbox: <><path d="M4 4h16l1 11-3 5H6l-3-5z"/><path d="M3 14h5l2 3h4l2-3h5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    sparkle: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
    filter: <><path d="M4 7h16M7 12h10m-7 5h4"/><circle cx="8" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></>,
  }
  return <svg {...common}>{paths[name] || paths.file}</svg>
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'yellow' | 'red' | 'blue' }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{children}</span>
}

function levelTone(level: Level): 'green' | 'yellow' | 'blue' | 'red' {
  if (level === 'priority' || level === 'ready') return 'green'
  if (level === 'workable') return 'yellow'
  return 'red'
}

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  return <Badge tone={status === 'published' ? 'green' : 'neutral'}>{status === 'published' ? 'Опубликована' : 'Черновик'}</Badge>
}

function RatingMeter({ score, small = false }: { score: number; small?: boolean }) {
  return <div className={`rating-meter ${small ? 'rating-meter-small' : ''}`}><span className="rating-track"><span className="rating-fill" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} /></span><strong>{score}</strong></div>
}

function App() {
  const [actor, setActor] = useState<Actor>(demoActors[0])
  const [availableActors, setAvailableActors] = useState<Actor[]>([])
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState('')
  const [page, setPage] = useState<Page>('workspace')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const role: Role = actor.kind

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3400)
  }

  const loadTasks = useCallback(async (scope: 'mine' | 'catalog' = role === 'business' ? 'mine' : 'catalog') => {
    try {
      const response = await api.listTasks({ scope })
      setTasks(response.items)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }, [role, actor.id])

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      try {
        const response = await api.getActors()
        const initial = response.items.find((item) => item.kind === 'business') || response.items[0]
        if (!initial) throw new Error('Демо-профили не найдены')
        const session = await api.selectSession(initial.id)
        if (!cancelled) {
          setAvailableActors(response.items)
          setActor(session.actor)
          setReady(true)
        }
      } catch (error) { if (!cancelled) setStartupError(errorMessage(error)) }
    }
    void initialize()
    return () => { cancelled = true }
  }, [])

  useEffect(() => { if (ready) void loadTasks() }, [ready, loadTasks])

  const changeActor = async (actorId: string) => {
    setBusy(true)
    try {
      const response = await api.selectSession(actorId)
      setActor(response.actor)
      setPage(response.actor.kind === 'business' ? 'workspace' : 'catalog')
      setTaskId(null)
    } catch (error) { showToast(errorMessage(error)) } finally { setBusy(false) }
  }

  const createTask = async () => {
    setBusy(true)
    try {
      const response = await api.createTask('Опишите потребность бизнеса и желаемый результат.', 'education')
      setTaskId(response.task.id)
      setPage('editor')
      showToast('Новый черновик создан')
      void loadTasks('mine')
    } catch (error) { showToast(errorMessage(error)) } finally { setBusy(false) }
  }

  const openTask = (id: string) => { setTaskId(id); setPage('editor') }
  const nav = role === 'business'
    ? [{ id: 'workspace' as Page, label: 'Мои задачи', icon: 'grid' }, { id: 'applications' as Page, label: 'Отклики команд', icon: 'inbox' }]
    : [{ id: 'catalog' as Page, label: 'Каталог задач', icon: 'compass' }, { id: 'applications' as Page, label: 'Мои отклики', icon: 'inbox' }]

  if (!ready) return <div className="app-shell"><main className="main-area"><div className="page-content"><EmptyState icon="clock" title={startupError ? 'Не удалось подключиться к API' : 'Подключаем демо-профиль'} text={startupError || 'Загружаем данные проекта.'} />{startupError && <button className="button button-primary" onClick={() => window.location.reload()}>Повторить</button>}</div></main></div>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><span className="brand-mark"><Icon name="sparkle" size={20} /></span><span>ai sana<small>project space</small></span></div>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav className="main-nav" aria-label="Главная навигация">
        {nav.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setTaskId(null) }}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'applications' && role === 'business' && tasks.reduce((sum, task) => sum + task.applicationCount, 0) > 0 && <span className="nav-count">{tasks.reduce((sum, task) => sum + task.applicationCount, 0)}</span>}</button>)}
        {role === 'business' && <button className={`nav-item ${page === 'editor' ? 'active' : ''}`} onClick={() => void createTask()}><Icon name="plus" /><span>Создать задачу</span></button>}
      </nav>
      <div className="sidebar-bottom">
        <div className="help-card"><span className="help-spark"><Icon name="sparkle" size={16} /></span><strong>Сильные идеи<br />начинаются с ясности.</strong><span>AI Sana помогает сделать первый шаг.</span></div>
        <div className="sidebar-profile"><div className="avatar avatar-dark">{actor.name.slice(0, 1)}</div><div className="profile-copy"><strong>{actor.name}</strong><span>{actor.kind === 'business' ? 'Представитель бизнеса' : 'Студенческая команда'}</span></div><span className="profile-menu">···</span></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><span>AI Sana</span><Icon name="chevron" size={14} /><strong>{page === 'workspace' ? 'Мои задачи' : page === 'editor' ? 'Редактор задачи' : page === 'catalog' ? 'Каталог задач' : role === 'business' ? 'Отклики команд' : 'Мои отклики'}</strong></div>
        <div className="topbar-right"><span className="demo-label"><span className="live-dot" />ДЕМО-РЕЖИМ</span><label className="actor-select-label" htmlFor="actor-switcher">Профиль</label><select id="actor-switcher" className="actor-select" value={actor.id} onChange={(event) => void changeActor(event.target.value)} disabled={busy}>
          <optgroup label="Бизнес">{availableActors.filter((item) => item.kind === 'business').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
          <optgroup label="Студенческие команды">{availableActors.filter((item) => item.kind === 'team').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
        </select><button className="avatar avatar-top" aria-label="Профиль пользователя">{actor.name.slice(0, 1)}</button></div>
      </header>

      {page === 'workspace' && role === 'business' && <BusinessWorkspace tasks={tasks} busy={busy} onCreate={() => void createTask()} onOpen={openTask} onApplications={() => setPage('applications')} />}
      {page === 'editor' && role === 'business' && taskId && <TaskEditor key={taskId} taskId={taskId} onBack={() => { setPage('workspace'); void loadTasks('mine') }} onSaved={() => void loadTasks('mine')} onApplications={() => setPage('applications')} showToast={showToast} />}
      {page === 'catalog' && role === 'team' && <CatalogPage onToast={showToast} />}
      {page === 'applications' && <ApplicationsPage role={role} actor={actor} tasks={tasks} onToast={showToast} />}
    </main>
    {toast && <div className="toast" role="status"><span className="toast-check"><Icon name="check" size={15} /></span>{toast}</div>}
  </div>
}

function PageIntro({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="intro-action">{action}</div>}</div>
}

function PrimaryButton({ children, onClick, disabled, icon, type = 'button', className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; icon?: string; type?: 'button' | 'submit'; className?: string }) {
  return <button type={type} className={`button button-primary ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={17} />}{children}</button>
}

function SecondaryButton({ children, onClick, disabled, icon, className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; icon?: string; className?: string }) {
  return <button type="button" className={`button button-secondary ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={17} />}{children}</button>
}

function BusinessWorkspace({ tasks, busy, onCreate, onOpen, onApplications }: { tasks: TaskSummary[]; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onApplications: () => void }) {
  const published = tasks.filter((task) => task.publicationStatus === 'published').length
  const drafts = tasks.filter((task) => task.publicationStatus === 'draft').length
  const responses = tasks.reduce((sum, task) => sum + task.applicationCount, 0)
  return <div className="page-content">
    <PageIntro eyebrow="ПРОСТРАНСТВО БИЗНЕСА" title="От задачи — к решению" subtitle="Опишите потребность, чтобы студенческие команды могли предложить конкретные идеи." action={<PrimaryButton icon="plus" onClick={onCreate} disabled={busy}>Новая задача</PrimaryButton>} />
    <section className="hero-banner"><div className="hero-copy"><div className="hero-kicker"><span className="hero-kicker-dot" />ВАША ИДЕЯ МОЖЕТ СТАТЬ ПРОЕКТОМ</div><h2>Хорошее решение<br />начинается с вопроса.</h2><p>AI Sana поможет уточнить задачу, собрать важные детали и найти команду, которой она откликнется.</p><button className="hero-link" onClick={onCreate}>Создать первую задачу <Icon name="arrow" size={16} /></button></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><Icon name="sparkle" size={35} /></div><div className="orbit-chip chip-one">Идея</div><div className="orbit-chip chip-two">Команда</div><div className="orbit-chip chip-three">Результат</div><span className="hero-star star-one">✳</span><span className="hero-star star-two">✳</span></div></section>
    <section className="stats-grid" aria-label="Сводка по задачам"><StatCard label="Всего задач" value={String(tasks.length).padStart(2, '0')} caption="В вашем пространстве" icon="file" tone="mint" /><StatCard label="Опубликовано" value={String(published).padStart(2, '0')} caption="Доступны командам" icon="compass" tone="lilac" /><StatCard label="Черновики" value={String(drafts).padStart(2, '0')} caption="Можно продолжить" icon="clock" tone="peach" /><StatCard label="Отклики" value={String(responses).padStart(2, '0')} caption="Идеи от команд" icon="users" tone="sky" /></section>
    <section className="section-block"><div className="section-heading"><div><div className="eyebrow">ВАШИ ПРОЕКТЫ</div><h2>Недавние задачи</h2></div><button className="text-button" onClick={onApplications}>К откликам <Icon name="arrow" size={15} /></button></div>
      <div className="task-list">{tasks.map((task, index) => <button className="task-row" key={task.id} onClick={() => onOpen(task.id)}><span className={`task-index index-${index % 4}`}>{String(index + 1).padStart(2, '0')}</span><span className="task-row-main"><strong>{task.title}</strong><span>{labelForTopic(task.topic)} <i>·</i> {task.applicationCount} {task.applicationCount === 1 ? 'отклик' : 'откликов'}</span></span><span className="task-rating"><RatingMeter score={task.rating.score} small /><small>готовность</small></span><span className="task-row-status"><StatusBadge status={task.publicationStatus} /></span><span className="row-chevron"><Icon name="chevron" size={17} /></span></button>)}</div>
      {!tasks.length && <EmptyState icon="file" title="Задач пока нет" text="Создайте первую задачу, и команды смогут предложить свои идеи." action={<PrimaryButton icon="plus" onClick={onCreate}>Создать задачу</PrimaryButton>} />}
    </section>
    <section className="bottom-note"><span className="note-icon"><Icon name="sparkle" size={18} /></span><span><strong>Рейтинг помогает увидеть полноту описания.</strong> Любую подтверждённую задачу можно опубликовать — даже если часть деталей пока нужно уточнить.</span><button className="note-link" onClick={onCreate}>Начать <Icon name="arrow" size={14} /></button></section>
  </div>
}

function StatCard({ label, value, caption, icon, tone }: { label: string; value: string; caption: string; icon: string; tone: string }) {
  return <article className="stat-card"><span className={`stat-icon stat-${tone}`}><Icon name={icon} size={18} /></span><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-caption">{caption}</span></article>
}

function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={22} /></span><h3>{title}</h3><p>{text}</p>{action}</div>
}

function TaskEditor({ taskId, onBack, onSaved, onApplications, showToast }: { taskId: string; onBack: () => void; onSaved: () => void; onApplications: () => void; showToast: (message: string) => void }) {
  const [task, setTask] = useState<OwnerTask | null>(null)
  const [draftText, setDraftText] = useState('')
  const [topic, setTopic] = useState<Topic>('education')
  const [card, setCard] = useState<Card | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [questions, setQuestions] = useState<AiResult['questions']>([])
  const [aiMode, setAiMode] = useState<AiResult['mode'] | null>(null)
  const [previewRating, setPreviewRating] = useState<Rating | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'details' | 'questions'>('details')
  const [aiResult, setAiResult] = useState<AiResult | null>(null)

  const hydrate = (value: OwnerTask) => {
    setTask(value); setDraftText(value.draftText); setTopic(value.topic); setCard(structuredClone(value.workingCard)); setAnswers(value.answers || []); setQuestions(value.questions || [])
    setPreviewRating(value.rating); setDirty(false)
  }
  const reload = useCallback(async () => {
    setLoading(true)
    try { const response = await api.getTask(taskId); hydrate(response.task as OwnerTask); setError('') }
    catch (exception) { setError(errorMessage(exception)) } finally { setLoading(false) }
  }, [taskId])
  useEffect(() => { void reload() }, [reload])

  const saveWorking = async () => {
    if (!task || !card) return task
    if (!dirty) return task
    setSaving(true); setError('')
    try {
      const response = await api.patchTask(task.id, { revision: task.revision, draftText, topic, cardPatch: card, answers })
      hydrate(response.task); setPreviewRating(response.previewRating); onSaved(); showToast('Изменения сохранены'); return response.task
    } catch (exception) {
      const message = errorMessage(exception); setError(message)
      if ((exception as { status?: number })?.status === 409) { await reload(); showToast('Задача обновлена с другой версии. Загружены актуальные данные.') }
      return null
    } finally { setSaving(false) }
  }

  const runAi = async (mode: 'analyze' | 'compose') => {
    let current = task
    if (dirty) current = await saveWorking()
    if (!current) return
    setSaving(true); setError('')
    try {
      const result = await api.analyze(current.id, current.revision, mode)
      setAiResult(result); setAiMode(result.mode)
      if (mode === 'analyze') setQuestions(result.questions)
      if (mode === 'analyze') setActiveTab('questions')
      showToast(result.mode === 'template' ? 'Включён шаблонный режим вопросов' : 'Предложение готово для проверки')
    } catch (exception) { setError(errorMessage(exception)); if ((exception as { status?: number })?.status === 409) await reload() } finally { setSaving(false) }
  }

  const updateCard = (path: string, value: string | null) => {
    if (!card) return
    const [first, second] = path.split('.') as [keyof Card, string | undefined]
    setCard(second ? { ...card, [first]: { ...(card[first] as object), [second]: value } } as Card : { ...card, [first]: value } as Card)
    setDirty(true)
  }

  const setAnswer = (questionId: string, value: string | null, skipped = false) => {
    setAnswers((current) => [...current.filter((answer) => answer.questionId !== questionId), { questionId, value, skipped }])
    setDirty(true)
  }

  const applyProposal = () => {
    if (!aiResult) return
    setCard(structuredClone(aiResult.proposal)); setDirty(true); setActiveTab('details')
    showToast('Предложение перенесено в поля — проверьте и сохраните изменения')
  }

  const confirmTask = async () => {
    let current = task
    if (dirty) current = await saveWorking()
    if (!current) return
    setSaving(true)
    try {
      const response = await api.confirm(current.id, current.revision)
      hydrate(response.task); setPreviewRating(response.rating); showToast('Сведения подтверждены. Рейтинг рассчитан.')
    } catch (exception) { setError(errorMessage(exception)); if ((exception as { status?: number })?.status === 409) await reload() } finally { setSaving(false) }
  }

  const publishTask = async () => {
    if (!task) return
    if (dirty || task.confirmedRevision !== task.revision) { setError('Сначала сохраните и подтвердите актуальную версию карточки.'); return }
    setSaving(true)
    try { const response = await api.publish(task.id, task.revision); hydrate(response.task); onSaved(); showToast('Задача опубликована — она появилась в каталоге') }
    catch (exception) { setError(errorMessage(exception)); if ((exception as { status?: number })?.status === 409) await reload() } finally { setSaving(false) }
  }

  if (loading) return <div className="page-content"><EmptyState icon="clock" title="Загружаем задачу" text="Подготавливаем карточку и её состояние." /></div>
  if (!task || !card) return <div className="page-content"><InlineError message={error || 'Задача не найдена.'} /><SecondaryButton onClick={onBack}>Назад к задачам</SecondaryButton></div>
  const confirmed = task.confirmedRevision === task.revision && !dirty

  return <div className="page-content editor-page">
    <button className="back-link" onClick={onBack}>← <span>Все задачи</span></button>
    <PageIntro eyebrow="РЕДАКТОР ЗАДАЧИ" title={card.title || 'Новая задача'} subtitle="Расскажите о потребности своими словами — AI поможет уточнить детали, а финальное решение всегда за вами." action={<StatusBadge status={task.publicationStatus} />} />
    <div className="editor-layout">
      <div className="editor-main">
        <section className="surface editor-source">
          <div className="surface-heading"><span className="step-number">01</span><div><h2>Начните с идеи</h2><p>Черновик и тема помогут AI понять контекст.</p></div><Badge tone="blue">Необязательно быть идеально точным</Badge></div>
          <label className="field-label" htmlFor="draft-text">Опишите задачу как есть</label>
          <textarea id="draft-text" className="textarea draft-area" placeholder="Например: ученики старших классов не знают, какие направления им подходят. Хотим помочь им разобраться…" value={draftText} onChange={(event) => { setDraftText(event.target.value); setDirty(true) }} />
          <div className="field-foot"><span>Обычный текст — хороший старт</span><span>{draftText.length} символов</span></div>
          <div className="field-row topic-row"><label className="field-label" htmlFor="topic-select">Тема проекта</label><select id="topic-select" className="select-control" value={topic} onChange={(event) => { setTopic(event.target.value as Topic); setDirty(true) }}>{topicOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="ai-actions"><PrimaryButton icon="sparkle" onClick={() => void runAi('analyze')} disabled={saving || draftText.trim().length < 8}>{saving ? 'Секунду…' : 'Задать уточняющие вопросы'}</PrimaryButton><button className="text-button muted-text" onClick={() => void saveWorking()} disabled={!dirty || saving}>Сохранить черновик</button></div>
        </section>

        <section className="surface card-surface">
          <div className="surface-heading"><span className="step-number">02</span><div><h2>Карточка задачи</h2><p>Заполните важные детали и подтвердите только то, в чём уверены.</p></div></div>
          <div className="editor-tabs"><button className={activeTab === 'details' ? 'tab-active' : ''} onClick={() => setActiveTab('details')}>Сведения</button><button className={activeTab === 'questions' ? 'tab-active' : ''} onClick={() => setActiveTab('questions')}>Вопросы AI {questions.length > 0 && <span className="tab-count">{questions.length}</span>}</button></div>
          {activeTab === 'details' ? <div className="card-fields">
            <div className="field-block full-field"><label className="field-label" htmlFor="card-title">Название задачи <span className="required-hint">нужно для публикации</span></label><input id="card-title" className="text-input" maxLength={120} minLength={3} placeholder="Например, профориентация для школьников" value={card.title || ''} onChange={(event) => updateCard('title', event.target.value || null)} /><span className="field-hint">От 3 до 120 символов</span></div>
            <div className="field-block"><label className="field-label" htmlFor="context">Что происходит сейчас?</label><textarea id="context" className="textarea" rows={3} placeholder="Опишите текущую ситуацию" value={card.context || ''} onChange={(event) => updateCard('context', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="need">Что нужно изменить и зачем?</label><textarea id="need" className="textarea" rows={3} placeholder="Какую проблему должно решить задание?" value={card.need || ''} onChange={(event) => updateCard('need', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="users">Для кого решение?</label><input id="users" className="text-input" placeholder="Кто будет пользоваться результатом?" value={card.users || ''} onChange={(event) => updateCard('users', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="data-availability">Доступность данных</label><select id="data-availability" className="select-control" value={card.data.availability || ''} onChange={(event) => updateCard('data.availability', event.target.value || null)}><option value="">Пока неизвестно</option><option value="available">Данные уже есть</option><option value="planned">Планируем получить</option><option value="unavailable">Данных нет</option></select></div>
            <div className="field-block full-field"><label className="field-label" htmlFor="data-source">Какие материалы доступны?</label><textarea id="data-source" className="textarea" rows={2} placeholder="Источник или план получения данных" value={card.data.source || ''} onChange={(event) => updateCard('data.source', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="artifact">Что команда сдаст?</label><input id="artifact" className="text-input" placeholder="Прототип, исследование, модель…" value={card.result.artifact || ''} onChange={(event) => updateCard('result.artifact', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="scope">Границы результата</label><input id="scope" className="text-input" placeholder="Что входит в объём проекта?" value={card.result.scope || ''} onChange={(event) => updateCard('result.scope', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="metric">Показатель успеха</label><input id="metric" className="text-input" placeholder="Что можно проверить?" value={card.success.metric || ''} onChange={(event) => updateCard('success.metric', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="target">Условие приёмки</label><input id="target" className="text-input" placeholder="При каком результате примете работу?" value={card.success.target || ''} onChange={(event) => updateCard('success.target', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="deadline-mode">Срок</label><select id="deadline-mode" className="select-control" value={card.constraints.deadlineMode || ''} onChange={(event) => updateCard('constraints.deadlineMode', event.target.value || null)}><option value="">Пока неизвестно</option><option value="fixed">Срок задан</option><option value="flexible">Гибкий срок</option></select></div>
            {card.constraints.deadlineMode === 'fixed' && <div className="field-block"><label className="field-label" htmlFor="deadline-date">Дата сдачи</label><input id="deadline-date" type="date" className="text-input" value={card.constraints.deadlineDate || ''} onChange={(event) => updateCard('constraints.deadlineDate', event.target.value || null)} /></div>}
            <div className="field-block full-field"><label className="field-label" htmlFor="technology">Технологии и доступы</label><input id="technology" className="text-input" placeholder="Например: без ограничений, можно использовать открытые данные" value={card.constraints.technologyAccess || ''} onChange={(event) => updateCard('constraints.technologyAccess', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="contact">Рабочий контакт</label><input id="contact" className="text-input" placeholder="Email или ссылка" value={card.contact.channel || ''} onChange={(event) => updateCard('contact.channel', event.target.value || null)} /></div>
            <div className="field-block"><label className="field-label" htmlFor="consultation">Как консультироваться?</label><input id="consultation" className="text-input" placeholder="Формат и частота встреч" value={card.contact.consultation || ''} onChange={(event) => updateCard('contact.consultation', event.target.value || null)} /></div>
            <div className="field-block full-field"><label className="field-label" htmlFor="feedback">Как вы дадите обратную связь?</label><input id="feedback" className="text-input" placeholder="Например: комментарии раз в неделю" value={card.contact.feedback || ''} onChange={(event) => updateCard('contact.feedback', event.target.value || null)} /></div>
          </div> : <QuestionsPanel questions={questions} answers={answers} aiMode={aiMode} onAnswer={setAnswer} onCompose={() => void runAi('compose')} aiResult={aiResult} onApplyProposal={applyProposal} saving={saving} />}
          {aiResult && activeTab === 'details' && <ProposalPanel result={aiResult} onApply={applyProposal} />}
          <div className="editor-footer"><span className={dirty ? 'dirty-indicator' : 'saved-indicator'}><span />{dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span><SecondaryButton onClick={() => void saveWorking()} disabled={!dirty || saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</SecondaryButton></div>
        </section>
      </div>
      <aside className="editor-aside">
        <RatingCard rating={previewRating || task.rating} confirmed={confirmed} dirty={dirty} />
        <section className="surface publish-card"><div className="publish-top"><span className="publish-icon"><Icon name="compass" size={18} /></span><div><strong>{task.publicationStatus === 'published' ? 'Задача в каталоге' : 'Готовы поделиться?'}</strong><span>{task.publicationStatus === 'published' ? 'Команды уже могут откликаться' : 'Опубликуйте карточку для команд'}</span></div></div>
          {task.publicationStatus === 'published' ? <SecondaryButton className="button-block" onClick={onApplications}>Посмотреть отклики <Icon name="arrow" size={15} /></SecondaryButton> : <><button className="confirm-row" onClick={() => void confirmTask()} disabled={saving || (!dirty && confirmed)}><span className={`confirm-check ${confirmed ? 'checked' : ''}`}>{confirmed && <Icon name="check" size={13} />}</span><span><strong>Подтвердить сведения</strong><small>Проверьте AI-предложения и поля</small></span></button><PrimaryButton className="button-block" onClick={() => void publishTask()} disabled={saving || !confirmed} icon="arrow">Опубликовать задачу</PrimaryButton><p className="publish-footnote">Публикация доступна при любом рейтинге. Низкий балл не мешает командам откликнуться.</p></>}
        </section>
        <div className="privacy-note"><span><Icon name="check" size={14} /></span><p><strong>Вы управляете публикацией.</strong><br />Черновик виден только вашему демо-профилю. В каталоге показываются подтверждённые данные.</p></div>
      </aside>
    </div>
    {error && <div className="floating-error"><InlineError message={error} onClose={() => setError('')} /></div>}
  </div>
}

function RatingCard({ rating, confirmed, dirty }: { rating: Rating | null; confirmed: boolean; dirty: boolean }) {
  const score = rating?.score ?? 0
  const level = rating?.level ?? 'needs_clarification'
  const suggestions = rating?.breakdown.flatMap((line) => line.missing).slice(0, 3) || []
  return <section className="surface rating-card"><div className="rating-card-head"><div><div className="eyebrow">ПОЛНОТА ЗАДАЧИ</div><h3>Рейтинг готовности</h3></div><span className="rating-bubble">{score}<small>/100</small></span></div><div className="rating-large-meter"><span><i style={{ width: `${score}%` }} /></span></div><div className="rating-level"><Badge tone={levelTone(level)}>{levelName[level]}</Badge><span>{confirmed && !dirty ? 'Подтверждённый балл' : 'Предварительная оценка'}</span></div><div className="rating-breakdown">{rating?.breakdown.map((item) => <div className="breakdown-row" key={item.key}><span>{item.label}</span><span className="breakdown-track"><i style={{ width: `${item.max ? item.earned / item.max * 100 : 0}%` }} /></span><b>{item.earned}<small>/{item.max}</small></b></div>)}</div>{suggestions.length > 0 && <div className="missing-hints"><strong>Что можно уточнить</strong><ul>{suggestions.map((item) => <li key={item}>{item}</li>)}</ul></div>}<div className="rating-disclaimer">Рейтинг показывает полноту описания, а не ценность вашей идеи.</div></section>
}

function QuestionsPanel({ questions, answers, aiMode, onAnswer, onCompose, aiResult, onApplyProposal, saving }: { questions: AiResult['questions']; answers: Answer[]; aiMode: AiResult['mode'] | null; onAnswer: (id: string, value: string | null, skipped?: boolean) => void; onCompose: () => void; aiResult: AiResult | null; onApplyProposal: () => void; saving: boolean }) {
  if (!questions.length) return <div className="questions-empty"><span className="ai-orb"><Icon name="sparkle" size={22} /></span><h3>Давайте уточним важное</h3><p>AI задаст 3–5 коротких вопросов по вашему черновику. Ответы можно пропустить и заполнить позже.</p><button className="inline-action" onClick={() => document.getElementById('draft-text')?.focus()}>Сначала добавьте черновик ↑</button>{aiResult && <ProposalPanel result={aiResult} onApply={onApplyProposal} />}</div>
  return <div className="questions-panel"><div className="mode-note"><span className="mode-note-icon"><Icon name={aiMode === 'template' ? 'file' : 'sparkle'} size={15} /></span>{aiMode === 'template' ? 'Шаблонный режим: вопросы по незаполненным полям.' : 'Предложение AI: проверьте формулировки перед применением.'}</div><div className="question-list">{questions.map((question, index) => {
    const answer = answers.find((item) => item.questionId === question.id)
    return <div className="question-card" key={question.id}><div className="question-number">{String(index + 1).padStart(2, '0')}</div><div className="question-body"><label htmlFor={`answer-${question.id}`}>{question.text}</label><textarea id={`answer-${question.id}`} className="textarea" rows={2} placeholder="Ваш ответ — или оставьте поле пустым" value={answer?.value || ''} disabled={answer?.skipped} onChange={(event) => onAnswer(question.id, event.target.value || null)} /><button className={`skip-question ${answer?.skipped ? 'skip-active' : ''}`} onClick={() => onAnswer(question.id, null, !answer?.skipped)}>{answer?.skipped ? '↶ Вернуть вопрос' : 'Пропустить вопрос'}</button></div></div>
  })}</div><div className="questions-footer"><SecondaryButton icon="sparkle" onClick={onCompose} disabled={saving}>Собрать карточку из ответов</SecondaryButton><span>Ответы сохраняются вместе с черновиком.</span></div>{aiResult?.warnings.map((warning) => <InlineError key={warning} message={warning} />)}{aiResult?.proposal && <ProposalPanel result={aiResult} onApply={onApplyProposal} />}</div>
}

function ProposalPanel({ result, onApply }: { result: AiResult; onApply: () => void }) {
  return <div className="proposal-box"><div className="proposal-heading"><span className="proposal-spark"><Icon name="sparkle" size={15} /></span><div><strong>Предложение AI</strong><span>Непроверенные поля не добавляют баллы</span></div><Badge tone={result.mode === 'template' ? 'yellow' : 'blue'}>{result.mode === 'template' ? 'Шаблон' : result.mode === 'cached' ? 'Кэш' : 'AI'}</Badge></div><p>{result.proposal.title || 'Название пока не заполнено'}{result.proposal.context ? ` — ${result.proposal.context}` : ''}</p><SecondaryButton onClick={onApply}>Перенести в карточку</SecondaryButton></div>
}

function CatalogPage({ onToast }: { onToast: (message: string) => void }) {
  const [items, setItems] = useState<TaskSummary[]>([])
  const [topic, setTopic] = useState<Topic | ''>('')
  const [level, setLevel] = useState<Level | ''>('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PublicTask | null>(null)
  const [opening, setOpening] = useState(false)
  const [search, setSearch] = useState('')
  const reload = useCallback(async () => {
    setLoading(true)
    try { const response = await api.listTasks({ scope: 'catalog', topic: topic || undefined, level: level || undefined }); setItems(response.items) }
    catch (error) { onToast(errorMessage(error)) } finally { setLoading(false) }
  }, [topic, level])
  useEffect(() => { void reload() }, [reload])
  const openDetails = async (id: string) => {
    setOpening(true)
    try { const response = await api.getTask(id); setSelected(response.task as PublicTask) }
    catch (error) { onToast(errorMessage(error)) } finally { setOpening(false) }
  }
  const filteredItems = items.filter((item) => `${item.title} ${labelForTopic(item.topic)}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page-content catalog-page">
    <PageIntro eyebrow="ПРОСТРАНСТВО КОМАНДЫ" title="Найдите задачу, которая ваша" subtitle="Изучите реальные запросы бизнеса, выберите интересный и предложите свой подход." action={<span className="catalog-live"><span className="live-dot" />{items.length} опубликованных задач</span>} />
    <section className="catalog-hero"><div><div className="eyebrow">ВАШ СЛЕДУЮЩИЙ ПРОЕКТ</div><h2>Не просто кейс.<br /><span>Решение для людей.</span></h2><p>Каждая карточка — запрос от бизнеса с ожидаемым результатом и критериями успеха.</p></div><div className="catalog-illustration"><div className="catalog-card-back" /><div className="catalog-card-front"><span className="mini-mark"><Icon name="sparkle" size={15} /></span><span className="mini-line line-wide" /><span className="mini-line" /><span className="mini-pill" /><span className="mini-line line-short" /></div><span className="floating-check"><Icon name="check" size={16} /></span></div></section>
    <section className="section-block catalog-list-section"><div className="section-heading"><div><div className="eyebrow">ОТКРЫТЫЙ КАТАЛОГ</div><h2>Задачи бизнеса <span className="muted-count">{filteredItems.length}</span></h2></div></div>
      <div className="filters-bar"><div className="search-field"><Icon name="search" size={17} /><input aria-label="Поиск по каталогу" placeholder="Найти задачу по названию" value={search} onChange={(event) => setSearch(event.target.value)} /></div><span className="filter-label"><Icon name="filter" size={16} />Фильтры</span><select aria-label="Фильтр по теме" className="filter-select" value={topic} onChange={(event) => setTopic(event.target.value as Topic | '')}><option value="">Все темы</option>{topicOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select aria-label="Фильтр по уровню готовности" className="filter-select" value={level} onChange={(event) => setLevel(event.target.value as Level | '')}><option value="">Любая готовность</option>{levelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
      {loading ? <div className="loading-inline">Обновляем каталог…</div> : filteredItems.length ? <div className="catalog-grid">{filteredItems.map((task, index) => <TaskCard key={task.id} task={task} index={index} onOpen={() => void openDetails(task.id)} loading={opening} />)}</div> : <EmptyState icon="search" title="Задач по этим условиям нет" text="Попробуйте изменить тему или уровень готовности." action={<SecondaryButton onClick={() => { setTopic(''); setLevel(''); setSearch('') }}>Сбросить фильтры</SecondaryButton>} />}
      <div className="catalog-order-note"><span className="order-note-mark">↕</span>Сначала показываем задачи с самым высоким рейтингом готовности.</div>
    </section>
    {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} onToast={onToast} />}
  </div>
}

function TaskCard({ task, index, onOpen, loading }: { task: TaskSummary; index: number; onOpen: () => void; loading: boolean }) {
  const accent = ['card-mint', 'card-blue', 'card-peach', 'card-lilac'][index % 4]
  return <article className="catalog-card"><div className={`catalog-card-accent ${accent}`}><div className="card-accent-doodle">✳</div><Badge tone="neutral">{labelForTopic(task.topic)}</Badge><span className="card-accent-id">AI SANA · PROJECT {String(index + 1).padStart(2, '0')}</span></div><div className="catalog-card-content"><div className="catalog-card-meta"><Badge tone={levelTone(task.rating.level)}>{levelName[task.rating.level]}</Badge><span className="date-meta"><Icon name="clock" size={13} />{task.publishedAt ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(task.publishedAt)) : 'Недавно'}</span></div><h3>{task.title}</h3><p className="catalog-card-desc">{task.rating.breakdown.find((item) => item.key === 'contextNeed')?.missing.length ? 'Бизнес приглашает команды помочь сформулировать и решить эту задачу.' : 'Понятный запрос с обозначенными данными и ожидаемым результатом.'}</p><div className="catalog-card-footer"><div className="mini-rating"><strong>{task.rating.score}</strong><span>/ 100</span><span className="mini-track"><i style={{ width: `${task.rating.score}%` }} /></span></div><button className="card-open" onClick={onOpen} disabled={loading} aria-label={`Открыть задачу ${task.title}`}><Icon name="arrow" size={17} /></button></div></div></article>
}

function TaskDrawer({ task, onClose, onToast }: { task: PublicTask; onClose: () => void; onToast: (message: string) => void }) {
  const [applying, setApplying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [idea, setIdea] = useState('')
  const [plan, setPlan] = useState('')
  const [timeline, setTimeline] = useState('')
  const [prototypeUrl, setPrototypeUrl] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      await api.createApplication(task.id, { idea, plan, timeline, prototypeUrl: prototypeUrl.trim(), clientRequestId: crypto.randomUUID() })
      setSent(true); onToast('Отклик отправлен бизнесу')
    } catch (error) { onToast(errorMessage(error)) } finally { setSaving(false) }
  }
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div className="drawer-head"><span className="eyebrow">КАРТОЧКА ПРОЕКТА</span><button className="icon-button" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button></div><div className="drawer-scroll"><div className="drawer-tags"><Badge tone="blue">{labelForTopic(task.topic)}</Badge><Badge tone={levelTone(task.rating.level)}>{levelName[task.rating.level]}</Badge></div><h2 id="drawer-title">{task.card.title || 'Проект без названия'}</h2><div className="drawer-rating"><RatingMeter score={task.rating.score} /><span>полнота описания</span></div><div className="drawer-section"><h3>Контекст</h3><p>{task.card.context || 'Бизнес поделился задачей и ищет команду, которая поможет уточнить детали.'}</p></div><div className="drawer-section"><h3>Что нужно изменить</h3><p>{task.card.need || 'Предложите, как можно подойти к решению этой задачи.'}</p></div><div className="drawer-detail-grid"><Detail label="Для кого" value={task.card.users} /><Detail label="Результат" value={task.card.result.artifact} /><Detail label="Данные" value={task.card.data.availability === 'available' ? 'Доступны' : task.card.data.availability === 'planned' ? 'Планируются' : 'Не указаны'} /><Detail label="Срок" value={task.card.constraints.deadlineMode === 'fixed' ? task.card.constraints.deadlineDate || 'Срок задан' : 'Гибкий / уточняется'} /></div><div className="drawer-section"><h3>Критерии успеха</h3><p>{task.card.success.metric ? `${task.card.success.metric}${task.card.success.target ? ` — ${task.card.success.target}` : ''}` : 'Обсудите критерии результата с представителем бизнеса.'}</p></div>
      {!applying && !sent && <div className="drawer-apply-prompt"><span className="prompt-icon"><Icon name="sparkle" /></span><div><strong>Есть идея?</strong><span>Поделитесь подходом — бизнес рассмотрит предложение вашей команды.</span></div></div>}
      {sent ? <div className="sent-state"><span><Icon name="check" size={20} /></span><h3>Отклик отправлен</h3><p>Бизнес увидит ваш план и сможет принять решение.</p><SecondaryButton onClick={onClose}>Вернуться в каталог</SecondaryButton></div> : applying ? <form className="application-form" onSubmit={(event) => void submit(event)}><div className="form-heading"><span className="eyebrow">ОТКЛИК КОМАНДЫ</span><h3>Расскажите о своей идее</h3><p>Ответьте на несколько вопросов — так бизнесу будет проще оценить ваш подход.</p></div><label className="field-label" htmlFor="application-idea">Идея решения *</label><textarea id="application-idea" className="textarea" rows={3} required value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="Как ваша команда подойдёт к задаче?" /><label className="field-label" htmlFor="application-plan">План работы *</label><textarea id="application-plan" className="textarea" rows={3} required value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Основные шаги и этапы" /><div className="form-split"><div><label className="field-label" htmlFor="application-timeline">Сроки *</label><input id="application-timeline" className="text-input" required value={timeline} onChange={(event) => setTimeline(event.target.value)} placeholder="Например, 2 недели" /></div><div><label className="field-label" htmlFor="application-link">Ссылка на прототип *</label><input id="application-link" className="text-input" type="url" required value={prototypeUrl} onChange={(event) => setPrototypeUrl(event.target.value)} placeholder="https://…" /></div></div><PrimaryButton type="submit" className="button-block" disabled={saving}>{saving ? 'Отправляем…' : 'Отправить отклик'}</PrimaryButton></form> : <PrimaryButton className="button-block drawer-apply" icon="arrow" onClick={() => setApplying(true)}>Предложить решение</PrimaryButton>}
    </div></aside></div>
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="detail-cell"><span>{label}</span><strong>{value || 'Не указано'}</strong></div>
}

function ApplicationsPage({ role, actor, tasks, onToast }: { role: Role; actor: Actor; tasks: TaskSummary[]; onToast: (message: string) => void }) {
  const [items, setItems] = useState<Array<Application & { taskTitle: string }>>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'selected' | 'rejected'>('all')
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const groups = await Promise.all(tasks.map(async (task) => {
        try { const result = await api.listApplications(task.id); return result.items.map((item) => ({ ...item, taskTitle: task.title })) }
        catch { return [] }
      }))
      setItems(groups.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    } catch (error) { onToast(errorMessage(error)) } finally { setLoading(false) }
  }, [tasks, role])
  useEffect(() => { void refresh() }, [refresh])
  const visible = items.filter((item) => filter === 'all' || item.status === filter)
  const decide = async (id: string, status: 'selected' | 'rejected') => {
    try { const result = await api.decideApplication(id, status); setItems((current) => current.map((item) => item.id === id ? { ...item, ...result.application } : item)); onToast(status === 'selected' ? 'Команда выбрана для проекта' : 'Отклик отклонён') }
    catch (error) { onToast(errorMessage(error)) }
  }
  const title = role === 'business' ? 'Идеи для ваших задач' : 'Ваши предложения бизнесу'
  return <div className="page-content applications-page"><PageIntro eyebrow={role === 'business' ? 'ОБРАТНАЯ СВЯЗЬ' : 'ПРОСТРАНСТВО КОМАНДЫ'} title={title} subtitle={role === 'business' ? 'Сравните подходы, задайте вопросы командам и примите решение по каждому отклику.' : `${actor.name} · следите за решениями бизнеса по отправленным предложениям.`} action={<Badge tone="blue">{items.filter((item) => item.status === 'pending').length} ожидают решения</Badge>} />
    <section className="section-block"><div className="section-heading"><div><div className="eyebrow">ПРЕДЛОЖЕНИЯ</div><h2>{role === 'business' ? 'Отклики команд' : 'История откликов'} <span className="muted-count">{visible.length}</span></h2></div></div><div className="applications-filter">{(['all', 'pending', 'selected', 'rejected'] as const).map((key) => <button key={key} className={filter === key ? 'filter-chip active' : 'filter-chip'} onClick={() => setFilter(key)}>{key === 'all' ? 'Все' : key === 'pending' ? 'На рассмотрении' : key === 'selected' ? 'Выбраны' : 'Отклонены'}</button>)}</div>
      {loading ? <div className="loading-inline">Загружаем отклики…</div> : visible.length ? <div className="application-list">{visible.map((item) => <ApplicationCard key={item.id} item={item} role={role} onDecide={decide} />)}</div> : <EmptyState icon="inbox" title="Пока нет откликов" text={role === 'business' ? 'Опубликуйте задачу, чтобы команды могли предложить решения.' : 'Откликнитесь на задачу из каталога — здесь появится статус предложения.'} />}
    </section>
  </div>
}

function ApplicationCard({ item, role, onDecide }: { item: Application & { taskTitle: string }; role: Role; onDecide: (id: string, status: 'selected' | 'rejected') => void }) {
  const statusTone = item.status === 'selected' ? 'green' : item.status === 'rejected' ? 'red' : 'yellow'
  const statusText = item.status === 'selected' ? 'Выбрана' : item.status === 'rejected' ? 'Отклонена' : 'На рассмотрении'
  return <article className="application-card"><div className="application-card-top"><div className="avatar team-avatar">{item.teamName.slice(-1)}</div><div className="application-author"><strong>{role === 'business' ? item.teamName : item.taskTitle}</strong><span>{role === 'business' ? item.taskTitle : `Отправлено ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(item.createdAt))}`}</span></div><Badge tone={statusTone}>{statusText}</Badge></div><div className="application-copy"><span className="eyebrow">ИДЕЯ</span><p>{item.idea}</p><div className="application-columns"><div><span>План команды</span><p>{item.plan}</p></div><div><span>Срок реализации</span><p>{item.timeline}</p></div></div>{item.prototypeUrl && <a href={item.prototypeUrl} className="prototype-link" target="_blank" rel="noreferrer">Открыть прототип <Icon name="external" size={14} /></a>}</div>{role === 'business' && item.status === 'pending' && <div className="application-actions"><SecondaryButton onClick={() => onDecide(item.id, 'rejected')}>Отклонить</SecondaryButton><PrimaryButton onClick={() => onDecide(item.id, 'selected')} icon="check">Выбрать команду</PrimaryButton></div>}{role === 'business' && item.status !== 'pending' && <div className="application-decision-note"><Icon name="check" size={14} />Решение сохранено отдельно для этого отклика</div>}</article>
}

function InlineError({ message, onClose }: { message: string; onClose?: () => void }) {
  return <div className="inline-error"><span>!</span><p>{message}</p>{onClose && <button aria-label="Закрыть сообщение" onClick={onClose}><Icon name="close" size={14} /></button>}</div>
}

export default App
