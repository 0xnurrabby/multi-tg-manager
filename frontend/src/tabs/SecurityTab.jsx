import { useEffect, useState, useCallback, useRef } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import { fmtTime, accountAge, sortByAge } from '../lib/util'
import ProgressModal from '../components/ProgressModal.jsx'
import LoginEmailCard from '../components/LoginEmailCard.jsx'
import RecoveryEmailCard from '../components/RecoveryEmailCard.jsx'
import NurMailProviderCard from '../components/NurMailProviderCard.jsx'
import { useBulkProgress } from '../lib/useBulkProgress'

const TYPE_COLORS = {
  login_code:       'bg-brand-warn',
  login_request:    'bg-brand-ok',
  new_login:        'bg-brand-err',
  '2fa_change':     'bg-brand-violet',
  account_deletion: 'bg-brand-err',
  reset_request:    'bg-brand-err',
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
  const [pendingPress, setPendingPress] = useState(null)
  const cardRef = useRef(null)
  const lastMaxRef = useRef(0)
  const onChangeRef = useRef(onChange)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const m = await Endpoints.securityMessages(account.id)
      setMsgs(m)
      const maxId = (m || []).reduce((mx, row) => Math.max(mx, row.id || 0), 0)
      if (lastMaxRef.current && maxId > lastMaxRef.current) onChangeRef.current?.()
      lastMaxRef.current = maxId
    } catch (e) {
      if (!silent) toast.error(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [account.id, toast])

  const loadSessions = useCallback(() => {
    // Sessions come from Telegram and can take a moment; don't hold the
    // message list hostage while they load.
    Endpoints.tgSessions(account.id)
      .then((s) => setSessions(s || []))
      .catch(() => setSessions([]))
  }, [account.id])

  const load = useCallback(async () => {
    await loadMessages(false)
    loadSessions()
  }, [loadMessages, loadSessions])

  useEffect(() => {
    if (!open) return
    loadMessages(false)
    loadSessions()
    const id = setInterval(() => {
      if (!document.hidden) loadMessages(true)
    }, 2500)
    return () => clearInterval(id)
  }, [open, loadMessages, loadSessions])

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

  function askPress(m, b) {
    setPendingPress({ messageId: m.id, button: b, label: b.text || 'button' })
  }

  async function confirmPress() {
    const pending = pendingPress
    if (!pending) return
    setPendingPress(null)
    setLoading(true)
    try {
      const r = await Endpoints.pressSecurityButton(pending.messageId, pending.button.index)
      toast.success(r?.answer && r.answer !== 'ok' ? r.answer : `Pressed: ${pending.label}`)
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
                          onClick={() => askPress(m, b)}>
                          {b.text || `Button ${b.index + 1}`}
                        </button>
                      )
                    })}
                  </div>
                )}
                {pendingPress?.messageId === m.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--hairline)] bg-[rgb(var(--ink)/0.04)] px-3 py-2">
                    <span className="text-xs">
                      Press <strong>{pendingPress.label}</strong> for this message?
                    </span>
                    <button
                      className="nb-btn !py-1 !px-3 text-xs"
                      onClick={() => setPendingPress(null)}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button
                      className="nb-btn-pri !py-1 !px-3 text-xs"
                      onClick={confirmPress}
                      disabled={loading}
                    >
                      {loading ? 'Pressing…' : 'Confirm'}
                    </button>
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

const TTL_OPTIONS = [
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
  { days: 365, label: '12 months' },
  { days: 548, label: '18 months' },
  { days: 730, label: '24 months' },
]

// Telegram's "If away for": how long an account may stay unopened before it is
// deleted. Telegram accepts only 30/90/180/365/548/730 days.
function AccountTtlPanel({ accounts, onChange }) {
  const toast = useToast()
  const { progress, run, close } = useBulkProgress()
  const [busy, setBusy] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [tally, setTally] = useState(null)
  const connectedCount = accounts.filter((a) => a.status === 'connected').length

  async function scan() {
    if (accounts.length === 0) {
      toast.error('No accounts available')
      return
    }
    setScanBusy(true)
    const counts = {}
    try {
      await run(`Self-destruct timers - ${accounts.length} accounts`, (onEvent) =>
        Endpoints.ttlScan((evt) => {
          if (evt.type === 'progress' && evt.status === 'ok') {
            const m = /(\d+)\s*days/.exec(evt.detail || '')
            if (m) counts[m[1]] = (counts[m[1]] || 0) + 1
          }
          onEvent(evt)
        }))
      setTally(counts)
    } finally {
      setScanBusy(false)
    }
  }

  async function apply(days, label) {
    if (accounts.length === 0) {
      toast.error('No accounts available')
      return
    }
    if (!confirm(
      `Set "If away for" to ${label} on all ${connectedCount} connected account(s)?\n\n` +
      `Telegram deletes an account only if it is not opened within that period. ` +
      `A longer value keeps the accounts safer.`
    )) return
    setBusy(true)
    try {
      await run(`Self-destruct ${label} - ${connectedCount} accounts`, (onEvent) =>
        Endpoints.ttlSet(days, null, onEvent))
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nb-card p-4 mb-4">
      <div className="flex items-start sm:items-center gap-4 flex-col sm:flex-row">
        <div className="flex-1">
          <div className="micro-label">Bulk action</div>
          <div className="display-title text-[20px] mt-1">Account self-destruct</div>
          <div className="text-sm text-muted mt-1">
            Sets the same <b>“If away for”</b> period on all <b>{connectedCount}</b> connected
            accounts in one click — longer is safer, shorter deletes unused accounts sooner.
          </div>
        </div>
        <button className="nb-btn w-full sm:w-auto" disabled={scanBusy} onClick={scan}>
          {scanBusy ? 'Reading…' : 'Read current timers'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {TTL_OPTIONS.map((o) => (
          <button
            key={o.days}
            className="nb-btn-pri !py-1.5 !px-4 text-xs"
            disabled={busy}
            onClick={() => apply(o.days, o.label)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {tally && (
        <div className="mt-4">
          <div className="micro-label mb-2">Current values</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(tally)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([days, n]) => (
                <span key={days} className="nb-badge bg-white text-ink">{days} days · {n}</span>
              ))}
            {Object.keys(tally).length === 0 && (
              <span className="text-xs text-muted">Nothing read yet.</span>
            )}
          </div>
        </div>
      )}

      <ProgressModal progress={progress} onClose={close} />
    </div>
  )
}

// Bulk change/set the Two-Step (2FA) password across many accounts at once.
function Bulk2faPanel({ accounts, onChange }) {
  const toast = useToast()
  const { progress, run, close } = useBulkProgress()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('on')          // 'on' | 'off'
  const [ids, setIds] = useState([])
  const [query, setQuery] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [hint, setHint] = useState('')
  const [bank, setBank] = useState([])            // current-password attempt bank (max 5)
  const [bankInput, setBankInput] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [knownCount, setKnownCount] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    Endpoints.twofaKnown().then((r) => setKnownCount(r?.count ?? 0)).catch(() => setKnownCount(null))
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = sortByAge(q
    ? accounts.filter((a) =>
        `${a.first_name || ''} ${a.last_name || ''} ${a.phone || ''} ${a.username || ''}`
          .toLowerCase()
          .includes(q))
    : accounts)

  const allChecked = filtered.length > 0 && filtered.every((a) => ids.includes(a.id))
  const no2fa = filtered.filter((a) => !a.has_2fa)
  const with2fa = filtered.filter((a) => a.has_2fa)
  const selectedAccounts = accounts.filter((a) => ids.includes(a.id))
  const allNo2fa = ids.length > 0 && selectedAccounts.every((a) => !a.has_2fa)
  const anyWith2fa = selectedAccounts.some((a) => a.has_2fa)

  const toggleAll = () => {
    if (allChecked) {
      const drop = new Set(filtered.map((a) => a.id))
      setIds((arr) => arr.filter((x) => !drop.has(x)))
    } else {
      setIds((arr) => Array.from(new Set([...arr, ...filtered.map((a) => a.id)])))
    }
  }
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

    if (mode === 'off') {
      if (!confirm(
        `Turn OFF Two-Step Verification on ${ids.length} account(s)?\n\n` +
        `Each account's remembered password is tried first` +
        `${bank.length ? `, then your ${bank.length} listed password(s)` : ''} ` +
        `(max 5 tries per account).`
      )) return
      setBusy(true)
      await run(`2FA off — ${ids.length} account(s)`, (onEvent) =>
        Endpoints.bulk2faOff({ account_ids: ids, password_bank: bank }, onEvent))
      setBusy(false)
      onChange?.()
      return
    }

    if (!newPwd) { toast.error('Enter the new 2FA password'); return }
    if (newPwd.trim() !== newPwd2.trim()) { toast.error('New passwords do not match'); return }
    if (!confirm(
      allNo2fa
        ? `Add 2FA to ${ids.length} account(s) that currently have no 2FA?\n\nNo current password is needed for these accounts.`
        : `Set/change the Two-Step password on ${ids.length} account(s)?\n\n` +
          `For accounts that already have 2FA, your remembered passwords` +
          `${bank.length ? ` and ${bank.length} entered password(s)` : ''} are tried (up to 5 per account).`
    )) return
    setBusy(true)
    await run(`Bulk 2FA — ${ids.length} account(s)`, (onEvent) =>
      Endpoints.bulk2fa({ account_ids: ids, new_password: newPwd, hint, password_bank: bank }, onEvent))
    setBusy(false)
    onChange?.()
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
          <div className="flex flex-wrap gap-1">
            <button
              className={'nb-tab ' + (mode === 'on' ? 'nb-tab-active' : '')}
              onClick={() => setMode('on')}
            >
              Turn on / change
            </button>
            <button
              className={'nb-tab ' + (mode === 'off' ? 'nb-tab-active' : '')}
              onClick={() => setMode('off')}
            >
              Turn off
            </button>
          </div>

          {mode === 'on' ? (
            <>
              <div className="text-sm text-muted leading-6">
                Sets a new Two-Step password on every selected account. Accounts <b>without</b> 2FA
                get it turned on. Accounts that <b>already have</b> 2FA need their current password —
                we try each account's remembered password first (saved when you logged in), then the
                list below, at most 5 tries per account.
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
            </>
          ) : (
            <div className="text-sm text-muted leading-6">
              Removes the Two-Step password from every selected account, so they log in with just
              the code. Each account's remembered password is tried first, then the list below
              (max 5 tries per account).
              {knownCount != null && <> We currently remember <b>{knownCount}</b> password{knownCount === 1 ? '' : 's'}.</>}
            </div>
          )}

          {/* current-password attempt bank */}
          {(mode === 'off' || anyWith2fa) && (
            <div className="nb-card-sm p-3">
              <div className="micro-label mb-2">Current passwords to try, max 5</div>
              <div className="text-[11px] text-muted mb-3">
                For accounts where the saved password doesn't work. Tried in order until one is accepted.
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
          )}

          {mode === 'on' && allNo2fa && (
            <div className="nb-note nb-note-info px-3 py-2 text-sm">
              All selected accounts have 2FA off, so no current password is needed.
            </div>
          )}

          {/* account picker with search */}
          <div className="nb-card-sm p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="micro-label">Accounts</span>
              <button className="nb-btn !py-0.5 !px-2 text-[11px]" onClick={toggleAll}>
                {allChecked ? 'Clear shown' : `Select all shown (${filtered.length})`}
              </button>
              {mode === 'off' && with2fa.length > 0 && (
                <button
                  className="nb-btn !py-0.5 !px-2 text-[11px]"
                  onClick={() => setIds((arr) => Array.from(new Set([...arr, ...with2fa.map((a) => a.id)])))}
                >
                  Select with 2FA ({with2fa.length})
                </button>
              )}
              {mode === 'on' && no2fa.length > 0 && (
                <button
                  className="nb-btn !py-0.5 !px-2 text-[11px]"
                  onClick={() => setIds((arr) => Array.from(new Set([...arr, ...no2fa.map((a) => a.id)])))}
                >
                  Select without 2FA ({no2fa.length})
                </button>
              )}
              <span className="text-xs opacity-70 ml-auto">{ids.length} selected</span>
            </div>

            <input
              className="nb-input !py-1 text-sm mb-2"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, country code or @username…"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-auto pr-1">
              {filtered.map((a) => (
                <label key={a.id} className={
                  'flex items-center gap-2 px-2 py-1.5 rounded-full cursor-pointer text-[12px] transition-colors ' +
                  (ids.includes(a.id)
                    ? 'bg-brand-pri/30 text-ink'
                    : 'text-muted hover:bg-[rgb(var(--ink)/0.04)] hover:text-ink')
                }>
                  <input type="checkbox" className="shrink-0" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
                  <span className="truncate">{((a.first_name || '') + ' ' + (a.last_name || '')).trim() || a.phone}</span>
                  <span className="text-[10px] font-mono text-muted truncate">{a.phone}</span>
                  <span className="text-[9px] font-mono text-muted shrink-0">{accountAge(a)}</span>
                  {a.has_2fa
                    ? <span className="text-[9px] font-mono text-brand-info ml-auto shrink-0" title="already has 2FA">2FA</span>
                    : <span className="text-[9px] font-mono text-muted ml-auto shrink-0" title="no 2FA yet">off</span>}
                </label>
              ))}
              {filtered.length === 0 && (
                <div className="text-xs text-muted px-2 py-3">No account matches “{query}”.</div>
              )}
            </div>
          </div>

          <button className="nb-btn-pri w-full" disabled={busy} onClick={start}>
            {busy
              ? 'Working...'
              : mode === 'off'
                ? `Turn off 2FA on ${ids.length} account${ids.length === 1 ? '' : 's'}`
                : `${allNo2fa ? 'Add 2FA to' : 'Change 2FA on'} ${ids.length} account${ids.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      <ProgressModal progress={progress} onClose={close} />
    </div>
  )
}

function EmailSetupPanel({ accounts, onChange }) {
  const toast = useToast()
  const { progress, run, close } = useBulkProgress()
  const [conc, setConc] = useState(5)
  const [doLogin, setDoLogin] = useState(true)
  const [doRecovery, setDoRecovery] = useState(true)
  const [query, setQuery] = useState('')
  const [ids, setIds] = useState([])
  const [busy, setBusy] = useState(false)

  const connected = accounts.filter((a) => a.status === 'connected')
  const q = query.trim().toLowerCase()
  const filtered = sortByAge(q
    ? connected.filter((a) =>
        `${a.first_name || ''} ${a.last_name || ''} ${a.phone || ''} ${a.username || ''}`
          .toLowerCase()
          .includes(q))
    : connected)
  const allChecked = filtered.length > 0 && filtered.every((a) => ids.includes(a.id))
  const targetCount = ids.length || connected.length

  const toggleAll = () => {
    if (allChecked) {
      const drop = new Set(filtered.map((a) => a.id))
      setIds((arr) => arr.filter((x) => !drop.has(x)))
    } else {
      setIds((arr) => Array.from(new Set([...arr, ...filtered.map((a) => a.id)])))
    }
  }
  const toggle = (id) => setIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  async function start() {
    if (!doLogin && !doRecovery) {
      toast.error('Tick login email, recovery email, or both')
      return
    }
    const count = ids.length || connected.length
    if (!count) {
      toast.error('No connected accounts')
      return
    }
    if (!confirm(
      `Run email setup on ${count} account(s)?\n\n` +
      `${doLogin ? '• Login email: switch to a readable NurMail mailbox (requires an existing login email)\n' : ''}` +
      `${doRecovery ? '• Recovery email: same mailbox, 2FA code confirmed automatically\n' : ''}` +
      `• ${conc} accounts run in parallel, no separate runs needed`
    )) return
    setBusy(true)
    try {
      await run(`Email setup · ${count} accounts`, (onEvent) =>
        Endpoints.autoEmail({
          account_ids: ids.length ? ids : null,
          concurrency: conc,
          login: doLogin,
          recovery: doRecovery,
        }, onEvent))
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nb-card p-4 mb-4">
      <div className="flex items-start sm:items-center gap-4 flex-col sm:flex-row">
        <div className="flex-1">
          <div className="micro-label">Bulk action</div>
          <div className="display-title text-[20px] mt-1">Login + recovery email</div>
          <div className="text-sm text-muted mt-1">
            One run does both. The login mailbox is reused for the recovery email;
            if that is not possible a fresh NurMail mailbox is generated. Accounts
            without any login email can only get a recovery email (Telegram blocks
            the first login email through an app).
          </div>
        </div>
        <label className="text-xs">
          <div className="micro-label mb-1">Parallel</div>
          <select
            className="nb-input !py-1"
            value={conc}
            onChange={(e) => setConc(Number(e.target.value))}
          >
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <button className="nb-btn-pri w-full sm:w-auto" disabled={busy} onClick={start}>
          {busy ? 'Working…' : `Start email setup (${targetCount})`}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={doLogin} onChange={(e) => setDoLogin(e.target.checked)} />
          Login email
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={doRecovery} onChange={(e) => setDoRecovery(e.target.checked)} />
          Recovery email
        </label>
        <span className="text-muted">
          {ids.length ? `${ids.length} selected` : `all ${connected.length} connected (none selected)`}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <input
            className="nb-input !py-1 text-sm flex-1 min-w-[200px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, country code or @username…"
          />
          <button className="nb-btn !py-1 !px-3 text-[11px]" onClick={toggleAll}>
            {allChecked ? 'Clear shown' : `Select all shown (${filtered.length})`}
          </button>
          <button className="nb-btn !py-1 !px-3 text-[11px]" onClick={() => setIds([])}>Clear all</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-auto pr-1">
          {filtered.slice(0, 400).map((a) => (
            <label key={a.id} className={
              'flex items-center gap-2 px-2 py-1 rounded-full cursor-pointer text-[12px] transition-colors ' +
              (ids.includes(a.id)
                ? 'bg-brand-pri/30 text-ink'
                : 'text-muted hover:bg-[rgb(var(--ink)/0.04)] hover:text-ink')
            }>
              <input type="checkbox" className="shrink-0" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="truncate">{((a.first_name || '') + ' ' + (a.last_name || '')).trim() || a.phone}</span>
              <span className="text-[10px] font-mono text-muted truncate">{a.phone}</span>
              <span className="text-[9px] font-mono text-muted shrink-0">{accountAge(a)}</span>
            </label>
          ))}
          {filtered.length === 0 && (
            <div className="text-xs text-muted px-2 py-3">No account matches “{query}”.</div>
          )}
        </div>
        {filtered.length > 400 && (
          <div className="text-[10px] text-muted mt-1">Showing the first 400 matches — refine the search.</div>
        )}
      </div>

      <ProgressModal progress={progress} onClose={close} />
    </div>
  )
}

function EmailLoginPanel({ accounts, selected, onChange }) {
  const toast = useToast()
  const { progress, run, close } = useBulkProgress()
  const [scanBusy, setScanBusy] = useState(false)

  const checked = accounts.filter((a) => !!a.email_checked_at)
  const withEmail = checked.filter((a) => !!(a.login_email_pattern || '').trim()).length
  const withoutEmail = checked.length - withEmail
  const unknown = accounts.length - checked.length

  async function scanAll() {
    if (accounts.length === 0) return
    setScanBusy(true)
    await run(`Email login status - ${accounts.length} accounts`, (onEvent) =>
      Endpoints.emailScan(onEvent))
    setScanBusy(false)
    onChange?.()
  }

  return (
    <div className="nb-card p-5 mb-4">
      <div className="flex items-start sm:items-center gap-3 flex-col sm:flex-row">
        <div>
          <div className="micro-label">Account email</div>
          <div className="display-title text-[20px] mt-1">Email login</div>
        </div>
        <span className="nb-badge bg-brand-info">Telegram login email</span>
        <button className="nb-btn w-full sm:w-auto sm:ml-auto !py-1 !px-3 text-xs"
          disabled={scanBusy || accounts.length === 0} onClick={scanAll}>
          {scanBusy ? 'Checking...' : 'Check all statuses'}
        </button>
      </div>

      <div className="text-sm text-muted leading-6 mt-2">
        Shows how many accounts have a Telegram login email. Pick an account from
        the sidebar, then change its email with a verification code sent to the new
        address. No 2FA password is needed for this.
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="nb-card-sm p-3">
          <div className="micro-label">With email</div>
          <div className="display-title text-[22px] mt-1">{withEmail}</div>
        </div>
        <div className="nb-card-sm p-3">
          <div className="micro-label">Without email</div>
          <div className="display-title text-[22px] mt-1">{withoutEmail}</div>
        </div>
        <div className="nb-card-sm p-3">
          <div className="micro-label">Not checked</div>
          <div className="display-title text-[22px] mt-1">{unknown}</div>
        </div>
      </div>

      <div className="mt-4">
        {!selected && (
          <div className="nb-note nb-note-info px-3 py-2 text-sm">
            Choose an account from the sidebar, or open any account and use its
            Overview tab.
          </div>
        )}
        {selected && (
          <div className="space-y-3">
            <LoginEmailCard account={selected} onChange={onChange} className="nb-card-sm p-4" />
            <RecoveryEmailCard account={selected} onChange={onChange} className="nb-card-sm p-4" />
          </div>
        )}
      </div>

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

// Someone started Telegram's "reset account" (7-day deletion) flow. These live in
// their own always-visible panel so the cancel link can't get lost in normal
// security messages.
export function ResetRequestsPanel({ onChange }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [needCodeId, setNeedCodeId] = useState(null)
  const [codeValue, setCodeValue] = useState('')

  const load = useCallback(async () => {
    try {
      const rows = await Endpoints.resetRequests()
      setItems(rows || [])
    } catch {
      // Panel stays quiet; the rest of the tab still works.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 10000)
    return () => clearInterval(id)
  }, [load])

  async function markRead(item) {
    try {
      await Endpoints.markRead(item.id)
      await load()
      onChange?.()
    } catch (e) {
      toast.error(e.message)
    }
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Cancel link copied')
    } catch {
      toast.error('Could not copy the link')
    }
  }

  async function cancelDeletion(item) {
    if (!confirm(
      `Cancel the pending deletion of ${item.account_name} (${item.phone})?\n\n` +
      `Telegram sends a code to the account's own number. If it can't be read ` +
      `automatically, you can paste the code from your number panel.`
    )) return
    setBusyId(item.id)
    try {
      const r = await Endpoints.cancelReset(item.id)
      if (r?.need_code) {
        setNeedCodeId(item.id)
        setCodeValue('')
        toast.info(r.message || 'Enter the SMS code from the account number')
        return
      }
      toast.success('Deletion cancelled — the requester is logged out')
      setNeedCodeId(null)
      await load()
      onChange?.()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function submitCancelCode(item) {
    const code = codeValue.trim()
    if (!code) {
      toast.error('Enter the SMS code from the account number')
      return
    }
    setBusyId(item.id)
    try {
      await Endpoints.cancelReset(item.id, code)
      toast.success('Deletion cancelled — the requester is logged out')
      setNeedCodeId(null)
      setCodeValue('')
      await load()
      onChange?.()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (loading || items.length === 0) return null

  const urgent = items.filter((i) => i.days_left !== null && i.days_left <= 3).length

  return (
    <div
      className="nb-card p-5 mb-4"
      style={{ borderColor: 'rgb(var(--danger) / 0.55)', boxShadow: 'inset 4px 0 0 rgb(var(--danger))' }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="micro-label" style={{ color: 'rgb(var(--danger))' }}>Urgent · account deletion</div>
          <div className="display-title text-[24px] mt-1">Account reset requests</div>
          <div className="text-[12px] text-muted mt-1.5 max-w-[70ch] leading-5">
            Someone started Telegram&apos;s 7-day account reset on these accounts. If the
            countdown ends, the account, chats and 2FA password are deleted. Open the
            cancel link inside a Telegram app where that account is logged in — or use
            the account&apos;s service message below.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {urgent > 0 && <span className="nb-badge bg-brand-err">{urgent} urgent</span>}
          <span className="nb-badge bg-white text-ink">{items.length} open</span>
        </div>
      </div>

      <div className="space-y-2 mt-4 max-h-[420px] overflow-y-auto pr-1">
        {items.map((r) => (
          <div
            key={r.id}
            className="nb-card-sm p-3"
            style={{ borderColor: 'rgb(var(--danger) / 0.35)' }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`nb-badge ${r.days_left !== null && r.days_left <= 3 ? 'bg-brand-err' : 'bg-brand-warn'}`}>
                {r.days_left !== null ? `${r.days_left}d left` : 'reset'}
              </span>
              <span className="font-semibold text-[13px]">{r.account_name}</span>
              <span className="text-[10px] text-muted font-mono">
                {r.phone}{r.username ? ` · @${r.username}` : ''}
              </span>
              {!r.is_read && <span className="w-1.5 h-1.5 rounded-full bg-brand-err inline-block" />}
              <span className="text-[10px] text-muted font-mono ml-auto">{fmtTime(r.received_at)}</span>
            </div>
            <div className="text-[11px] text-muted mt-1.5 whitespace-pre-wrap line-clamp-3">
              {r.message_text}
            </div>
            {r.action_status === 'Deletion cancelled' ? (
              <div className="mt-2">
                <span className="nb-badge bg-brand-ok">Deletion cancelled</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button
                  className="nb-btn-err !py-1 !px-3 text-xs"
                  disabled={busyId === r.id}
                  onClick={() => cancelDeletion(r)}
                >
                  {busyId === r.id ? 'Working…' : 'Cancel deletion'}
                </button>
                {r.cancel_url ? (
                  <>
                    <a className="nb-btn !py-1 !px-3 text-xs" href={r.cancel_url} target="_blank" rel="noreferrer">
                      Open cancel link
                    </a>
                    <button className="nb-btn !py-1 !px-3 text-xs" onClick={() => copyLink(r.cancel_url)}>
                      Copy link
                    </button>
                  </>
                ) : (
                  <span className="text-[10px] text-muted">
                    No cancel link in this message — open the account&apos;s Telegram service messages.
                  </span>
                )}
                <button className="nb-btn !py-1 !px-3 text-xs" onClick={() => markRead(r)}>
                  Mark as read
                </button>
              </div>
            )}

            {needCodeId === r.id && r.action_status !== 'Deletion cancelled' && (
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <input
                  className="nb-input flex-1"
                  inputMode="numeric"
                  value={codeValue}
                  onChange={(e) => setCodeValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCancelCode(r) } }}
                  placeholder="SMS code from the account number"
                />
                <button
                  className="nb-btn-pri !px-4"
                  disabled={busyId === r.id}
                  onClick={() => submitCancelCode(r)}
                >
                  {busyId === r.id ? 'Confirming…' : 'Confirm cancel'}
                </button>
                <button
                  className="nb-btn !px-3"
                  onClick={() => { setNeedCodeId(null); setCodeValue('') }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function LoginRequestsPanel({ onChange }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [auto, setAuto] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await Endpoints.securityRequests()
      setItems(rows || [])
    } catch {
      // The panel stays quiet; the Security tab's main content still works.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    load()
    Endpoints.getAutoDecline()
      .then((r) => { if (alive) setAuto(!!r?.enabled) })
      .catch(() => {})
    const id = setInterval(() => { if (!document.hidden) load() }, 6000)
    return () => { alive = false; clearInterval(id) }
  }, [load])

  async function toggleAuto(e) {
    const enabled = e.target.checked
    setAuto(enabled)
    try {
      await Endpoints.setAutoDecline(enabled)
      toast.success(enabled ? 'Auto-decline is ON' : 'Auto-decline is OFF')
    } catch (err) {
      setAuto(!enabled)
      toast.error(err.message)
    }
  }

  async function press(req, btn) {
    setBusy(true)
    try {
      const r = await Endpoints.pressSecurityButton(req.id, btn.index)
      toast.success(r?.answer && r.answer !== 'ok' ? r.answer : `${btn.text || 'Pressed'}: ${req.account_name}`)
      await load()
      onChange?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nb-card p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="micro-label">Security watch</div>
          <div className="display-title text-[22px] mt-1">Login &amp; reset requests</div>
          <div className="text-[12px] text-muted mt-1.5 max-w-[64ch] leading-5">
            Telegram 777000 login approvals, login codes and reset/security changes for all accounts.
            Approve or decline from here.
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer select-none">
          <input type="checkbox" checked={auto} onChange={toggleAuto} />
          Auto-decline login approvals
        </label>
      </div>

      {auto && (
        <div className="nb-note nb-note-warn px-3 py-2 text-[11px] mt-3">
          Auto-decline is ON. New Telegram login approvals will be declined automatically.
          Turn it off before you log in on a new device yourself.
        </div>
      )}

      {loading && items.length === 0 && <div className="text-sm text-muted mt-3">Loading...</div>}
      {!loading && items.length === 0 && (
        <div className="text-sm text-muted mt-3">No login or reset requests in the last 7 days.</div>
      )}

      {items.length > 0 && (
        <div className="space-y-2 mt-3 max-h-[360px] overflow-auto pr-1">
          {items.map((r) => (
            <div key={r.id} className="nb-card-sm p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`nb-badge ${TYPE_COLORS[r.type] || 'bg-white'}`}>{r.type}</span>
                <span className="font-semibold text-[12px]">{r.account_name}</span>
                <span className="text-[10px] text-muted font-mono truncate">{r.phone}{r.username ? ` ? @${r.username}` : ''}</span>
                <span className="text-[10px] text-muted font-mono ml-auto">{fmtTime(r.received_at)}</span>
              </div>
              <div className="text-[11px] font-mono text-muted mt-1.5 whitespace-pre-wrap line-clamp-3">
                {(r.message_text || '').slice(0, 320)}
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {(r.buttons || []).filter((b) => b.type === 'callback').map((b) => (
                  <button
                    key={b.index}
                    className={buttonClass(b.text) + ' !py-1 !px-3 text-xs'}
                    disabled={busy || !!r.action_status}
                    onClick={() => press(r, b)}
                  >
                    {b.text || `Button ${b.index + 1}`}
                  </button>
                ))}
                {r.action_status && (
                  <span className="text-[10px] text-muted">Action: {r.action_status}</span>
                )}
                {!(r.buttons || []).some((b) => b.type === 'callback') && !r.action_status && (
                  <span className="text-[10px] text-muted">No action button</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SecurityTab({ accounts, focusAlert, focusAccountId, focusTick, onChange }) {
  const selected = accounts.find((a) => a.id === focusAccountId) || null
  const [showTools, setShowTools] = useState(false)

  return (
    <div>
      <div className="nb-card p-5 mb-4">
        <div className="micro-label">Security</div>
        <div className="display-title text-[26px] mt-2">Telegram service messages</div>
        <div className="text-sm text-muted mt-2 max-w-[68ch] leading-6">
          Every message from the official Telegram account, shown on your phone as
          <b> &quot;Telegram&quot;</b> / <b>+42777</b>, per account. Pick an account
          from the sidebar to see its messages and active sessions. Login approvals
          and reset requests now live in the <b>Urgent</b> tab.
        </div>
        <button className="nb-btn mt-3" onClick={() => setShowTools((v) => !v)}>
          {showTools ? 'Hide bulk security tools' : 'Show bulk security tools'}
        </button>
      </div>

      {showTools && (
        <>
          <NurMailProviderCard />
          <EmailSetupPanel accounts={accounts} onChange={onChange} />
          <BulkTerminateSessionsPanel accounts={accounts} onChange={onChange} />
          <Bulk2faPanel accounts={accounts} onChange={onChange} />
          <AccountTtlPanel accounts={accounts} onChange={onChange} />
          <EmailLoginPanel accounts={accounts} selected={selected} onChange={onChange} />
        </>
      )}

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
