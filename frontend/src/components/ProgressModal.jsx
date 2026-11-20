import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const STATUS_TONE = {
  ok: 'bg-brand-ok',
  failed: 'bg-brand-err',
  skipped: 'bg-brand-warn',
  pending: 'bg-brand-info',
}

// 900+ rows in the DOM make the modal slow and tall; keep the newest ones only.
const MAX_ROWS = 300

function Badge({ label, n, color }) {
  if (!n) return null
  return <span className={'nb-badge text-ink ' + color}>{n} {label}</span>
}

// Live progress for a streaming bulk task. `progress` comes from useBulkProgress().
// The card has a fixed, compact height; the row list scrolls inside it.
export default function ProgressModal({ progress, onClose }) {
  const listRef = useRef(null)
  const startRef = useRef(null)
  const stickRef = useRef(true)
  const [elapsed, setElapsed] = useState(0)

  // auto-scroll to the newest row, unless the user scrolled up to read something
  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [progress?.rows?.length])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  // elapsed-seconds timer: start when a run opens, stop when it's done
  const running = progress && !progress.done
  useEffect(() => {
    if (!progress) {
      startRef.current = null
      stickRef.current = true
      setElapsed(0)
      return
    }
    if (startRef.current == null) startRef.current = Date.now()
    if (!running) return
    const t = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 200)
    return () => clearInterval(t)
  }, [progress, running])

  if (!progress) return null
  const { title, total, current, success, failed, skipped, pending, currentName, rows, done, error } = progress
  const pct = total > 0 ? Math.round((current / total) * 100) : (done ? 100 : 0)
  const all = rows || []
  const hidden = Math.max(0, all.length - MAX_ROWS)
  const visible = hidden > 0 ? all.slice(-MAX_ROWS) : all

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-ink/35 flex items-center justify-center p-4">
      <div
        className="nb-card p-5 w-full max-w-lg flex flex-col overflow-hidden rise"
        style={{ height: 'min(560px, 85vh)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-3 shrink-0">
          <div className="min-w-0">
            <div className="micro-label">Working</div>
            <h2 className="display-title text-[22px] mt-1 truncate">{title || 'Please wait'}</h2>
          </div>
          <button className="nb-btn !py-1 !px-3 shrink-0" onClick={onClose} disabled={!done} title={done ? 'Close' : 'Running…'}>
            Close
          </button>
        </div>

        <div className="h-2 rounded-full bg-[rgb(var(--ink)/0.06)] overflow-hidden mb-3 shrink-0">
          <div className="h-full bg-ink transition-all duration-200" style={{ width: `${pct}%` }} />
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap text-xs shrink-0">
          <span className="font-mono text-[11px] text-ink">{current}/{total || '…'}</span>
          <Badge label="ok" n={success} color="bg-brand-ok" />
          <Badge label="failed" n={failed} color="bg-brand-err" />
          <Badge label="pending" n={pending} color="bg-brand-info" />
          <Badge label="skipped" n={skipped} color="bg-brand-warn" />
          <span className="font-mono text-[11px] text-muted">{elapsed.toFixed(1)}s</span>
          <span className="ml-auto text-muted truncate max-w-[45%]">
            {done ? (error ? 'Stopped' : 'Done') : (currentName ? `→ ${currentName}` : 'Starting…')}
          </span>
        </div>

        {error && (
          <div className="nb-note nb-note-err px-3 py-2 text-sm mb-3 shrink-0">{error}</div>
        )}

        {hidden > 0 && (
          <div className="text-[10px] text-muted mb-1 shrink-0">
            Showing the latest {MAX_ROWS} of {all.length} rows
          </div>
        )}

        <div
          ref={listRef}
          onScroll={onScroll}
          className="space-y-1 overflow-y-auto min-h-0 flex-1 pr-1"
        >
          {visible.map((r, i) => (
            <div key={i} className="nb-card-sm px-3 py-1.5 text-sm flex items-center gap-2">
              <span className={'w-2 h-2 rounded-full shrink-0 ' + (STATUS_TONE[r.status] || 'bg-ink/20')} />
              <span className="font-medium truncate">{r.name}</span>
              {r.detail && <span className="text-xs text-muted truncate ml-auto">{r.detail}</span>}
            </div>
          ))}
        </div>

        {done && (
          <button className="nb-btn-pri mt-3 w-full shrink-0" onClick={onClose}>Close</button>
        )}
      </div>
    </div>,
    document.body,
  )
}
