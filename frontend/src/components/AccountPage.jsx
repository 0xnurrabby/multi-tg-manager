import ProfileTab from '../tabs/ProfileTab'
import { AccountRow } from '../tabs/SecurityTab'
import { CopyButton } from '../lib/CopyButton'

function StatusBadge({ status }) {
  if (status === 'connected') return <span className="nb-badge bg-brand-ok">Connected</span>
  if (status === 'banned') return <span className="nb-badge bg-brand-err">Banned</span>
  return <span className="nb-badge bg-brand-warn">Disconnected</span>
}

export default function AccountPage({ account, onRefresh, onOpenTab }) {
  if (!account) return null
  const name = `${account.first_name || ''} ${account.last_name || ''}`.trim() || account.phone

  return (
    <div className="space-y-6">
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div className="min-w-0">
          <div className="micro-label">Account</div>
          <h1
            className="display-title mt-2 truncate"
            style={{ fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1 }}
          >
            {name}
          </h1>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted mt-3">
            <span>{account.phone}</span>
            <CopyButton value={account.phone} label="phone" />
            {account.username && <span className="truncate">· @{account.username}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:justify-end">
          <StatusBadge status={account.status} />
          {account.has_2fa
            ? <span className="nb-badge bg-brand-info">2FA on</span>
            : <span className="nb-badge bg-brand-warn">2FA off</span>}
          {account.unread_security > 0 && (
            <span className="nb-badge bg-brand-err">{account.unread_security} new</span>
          )}
          <button className="nb-btn" onClick={() => onOpenTab?.('groups')}>Groups</button>
          <button className="nb-btn" onClick={() => onOpenTab?.('messages')}>Messages</button>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="min-w-0">
          <div className="micro-label mb-2">Profile</div>
          <ProfileTab account={account} onRefresh={onRefresh} showChat={false} />
        </div>

        <div className="min-w-0">
          <div className="micro-label mb-2">Security</div>
          <AccountRow
            key={account.id}
            account={account}
            isSelected
            focused
            onChange={onRefresh}
          />
        </div>
      </div>
    </div>
  )
}
