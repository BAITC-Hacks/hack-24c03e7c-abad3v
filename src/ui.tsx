import type { ReactNode } from 'react'
import type { Level, Topic } from './types'
export const topicOptions: Array<{ value: Topic; label: string }> = [
  { value: 'education', label: 'Образование' }, { value: 'career', label: 'Карьера' }, { value: 'operations', label: 'Операции' },
  { value: 'analytics', label: 'Аналитика' }, { value: 'other', label: 'Другое' },
]
export const levelOptions: Array<{ value: Level; label: string }> = [
  { value: 'needs_clarification', label: 'Нужно уточнить' }, { value: 'workable', label: 'Можно брать' },
  { value: 'ready', label: 'Готово к старту' }, { value: 'priority', label: 'Высокая готовность' },
]
export const levelName: Record<Level, string> = { needs_clarification: 'Нужно уточнить', workable: 'Можно брать', ready: 'Готово к старту', priority: 'Высокая готовность' }

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
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

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'yellow' | 'red' | 'blue' }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{children}</span>
}

export function levelTone(level: Level): 'green' | 'yellow' | 'blue' | 'red' {
  if (level === 'priority' || level === 'ready') return 'green'
  if (level === 'workable') return 'yellow'
  return 'red'
}

export function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  return <Badge tone={status === 'published' ? 'green' : 'neutral'}>{status === 'published' ? 'Опубликована' : 'Черновик'}</Badge>
}

export function RatingMeter({ score, small = false }: { score: number; small?: boolean }) {
  return <div className={`rating-meter ${small ? 'rating-meter-small' : ''}`}><span className="rating-track"><span className="rating-fill" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} /></span><strong>{score}</strong></div>
}


export function PageIntro({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="intro-action">{action}</div>}</div>
}

export function PrimaryButton({ children, onClick, disabled, icon, type = 'button', className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; icon?: string; type?: 'button' | 'submit'; className?: string }) {
  return <button type={type} className={`button button-primary ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={17} />}{children}</button>
}

export function SecondaryButton({ children, onClick, disabled, icon, className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; icon?: string; className?: string }) {
  return <button type="button" className={`button button-secondary ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={17} />}{children}</button>
}


export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={22} /></span><h3>{title}</h3><p>{text}</p>{action}</div>
}

