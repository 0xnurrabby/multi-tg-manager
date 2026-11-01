import ProfileTab from '../tabs/ProfileTab'
import { AccountRow } from '../tabs/SecurityTab'
import { CopyButton } from '../lib/CopyButton'
import Icon from './Icon'

function StatusBadge({ status }) {
  if (status === 'connected') return <span className="nb-badge bg-brand-ok">Connected</span>
  if (status === 'banned') return <span className="nb-badge bg-brand-err">Banned</span>
  return <span className="nb-badge bg-brand-warn">Disconnected</span>
}

export default function AccountPage({ account, accountNumber, accountTotal, onPrev, onNext, onRefresh, onOpenTab }) {
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
            {account.username && (
              <span className="flex items-center gap-1 min-w-0">
                <span className="truncate">· @{account.username}</span>
                <CopyButton value={account.username} label="username" />
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-3">
          {accountNumber && (
            <div className="flex items-center gap-1.5">
              <button className="icon-btn" onClick={onPrev} title="Previous account" aria-label="Previous account">
                <Icon name="arrow" size={16} className="rotate-180" />
              </button>
              <span className="nb-badge bg-brand-pri text-black">
                #{accountNumber} / {accountTotal}
              </span>
              <button className="icon-btn" onClick={onNext} title="Next account" aria-label="Next account">
                <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
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
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="min-w-0 order-2 xl:order-1">
          <div className="micro-label mb-2">Profile</div>
          <ProfileTab account={account} onRefresh={onRefresh} showChat={false} />
        </div>

        <div className="min-w-0 order-1 xl:order-2">
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
