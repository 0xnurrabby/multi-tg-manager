import { useEffect, useState } from 'react'
import { initials, colorForString } from '../lib/util'
import { fetchAvatar, subscribe, get as getCachedAvatar } from '../lib/avatar'

export default function AccountAvatar({
  account,
  size = 40,
  showOnline = false,
  className = '',
}) {
  const [url, setUrl] = useState(() => getCachedAvatar(account.id))

  useEffect(() => {
    let cancelled = false
    if (account.status === 'connected') {
      fetchAvatar(account.id).then((u) => { if (!cancelled) setUrl(u) })
    }
    const unsub = subscribe(account.id, (u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true; unsub() }
  }, [account.id, account.status])

  const px = `${size}px`
  return (
    <div
      className={        'relative border border-[color:var(--hairline)] overflow-hidden flex items-center justify-center font-semibold text-ink ' + className}
      style={{ width: px, height: px, background: url ? '#fff' : colorForString(account.phone) }}
    >
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : <span style={{ fontSize: Math.max(10, Math.round(size * 0.4)) }}>
            {initials(account.first_name, account.last_name)}
          </span>}
      {showOnline && (
        <span
          className={
            'absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[color:var(--surface)] ' +
            (account.is_online ? 'bg-brand-ok' : 'bg-zinc-400')
          }
        />
      )}
    </div>
  )
}
