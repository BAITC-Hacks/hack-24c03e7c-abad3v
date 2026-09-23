import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from './api'
import type { Actor, TaskSummary } from './types'
import { Icon, EmptyState } from './ui'
import { BusinessWorkspace, CatalogPage, ApplicationsPage } from './WorkspacePages'
import { TaskEditor } from './TaskEditor'
import { readLocal, writeLocal } from './editorModel'
import { ProfileSwitcher } from './ProfileSwitcher'

function readRoute() {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(query), parts = path.split('/')
  return { page: parts[0] || 'workspace', taskId: parts[0] === 'tasks' ? decodeURIComponent(parts[1] || '') : null, step: params.get('step') || '', applicationTask: params.get('task') || undefined }
}

export default function App() {
  const [actor, setActor] = useState<Actor | null>(null)
  const [actors, setActors] = useState<Actor[]>([])
  const [route, setRoute] = useState(readRoute)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const editorSave = useRef<(() => Promise<boolean>) | null>(null)
  const navigate = async (path: string, flush = true) => { if (flush && editorSave.current && !(await editorSave.current())) return; window.location.hash = `/${path}` }
  const showToast = useCallback((message: string) => setToast(message), [])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { const update = () => setRoute(readRoute()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [route.page, route.taskId, route.step, route.applicationTask])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { items } = await api.getActors()
        const preferred = readLocal<string>('ai-sana:actor')
        const selected = items.find(item => item.id === preferred) || items.find(item => item.kind === 'business') || items[0]
        if (!selected) throw new Error('Демо-профили не найдены')
        const session = await api.selectSession(selected.id)
        if (!cancelled) { setActor(session.actor); setActors(items); if (!window.location.hash) navigate(selected.kind === 'business' ? 'workspace' : 'catalog') }
      } catch (exception) { if (!cancelled) setError(errorMessage(exception)) }
    })()
    return () => { cancelled = true }
  }, [])
  const loadTasks = useCallback(async () => {
    if (!actor) return
    setTasksLoading(true); setTasksError('')
    try { const response = await api.listTasks({ scope: actor.kind === 'business' ? 'mine' : 'catalog' }); setTasks(response.items) }
    catch (exception) { setTasksError(errorMessage(exception)) }
    finally { setTasksLoading(false) }
  }, [actor, showToast])
  useEffect(() => { void loadTasks() }, [loadTasks, route.page])
  async function changeActor(id: string) {
    if (editorSave.current && !(await editorSave.current())) return
    setBusy(true)
    try { const response = await api.selectSession(id); setActor(response.actor); writeLocal('ai-sana:actor', id); setTasks([]); void navigate(response.actor.kind === 'business' ? 'workspace' : 'catalog', false) }
    catch (exception) { showToast(errorMessage(exception)) }
    finally { setBusy(false) }
  }
  if (!actor) return <main className="startup-screen"><EmptyState icon="sparkle" title={error ? 'Не удалось подключиться' : 'Открываем ваше пространство'} text={error || 'Загружаем задачи и демо-профили.'} action={error && <button className="button button-primary" onClick={() => window.location.reload()}>Повторить</button>} /></main>
  const business = actor.kind === 'business'
  const editor = business && ['tasks', 'new'].includes(route.page)
  const page = editor ? 'editor' : route.page === 'applications' ? 'applications' : business ? 'workspace' : 'catalog'
  const pending = tasks.reduce((sum, item) => sum + (item.pendingApplicationCount || 0), 0)
  const nav = business ? [{ id: 'workspace', label: 'Мои задачи', icon: 'grid' }, { id: 'applications', label: 'Отклики команд', icon: 'inbox' }] : [{ id: 'catalog', label: 'Каталог задач', icon: 'compass' }, { id: 'applications', label: 'Мои отклики', icon: 'inbox' }]
  return <div className="app-shell">
    <header className="app-header"><div className="header-inner">
      <a className="brand" onClick={event => { event.preventDefault(); void navigate(business ? 'workspace' : 'catalog') }} href={business ? '#/workspace' : '#/catalog'} aria-label="AI Sana — главная"><span className="brand-symbol"><Icon name="sparkle" size={23} /></span><span>AI Sana</span></a>
      <nav className="header-nav" aria-label="Главная навигация">{nav.map(item => <button key={item.id} className={(page === item.id || item.id === 'workspace' && editor) ? 'active' : ''} onClick={() => void navigate(item.id)}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.id === 'applications' && business && pending > 0 && <span className="nav-count">{pending}</span>}</button>)}</nav>
      <ProfileSwitcher actor={actor} actors={actors} busy={busy} onChange={changeActor} />
    </div></header>
    <main className="main-area" inert={busy}>
      {page === 'workspace' && <BusinessWorkspace tasks={tasks} busy={busy} loading={tasksLoading} error={tasksError} onRetry={() => void loadTasks()} onCreate={() => navigate('new')} onOpen={id => navigate(`tasks/${id}`)} onApplications={() => navigate('applications')} />}
      {page === 'editor' && <TaskEditor key={`${actor.id}:${route.taskId || 'new'}`} registerSave={save => { editorSave.current = save }} taskId={route.taskId || null} actorId={actor.id} step={route.step} onStep={step => navigate(`tasks/${route.taskId}?step=${step}`, false)} onCreated={id => navigate(`tasks/${id}?step=clarify`)} onBack={() => navigate('workspace')} onSaved={() => void loadTasks()} onApplications={id => navigate(`applications?task=${id}`)} showToast={showToast} />}
      {page === 'catalog' && <CatalogPage key={actor.id} onToast={showToast} />}
      {page === 'applications' && <ApplicationsPage key={`${actor.id}:${route.applicationTask || ''}`} role={actor.kind} actor={actor} tasks={tasks} initialTaskId={route.applicationTask} onToast={showToast} onChanged={() => void loadTasks()} />}
    </main>{toast && <div className="toast" role="status"><Icon name="check" />{toast}<button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setToast('')}><Icon name="close" size={16} /></button></div>}
  </div>
}
