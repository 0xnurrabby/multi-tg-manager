import { useCallback, useEffect, useMemo, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import { fmtTime } from '../lib/util'
import { CopyButton } from '../lib/CopyButton'

const CODE_RE = /\b(\d{5,6})\b/

function latestCode(messages) {
  for (const m of messages) {
    const hit = CODE_RE.exec(m.message_text || '')
    if (hit) return hit[1]
  }
  return ''
}

function SellAccount({ account, onChange }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [sessions, setSessions] = useState([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const [m, s] = await Promise.all([
        Endpoints.securityMessages(account.id).catch(() => []),
        Endpoints.tgSessions(account.id).catch(() => []),
      ])
      setMessages((m || []).slice(0, 12))
      const list = s || []
      setSessions(list)
    } finally {
      setBusy(false)
    }
  }, [account.id])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const code = latestCode(messages)
  // Last logged-in non-current session = the buyer. Never logged out from here.
  const buyerHash = sessions
    .filter((s) => !s.is_current)
    .sort((a, b) => (Date.parse(b.date_created || 0) || 0) - (Date.parse(a.date_created || 0) || 0))[0]?.hash
  const name = `${account.first_name || ''} ${account.last_name || ''}`.trim() || account.phone

  async function logoutAll() {
    if (!confirm(
      `Remove every Telegram session on ${account.phone}?\n\n` +
      `The newest device (the buyer that logged in last) is kept automatically.\n` +
      `Every other device — including this app — is logged out, and the account ` +
      `is removed from TG Manager.`
    )) return
    setBusy(true)
    try {
      const r = await Endpoints.logoutAll(account.id, null)
      toast.success(`Buyer session kept · ${r.terminated} other session(s) removed`)
      onChange?.()
      setOpen(false)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function logoutOne(session) {
    const label = session.is_current
      ? 'this app (TG Manager)'
      : `${session.device || session.app_name || 'this device'} (${session.platform || '?'})`
    if (!confirm(
      session.is_current
        ? `Log ${account.phone} out of this app only? Other devices stay logged in.`
        : `Remove ${label} from ${account.phone}?`
    )) return
    setBusy(true)
    try {
      if (session.is_current) {
        await Endpoints.logoutSelf(account.id)
        toast.success('Logged out of this app')
        onChange?.()
        setOpen(false)
      } else {
        await Endpoints.terminateSession(account.id, session.hash)
        toast.success('Session removed')
        await load()
      }
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nb-card p-4 mb-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[14px] truncate">{name}</span>
            <span className="text-[11px] text-muted font-mono">{account.phone}</span>
            <CopyButton value={account.phone} label="phone number" />
            {account.username && (
              <>
                <span className="text-[11px] text-muted font-mono">@{account.username}</span>
                <CopyButton value={account.username} label="username" />
              </>
            )}
            <span className="nb-badge bg-brand-warn">2FA off</span>
            {code && <span className="nb-badge bg-brand-ok font-mono">OTP {code}</span>}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {account.status === 'connected' ? 'Connected here' : 'Not connected here'}
            {messages[0]?.received_at ? ` · last message ${fmtTime(messages[0].received_at)}` : ''}
          </div>
        </div>
        <button className="nb-btn !py-1 !px-3 text-xs" disabled={busy} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Codes & sessions'}
        </button>
        <button className="nb-btn-err !py-1 !px-3 text-xs" disabled={busy} onClick={logoutAll}>
          {busy ? 'Working…' : 'Logout from all'}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="nb-card-sm p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="micro-label">Latest Telegram messages</span>
              <button className="nb-btn !py-0.5 !px-2 text-[11px] ml-auto" disabled={busy} onClick={load}>
                Refresh
              </button>
            </div>
            {busy && messages.length === 0 && <div className="text-xs text-muted">Loading…</div>}
            {!busy && messages.length === 0 && (
              <div className="text-xs text-muted">No service messages stored for this account.</div>
            )}
            <div className="space-y-1 max-h-56 overflow-auto pr-1">
              {messages.map((m) => {
                const hit = CODE_RE.exec(m.message_text || '')
                return (
                  <div key={m.id} className="rounded-xl border border-[color:var(--hairline)] px-2 py-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="nb-badge bg-white text-ink">{m.type}</span>
                      {hit && (
                        <button
                          className="nb-badge bg-brand-ok font-mono"
                          title="Copy code"
                          onClick={() => { navigator.clipboard?.writeText(hit[1]); toast.success('Code copied') }}
                        >
                          {hit[1]}
                        </button>
                      )}
                      <span className="ml-auto text-muted font-mono">{fmtTime(m.received_at)}</span>
                    </div>
                    <div className="text-muted mt-1 line-clamp-2 whitespace-pre-wrap">
                      {(m.message_text || '').slice(0, 140)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="nb-card-sm p-3">
            <div className="micro-label mb-2">Sessions · buyer is kept</div>
            {sessions.length === 0 && <div className="text-xs text-muted">No session data (account may be disconnected).</div>}
            <div className="space-y-1 max-h-56 overflow-auto pr-1">
              {sessions.map((s) => (
                <div
                  key={s.hash}
                  className={
                    'flex items-center gap-2 rounded-xl border px-2 py-1.5 text-[11px] ' +
                    (buyerHash === s.hash ? 'border-[color:var(--positive)]' : 'border-[color:var(--hairline)]')
                  }
                >
                  <span className="font-medium truncate">{s.device || s.app_name || 'Unknown'}</span>
                  <span className="text-muted truncate">{s.platform}</span>
                  {s.is_current && <span className="nb-badge bg-brand-ok">this app</span>}
                  {buyerHash === s.hash && <span className="nb-badge bg-brand-ok">buyer · kept</span>}
                  {buyerHash !== s.hash && (
                    <button
                      className="nb-btn-err !py-0.5 !px-2 text-[10px] ml-auto shrink-0"
                      disabled={busy}
                      onClick={() => logoutOne(s)}
                    >
                      {s.is_current ? 'Logout app' : 'Logout'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted mt-2">
              The newest device (last login) is treated as the buyer and can't be logged
              out here. Every other device can be removed one by one, or all at once.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SellTab({ accounts, onChange }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const disconnected = accounts.filter((a) => a.status !== 'connected' && a.status !== 'banned')

  async function removeDisconnected() {
    if (!disconnected.length) return
    if (!confirm(
      `Remove ${disconnected.length} disconnected account(s) from TG Manager?\n\n` +
      `Their session files and stored codes are deleted. Accounts still logged in ` +
      `on Telegram are not affected.`
    )) return
    setBusy(true)
    try {
      const r = await Endpoints.removeDisconnected()
      toast.success(`Removed ${r.removed} disconnected account(s)`)
      onChange?.()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return accounts
      .filter((a) => !a.has_2fa)
      .filter((a) => a.status === 'connected')
      .filter((a) => {
        if (!needle) return true
        return `${a.first_name || ''} ${a.last_name || ''} ${a.phone || ''} ${a.username || ''}`
          .toLowerCase()
          .includes(needle)
      })
  }, [accounts, q])

  return (
    <div>
      <div className="nb-card p-5 mb-4">
        <div className="micro-label">For sell</div>
        <div className="display-title text-[26px] mt-2">Accounts without 2FA</div>
        <div className="text-sm text-muted mt-2 max-w-[70ch] leading-6">
          Every account with Two-Step Verification <b>off</b>. Open one to see its latest
          Telegram codes, then <b>Logout from all</b> to remove every device except the
          session you keep (the buyer bot) — so the sale bot never sees extra devices.
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <input
            className="nb-input !py-1 text-sm flex-1 min-w-[220px]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, country code or @username…"
          />
          <span className="nb-badge bg-white text-ink">{list.length} account(s)</span>
          {disconnected.length > 0 && (
            <button className="nb-btn-err !py-1 !px-3 text-xs" disabled={busy} onClick={removeDisconnected}>
              {busy ? 'Removing…' : `Remove disconnected (${disconnected.length})`}
            </button>
          )}
        </div>
      </div>

      {list.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">◎</span>
          <div className="empty-title">No 2FA-off accounts</div>
          <div className="text-sm max-w-[44ch]">
            Turn 2FA off from Security → Two-step password, and the account will show up here.
          </div>
        </div>
      )}

      {list.map((a) => (
        <SellAccount key={a.id} account={a} onChange={onChange} />
      ))}
    </div>
  )
}
