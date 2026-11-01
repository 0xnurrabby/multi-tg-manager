import { useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'

export default function TunnelLink() {
  const [info, setInfo] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await Endpoints.tunnel()
        if (alive) setInfo(r)
      } catch {
        /* silent while the tunnel is starting */
      }
    }
    load()
    const id = setInterval(load, 7000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  async function copy() {
    if (!info?.url) return
    try {
      await navigator.clipboard.writeText(info.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  if (!info) return null

  if (info.url) {
    return (
      <div className="stat-chip !gap-1.5 max-w-[330px] min-w-0" title={info.url}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgb(var(--accent-peach))' }} />
        <span className="micro-label shrink-0">Cloudflare</span>
        <a
          href={info.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] leading-none truncate hover:underline min-w-0"
        >
          {info.url.replace(/^https?:\/\//, '')}
        </a>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] border border-[color:var(--hairline)] text-muted hover:text-ink hover:border-[color:var(--hairline-strong)]"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    )
  }

  if (info.status === 'starting' || info.status === 'downloading') {
    return (
      <div className="stat-chip !gap-1.5" title={info.status === 'downloading' ? 'Downloading cloudflared...' : 'Starting Cloudflare tunnel...'}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: 'rgb(var(--accent-peach))' }} />
        <span className="micro-label">Tunnel starting</span>
      </div>
    )
  }

  if (info.status === 'error' && info.error) {
    return (
      <div className="stat-chip !gap-1.5 max-w-[260px]" title={info.error}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgb(var(--accent-rose))' }} />
        <span className="micro-label">Tunnel off</span>
      </div>
    )
  }

  return null
}
