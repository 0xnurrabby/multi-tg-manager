import { CopyButton } from '../lib/CopyButton'
import { initials, colorForString } from '../lib/util'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

function statusBadge(status) {
  if (status === 'connected') return <span className="nb-badge bg-brand-ok text-black">Connected</span>
  if (status === 'banned')    return <span className="nb-badge bg-brand-err text-black">Banned</span>
  return <span className="nb-badge bg-brand-warn text-black">Disconnected</span>
}

export default function Sidebar({ accounts, selectedId, onSelect, onAdd, onDeleted }) {
  const toast = useToast()
  return (
    <aside className="w-[320px] border-r-2 border-black dark:border-white bg-white dark:bg-zinc-900 flex flex-col">
      <div className="p-3 border-b-2 border-black dark:border-white flex items-center justify-between">
        <span className="font-extrabold uppercase tracking-tight">Accounts ({accounts.length})</span>
      </div>
      <div className="flex-1 overflow-auto">
        {accounts.length === 0 && (
          <div className="p-4 text-sm opacity-70">No accounts yet. Add your first account below.</div>
        )}
        {accounts.map((a) => {
          const sel = a.id === selectedId
          return (
            <div
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={
                'flex items-start gap-3 p-3 border-b-2 border-black dark:border-white cursor-pointer transition-colors ' +
                (sel ? 'bg-brand-pri text-black' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800')
              }
            >
              <div
                className="relative w-10 h-10 border-2 border-black dark:border-white flex items-center justify-center font-extrabold text-black"
                style={{ background: colorForString(a.phone) }}
              >
                {initials(a.first_name, a.last_name)}
                <span
                  className={
                    'absolute -bottom-1 -right-1 w-3 h-3 border-2 border-black ' +
                    (a.is_online ? 'bg-brand-ok' : 'bg-zinc-400')
                  }
                />
              </div>
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
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (!confirm(`Remove ${a.phone}? Session file will be deleted.`)) return
                      try {
                        await Endpoints.deleteAccount(a.id)
                        toast.success('Account removed')
                        onDeleted?.()
                      } catch (err) { toast.error(err.message) }
                    }}
                  >remove</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="p-3 border-t-2 border-black dark:border-white">
        <button className="nb-btn-pri w-full" onClick={onAdd}>+ Add Account</button>
      </div>
    </aside>
  )
}
