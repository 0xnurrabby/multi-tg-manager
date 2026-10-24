import { useEffect, useState, useMemo } from 'react'
import { CopyButton } from '../lib/CopyButton'
import { fmtTime } from '../lib/util'
import { Endpoints } from '../lib/api'
import AccountAvatar from '../components/AccountAvatar'
import Icon from '../components/Icon'

function Stat({ label, value, accent, hint }) {
  return (
    <div className="nb-card nb-card-lift p-5">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `rgb(var(${accent}))` }} />
        <span className="micro-label">{label}</span>
      </div>
      <div className="display-title text-[38px] mt-4 tabular-nums">{value}</div>
      {hint && <div className="text-[12px] text-muted mt-2">{hint}</div>}
    </div>
  )
}

function StatusBar({ stats, total }) {
  const c = stats.connected || 0
  const b = stats.banned || 0
  const d = Math.max(total - c - b, 0)
  if (total === 0) return null
  const pct = (n) => `${(n / total) * 100}%`
  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-[rgb(var(--ink)/0.06)]">
      <div className="bg-brand-ok"   title={`${c} connected`}    style={{ width: pct(c) }} />
      <div className="bg-brand-warn" title={`${d} disconnected`} style={{ width: pct(d) }} />
      <div className="bg-brand-err"  title={`${b} banned`}       style={{ width: pct(b) }} />
    </div>
  )
}

function StatusDot({ status }) {
  const c = status === 'connected' ? 'bg-brand-ok' : status === 'banned' ? 'bg-brand-err' : 'bg-brand-warn'
  return <span className={'inline-block w-2 h-2 rounded-full ' + c} title={status} />
}

function LegendDot({ tone, label, count }) {
  return (
    <span className="flex items-center gap-2 text-[11px] text-muted">
      <span className={'w-2 h-2 rounded-full ' + tone} />
      {label}
      <span className="font-mono text-ink">{count}</span>
    </span>
  )
}

export default function DashboardTab({ stats, accounts, onSelect, onOpenAlert, onChange }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')   // all|connected|disconnected|banned|2fa|alerts
  const [recentAlerts, setRecentAlerts] = useState([])
  const [marking, setMarking] = useState(false)

  useEffect(() => {
    Endpoints.securityMessages(undefined, true).then((m) => setRecentAlerts((m || []).slice(0, 10))).catch(() => {})
  }, [stats.unread_security])

  async function markAllRead() {
    setMarking(true)
    try {
      await Endpoints.markAllRead()
      setRecentAlerts([])
      onChange?.()
    } catch (e) {
      // surface nothing intrusive; alerts will reappear on next refresh if it failed
    } finally {
      setMarking(false)
    }
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return accounts.filter((a) => {
      if (filter === 'connected'    && a.status !== 'connected')    return false
      if (filter === 'disconnected' && a.status === 'connected')    return false
      if (filter === 'banned'       && a.status !== 'banned')       return false
      if (filter === '2fa'          && !a.has_2fa)                  return false
      if (filter === 'alerts'       && (a.unread_security || 0) === 0) return false
      if (!qq) return true
      const hay = `${a.first_name} ${a.last_name} ${a.username} ${a.phone}`.toLowerCase()
      return hay.includes(qq)
    })
  }, [accounts, q, filter])

  const totalAlerts = stats.unread_security || 0
  const without2fa = stats.total - stats.with_2fa
  const onlineCount = accounts.filter((a) => a.is_online).length
  const disconnected = Math.max(stats.total - stats.connected - stats.banned, 0)

  return (
    <div className="space-y-8">
      {/* MASTHEAD */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <div className="micro-label">Overview</div>
          <h1
            className="display-title mt-3 max-w-[16ch]"
            style={{ fontSize: 'clamp(36px, 4.6vw, 58px)', lineHeight: 0.99 }}
          >
            Your accounts, <span className="serif-accent">at a glance.</span>
          </h1>
          <p className="text-muted mt-4 max-w-[52ch] text-[15px] leading-7">
            A quiet read on connection health, two-step coverage, and the latest
            messages from Telegram.
          </p>
        </div>
        <div className="sm:text-right shrink-0">
          <div className="micro-label">Online now</div>
          <div className="display-title text-[32px] mt-1 tabular-nums">{onlineCount}</div>
          <div className="text-[11px] text-muted mt-1">of {stats.total} accounts</div>
        </div>
      </section>

      {/* STAT GRID */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger">
        <Stat label="Total accounts" value={stats.total} accent="--accent-sun" />
        <Stat label="Connected" value={stats.connected} accent="--accent-mint" />
        <Stat label="Disconnected" value={disconnected} accent="--accent-peach" />
        <Stat label="Banned" value={stats.banned} accent="--accent-rose" />
        <Stat label="2FA enabled" value={stats.with_2fa} accent="--accent-sky"
              hint={without2fa > 0 ? `${without2fa} without 2FA` : 'All protected'} />
        <Stat label="Unread alerts" value={totalAlerts} accent="--accent-rose"
              hint={totalAlerts > 0 ? 'Needs a look' : 'All clear'} />
      </div>

      {/* HEALTH */}
      <div className="nb-card p-5">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div className="micro-label">At a glance</div>
            <div className="display-title text-[20px] mt-1">Connection health</div>
          </div>
          <div className="text-[11px] text-muted text-right">
            <span className="font-mono text-ink">{onlineCount}</span> online ·{' '}
            <span className="font-mono text-ink">{stats.connected}</span> connected ·{' '}
            <span className="font-mono text-ink">{stats.with_2fa}/{stats.total}</span> with 2FA
          </div>
        </div>
        <StatusBar stats={stats} total={stats.total || 1} />
        <div className="flex gap-5 mt-3 flex-wrap">
          <LegendDot tone="bg-brand-ok"   label="Connected"    count={stats.connected} />
          <LegendDot tone="bg-brand-warn" label="Disconnected" count={disconnected} />
          <LegendDot tone="bg-brand-err"  label="Banned"       count={stats.banned} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ACCOUNT TABLE */}
        <div className="lg:col-span-2 nb-card p-5 min-w-0">
          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <div>
              <div className="micro-label">Directory</div>
              <div className="display-title text-[20px] mt-1">
                All accounts <span className="font-mono text-[12px] text-muted tracking-normal">({filtered.length}/{accounts.length})</span>
              </div>
            </div>
            <div className="ml-auto flex gap-2 items-center flex-wrap">
              <input className="nb-input !w-44 !py-2 text-xs" placeholder="Search name, phone, @"
                value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="nb-input !w-auto !py-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="connected">Connected</option>
                <option value="disconnected">Disconnected</option>
                <option value="banned">Banned</option>
                <option value="2fa">With 2FA</option>
                <option value="alerts">With unread alerts</option>
              </select>
            </div>
          </div>

          {filtered.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon"><Icon name={accounts.length === 0 ? 'users' : 'inbox'} size={18} /></span>
              <div className="empty-title">
                {accounts.length === 0 ? 'No accounts yet' : 'Nothing matches this filter'}
              </div>
              <div className="text-sm max-w-[32ch]">
                {accounts.length === 0
                  ? 'Add your first account from the sidebar to start.'
                  : 'Try a different search or filter.'}
              </div>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="overflow-auto max-h-[calc(100vh-380px)] -mx-2">
              <table className="nb-table text-sm">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Status</th>
                    <th>2FA</th>
                    <th className="!text-right">Alerts</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} onClick={() => onSelect(a.id)} className="cursor-pointer">
                      <td>
                        <div className="flex items-center gap-2.5">
                          <AccountAvatar account={a} size={30} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate max-w-[160px]">{(a.first_name + ' ' + a.last_name).trim() || '—'}</span>
                              {a.is_online && <span className="w-1.5 h-1.5 rounded-full bg-brand-ok shrink-0" title="online" />}
                            </div>
                            <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                              <span>{a.phone}</span>
                              <CopyButton value={a.phone} />
                              {a.username && <span className="truncate">· @{a.username}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot status={a.status} />
                          <span className="text-[11px] text-muted capitalize">{a.status}</span>
                        </span>
                      </td>
                      <td>
                        {a.has_2fa
                          ? <span className="nb-badge bg-brand-info">On</span>
                          : <span className="nb-badge">Off</span>}
                      </td>
                      <td className="text-right">
                        {a.unread_security > 0
                          ? <span className="nb-badge bg-brand-err">{a.unread_security}</span>
                          : <span className="text-muted/50">—</span>}
                      </td>
                      <td className="text-[11px] text-muted whitespace-nowrap">
                        {a.last_seen ? fmtTime(a.last_seen) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RECENT ALERTS */}
        <div className="nb-card p-5 h-fit min-w-0">
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <div className="micro-label">Inbox</div>
              <div className="display-title text-[20px] mt-1">Recent alerts</div>
            </div>
            <div className="flex items-center gap-2">
              {totalAlerts > 0 && (
                <button className="nb-btn !py-1 !px-3 !text-[11px]"
                        onClick={markAllRead} disabled={marking}>
                  {marking ? '…' : 'Mark read'}
                </button>
              )}
              {totalAlerts > 0 && <span className="nb-badge bg-brand-err">{totalAlerts}</span>}
            </div>
          </div>

          {recentAlerts.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon"><Icon name="check" size={18} /></span>
              <div className="empty-title">Nothing unread</div>
              <div className="text-sm max-w-[26ch]">New Telegram security messages will appear here.</div>
            </div>
          )}

          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {recentAlerts.map((m) => {
              const acc = accounts.find((a) => a.id === m.account_id)
              return (
                <div key={m.id} className="nb-card-sm p-3 text-xs cursor-pointer hover:border-[color:var(--hairline-strong)] transition-colors" onClick={() => onOpenAlert?.(m)}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="nb-badge bg-brand-warn !text-[10px]">{m.type}</span>
                    <span className="text-[10px] text-muted ml-auto font-mono">{fmtTime(m.received_at)}</span>
                  </div>
                  <div className="font-mono text-[11px] whitespace-pre-wrap line-clamp-3 text-ink/80">{m.message_text}</div>
                  {acc && <div className="text-[10px] text-muted mt-2">→ {(acc.first_name || acc.phone)}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
