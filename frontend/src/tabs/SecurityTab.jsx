import { useEffect, useState, useCallback } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import { fmtTime } from '../lib/util'

const TYPE_COLORS = {
  login_code:       'bg-brand-warn',
  new_login:        'bg-brand-err',
  '2fa_change':     'bg-brand-violet',
  account_deletion: 'bg-brand-err',
  unknown:          'bg-white',
}

function AccountRow({ account, onChange }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const m = await Endpoints.securityMessages(account.id)
      setMsgs(m)
      try {
        const s = await Endpoints.tgSessions(account.id)
        setSessions(s)
      } catch { setSessions([]) }
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }, [account.id, toast])

  useEffect(() => { if (open) load() }, [open, load])

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

  return (
    <div className="nb-card-sm mb-3">
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-bold flex-1">
          {(account.first_name + ' ' + account.last_name).trim() || account.phone}
        </span>
        {account.has_2fa
          ? <span className="nb-badge bg-brand-violet text-black">2FA on</span>
          : <span className="nb-badge bg-brand-warn text-black">2FA off</span>}
        {account.unread_security > 0 && (
          <span className="nb-badge bg-brand-err text-black">{account.unread_security} new</span>
        )}
        <span className="opacity-60 text-sm">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="px-4 pb-4 border-t-2 border-black dark:border-white">
          <div className="mt-3 flex items-center gap-2">
            <span className="font-bold text-sm uppercase">777000 messages</span>
            <button className="nb-btn !py-1 !px-2 text-xs ml-auto" onClick={markAllRead}>Mark all read</button>
            <button className="nb-btn !py-1 !px-2 text-xs" onClick={load}>Refresh</button>
          </div>
          {loading && <div className="text-sm opacity-60 mt-2">Loading…</div>}
          {!loading && msgs.length === 0 && <div className="text-sm opacity-60 mt-2">No messages from Telegram.</div>}
          <div className="space-y-2 mt-2">
            {msgs.map((m) => (
              <div key={m.id} className={'nb-card-sm p-3 ' + (m.is_read ? 'opacity-60' : '')}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`nb-badge ${TYPE_COLORS[m.type] || 'bg-white'} text-black`}>{m.type}</span>
                  {!m.is_read && <span className="w-2 h-2 rounded-full bg-brand-err inline-block" />}
                  <span className="text-xs opacity-70 ml-auto">{fmtTime(m.received_at)}</span>
                </div>
                <div className={'whitespace-pre-wrap text-sm font-mono ' + (m.is_read ? '' : 'font-bold')}>
                  {m.message_text}
                </div>
                {!m.is_read && (
                  <button className="nb-btn !py-1 !px-2 text-xs mt-2" onClick={() => markRead(m.id)}>
                    Mark as read
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-2">
            <span className="font-bold text-sm uppercase">Active sessions</span>
            <button className="nb-btn-err !py-1 !px-2 text-xs ml-auto" onClick={killOthers}>Terminate all others</button>
          </div>
          <div className="space-y-2 mt-2">
            {sessions.length === 0 && <div className="text-sm opacity-60">No sessions data.</div>}
            {sessions.map((s) => (
              <div key={s.hash} className="nb-card-sm p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">
                    {s.device || s.app_name || 'Unknown'} {s.is_current && <span className="nb-badge bg-brand-ok text-black ml-1">current</span>}
                  </div>
                  <div className="text-xs opacity-70 truncate">
                    {s.platform} • {s.ip} • {s.country} • {fmtTime(s.date_created)}
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

export default function SecurityTab({ accounts, onChange }) {
  return (
    <div>
      <div className="nb-card p-4 mb-4">
        <div className="font-extrabold uppercase">Security Center</div>
        <div className="text-sm opacity-70">
          All messages from Telegram service account (777000) per account. New messages also trigger a desktop notification.
        </div>
      </div>
      {accounts.length === 0 && <div className="opacity-60">No accounts.</div>}
      {accounts.map((a) => <AccountRow key={a.id} account={a} onChange={onChange} />)}
    </div>
  )
}
