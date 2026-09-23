import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, errorMessage } from './api'
import { distinctTaskText } from './listPages'
import { labelForTopic } from './fixtures'
import { fieldLabel } from './editorModel'
import type { Actor, Application, Level, PublicTask, Role, Status, TaskSummary } from './types'
import { Badge, EmptyState, Icon, levelName, levelOptions, levelTone, PrimaryButton, RatingMeter, SecondaryButton, StatusBadge } from './ui'
import './pages.css'

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const formatDate = (value?: string | null) => value && !Number.isNaN(Date.parse(value)) ? dateFormat.format(new Date(value)) : ''
const dataLabel = (value?: string | null) => value === 'available' ? 'Данные доступны' : value === 'planned' ? 'Данные готовятся' : value === 'unavailable' ? 'Данных пока нет' : 'Данные не уточнены'
const deadlineLabel = (value?: string | null) => value === 'flexible' ? 'Гибкий срок' : value ? formatDate(value) || value : 'Срок не уточнён'
const displayTitle = (task: TaskSummary) => task.title && task.title !== 'Новая задача' ? task.title : task.need || 'Задача в работе'
const catalogTopicLabel = (topic: TaskSummary['topic']) => labelForTopic(topic).trim().replace(/\s+/g, ' ')
const catalogTopicKey = (topic: TaskSummary['topic']) => catalogTopicLabel(topic).normalize('NFKC').toLocaleLowerCase('ru-RU')
const prototypeLink = (value: string | null) => {
  try { const parsed = new URL(value || ''); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null } catch { return null }
}

function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <header className="workspace-page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="workspace-heading-action">{action}</div>}</header>
}

function RequestError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="page-request-error" role="alert"><div><strong>Не удалось загрузить данные</strong><p>{message}</p></div><SecondaryButton onClick={onRetry}>Повторить</SecondaryButton></div>
}

function PageLoading({ children }: { children: ReactNode }) {
  return <div className="page-loading" role="status"><span className="page-loading-dot" />{children}</div>
}

type WorkspaceProps = { tasks: TaskSummary[]; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onApplications: () => void; loading?: boolean; error?: string; onRetry?: () => void }

export function BusinessWorkspace({ tasks, busy, onCreate, onOpen, onApplications, loading = false, error, onRetry }: WorkspaceProps) {
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all')
  const [search, setSearch] = useState('')
  const published = tasks.filter((task) => task.publicationStatus === 'published').length
  const drafts = tasks.length - published
  const pending = tasks.reduce((sum, task) => sum + (task.pendingApplicationCount ?? 0), 0)
  const responses = tasks.reduce((sum, task) => sum + task.applicationCount, 0)
  const resumable = tasks.filter((task) => task.publicationStatus === 'draft' || task.hasUnpublishedChanges).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0]
  const visible = tasks.filter((task) => (filter === 'all' || task.publicationStatus === filter) && `${task.title} ${task.need || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const retry = onRetry || (() => window.location.reload())

  if ((loading || busy) && !tasks.length) return <div className="page-content workspace-page"><PageHeading title="Мои задачи" subtitle="Задачи, черновики и отклики команд." /><PageLoading>Загружаем задачи…</PageLoading></div>
  if (error && !tasks.length) return <div className="page-content workspace-page"><PageHeading title="Мои задачи" subtitle="Задачи, черновики и отклики команд." /><RequestError message={error} onRetry={retry} /></div>

  return <div className="page-content workspace-page">
    <PageHeading title="Мои задачи" subtitle="Сформулируйте задачу, опубликуйте её и выберите команду." action={<PrimaryButton icon="plus" onClick={onCreate} disabled={busy}>Создать задачу</PrimaryButton>} />
    {error && <RequestError message={error} onRetry={retry} />}
    <div className="workspace-counts" aria-label="Сводка"><span><strong>{tasks.length}</strong> всего</span><span><strong>{published}</strong> опубликовано</span><span><strong>{drafts}</strong> в работе</span><button onClick={onApplications}><strong>{responses}</strong> откликов <Icon name="arrow" size={16} /></button></div>
    {resumable && <section className="continue-task"><span className="continue-task-icon"><Icon name="file" size={22} /></span><div><span>{resumable.hasUnpublishedChanges ? 'Есть неопубликованные изменения' : 'Продолжить черновик'}</span><h2>{displayTitle(resumable)}</h2><p>{resumable.hasUnpublishedChanges ? 'Проверьте изменения перед обновлением публикации.' : 'Ваше описание и ответы сохранены.'}</p></div><SecondaryButton icon="arrow" onClick={() => onOpen(resumable.id)}>{resumable.hasUnpublishedChanges ? 'Проверить' : 'Продолжить'}</SecondaryButton></section>}
    {pending > 0 && <button className="pending-responses" onClick={onApplications}><Icon name="inbox" size={18} /><span><strong>{pending}</strong> откликов ждут решения</span><span>Посмотреть <Icon name="arrow" size={16} /></span></button>}
    <section className="task-register" aria-label="Список задач">
      <div className="task-register-toolbar"><div className="page-filter-tabs" aria-label="Статус задач">{(['all', 'draft', 'published'] as const).map((value) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'Все задачи' : value === 'draft' ? 'Черновики' : 'Опубликованные'}<span>{value === 'all' ? tasks.length : value === 'draft' ? drafts : published}</span></button>)}</div><label className="page-search"><Icon name="search" size={19} /><input aria-label="Поиск в моих задачах" placeholder="Найти задачу" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {!tasks.length ? <EmptyState icon="file" title="Здесь будут ваши задачи" text="Опишите проблему своими словами. AI поможет уточнить детали и подготовить карточку." action={<PrimaryButton icon="plus" onClick={onCreate} disabled={busy}>Создать первую задачу</PrimaryButton>} /> : !visible.length ? <EmptyState icon="search" title="Задач не найдено" text="Измените запрос или выберите другой статус." action={<SecondaryButton onClick={() => { setSearch(''); setFilter('all') }}>Сбросить фильтры</SecondaryButton>} /> : <div className="task-register-list"><div className="task-register-labels" aria-hidden="true"><span>Задача</span><span>Статус</span><span>Полнота</span><span>Отклики</span><span /></div>{visible.map((task) => {
        const draftRating = task.publicationStatus === 'draft' || task.hasUnpublishedChanges
        const rating = draftRating ? task.previewRating : task.rating
        return <article className="task-register-row" key={task.id}><div className="task-register-description"><button className="task-title-link" onClick={() => onOpen(task.id)}>{displayTitle(task)}</button><p>{task.need || 'Продолжите описание проблемы.'}</p><span>{labelForTopic(task.topic)}<span aria-hidden="true"> · </span>{deadlineLabel(task.deadline)}</span></div><div className="task-register-status"><StatusBadge status={task.publicationStatus} />{task.hasUnpublishedChanges && <span className="unpublished-label">Есть изменения</span>}</div><div className="task-register-rating">{rating ? <><RatingMeter score={rating.score} /><span>{draftRating ? 'черновик' : 'публикация'}</span></> : <span>Не оценена</span>}</div><button className="task-response-count" aria-label={`${task.applicationCount} откликов на задачу ${displayTitle(task)}`} onClick={() => { onApplications(); window.location.hash = `/applications?task=${encodeURIComponent(task.id)}` }}><Icon name="users" size={17} />{task.applicationCount}</button><SecondaryButton onClick={() => onOpen(task.id)}>{task.publicationStatus === 'draft' ? 'Продолжить' : 'Открыть'}</SecondaryButton></article>
      })}</div>}
    </section>
  </div>
}

export function CatalogPage({ onToast }: { onToast: (message: string) => void }) {
  const [items, setItems] = useState<TaskSummary[]>([])
  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState<Level | ''>('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<PublicTask | null>(null)
  const [detailError, setDetailError] = useState('')
  const [requestedId, setRequestedId] = useState<string | null>(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('task'))

  useEffect(() => {
    if (requestedId) return
    let cancelled = false
    setLoading(true); setError('')
    void api.listTasks({ scope: 'catalog' }).then((response) => {
      if (cancelled) return
      setItems(response.items)
      setTopic((current) => current && !response.items.some((task) => catalogTopicKey(task.topic) === current) ? '' : current)
    }).catch((exception: unknown) => { if (!cancelled) setError(errorMessage(exception)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [retry, requestedId])
  useEffect(() => {
    const syncSelection = () => setRequestedId(new URLSearchParams(window.location.hash.split('?')[1] || '').get('task'))
    window.addEventListener('hashchange', syncSelection)
    return () => window.removeEventListener('hashchange', syncSelection)
  }, [])
  useEffect(() => {
    let cancelled = false
    setSelected(null); setDetailError('')
    if (!requestedId) return
    void api.getTask(requestedId).then((response) => { if (!cancelled) setSelected(response.task as PublicTask) }).catch((exception: unknown) => { if (!cancelled) setDetailError(errorMessage(exception)) })
    return () => { cancelled = true }
  }, [requestedId, retry])
  const openTask = (id: string) => { setRequestedId(id); window.location.hash = `/catalog?task=${encodeURIComponent(id)}`; window.scrollTo(0, 0) }
  const closeTask = () => { setRequestedId(null); setSelected(null); window.location.hash = '/catalog' }
  const topicLabels = new Map<string, string>()
  for (const task of items) {
    const key = catalogTopicKey(task.topic)
    if (key && !topicLabels.has(key)) topicLabels.set(key, catalogTopicLabel(task.topic))
  }
  const availableTopics = Array.from(topicLabels, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'ru-RU'))
  const query = search.trim().toLocaleLowerCase()
  const filtered = items.filter((task) => (!topic || catalogTopicKey(task.topic) === topic) && (!level || task.rating.level === level) && `${task.title} ${task.need || ''} ${task.result || ''} ${labelForTopic(task.topic)}`.toLocaleLowerCase().includes(query))

  if (requestedId) return selected ? <PublicTaskPage key={selected.id} task={selected} onBack={closeTask} onToast={onToast} /> : <div className="page-content public-task-page"><button className="page-back-link" onClick={closeTask}><Icon name="arrow" size={17} />К каталогу</button>{detailError ? <RequestError message={detailError} onRetry={() => setRetry((value) => value + 1)} /> : <PageLoading>Открываем задачу…</PageLoading>}</div>

  return <div className="page-content task-catalog-page">
    <PageHeading title="Каталог задач" subtitle="Изучите запросы бизнеса и предложите решение от своей команды." action={<SecondaryButton disabled={loading} onClick={() => setRetry((value) => value + 1)}>Обновить</SecondaryButton>} />
    <div className="catalog-toolbar"><label className="page-search"><Icon name="search" size={20} /><input aria-label="Поиск по задачам" placeholder="Название, тема или описание" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="catalog-filter"><span>Направление</span><select value={topic} onChange={(event) => setTopic(event.target.value)}><option value="">Все направления</option>{availableTopics.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="catalog-filter"><span>Готовность</span><select value={level} onChange={(event) => setLevel(event.target.value as Level | '')}><option value="">Любая готовность</option>{levelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
    <div className="catalog-results-heading"><span>{loading ? 'Загружаем задачи…' : `Найдено задач: ${filtered.length}`}</span><span>Сначала с высокой готовностью</span></div>
    {error ? <RequestError message={error} onRetry={() => setRetry((value) => value + 1)} /> : loading ? <PageLoading>Загружаем опубликованные задачи…</PageLoading> : !filtered.length ? <EmptyState icon="search" title="Подходящих задач пока нет" text="Попробуйте изменить запрос или фильтры." action={<SecondaryButton onClick={() => { setSearch(''); setTopic(''); setLevel('') }}>Сбросить фильтры</SecondaryButton>} /> : <div className="project-catalog-grid">{filtered.map((task) => <article className="project-catalog-card" key={task.id}><div className="project-card-top"><span>{labelForTopic(task.topic)}</span><Badge tone={levelTone(task.rating.level)}>{levelName[task.rating.level]}</Badge></div><h2><button onClick={() => openTask(task.id)}>{task.title}</button></h2><p className="project-need">{task.need || 'Потребность пока не уточнена.'}</p><div className="project-result"><h3>Ожидаемый результат</h3><p>{task.result || 'Ожидаемый результат ещё не указан.'}</p></div><dl className="project-facts"><div><dt>Данные</dt><dd>{dataLabel(task.dataAvailability)}</dd></div><div><dt>Срок</dt><dd>{deadlineLabel(task.deadline)}</dd></div></dl><div className="project-card-bottom"><span><strong>{task.rating.score}/100</strong> полнота описания</span><SecondaryButton icon="arrow" onClick={() => openTask(task.id)}>Подробнее</SecondaryButton></div></article>)}</div>}
  </div>
}

function PublicTaskPage({ task, onBack, onToast }: { task: PublicTask; onBack: () => void; onToast: (message: string) => void }) {
  const [applying, setApplying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [idea, setIdea] = useState('')
  const [plan, setPlan] = useState('')
  const [timeline, setTimeline] = useState('')
  const [prototypeUrl, setPrototypeUrl] = useState('')
  const lastRequest = useRef({ payload: '', id: crypto.randomUUID() })
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => { title.current?.focus() }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!idea.trim() || !plan.trim() || !timeline.trim() || !prototypeLink(prototypeUrl)) { setError('Добавьте подход, план, сроки и ссылку на прототип (http или https).'); return }
    setSaving(true); setError('')
    const payload = { idea: idea.trim(), plan: plan.trim(), timeline: timeline.trim(), prototypeUrl: prototypeUrl.trim() }
    const payloadKey = JSON.stringify(payload)
    if (lastRequest.current.payload !== payloadKey) lastRequest.current = { payload: payloadKey, id: crypto.randomUUID() }
    try { await api.createApplication(task.id, { ...payload, clientRequestId: lastRequest.current.id }); setSent(true); onToast('Отклик отправлен бизнесу') }
    catch (exception) { setError(errorMessage(exception)) } finally { setSaving(false) }
  }

  return <div className="page-content public-task-page">
    <button className="page-back-link" onClick={onBack}><Icon name="arrow" size={17} />К каталогу</button>
    <header className="public-task-heading"><div className="public-task-meta"><span>{labelForTopic(task.topic)}</span><Badge tone={levelTone(task.rating.level)}>{levelName[task.rating.level]}</Badge></div><h1 ref={title} tabIndex={-1}>{task.card.title || 'Задача без названия'}</h1><p>Опубликовано {formatDate(task.publishedAt) || 'недавно'} · полнота описания {task.rating.score}/100</p></header>
    <div className="public-task-layout"><article className="public-task-article"><TaskSection title="Проблема" text={task.card.need} /><TaskSection title="Контекст" text={task.card.context} /><TaskSection title="Для кого" text={task.card.users} /><TaskSection title="Ожидаемый результат" text={distinctTaskText([task.card.result.artifact, task.card.result.scope])} /><TaskSection title="Критерии приёмки" text={[...new Set([task.card.success.metric, task.card.success.target].filter(Boolean))].join(' — ')} /><TaskSection title="Доступы и ограничения" text={task.card.constraints.technologyAccess} /><TaskSection title="Связь с бизнесом" text={[task.card.contact.channel, task.card.contact.consultation, task.card.contact.feedback].filter(Boolean).join('\n')} /></article>
      <aside className="public-task-aside"><section className="task-key-facts"><h2>Условия задачи</h2><dl><div><dt>Данные</dt><dd>{dataLabel(task.card.data.availability)}</dd>{task.card.data.source && <dd className="fact-extra">{task.card.data.source}</dd>}</div><div><dt>Срок</dt><dd>{deadlineLabel(task.card.constraints.deadlineMode === 'flexible' ? 'flexible' : task.card.constraints.deadlineDate)}</dd></div></dl><details className="public-rating-breakdown"><summary>Как рассчитан рейтинг <strong>{task.rating.score}/100</strong></summary><p>Рейтинг отражает полноту опубликованного описания.</p><div className="public-rating-sections">{task.rating.breakdown.map((line) => <section key={line.key}><div className="public-rating-line"><h3>{line.label}</h3><span>{line.earned} / {line.max}</span></div>{line.missing.length ? <><p>Нужно уточнить:</p><ul>{line.missing.map((missing) => <li key={missing}>{fieldLabel(missing)}</li>)}</ul></> : <p>Сведения заполнены</p>}</section>)}</div></details></section>
        {sent ? <section className="application-sent-panel" role="status"><span className="success-mark"><Icon name="check" size={23} /></span><h2>Отклик отправлен</h2><p>Статус предложения появится в разделе «Мои отклики».</p><PrimaryButton onClick={() => { window.location.hash = `/applications?task=${encodeURIComponent(task.id)}` }}>К моим откликам</PrimaryButton></section> : applying ? <form className="project-application-form" onSubmit={(event) => void submit(event)}><h2>Ваше предложение</h2><p>Расскажите, как команда решит задачу.</p><label>Подход *<textarea className="textarea" required rows={3} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="Как вы решите проблему?" /></label><label>План работы *<textarea className="textarea" required rows={3} value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Основные шаги и этапы" /></label><label>Сроки *<input className="text-input" required value={timeline} onChange={(event) => setTimeline(event.target.value)} placeholder="Например, 2 недели" /></label><label>Ссылка на прототип *<input className="text-input" type="url" required value={prototypeUrl} onChange={(event) => setPrototypeUrl(event.target.value)} placeholder="https://…" /></label>{error && <div className="page-form-error" role="alert">{error}</div>}<PrimaryButton type="submit" disabled={saving}>{saving ? 'Отправляем…' : 'Отправить отклик'}</PrimaryButton><button className="text-button" type="button" disabled={saving} onClick={() => setApplying(false)}>Свернуть форму</button></form> : <section className="task-apply-panel"><Icon name="users" size={26} /><h2>Готовы взяться за задачу?</h2><p>Предложите подход, сроки и прототип. Бизнес увидит ваш отклик и примет решение.</p><PrimaryButton icon="arrow" onClick={() => setApplying(true)}>Предложить решение</PrimaryButton></section>}
      </aside></div>
  </div>
}

function TaskSection({ title, text }: { title: string; text: string | null | undefined }) {
  return <section className="public-task-section"><h2>{title}</h2><p className={text ? '' : 'not-specified'}>{text || 'Пока не указано'}</p></section>
}

type NamedApplication = Application & { taskTitle: string }
const statusNames: Record<Status, string> = { pending: 'На рассмотрении', selected: 'Команда выбрана', rejected: 'Отклонено' }
function ApplicationStatus({ status }: { status: Status }) { return <Badge tone={status === 'selected' ? 'green' : status === 'rejected' ? 'red' : 'yellow'}>{statusNames[status]}</Badge> }

function DecisionActions({ item, deciding, onDecide, comparison = false }: { item: NamedApplication; deciding: string | null; onDecide: (status: 'selected' | 'rejected') => void; comparison?: boolean }) {
  const editor = useRef<HTMLDetailsElement>(null)
  const closeEditor = () => {
    if (!editor.current) return
    editor.current.open = false
    editor.current.querySelector('summary')?.focus()
  }
  useEffect(() => { if (editor.current?.open) closeEditor() }, [item.status])
  const busy = !!deciding
  const saving = deciding === item.id
  if (item.status === 'pending') return <div className={comparison ? 'comparison-actions' : 'response-decision'}>
    {!comparison && <SecondaryButton disabled={busy} onClick={() => onDecide('rejected')}>Отклонить</SecondaryButton>}
    <PrimaryButton disabled={busy} onClick={() => onDecide('selected')}>{saving ? 'Сохраняем…' : 'Выбрать команду'}</PrimaryButton>
    {comparison && <button className="text-button" disabled={busy} onClick={() => onDecide('rejected')}>Отклонить</button>}
  </div>
  const alternative = item.status === 'selected' ? 'rejected' : 'selected'
  return <div className="response-decision-saved">
    <span><Icon name="check" size={16} />Решение сохранено{formatDate(item.decidedAt) ? ` · ${formatDate(item.decidedAt)}` : ''}</span>
    <details className="decision-editor" ref={editor}>
      <summary aria-label={`Изменить решение по отклику команды ${item.teamName}`}>Изменить решение</summary>
      <div className="decision-editor-body" role="group" aria-label={`Новое решение по отклику команды ${item.teamName}`}>
        <p>{item.status === 'selected' ? 'Команда выбрана. Вы можете отклонить её отклик.' : 'Отклик отклонён. Вы можете выбрать эту команду.'}</p>
        <div><PrimaryButton disabled={busy} onClick={() => onDecide(alternative)}>{saving ? 'Сохраняем…' : alternative === 'selected' ? 'Выбрать команду' : 'Отклонить отклик'}</PrimaryButton><button className="text-button" disabled={busy} onClick={closeEditor}>Отмена</button></div>
      </div>
    </details>
  </div>
}

export function ApplicationsPage({ role, actor, tasks, onToast, initialTaskId, onChanged }: { role: Role; actor: Actor; tasks: TaskSummary[]; onToast: (message: string) => void; initialTaskId?: string | null; onChanged?: () => void }) {
  const [items, setItems] = useState<NamedApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [taskFilter, setTaskFilter] = useState(initialTaskId || '')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [deciding, setDeciding] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { const response = await api.listApplications(); setItems(response.items.map((item) => ({ ...item, taskTitle: (item as Application & { taskTitle?: string }).taskTitle || tasks.find((task) => task.id === item.taskId)?.title || `Задача ${item.taskId}` })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) }
    catch (exception) { setError(errorMessage(exception)) } finally { setLoading(false) }
  }, [tasks, actor.id])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setTaskFilter(initialTaskId || ''); setSelectedIds([]); setComparing(false) }, [initialTaskId, actor.id])
  const visible = items.filter((item) => (!taskFilter || item.taskId === taskFilter) && (filter === 'all' || item.status === filter))
  const compared = items.filter((item) => selectedIds.includes(item.id))
  const decide = async (id: string, status: 'selected' | 'rejected') => {
    setDeciding(id)
    try { const result = await api.decideApplication(id, status); setItems((current) => current.map((item) => item.id === id ? { ...item, ...result.application } : item)); onChanged?.(); onToast(status === 'selected' ? 'Команда выбрана для проекта' : 'Отклик отклонён') }
    catch (exception) { onToast(errorMessage(exception)) } finally { setDeciding(null) }
  }
  const toggleCompare = (item: NamedApplication) => {
    if (selectedIds.includes(item.id)) { setSelectedIds((current) => current.filter((id) => id !== item.id)); return }
    if (compared.length && compared[0].taskId !== item.taskId) { onToast('Для сравнения выберите отклики на одну задачу.'); return }
    if (selectedIds.length >= 3) { onToast('Можно сравнить до трёх команд одновременно.'); return }
    setSelectedIds((current) => [...current, item.id])
  }
  const selectTask = (id: string) => { setTaskFilter(id); setSelectedIds([]); setComparing(false); window.history.replaceState(null, '', `#/applications${id ? `?task=${encodeURIComponent(id)}` : ''}`) }
  const taskGroups = Array.from(new Set(visible.map((item) => item.taskId)))
  const filterTasks = Array.from(new Map([...tasks.map((task) => [task.id, task.title] as const), ...items.map((item) => [item.taskId, item.taskTitle] as const)]))

  return <div className="page-content responses-page">
    <PageHeading title={role === 'business' ? 'Отклики команд' : 'Мои отклики'} subtitle={role === 'business' ? 'Сравните подходы, сроки и прототипы. Выберите подходящую команду.' : `${actor.name} · ваши предложения и решения бизнеса.`} action={<SecondaryButton onClick={() => void refresh()} disabled={loading}>Обновить</SecondaryButton>} />
    <div className="responses-controls"><label className="response-task-select"><span>Задача</span><select value={taskFilter} onChange={(event) => selectTask(event.target.value)}><option value="">Все задачи</option>{filterTasks.map(([id, title]) => <option key={id} value={id}>{title} ({items.filter((item) => item.taskId === id).length})</option>)}</select></label><div className="page-filter-tabs" aria-label="Статус откликов">{(['all', 'pending', 'selected', 'rejected'] as const).map((value) => <button key={value} className={filter === value ? 'is-active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'Все' : statusNames[value]}<span>{items.filter((item) => (!taskFilter || item.taskId === taskFilter) && (value === 'all' || item.status === value)).length}</span></button>)}</div></div>
    {error && <RequestError message={error} onRetry={() => void refresh()} />}
    {role === 'business' && !loading && items.length > 0 && <div className="comparison-toolbar"><span>{selectedIds.length ? `Выбрано для сравнения: ${selectedIds.length} из 3` : 'Отметьте 2–3 команды по одной задаче для сравнения.'}</span><div>{selectedIds.length > 0 && <button className="text-button" onClick={() => { setSelectedIds([]); setComparing(false) }}>Сбросить</button>}<SecondaryButton disabled={selectedIds.length < 2} onClick={() => setComparing(!comparing)}>{comparing ? 'Вернуться к списку' : 'Сравнить команды'}</SecondaryButton></div></div>}
    {loading ? <PageLoading>Загружаем отклики…</PageLoading> : comparing && compared.length >= 2 ? <ComparisonTable items={compared} deciding={deciding} onDecide={(id, status) => void decide(id, status)} /> : visible.length ? <div className="response-groups">{taskGroups.map((id) => <section key={id} className="response-group">{!taskFilter && <h2>{visible.find((item) => item.taskId === id)?.taskTitle}</h2>}<div className="response-cards">{visible.filter((item) => item.taskId === id).map((item) => <ResponseCard key={item.id} item={item} role={role} checked={selectedIds.includes(item.id)} onCompare={() => toggleCompare(item)} deciding={deciding} onDecide={(status) => void decide(item.id, status)} />)}</div></section>)}</div> : !error && <EmptyState icon="inbox" title={filter !== 'all' ? 'Откликов с таким статусом нет' : role === 'business' ? 'Откликов пока нет' : 'Вы ещё не отправили отклики'} text={role === 'business' ? 'После публикации задачи здесь появятся предложения команд.' : 'Выберите задачу в каталоге и предложите решение.'} />}
  </div>
}

function ResponseCard({ item, role, checked, onCompare, deciding, onDecide }: { item: NamedApplication; role: Role; checked: boolean; onCompare: () => void; deciding: string | null; onDecide: (status: 'selected' | 'rejected') => void }) {
  const link = prototypeLink(item.prototypeUrl)
  return <article className={`response-card ${checked ? 'is-selected' : ''}`}><header><div><h3>{role === 'business' ? item.teamName : item.taskTitle}</h3><span>Отправлено {formatDate(item.createdAt)}</span></div><ApplicationStatus status={item.status} /></header><div className="response-card-content"><div className="response-approach"><h4>Подход команды</h4><p>{item.idea}</p></div><div className="response-plan"><h4>План работы</h4><p>{item.plan}</p></div><div className="response-timeline"><h4>Сроки</h4><p>{item.timeline}</p>{link ? <a href={link} target="_blank" rel="noreferrer">Открыть прототип <Icon name="external" size={16} /></a> : <span className="response-no-prototype">Прототип не указан</span>}</div></div><footer>{role === 'business' && <label className="compare-checkbox"><input type="checkbox" checked={checked} onChange={onCompare} />Сравнить {item.teamName}</label>}{role === 'business' && <DecisionActions item={item} deciding={deciding} onDecide={onDecide} />}{role === 'team' && <span className="response-team-status">{item.status === 'pending' ? 'Бизнес рассматривает предложение.' : item.status === 'selected' ? 'Бизнес выбрал вашу команду.' : 'Бизнес отклонил предложение.'}</span>}</footer></article>
}

function ComparisonTable({ items, deciding, onDecide }: { items: NamedApplication[]; deciding: string | null; onDecide: (id: string, status: 'selected' | 'rejected') => void }) {
  return <section className="comparison-section"><h2>Сравнение команд</h2><p>{items[0].taskTitle}</p><div className="comparison-scroll" role="region" aria-label="Сравнение предложений команд" tabIndex={0}><table className="comparison-table"><caption className="visually-hidden">Предложения команд по задаче «{items[0].taskTitle}»</caption><thead><tr><th scope="col">Критерий</th>{items.map((item) => <th scope="col" key={item.id}><strong>{item.teamName}</strong><ApplicationStatus status={item.status} /></th>)}</tr></thead><tbody><tr><th scope="row">Подход</th>{items.map((item) => <td key={item.id}>{item.idea}</td>)}</tr><tr><th scope="row">План работы</th>{items.map((item) => <td key={item.id}>{item.plan}</td>)}</tr><tr><th scope="row">Сроки</th>{items.map((item) => <td key={item.id}>{item.timeline}</td>)}</tr><tr><th scope="row">Прототип</th>{items.map((item) => { const link = prototypeLink(item.prototypeUrl); return <td key={item.id}>{link ? <a href={link} target="_blank" rel="noreferrer">Открыть прототип <Icon name="external" size={15} /></a> : 'Не указан'}</td> })}</tr><tr><th scope="row">Решение</th>{items.map((item) => <td key={item.id}><DecisionActions item={item} deciding={deciding} onDecide={(status) => onDecide(item.id, status)} comparison /></td>)}</tr></tbody></table></div></section>
}
