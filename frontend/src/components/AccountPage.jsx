import { useEffect, useState } from 'react'
import ProfileTab from '../tabs/ProfileTab'
import { AccountRow } from '../tabs/SecurityTab'
import { CopyButton } from '../lib/CopyButton'
import { fmtTime } from '../lib/util'
import Icon from './Icon'

function StatusBadge({ status }) {
  if (status === 'connected') return <span className="nb-badge bg-brand-ok">Connected</span>
  if (status === 'banned') return <span className="nb-badge bg-brand-err">Banned</span>
  return <span className="nb-badge bg-brand-warn">Disconnected</span>
}

const ACCOUNT_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security & sessions' },
]

export default function AccountPage({ account, accountNumber, accountTotal, onPrev, onNext, onRefresh, onOpenTab }) {
  const [section, setSection] = useState('overview')

  useEffect(() => {
    setSection('overview')
  }, [account?.id])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (typeof document !== 'undefined' && (!document.hasFocus() || document.visibilityState !== 'visible')) return
      const target = e.target
      const tag = target?.tagName?.toLowerCase()
      if (
        target?.isContentEditable ||
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.closest?.('[contenteditable="true"]')
      ) return
      e.preventDefault()
      if (e.key === 'ArrowLeft') onPrev?.()
      else onNext?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onPrev, onNext])

  if (!account) return null
  const name = `${account.first_name || ''} ${account.last_name || ''}`.trim() || account.phone
  const activeSection = ACCOUNT_SECTIONS.find((item) => item.id === section) || ACCOUNT_SECTIONS[0]

  return (
    <div className="space-y-5">
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div className="min-w-0">
          <div className="micro-label">Account workspace</div>
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
                <span className="truncate">? @{account.username}</span>
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

      <div className="flex gap-1 overflow-x-auto border-b border-[color:var(--hairline)] pb-1">
        {ACCOUNT_SECTIONS.map((item) => (
          <button
            key={item.id}
            className={`nb-tab whitespace-nowrap ${section === item.id ? 'nb-tab-active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-auto hidden sm:flex items-center text-[10px] text-muted px-2">
          {activeSection.label}
        </span>
      </div>

      {section === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 nb-card p-5">
            <div className="micro-label">Account summary</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <div className="rounded-2xl border border-[color:var(--hairline)] px-4 py-3">
                <div className="micro-label">Phone</div>
                <div className="font-mono text-sm mt-1 truncate">{account.phone}</div>
              </div>
              <div className="rounded-2xl border border-[color:var(--hairline)] px-4 py-3">
                <div className="micro-label">Username</div>
                <div className="font-mono text-sm mt-1 truncate">{account.username ? `@${account.username}` : 'Not set'}</div>
              </div>
              <div className="rounded-2xl border border-[color:var(--hairline)] px-4 py-3">
                <div className="micro-label">Connection</div>
                <div className="flex items-center gap-2 mt-1"><StatusBadge status={account.status} /></div>
              </div>
              <div className="rounded-2xl border border-[color:var(--hairline)] px-4 py-3">
                <div className="micro-label">Security</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {account.has_2fa ? <span className="nb-badge bg-brand-info">2FA on</span> : <span className="nb-badge bg-brand-warn">2FA off</span>}
                  {account.unread_security > 0 ? <span className="nb-badge bg-brand-err">{account.unread_security} new</span> : <span className="text-xs text-muted">No new alerts</span>}
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--hairline)] px-4 py-3">
                <div className="micro-label">Login email</div>
                <div className="text-sm mt-1 truncate">{account.login_email_pattern || 'Not set'}</div>
              </div>
              <div className="rounded-2xl border border-[color:var(--hairline)] px-4 py-3">
                <div className="micro-label">Last seen</div>
                <div className="text-sm mt-1">{account.last_seen ? fmtTime(account.last_seen) : '?'}</div>
              </div>
            </div>
          </div>

          <div className="nb-card p-5">
            <div className="micro-label">Quick actions</div>
            <div className="grid grid-cols-1 gap-2 mt-4">
              <button className="nb-btn w-full justify-start" onClick={() => setSection('profile')}>Edit profile</button>
              <button className="nb-btn w-full justify-start" onClick={() => setSection('security')}>Security & sessions</button>
              <button className="nb-btn w-full justify-start" onClick={() => onOpenTab?.('groups')}>Groups</button>
              <button className="nb-btn w-full justify-start" onClick={() => onOpenTab?.('messages')}>Messages</button>
              <button className="nb-btn w-full justify-start" onClick={onRefresh}>Refresh account data</button>
            </div>
          </div>
        </div>
      )}

      {section === 'profile' && (
        <ProfileTab account={account} onRefresh={onRefresh} showChat={false} />
      )}

      {section === 'security' && (
        <AccountRow
          key={account.id}
          account={account}
          isSelected
          focused
          onChange={onRefresh}
        />
      )}
    </div>
  )
}
