import { useMemo } from 'react'
import { fmtTime } from '../lib/util'

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function pct(value, total) {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)))
}

function Stat({ label, value, hint, tone }) {
  return (
    <div
      className="nb-card p-4"
      style={{ background: `linear-gradient(150deg, rgb(var(${tone}) / 0.42), rgb(var(--surface)) 72%)` }}
    >
      <div className="micro-label">{label}</div>
      <div className="display-title text-[30px] mt-2 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  )
}

function Coverage({ label, value, total, tone }) {
  const p = pct(value, total)
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-ink">{value} / {total}</span>
      </div>
      <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ink) / 0.07)' }}>
        <div className="h-full rounded-full" style={{ width: `${p}%`, background: `rgb(var(${tone}))` }} />
      </div>
    </div>
  )
}

export default function StatsTab({ accounts = [] }) {
  const data = useMemo(() => {
    const total = accounts.length
    const connected = accounts.filter((a) => a.status === 'connected').length
    const disconnected = accounts.filter((a) => a.status === 'disconnected').length
    const banned = accounts.filter((a) => a.status === 'banned').length
    const with2fa = accounts.filter((a) => a.has_2fa).length
    const withEmail = accounts.filter((a) => a.login_email_pattern).length
    const alerts = accounts.reduce((sum, a) => sum + num(a.unread_security), 0)
    const alertAccounts = accounts
      .filter((a) => num(a.unread_security) > 0)
      .sort((a, b) => num(b.unread_security) - num(a.unread_security))
      .slice(0, 8)
    return { total, connected, disconnected, banned, with2fa, withEmail, alerts, alertAccounts }
  }, [accounts])

  return (
    <div className="space-y-5">
      <section
        className="nb-card p-5 sm:p-6 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgb(var(--accent-mint) / 0.36), rgb(var(--surface)) 48%, rgb(var(--accent-sky) / 0.28))' }}
      >
        <div className="micro-label">Insights</div>
        <h1 className="display-title mt-2" style={{ fontSize: 'clamp(30px, 4vw, 46px)', lineHeight: 1.03 }}>
          Directory health, <span className="serif-accent">at a glance.</span>
        </h1>
        <p className="text-sm text-muted mt-3 max-w-[64ch] leading-6">
          A clean view of account connectivity, security coverage and unread Telegram alerts.
        </p>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat label="Accounts" value={data.total} hint="in this workspace" tone="--accent-sky" />
        <Stat label="Connected" value={data.connected} hint={`${pct(data.connected, data.total)}% online`} tone="--accent-mint" />
        <Stat label="2FA protected" value={data.with2fa} hint={`${pct(data.with2fa, data.total)}% coverage`} tone="--accent-sun" />
        <Stat label="Login email" value={data.withEmail} hint={`${pct(data.withEmail, data.total)}% coverage`} tone="--accent-peach" />
        <Stat label="Unread alerts" value={data.alerts} hint="from Telegram" tone="--accent-rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 nb-card p-5">
          <div className="micro-label">Coverage</div>
          <h2 className="display-title text-[20px] mt-1">Protection and connectivity</h2>
          <div className="space-y-4 mt-4">
            <Coverage label="Connected accounts" value={data.connected} total={data.total} tone="--accent-mint" />
            <Coverage label="Two-step verification" value={data.with2fa} total={data.total} tone="--accent-sun" />
            <Coverage label="Login email set" value={data.withEmail} total={data.total} tone="--accent-peach" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-5">
            <div className="rounded-2xl border border-[color:var(--hairline)] px-3 py-2.5">
              <div className="micro-label">Connected</div>
              <div className="font-mono text-lg mt-1">{data.connected}</div>
            </div>
            <div className="rounded-2xl border border-[color:var(--hairline)] px-3 py-2.5">
              <div className="micro-label">Disconnected</div>
              <div className="font-mono text-lg mt-1">{data.disconnected}</div>
            </div>
            <div className="rounded-2xl border border-[color:var(--hairline)] px-3 py-2.5">
              <div className="micro-label">Banned</div>
              <div className="font-mono text-lg mt-1">{data.banned}</div>
            </div>
          </div>
        </div>

        <div className="nb-card p-5">
          <div className="micro-label">Security queue</div>
          <h2 className="display-title text-[20px] mt-1">Accounts needing attention</h2>
          {data.alertAccounts.length === 0 ? (
            <div className="text-sm text-muted mt-4">No unread Telegram security alerts.</div>
          ) : (
            <div className="space-y-2 mt-4">
              {data.alertAccounts.map((account) => {
                const name = `${account.first_name || ''} ${account.last_name || ''}`.trim() || account.phone
                return (
                  <div key={account.id} className="flex items-center gap-2 rounded-xl border border-[color:var(--hairline)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold truncate">{name}</div>
                      <div className="text-[9px] text-muted font-mono truncate">{account.phone}</div>
                    </div>
                    <span className="nb-badge bg-brand-err shrink-0">{account.unread_security} new</span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="text-[10px] text-muted mt-4 leading-5">
            Open Security to review login/reset requests and bulk account protection.
          </div>
        </div>
      </div>

      <div className="text-[10px] text-muted text-right font-mono">
        Last account refresh {fmtTime(new Date())}
      </div>
    </div>
  )
}
