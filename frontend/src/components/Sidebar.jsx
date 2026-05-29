import { useState } from 'react'
import { CopyButton } from '../lib/CopyButton'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import AccountAvatar from './AccountAvatar'
import ConfirmModal from './ConfirmModal'

function statusBadge(status) {
  if (status === 'connected') return <span className="nb-badge bg-brand-ok text-black">Connected</span>
  if (status === 'banned')    return <span className="nb-badge bg-brand-err text-black">Banned</span>
  return <span className="nb-badge bg-brand-warn text-black">Disconnected</span>
}

// gone_at comes from the backend as a naive UTC ISO string (no timezone), so we
// force UTC interpretation before diffing against the local clock.
function ago(iso) {
  if (!iso) return ''
  const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z'
  const t = new Date(norm).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`
  return new Date(norm).toLocaleDateString()
}

const goneName = (g) => `${g.first_name || ''} ${g.last_name || ''}`.trim() || g.phone

export default function Sidebar({ accounts, gone = [], selectedId, onSelect, onAdd, onDeleted, onGoneChange }) {
  const toast = useToast()
  const [pendingDelete, setPendingDelete] = useState(null)  // account pending removal
  const [goneOpen, setGoneOpen] = useState(false)

  // Banned accounts drop out of the active list (they live in Gone/Banned).
  // Serial numbers are the 1-based position in this active list.
  const active = accounts.filter((a) => a.status !== 'banned')

  async function confirmDelete() {
    const a = pendingDelete
    setPendingDelete(null)
    if (!a) return
    try {
      await Endpoints.deleteAccount(a.id)
      toast.success('Account removed')
      onDeleted?.()
    } catch (err) { toast.error(err.message) }
  }

  async function clearGone() {
    try { await Endpoints.clearGoneAccounts(); onGoneChange?.() }
    catch (err) { toast.error(err.message) }
  }
  async function dismissGone(id) {
    try { await Endpoints.deleteGoneAccount(id); onGoneChange?.() }
    catch (err) { toast.error(err.message) }
  }

  return (
    <aside className="w-[320px] border-r-2 border-black dark:border-white bg-white dark:bg-zinc-900 flex flex-col">
      <div className="p-3 border-b-2 border-black dark:border-white flex items-center justify-between">
        <span className="font-extrabold uppercase tracking-tight">Accounts ({active.length})</span>
      </div>
      <div className="flex-1 overflow-auto">
        {active.length === 0 && (
          <div className="p-4 text-sm opacity-70">No accounts yet. Add your first account below.</div>
        )}
        {active.map((a, i) => {
          const sel = a.id === selectedId
          const serial = i + 1
          return (
            <div
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={
                'flex items-start gap-2 p-3 border-b-2 border-black dark:border-white cursor-pointer transition-colors ' +
                (sel ? 'bg-brand-pri text-black' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800')
              }
            >
              <div className="w-5 shrink-0 self-center text-right font-mono text-xs font-bold opacity-50 select-none">
                {serial}
              </div>
              <AccountAvatar account={a} size={40} showOnline />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold truncate">
                    {(a.first_name + ' ' + a.last_name).trim() || a.phone}
                  </div>
                  {statusBadge(a.status)}
                </div>
                <div className="flex items-center gap-1 text-xs font-mono truncate">
                  <span className="truncate">{a.phone}</span>
                  <CopyButton value={a.phone} label="phone" />
                </div>
                {a.username ? (
                  <div className="flex items-center gap-1 text-xs font-mono truncate opacity-80">
                    <span className="truncate">@{a.username}</span>
                    <CopyButton value={a.username} label="username" />
                  </div>
                ) : (
                  <div className="text-xs opacity-50 italic">no @username</div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  {a.has_2fa && <span className="nb-badge bg-brand-violet text-black">2FA</span>}
                  {a.unread_security > 0 && (
                    <span className="nb-badge bg-brand-err text-black">{a.unread_security} new</span>
                  )}
                  <button
                    className="ml-auto text-[10px] underline opacity-60 hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(a) }}
                  >remove</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {gone.length > 0 && (
        <div className="border-t-2 border-black dark:border-white shrink-0">
          <button
            onClick={() => setGoneOpen((o) => !o)}
            className="w-full flex items-center gap-2 p-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="font-extrabold uppercase tracking-tight text-sm">Gone / Banned</span>
            <span className="nb-badge bg-brand-err text-black">{gone.length}</span>
            <span className="ml-auto opacity-60">{goneOpen ? '▲' : '▼'}</span>
          </button>
          {goneOpen && (
            <div className="max-h-72 overflow-auto border-t border-black/20 dark:border-white/20">
              {gone.map((g) => (
                <div key={g.id} className="px-3 py-2 border-b border-black/15 dark:border-white/15 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold truncate">{goneName(g)}</span>
                    <span className={'nb-badge text-black ' + (g.reason === 'banned' ? 'bg-brand-err' : 'bg-brand-warn')}>
                      {g.reason}
                    </span>
                    <span className="ml-auto font-mono opacity-60 shrink-0">was #{g.old_serial ?? '—'}</span>
                  </div>
                  <div className="font-mono opacity-70 truncate">
                    {g.phone}{g.username ? ` · @${g.username}` : ''}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="opacity-50">{ago(g.gone_at)}</span>
                    <button
                      className="ml-auto text-[10px] underline opacity-50 hover:opacity-100"
                      onClick={() => dismissGone(g.id)}
                    >dismiss</button>
                  </div>
                </div>
              ))}
              <div className="p-2 text-center">
                <button className="text-[10px] underline opacity-60 hover:opacity-100" onClick={clearGone}>
                  clear all history
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="p-3 border-t-2 border-black dark:border-white shrink-0">
        <button className="nb-btn-pri w-full" onClick={onAdd}>+ Add Account</button>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Remove account?"
          message={`${(pendingDelete.first_name + ' ' + pendingDelete.last_name).trim() || pendingDelete.phone}\n${pendingDelete.phone}\n\nThe session file will be deleted. This cannot be undone.`}
          confirmLabel="Yes, remove"
          cancelLabel="No, keep"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  )
}
