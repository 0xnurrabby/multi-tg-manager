import { useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

function ItemList({ title, items, tone }) {
  if (!items.length) return null
  return (
    <div className="nb-card-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={'w-2 h-2 rounded-full ' + tone} />
        <span className="micro-label">{title}</span>
        <span className="text-xs text-muted font-mono ml-auto">{items.length}</span>
      </div>
      <div className="space-y-2 max-h-72 overflow-auto">
        {items.map((r) => (
          <div key={r.id} className="border border-[color:var(--hairline)] rounded-[12px] p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{r.name}</span>
              <span className="text-[11px] text-muted ml-auto font-mono">{r.phone}</span>
            </div>
            <div className="text-[11px] text-muted mt-1">{r.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TargetCheckTab() {
  const toast = useToast()
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function search() {
    const t = target.trim()
    if (!t) {
      toast.error('Enter a username or link')
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const r = await Endpoints.targetCheck(t)
      setResult(r)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const totals = result
    ? {
        present: result.present?.length || 0,
        absent: result.absent?.length || 0,
        skipped: result.skipped?.length || 0,
        failed: result.failed?.length || 0,
      }
    : null

  return (
    <div className="space-y-5">
      <div className="nb-card p-5">
        <div className="micro-label">Discovery</div>
        <h2 className="display-title text-[26px] mt-2">Target checker</h2>
        <div className="text-sm text-muted mt-2 max-w-[68ch] leading-6">
          Search one bot, channel, group, or username across every connected
          account. See which accounts have already used or joined it, and which
          ones have not.
        </div>
        <div className="flex gap-2 mt-4 flex-col sm:flex-row">
          <input
            className="nb-input"
            placeholder="@username or t.me link"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          />
          <button className="nb-btn-pri shrink-0" disabled={busy} onClick={search}>
            {busy ? 'Checking…' : 'Search all accounts'}
          </button>
        </div>
      </div>

      {totals && (
        <div className="flex flex-wrap gap-2">
          <span className="nb-badge bg-brand-ok">Found {totals.present}</span>
          <span className="nb-badge bg-brand-warn">Not found {totals.absent}</span>
          <span className="nb-badge bg-brand-info">Skipped {totals.skipped}</span>
          <span className="nb-badge bg-brand-err">Failed {totals.failed}</span>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 stagger">
          <ItemList
            title={result.peer?.kind === 'bot' || result.peer?.kind === 'user' ? 'Not used yet' : 'Not joined yet'}
            items={result.absent || []}
            tone="bg-brand-warn"
          />
          <ItemList
            title={result.peer?.kind === 'bot' || result.peer?.kind === 'user' ? 'Already used' : 'Already joined'}
            items={result.present || []}
            tone="bg-brand-ok"
          />
          <ItemList title="Skipped" items={result.skipped || []} tone="bg-brand-info" />
          <ItemList title="Failed" items={result.failed || []} tone="bg-brand-err" />
        </div>
      )}
    </div>
  )
}
