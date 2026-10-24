import { useEffect, useRef, useState } from 'react'

const STATUS_TONE = {
  ok: 'bg-brand-ok',
  failed: 'bg-brand-err',
  skipped: 'bg-brand-warn',
  pending: 'bg-brand-info',
}

function Badge({ label, n, color }) {
  if (!n) return null
  return <span className={'nb-badge text-ink ' + color}>{n} {label}</span>
}

// Live progress for a streaming bulk task. `progress` comes from useBulkProgress().
export default function ProgressModal({ progress, onClose }) {
  const listRef = useRef(null)
  const startRef = useRef(null)
  const [elapsed, setElapsed] = useState(0)
  // auto-scroll to newest row as they stream in
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [progress?.rows?.length])

  // elapsed-seconds timer: start when a run opens, stop when it's done
  const running = progress && !progress.done
  useEffect(() => {
    if (!progress) { startRef.current = null; setElapsed(0); return }
    if (startRef.current == null) startRef.current = Date.now()
    if (!running) return
    const t = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 200)
    return () => clearInterval(t)
  }, [progress, running])

  if (!progress) return null
  const { title, total, current, success, failed, skipped, pending, currentName, rows, done, error } = progress
  const pct = total > 0 ? Math.round((current / total) * 100) : (done ? 100 : 0)

  return (
    <div className="fixed inset-0 z-50 bg-ink/35 flex items-center justify-center p-4">
      <div className="nb-card p-6 w-full max-w-lg max-h-[85vh] flex flex-col rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="micro-label">Working</div>
            <h2 className="display-title text-[24px] mt-1">{title || 'Please wait'}</h2>
          </div>
          <button className="nb-btn !py-1 !px-3" onClick={onClose} disabled={!done} title={done ? 'Close' : 'Running…'}>Close</button>
        </div>

        {/* progress bar */}
        <div className="h-2 rounded-full bg-[rgb(var(--ink)/0.06)] overflow-hidden mb-3">
          <div className="h-full bg-ink transition-all duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-2 mb-4 flex-wrap text-xs">
          <span className="font-mono text-[11px] text-ink">{current}/{total || '…'}</span>
          <Badge label="ok" n={success} color="bg-brand-ok" />
          <Badge label="failed" n={failed} color="bg-brand-err" />
          <Badge label="pending" n={pending} color="bg-brand-info" />
          <Badge label="skipped" n={skipped} color="bg-brand-warn" />
          <span className="font-mono text-[11px] text-muted">{elapsed.toFixed(1)}s</span>
          <span className="ml-auto text-muted">
            {done ? (error ? 'Stopped' : 'Done') : (currentName ? `→ ${currentName}` : 'Starting…')}
          </span>
        </div>

        {error && (
          <div className="nb-note nb-note-err px-3 py-2 text-sm mb-3">{error}</div>
        )}

        <div ref={listRef} className="space-y-1 overflow-auto flex-1">
          {rows.map((r, i) => (
            <div key={i} className="nb-card-sm px-3 py-2 text-sm flex items-center gap-2">
              <span className={'w-2 h-2 rounded-full shrink-0 ' + (STATUS_TONE[r.status] || 'bg-ink/20')} />
              <span className="font-medium truncate">{r.name}</span>
              {r.detail && <span className="text-xs text-muted truncate ml-auto">{r.detail}</span>}
            </div>
          ))}
        </div>

        {done && (
          <button className="nb-btn-pri mt-4 w-full" onClick={onClose}>Close</button>
        )}
      </div>
    </div>
  )
}
