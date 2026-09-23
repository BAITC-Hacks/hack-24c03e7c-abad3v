import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Actor } from './types'
import { Icon } from './ui'
import './profile-switcher.css'

const groups = [
  { kind: 'business', label: 'Бизнес' },
  { kind: 'team', label: 'Студенческие команды' },
] as const

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('ru')
}

export function ProfileSwitcher({ actor, actors, busy, onChange }: {
  actor: Actor
  actors: Actor[]
  busy: boolean
  onChange: (id: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState(actor.id)
  const [pending, setPending] = useState(false)
  const changing = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const options = useRef(new Map<string, HTMLDivElement>())
  const search = useRef({ text: '', time: 0 })
  const id = useId()
  const disabled = busy || pending
  const ordered = groups.flatMap(group => actors.filter(item => item.kind === group.kind))
  const activeIndex = Math.max(0, ordered.findIndex(item => item.id === activeId))

  useEffect(() => {
    if (!open) return
    list.current?.focus({ preventScroll: true })
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (open) options.current.get(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeId])

  function show() {
    if (disabled || changing.current) return
    search.current = { text: '', time: 0 }
    setActiveId(actor.id)
    setOpen(true)
    if (open) list.current?.focus({ preventScroll: true })
  }

  function close() {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  async function choose(nextId: string) {
    if (disabled || changing.current) return
    close()
    if (nextId === actor.id) return
    // Keep repeat selections blocked while the editor finishes saving as well.
    changing.current = true
    setPending(true)
    try { await onChange(nextId) }
    finally { changing.current = false; setPending(false) }
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key === 'Tab') {
      // The trigger is the previous tab stop; close before returning focus to it.
      if (event.shiftKey) { event.preventDefault(); close() }
      return
    }
    if (disabled || !ordered.length) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      void choose(ordered[activeIndex].id)
      return
    }
    const next = event.key === 'ArrowDown' ? (activeIndex + 1) % ordered.length
      : event.key === 'ArrowUp' ? (activeIndex - 1 + ordered.length) % ordered.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : -1
    if (next >= 0) { event.preventDefault(); setActiveId(ordered[next].id); return }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = Date.now()
      const key = event.key.toLocaleLowerCase('ru')
      const text = now - search.current.time < 600 ? search.current.text + key : key
      search.current = { text, time: now }
      const match = [...ordered.slice(activeIndex + 1), ...ordered.slice(0, activeIndex + 1)]
        .find(item => item.name.toLocaleLowerCase('ru').startsWith(text))
      if (match) setActiveId(match.id)
    }
  }

  return <div className="profile-switch" ref={root} data-open={open} aria-busy={disabled}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button type="button" className="profile-trigger" ref={trigger}
      aria-label={`Сменить профиль: ${actor.name}, ${actor.kind === 'business' ? 'бизнес' : 'команда'}`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-disabled={disabled}
      onClick={() => { if (!disabled) { if (open) close(); else show() } }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() } }}>
      <span className="profile-avatar" data-kind={actor.kind} aria-hidden="true">{initials(actor.name)}</span>
      <span className="profile-trigger-copy">
        <span className="profile-trigger-role">{disabled ? 'Переключаем профиль…' : `${actor.kind === 'business' ? 'Бизнес' : 'Команда'} · демо`}</span>
        <strong className="profile-trigger-name">{actor.name}</strong>
      </span>
      <span className="profile-chevron"><Icon name="chevron" size={17} /></span>
    </button>
    {open && <div className="profile-popover">
      <div className="profile-menu-heading"><strong id={`${id}-heading`}>Сменить профиль</strong><span className="profile-demo-badge">Демо</span></div>
      <div className="profile-listbox" id={`${id}-list`} ref={list} role="listbox" tabIndex={-1}
        aria-labelledby={`${id}-heading`} aria-activedescendant={ordered.length ? `${id}-option-${activeIndex}` : undefined}
        onKeyDown={handleKey}>
        {groups.map(group => {
          const items = ordered.filter(item => item.kind === group.kind)
          return items.length > 0 && <div className="profile-group" key={group.kind} role="group" aria-labelledby={`${id}-${group.kind}`}>
            <div className="profile-group-label" id={`${id}-${group.kind}`}>{group.label}</div>
            {items.map(item => <div className="profile-option" key={item.id}
              ref={element => { if (element) options.current.set(item.id, element); else options.current.delete(item.id) }}
              id={`${id}-option-${ordered.indexOf(item)}`} role="option" aria-selected={item.id === actor.id}
              data-active={item.id === activeId} aria-label={item.name}
              onClick={() => void choose(item.id)}>
              <span className="profile-avatar" data-kind={item.kind} aria-hidden="true">{initials(item.name)}</span>
              <span className="profile-option-copy"><span className="profile-option-name">{item.name}</span><span className="profile-option-role">{item.kind === 'business' ? 'Публикация задач' : 'Работа над задачами'}</span></span>
              {item.id === actor.id && <span className="profile-option-check"><Icon name="check" size={16} /></span>}
            </div>)}
          </div>
        })}
      </div>
    </div>}
  </div>
}
