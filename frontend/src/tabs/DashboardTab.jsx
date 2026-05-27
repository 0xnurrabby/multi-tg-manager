import { CopyButton } from '../lib/CopyButton'
import { initials, colorForString } from '../lib/util'

function Stat({ label, value, color = 'bg-white' }) {
  return (
    <div className={`nb-card p-5 ${color} text-black`}>
      <div className="text-[11px] uppercase font-extrabold tracking-tight">{label}</div>
      <div className="text-5xl font-extrabold mt-1 font-mono">{value}</div>
    </div>
  )
}

export default function DashboardTab({ stats, accounts, onSelect }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total Accounts" value={stats.total} />
        <Stat label="Connected"      value={stats.connected} color="bg-brand-ok" />
        <Stat label="Banned"         value={stats.banned}    color="bg-brand-err" />
        <Stat label="2FA Enabled"    value={stats.with_2fa}  color="bg-brand-violet" />
      </div>

      <div className="nb-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-extrabold uppercase">Accounts at a glance</div>
          <div className="text-xs opacity-70">Click any card to edit profile</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.length === 0 && (
            <div className="opacity-60 text-sm">No accounts. Use “+ Add Account” in the sidebar.</div>
          )}
          {accounts.map((a) => (
            <div key={a.id} onClick={() => onSelect(a.id)} className="nb-card-sm p-3 cursor-pointer hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 border-2 border-black dark:border-white flex items-center justify-center font-extrabold text-black"
                  style={{ background: colorForString(a.phone) }}
                >{initials(a.first_name, a.last_name)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{(a.first_name + ' ' + a.last_name).trim() || a.phone}</div>
                  <div className="font-mono text-xs flex items-center gap-1">
                    {a.phone}<CopyButton value={a.phone} />
                  </div>
                  {a.username && (
                    <div className="font-mono text-xs flex items-center gap-1 opacity-80">
                      @{a.username}<CopyButton value={a.username} />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={'nb-badge ' + (a.status === 'connected' ? 'bg-brand-ok' : a.status === 'banned' ? 'bg-brand-err' : 'bg-brand-warn') + ' text-black'}>{a.status}</span>
                {a.has_2fa && <span className="nb-badge bg-brand-violet text-black">2FA</span>}
                {a.unread_security > 0 && <span className="nb-badge bg-brand-err text-black">{a.unread_security} alert</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
