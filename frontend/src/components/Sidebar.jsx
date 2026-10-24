import { useState } from 'react'
import { CopyButton } from '../lib/CopyButton'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import AccountAvatar from './AccountAvatar'
import ConfirmModal from './ConfirmModal'
import Icon from './Icon'

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
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false)
  const [passwordRemoveAll, setPasswordRemoveAll] = useState(false)
  const [removeAllPassword, setRemoveAllPassword] = useState('')
  const [removeAllBusy, setRemoveAllBusy] = useState(false)
  const [goneOpen, setGoneOpen] = useState(false)

  // Banned accounts drop out of the active list (they live in Gone/Banned).
  // Serial numbers are the 1-based position in this active list.
  const active = accounts.filter((a) => a.status !== 'banned')
  const totalAccounts = accounts.length

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

  function askRemoveAllPassword() {
    setConfirmRemoveAll(false)
    setRemoveAllPassword('')
    setPasswordRemoveAll(true)
  }

  function closeRemoveAllPassword() {
    if (removeAllBusy) return
    setPasswordRemoveAll(false)
    setRemoveAllPassword('')
  }

  async function removeAllAccounts() {
    if (!removeAllPassword) {
      toast.error('Enter app password')
      return
    }
    setRemoveAllBusy(true)
    try {
      const r = await Endpoints.removeAllAccounts(removeAllPassword)
      toast.success(`Removed ${r.removed || 0} account(s)`)
      setPasswordRemoveAll(false)
      setRemoveAllPassword('')
      onDeleted?.()
      onSelect?.(null)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRemoveAllBusy(false)
    }
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
    <aside className="app-sidebar w-[300px] xl:w-[320px] shrink-0 flex flex-col">
      <div className="px-5 py-4 border-b border-[color:var(--hairline)] flex items-end justify-between">
        <div>
          <div className="micro-label">Directory</div>
          <div className="display-title text-[22px] mt-1">Accounts</div>
        </div>
        <span className="nb-badge bg-brand-pri">{active.length}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {active.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="users" size={18} /></span>
            <div className="empty-title">No accounts yet</div>
            <div className="text-sm max-w-[28ch]">Add your first Telegram account to begin.</div>
          </div>
        )}
        {active.map((a, i) => {
          const sel = a.id === selectedId
          const serial = i + 1
          return (
            <div
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={'account-row flex items-start gap-3 px-4 py-3 ' + (sel ? 'account-row-active' : '')}
            >
              <div className="w-5 shrink-0 self-center text-right font-mono text-[11px] tracking-wide text-muted select-none">
                {serial}
              </div>
              <AccountAvatar account={a} size={40} showOnline />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-[14px] truncate tracking-[-0.01em]">
                    {(a.first_name + ' ' + a.last_name).trim() || a.phone}
                  </div>
                  {statusBadge(a.status)}
                </div>
                <div className="flex items-center gap-1 text-[11px] font-mono truncate text-muted mt-1">
                  <span className="truncate">{a.phone}</span>
                  <CopyButton value={a.phone} label="phone" />
                </div>
                {a.username ? (
                  <div className="flex items-center gap-1 text-[11px] font-mono truncate text-muted">
                    <span className="truncate">@{a.username}</span>
                    <CopyButton value={a.username} label="username" />
                  </div>
                ) : (
                  <div className="text-[11px] text-muted italic">no @username</div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  {a.has_2fa && <span className="nb-badge bg-brand-violet">2FA</span>}
                  {a.unread_security > 0 && (
                    <span className="nb-badge bg-brand-err">{a.unread_security} new</span>
                  )}
                  <button
                    className="ml-auto text-[11px] underline decoration-[color:var(--hairline)] underline-offset-2 text-muted hover:text-ink transition-colors"
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(a) }}
                  >remove</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {gone.length > 0 && (
        <div className="border-t border-[color:var(--hairline)] shrink-0">
          <button
            onClick={() => setGoneOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-[rgb(var(--ink)/0.025)] transition-colors"
          >
            <span className="micro-label normal-case tracking-[0.08em]">Gone / Banned</span>
            <span className="nb-badge bg-brand-err">{gone.length}</span>
            <span className="ml-auto text-muted text-xs">{goneOpen ? 'Less' : 'More'}</span>
          </button>
          {goneOpen && (
            <div className="max-h-72 overflow-auto border-t border-[color:var(--hairline)]">
              {gone.map((g) => (
                <div key={g.id} className="px-5 py-3 border-b border-[color:var(--hairline)] text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{goneName(g)}</span>
                    <span className={'nb-badge ' + (g.reason === 'banned' ? 'bg-brand-err' : 'bg-brand-warn')}>
                      {g.reason}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-muted shrink-0">was #{g.old_serial ?? '—'}</span>
                  </div>
                  <div className="font-mono text-muted truncate mt-1">
                    {g.phone}{g.username ? ` · @${g.username}` : ''}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-muted">{ago(g.gone_at)}</span>
                    <button
                      className="ml-auto text-[10px] underline text-muted hover:text-ink transition-colors"
                      onClick={() => dismissGone(g.id)}
                    >dismiss</button>
                  </div>
                </div>
              ))}
              <div className="p-3 text-center">
                <button className="text-[10px] underline text-muted hover:text-ink transition-colors" onClick={clearGone}>
                  clear all history
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-5 py-4 border-t border-[color:var(--hairline)] shrink-0 space-y-2">
        <button
          className="nb-btn-err w-full"
          disabled={totalAccounts === 0 || removeAllBusy}
          onClick={() => setConfirmRemoveAll(true)}
        >
          Remove all accounts
        </button>
        <button className="nb-btn-pri w-full" onClick={onAdd}>
          <Icon name="plus" size={16} />
          Add account
        </button>
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

      {confirmRemoveAll && (
        <ConfirmModal
          title="Remove all accounts?"
          message={`This will remove all ${totalAccounts} account(s), stop their clients, and delete their local session files.\n\nDo you want to continue?`}
          confirmLabel="Yes"
          cancelLabel="No"
          danger
          onConfirm={askRemoveAllPassword}
          onCancel={() => setConfirmRemoveAll(false)}
        />
      )}

      {passwordRemoveAll && (
        <div className="fixed inset-0 z-50 bg-ink/35 flex items-center justify-center p-4" onClick={closeRemoveAllPassword}>
          <div className="nb-card p-6 w-full max-w-sm rise" onClick={(e) => e.stopPropagation()}>
            <div className="micro-label">Confirm identity</div>
            <h2 className="display-title text-[24px] mt-2 mb-2">Enter password</h2>
            <div className="text-sm text-muted mb-4">
              Type the app password from your env file to remove all accounts.
            </div>
            <input
              type="password"
              className="nb-input mb-4"
              value={removeAllPassword}
              onChange={(e) => setRemoveAllPassword(e.target.value)}
              placeholder="App password"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') removeAllAccounts() }}
              disabled={removeAllBusy}
            />
            <div className="flex gap-2 justify-end">
              <button className="nb-btn" disabled={removeAllBusy} onClick={closeRemoveAllPassword}>Cancel</button>
              <button className="nb-btn-err" disabled={removeAllBusy || !removeAllPassword} onClick={removeAllAccounts}>
                {removeAllBusy ? 'Removing...' : 'Remove All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
