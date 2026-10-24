import { useEffect, useState, useCallback, useRef } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import { fmtTime } from '../lib/util'
import ProgressModal from '../components/ProgressModal.jsx'
import { useBulkProgress } from '../lib/useBulkProgress'

const TYPE_COLORS = {
  login_code:       'bg-brand-warn',
  login_request:    'bg-brand-ok',
  new_login:        'bg-brand-err',
  '2fa_change':     'bg-brand-violet',
  account_deletion: 'bg-brand-err',
  unknown:          'bg-white',
}

const CONFIRM_RE = /confirm|approve|accept|allow|yes/i
const DECLINE_RE = /decline|deny|cancel|reject|no/i

function buttonClass(text) {
  if (CONFIRM_RE.test(text || '')) return 'nb-btn-ok'
  if (DECLINE_RE.test(text || '')) return 'nb-btn-err'
  return 'nb-btn'
}

export function AccountRow({ account, focus, isSelected, focusTick, focused = false, onChange }) {
  const toast = useToast()
  const [open, setOpen] = useState(focused)
  const [msgs, setMsgs] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [highlightId, setHighlightId] = useState(null)
  const cardRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const m = await Endpoints.securityMessages(account.id)
      setMsgs(m)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
    // Sessions come from Telegram and can take a moment; don't hold the
    // message list hostage while they load.
    Endpoints.tgSessions(account.id)
      .then((s) => setSessions(s || []))
      .catch(() => setSessions([]))
  }, [account.id, toast])

  useEffect(() => { if (open) load() }, [open, load])

  // Arriving from a dashboard alert: open this account and mark the message.
  useEffect(() => {
    if (!focus || focus.accountId !== account.id) return
    setOpen(true)
    setHighlightId(focus.messageId)
  }, [focus?.ts, focus?.accountId, focus?.messageId, account.id])

  // Selecting an account in the sidebar opens and reveals its messages.
  useEffect(() => {
    if (!isSelected && !focused) return
    setOpen(true)
    if (focused) return
    // A dashboard alert will scroll to its exact message below.
    if (focus && focus.accountId === account.id) return
    const t = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => clearTimeout(t)
  }, [isSelected, focused, focusTick, focus?.ts, focus?.accountId, account.id])

  // Once the messages render, bring the requested one into view.
  useEffect(() => {
    if (!highlightId) return
    const el = document.getElementById(`sec-msg-${highlightId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, msgs])

  async function markRead(id) {
    try { await Endpoints.markRead(id); await load(); onChange?.() } catch (e) { toast.error(e.message) }
  }
  async function markAllRead() {
    try { await Endpoints.markAllRead(account.id); await load(); onChange?.() } catch (e) { toast.error(e.message) }
  }
  async function killSession(hash) {
    if (!confirm('Terminate this session?')) return
    try { await Endpoints.terminateSession(account.id, hash); await load() } catch (e) { toast.error(e.message) }
  }
  async function killOthers() {
    if (!confirm('Terminate ALL other sessions?')) return
    try { await Endpoints.terminateOthers(account.id); await load() } catch (e) { toast.error(e.message) }
  }

  async function backfill() {
    setLoading(true)
    try {
      await Endpoints.backfillSecurity(account.id, 50)
      await load()
      toast.success('Pulled latest messages from Telegram')
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }

  async function pressButton(m, b) {
    const label = b.text || 'button'
    if (!confirm(`Press "${label}" for this Telegram message?\n\n${(m.message_text || '').slice(0, 200)}`)) return
    setLoading(true)
    try {
      const r = await Endpoints.pressSecurityButton(m.id, b.index)
      toast.success(r?.answer && r.answer !== 'ok' ? r.answer : `Pressed: ${label}`)
      await load()
      onChange?.()
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }

  return (
    <div ref={cardRef} className="nb-card mb-3 overflow-hidden scroll-mt-4">
      <div
        className={
          'px-5 py-4 flex items-center gap-3 transition-colors ' +
          (focused ? '' : 'cursor-pointer hover:bg-[rgb(var(--ink)/0.025)]')
        }
        onClick={focused ? undefined : () => setOpen((o) => !o)}
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate tracking-[-0.01em]">
            {(account.first_name + ' ' + account.last_name).trim() || account.phone}
          </div>
          {focused && (
            <div className="font-mono text-[11px] text-muted mt-0.5">
              {account.phone}{account.username ? ` · @${account.username}` : ''}
            </div>
          )}
        </div>
        {account.has_2fa
          ? <span className="nb-badge bg-brand-info">2FA on</span>
          : <span className="nb-badge bg-brand-warn">2FA off</span>}
        {account.unread_security > 0 && (
          <span className="nb-badge bg-brand-err">{account.unread_security} new</span>
        )}
        {!focused && <span className="text-muted text-xs">{open ? 'Less' : 'More'}</span>}
      </div>
      {open && (
        <div className="px-5 pb-5 border-t border-[color:var(--hairline)]">
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="micro-label">Telegram service messages</span>
            <span className="text-[10px] text-muted">from &quot;Telegram&quot; · user 777000</span>
            <button className="nb-btn !py-1 !px-3 text-xs ml-auto" onClick={backfill} disabled={loading}>
              {loading ? '…' : 'Pull latest 50'}
            </button>
            <button className="nb-btn !py-1 !px-3 text-xs" onClick={markAllRead}>Mark all read</button>
            <button className="nb-btn !py-1 !px-3 text-xs" onClick={load}>Refresh</button>
          </div>
          {loading && <div className="text-sm text-muted mt-3">Loading…</div>}
          {!loading && msgs.length === 0 && (
            <div className="nb-note nb-note-info px-3 py-2 text-sm mt-3">
              No messages from Telegram yet. Try &quot;Pull latest 50&quot; to fetch history.
            </div>
          )}
          <div className="space-y-2 mt-3">
            {msgs.map((m) => (
              <div
                key={m.id}
                id={`sec-msg-${m.id}`}
                className={'nb-card-sm p-3 ' + (m.is_read ? 'opacity-60' : '')}
                style={m.id === highlightId ? { boxShadow: 'inset 3px 0 0 rgb(var(--accent-sun))' } : undefined}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`nb-badge ${TYPE_COLORS[m.type] || 'bg-white'}`}>{m.type}</span>
                  {!m.is_read && <span className="w-1.5 h-1.5 rounded-full bg-brand-err inline-block" />}
                  <span className="text-[10px] text-muted font-mono ml-auto">{fmtTime(m.received_at)}</span>
                </div>
                <div className={'whitespace-pre-wrap text-[12px] font-mono leading-5 ' + (m.is_read ? '' : 'text-ink')}>
                  {m.message_text}
                </div>
                {(m.buttons || []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {m.buttons.map((b) => {
                      if (b.type === 'url' && b.url) {
                        return (
                          <a key={b.index} href={b.url} target="_blank" rel="noreferrer"
                            className="nb-btn !py-1 !px-2 text-xs">
                            {b.text || 'Open'}
                          </a>
                        )
                      }
                      if (b.type !== 'callback') return null
                      return (
                        <button key={b.index}
                          className={buttonClass(b.text) + ' !py-1 !px-3 text-xs'}
                          disabled={loading || !!m.action_status}
                          onClick={() => pressButton(m, b)}>
                          {b.text || `Button ${b.index + 1}`}
                        </button>
                      )
                    })}
                  </div>
                )}
                {m.action_status && (
                  <div className="text-xs mt-1 opacity-70">Action taken: {m.action_status}</div>
                )}
                {!m.is_read && (
                  <button className="nb-btn !py-1 !px-2 text-xs mt-2" onClick={() => markRead(m.id)}>
                    Mark as read
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-2">
            <span className="micro-label">Active sessions</span>
            <button className="nb-btn-err !py-1 !px-3 text-xs ml-auto" onClick={killOthers}>Terminate all others</button>
          </div>
          <div className="space-y-2 mt-3">
            {sessions.length === 0 && <div className="text-sm text-muted">No sessions data.</div>}
            {sessions.map((s) => (
              <div key={s.hash} className="nb-card-sm p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {s.device || s.app_name || 'Unknown'} {s.is_current && <span className="nb-badge bg-brand-ok ml-1">current</span>}
                  </div>
                  <div className="text-[11px] text-muted truncate font-mono">
                    {s.platform} · {s.ip} · {s.country} · {fmtTime(s.date_created)}
                  </div>
                </div>
                {!s.is_current && (
                  <button className="nb-btn-err !py-1 !px-2 text-xs" onClick={() => killSession(s.hash)}>
                    Terminate
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Bulk change/set the Two-Step (2FA) password across many accounts at once.
function Bulk2faPanel({ accounts, onChange }) {
  const toast = useToast()
  const { progress, run, close } = useBulkProgress()
  const [open, setOpen] = useState(false)
  const [ids, setIds] = useState([])
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [hint, setHint] = useState('')
  const [bank, setBank] = useState([])        // current-password attempt bank (max 5)
  const [bankInput, setBankInput] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [knownCount, setKnownCount] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    Endpoints.twofaKnown().then((r) => setKnownCount(r?.count ?? 0)).catch(() => setKnownCount(null))
  }, [open])

  const allChecked = ids.length === accounts.length && accounts.length > 0
  const toggleAll = () => setIds(allChecked ? [] : accounts.map((a) => a.id))
  const toggle = (id) => setIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  function addBank() {
    const p = bankInput.trim()
    if (!p) return
    if (bank.length >= 5) { toast.error('Max 5 current passwords'); return }
    if (bank.includes(p)) { toast.info('Password already added'); setBankInput(''); return }
    setBank((arr) => [...arr, p]); setBankInput('')
  }
  const removeBank = (p) => setBank((arr) => arr.filter((x) => x !== p))

  async function start() {
    if (ids.length === 0) { toast.error('Pick at least one account'); return }
    if (!newPwd) { toast.error('Enter the new 2FA password'); return }
    if (newPwd.trim() !== newPwd2.trim()) { toast.error('New passwords do not match'); return }
    if (!confirm(
      `Set/change the Two-Step password on ${ids.length} account(s)?\n\n` +
      `For accounts that already have 2FA, your remembered passwords` +
      `${bank.length ? ` and ${bank.length} entered password(s)` : ''} are tried (up to 5 per account).`
    )) return
    setBusy(true)
    await run(`Bulk 2FA — ${ids.length} account(s)`, (onEvent) =>
      Endpoints.bulk2fa({ account_ids: ids, new_password: newPwd, hint, password_bank: bank }, onEvent))
    setBusy(false)
    onChange?.()  // refresh 2FA counts
  }

  return (
    <div className="nb-card p-5 mb-4">
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="micro-label">Bulk action</div>
          <div className="display-title text-[20px] mt-1">Two-step password</div>
        </div>
        <span className="nb-badge bg-brand-info">Many accounts</span>
        <span className="text-muted text-xs ml-auto">{open ? 'Less' : 'More'}</span>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="text-sm text-muted leading-6">
            Sets a new Two-Step password on every selected account. Accounts <b>without</b> 2FA get it
            turned on. Accounts that <b>already have</b> 2FA need their current password — we try each
            account's remembered password first (saved when you logged in), then the list below, at most
            5 tries per account.
            {knownCount != null && <> We currently remember <b>{knownCount}</b> password{knownCount === 1 ? '' : 's'} from login.</>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label>
              <div className="micro-label mb-2">New 2FA password</div>
              <input type={showPwd ? 'text' : 'password'} className="nb-input" value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)} placeholder="new password for all" />
            </label>
            <label>
              <div className="micro-label mb-2">Confirm new password</div>
              <input type={showPwd ? 'text' : 'password'} className="nb-input" value={newPwd2}
                onChange={(e) => setNewPwd2(e.target.value)} placeholder="repeat new password" />
            </label>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={showPwd} onChange={(e) => setShowPwd(e.target.checked)} />
              Show passwords
            </label>
            <label className="flex items-center gap-2 text-xs flex-1 min-w-[180px]">
              <span className="micro-label">Hint, optional</span>
              <input className="nb-input !py-1" maxLength={20} value={hint}
                onChange={(e) => setHint(e.target.value)} placeholder="max 20 chars" />
            </label>
          </div>

          {/* current-password attempt bank */}
          <div className="nb-card-sm p-3">
            <div className="micro-label mb-2">Current passwords to try, max 5</div>
            <div className="text-[11px] text-muted mb-3">
              For accounts that already have 2FA with a password we don't remember. Tried in order until one works.
            </div>
            <div className="flex gap-2 mb-2">
              <input type={showPwd ? 'text' : 'password'} className="nb-input !py-1 text-sm" value={bankInput}
                onChange={(e) => setBankInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBank() } }}
                placeholder="add a current password" disabled={bank.length >= 5} />
              <button className="nb-btn !px-3" onClick={addBank} disabled={bank.length >= 5}>Add</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {bank.length === 0 && <span className="text-[11px] text-muted">No passwords added yet.</span>}
              {bank.map((p, i) => (
                <span key={i} className="nb-badge bg-white text-ink flex items-center gap-1">
                  <span className="font-mono text-[11px] normal-case">{showPwd ? p : '•'.repeat(Math.min(p.length, 8))}</span>
                  <button className="opacity-60 hover:opacity-100" onClick={() => removeBank(p)}>✕</button>
                </span>
              ))}
            </div>
          </div>

          {/* account picker */}
          <div className="nb-card-sm p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="micro-label">Accounts</span>
              <button className="nb-btn !py-0.5 !px-2 text-[11px]" onClick={toggleAll}>{allChecked ? 'Clear' : 'Select all'}</button>
              <span className="text-xs opacity-70 ml-auto">{ids.length} selected</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-auto pr-1">
              {accounts.map((a) => (
                <label key={a.id} className={
                  'flex items-center gap-2 px-2 py-1.5 rounded-full cursor-pointer text-[12px] transition-colors ' +
                  (ids.includes(a.id)
                    ? 'bg-brand-pri/30 text-ink'
                    : 'text-muted hover:bg-[rgb(var(--ink)/0.04)] hover:text-ink')
                }>
                  <input type="checkbox" className="shrink-0" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
                  <span className="truncate">{((a.first_name || '') + ' ' + (a.last_name || '')).trim() || a.phone}</span>
                  {a.has_2fa
                    ? <span className="text-[9px] font-mono text-brand-info ml-auto shrink-0" title="already has 2FA">2FA</span>
                    : <span className="text-[9px] font-mono text-muted ml-auto shrink-0" title="no 2FA yet">off</span>}
                </label>
              ))}
            </div>
          </div>

          <button className="nb-btn-pri w-full" disabled={busy} onClick={start}>
            {busy ? 'Working…' : `Change 2FA on ${ids.length} account${ids.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      <ProgressModal progress={progress} onClose={close} />
    </div>
  )
}

function BulkTerminateSessionsPanel({ accounts, onChange }) {
  const toast = useToast()
  const { progress, run, close } = useBulkProgress()
  const [busy, setBusy] = useState(false)
  const accountCount = accounts.length

  async function start() {
    if (accountCount === 0) {
      toast.error('No accounts available')
      return
    }
    if (!confirm(
      `Terminate other Telegram sessions on ${accountCount} account(s)?\n\n` +
      `The current session used by this app is kept active for each account. ` +
      `Your Multi TG Manager website login will not be logged out.`
    )) return

    setBusy(true)
    await run(`Terminate sessions - ${accountCount} account(s)`, (onEvent) =>
      Endpoints.terminateOthersAll(onEvent))
    setBusy(false)
    onChange?.()
  }

  return (
    <div className="nb-card p-4 mb-4">
      <div className="flex items-start sm:items-center gap-4 flex-col sm:flex-row">
        <div className="flex-1">
          <div className="micro-label">Bulk action</div>
          <div className="display-title text-[20px] mt-1">All account sessions</div>
          <div className="text-sm text-muted mt-1">
            One click will remove every other Telegram login/device from every connected account, while keeping this app's current Telegram session active.
          </div>
        </div>
        <button className="nb-btn-err w-full sm:w-auto" disabled={busy || accountCount === 0} onClick={start}>
          {busy ? 'Working…' : `Terminate others on all (${accountCount})`}
        </button>
      </div>

      <ProgressModal progress={progress} onClose={close} />
    </div>
  )
}

export default function SecurityTab({ accounts, focusAlert, focusAccountId, focusTick, onChange }) {
  const selected = accounts.find((a) => a.id === focusAccountId) || null

  return (
    <div>
      <div className="nb-card p-5 mb-4">
        <div className="micro-label">Security</div>
        <div className="display-title text-[26px] mt-2">Telegram service messages</div>
        <div className="text-sm text-muted mt-2 max-w-[68ch] leading-6">
          Every message from the official Telegram account, shown on your phone as
          <b> &quot;Telegram&quot;</b> / <b>+42777</b>, per account. Pick an account
          from the sidebar to see its messages and active sessions. Login approvals
          include their Confirm and Decline buttons.
        </div>
      </div>

      <BulkTerminateSessionsPanel accounts={accounts} onChange={onChange} />
      <Bulk2faPanel accounts={accounts} onChange={onChange} />

      {!selected && (
        <div className="empty-state">
          <span className="empty-icon">◎</span>
          <div className="empty-title">No account selected</div>
          <div className="text-sm max-w-[32ch]">Choose an account from the sidebar to open its security details.</div>
        </div>
      )}

      {selected && (
        <>
          <div className="flex items-end justify-between gap-3 mb-2">
            <div>
              <div className="micro-label">Selected account</div>
              <div className="display-title text-[20px] mt-1">Security details</div>
            </div>
            <div className="text-[11px] text-muted">Switch account from the sidebar</div>
          </div>
          <AccountRow
            key={selected.id}
            account={selected}
            focus={focusAlert}
            isSelected
            focusTick={focusTick}
            focused
            onChange={onChange}
          />
        </>
      )}
    </div>
  )
}
