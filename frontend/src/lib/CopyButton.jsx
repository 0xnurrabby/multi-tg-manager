import { useState } from 'react'

export function CopyButton({ value, label = '' }) {
  const [done, setDone] = useState(false)
  if (!value) return null
  const copy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(String(value))
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {}
  }
  return (
    <button
      onClick={copy}
      title={`Copy ${label || value}`}
      className={
        'inline-flex items-center justify-center w-6 h-6 rounded-full border border-[color:var(--hairline)] text-[10px] font-medium transition-colors ' +
        (done
          ? 'bg-brand-ok text-ink'
          : 'bg-transparent text-muted hover:border-[color:var(--hairline-strong)] hover:text-ink')
      }
    >
      {done ? '✓' : '⧉'}
    </button>
  )
}
