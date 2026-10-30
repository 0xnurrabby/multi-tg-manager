import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Endpoints } from '../lib/api'
import { fmtTime } from '../lib/util'
import { useToast } from '../lib/toast.jsx'

const DAILY_LIMIT = 100
const TONES = ['--accent-mint', '--accent-sky', '--accent-sun', '--accent-peach', '--accent-rose']
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'working', label: 'In progress' },
  { id: 'done', label: 'Done' },
  { id: 'limit', label: 'Limit reached' },
  { id: 'zero', label: 'Not started' },
  { id: 'error', label: 'Needs retry' },
]

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function percent(n, d) {
  if (!d) return 0
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)))
}

function StatCard({ label, value, hint, tone }) {
  return (
    <div
      className="nb-card p-4 overflow-hidden"
      style={{ background: `linear-gradient(150deg, rgb(var(${tone}) / 0.42), rgb(var(--surface)) 72%)` }}
    >
      <div className="micro-label">{label}</div>
      <div className="display-title text-[30px] mt-2 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  )
}

function Progress({ value, tone = '--accent-mint', height = 8 }) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, background: 'rgb(var(--ink) / 0.07)' }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: `rgb(var(${tone}))` }}
      />
    </div>
  )
}

function chatTitle(chat) {
  if (!chat) return 'Not started'
  if (chat.status === 'error') return 'Needs retry'
  if (chat.status === 'cooldown') return 'Cooling down'
  if (chat.running) {
    const labels = {
      starting: 'Starting',
      thinking: 'Thinking',
      typing: 'Typing',
      waiting: 'Waiting for Meow',
      reading: 'Reading reply',
    }
    return labels[chat.status] || 'Working'
  }
  return chat.turns_done > 0 ? 'Paused' : 'Stopped'
}

function accountStatus(account, count, chat) {
  if (count >= DAILY_LIMIT) return { label: 'Done', tone: '--accent-mint' }
  if (chat?.status === 'limit') return { label: 'Limit reached', tone: '--accent-rose' }
  if (chat?.status === 'paused') return { label: 'Paused', tone: '--accent-sun' }
  if (chat?.status === 'error') return { label: 'Needs retry', tone: '--accent-rose' }
  if (chat?.status === 'cooldown') return { label: 'Cooling down', tone: '--accent-sun' }
  if (chat?.running) return { label: 'Working', tone: '--accent-sky' }
  if (count > 0) return { label: 'Paused', tone: '--accent-sun' }
  return { label: 'Not started', tone: '--accent-peach' }
}

function AccountCard({ account, count, chat, onOpen }) {
  const st = accountStatus(account, count, chat)
  const tone = st.tone
  const p = percent(count, DAILY_LIMIT)
  const name = `${account.first_name || ''} ${account.last_name || ''}`.trim() || account.phone
  return (
    <div
      className="rounded-[14px] border p-3 min-w-0"
      style={{
        borderColor: 'var(--hairline)',
        background: `linear-gradient(145deg, rgb(var(${tone}) / 0.20), rgb(var(--surface)) 75%)`,
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="w-7 h-7 rounded-full shrink-0 grid place-items-center text-[10px] font-semibold"
          style={{ background: `rgb(var(${tone}) / 0.55)` }}
        >
          {(name[0] || '?').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[12px] truncate" title={name}>{name}</div>
          <div className="font-mono text-[9px] text-muted truncate">{account.phone}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-[15px] tabular-nums leading-none">{count}</div>
          <div className="font-mono text-[8px] text-muted">/ {DAILY_LIMIT}</div>
        </div>
      </div>
      <div className="mt-2.5">
        <Progress value={p} tone={tone} height={6} />
      </div>
      <div className="mt-2 flex items-center gap-2 justify-between">
        <span className="text-[9px] font-mono uppercase tracking-[0.08em]" style={{ color: `rgb(var(${tone}))` }}>
          {st.label}
        </span>
        <button
          type="button"
          className="font-mono text-[9px] underline underline-offset-2 text-muted hover:text-ink"
          onClick={() => onOpen?.(account.id)}
        >
          Chat
        </button>
      </div>
      {chat?.last_error && chat.status !== 'cooldown' && (
        <div className="text-[9px] text-muted mt-1.5 truncate" title={chat.last_error}>{chat.last_error}</div>
      )}
    </div>
  )
}

export default function StatsTab({ accounts = [], onOpenChat }) {
  const toast = useToast()
  const [status, setStatus] = useState(null)
  const [counts, setCounts] = useState({})
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [countError, setCountError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [filter, setFilter] = useState('all')
  const alive = useRef(true)

  const mergeLive = useCallback((chats) => {
    setCounts((prev) => {
      let changed = false
      const next = { ...prev }
      for (const chat of chats || []) {
        if (!chat.daily_limit) continue
        const live = num(chat.daily_sent)
        if (live > num(next[chat.account_id])) {
          next[chat.account_id] = live
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const s = await Endpoints.aiStatus(2, false)
      if (!alive.current) return
      setStatus(s)
      mergeLive(s.accounts)
    } catch {
      /* polling should stay quiet */
    }
  }, [mergeLive])

  const syncCounts = useCallback(async () => {
    setSyncing(true)
    setCountError('')
    try {
      const r = await Endpoints.aiDailyCounts([])
      if (!alive.current) return
      setCounts((prev) => ({ ...prev, ...(r.counts || {}) }))
      setLastSync(new Date())
      if (r.errors?.length) setCountError(`${r.errors.length} account(s) could not be read`)
    } catch (e) {
      if (alive.current) setCountError(e.message)
    } finally {
      if (alive.current) setSyncing(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    loadStatus()
    syncCounts()
    const id = setInterval(loadStatus, 3000)
    return () => {
      alive.current = false
      clearInterval(id)
    }
  }, [loadStatus, syncCounts])

  async function retryErrors() {
    const ids = (status?.accounts || [])
      .filter((c) => c.status === 'error' && num(counts[c.account_id]) < DAILY_LIMIT)
      .map((c) => c.account_id)
    if (!ids.length) {
      toast.info('No failed accounts to retry')
      return
    }
    if (!confirm(`Retry ${ids.length} account(s) that stopped before 100?`)) return
    setRetrying(true)
    try {
      const r = await Endpoints.startAiChats(ids, true)
      if (r.started?.length) toast.success(`Retrying ${r.started.length} account(s)`)
      if (r.errors?.length) toast.error(`${r.errors.length} account(s) could not restart`)
      await loadStatus()
      await syncCounts()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setRetrying(false)
    }
  }

  const connected = useMemo(() => accounts.filter((a) => a.status === 'connected'), [accounts])
  const chatMap = useMemo(() => {
    const m = new Map()
    for (const chat of status?.accounts || []) m.set(chat.account_id, chat)
    return m
  }, [status])

  const rows = useMemo(() => connected.map((a) => {
    const chat = chatMap.get(a.id)
    const count = Math.max(num(counts[a.id]), num(chat?.daily_sent))
    return { account: a, chat, count }
  }), [connected, chatMap, counts])

  const goal = connected.length * DAILY_LIMIT
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  const done = rows.filter((r) => r.count >= DAILY_LIMIT).length
  const limits = rows.filter((r) => r.chat?.status === 'limit').length
  const paused = rows.filter((r) => r.chat?.status === 'paused').length
  const working = rows.filter((r) => r.count > 0 && r.count < DAILY_LIMIT && r.chat?.status !== 'error' && r.chat?.status !== 'limit' && r.chat?.status !== 'paused').length
  const zero = rows.filter((r) => r.count === 0 && r.chat?.status !== 'error' && r.chat?.status !== 'limit' && r.chat?.status !== 'paused').length
  const errors = rows.filter((r) => r.chat?.status === 'error').length
  const active = status?.active ?? 0
  const overall = percent(total, goal)
  const remaining = Math.max(0, goal - total)

  const board = useMemo(() => {
    const list = [...rows]
    if (filter === 'done') return list.filter((r) => r.count >= DAILY_LIMIT)
    if (filter === 'limit') return list.filter((r) => r.chat?.status === 'limit')
    if (filter === 'working') return list.filter((r) => r.count > 0 && r.count < DAILY_LIMIT && r.chat?.status !== 'error' && r.chat?.status !== 'limit' && r.chat?.status !== 'paused')
    if (filter === 'zero') return list.filter((r) => r.count === 0 && r.chat?.status !== 'error' && r.chat?.status !== 'limit' && r.chat?.status !== 'paused')
    if (filter === 'error') return list.filter((r) => r.chat?.status === 'error')
    return list
  }, [rows, filter]).sort((a, b) => (b.count - a.count) || a.account.phone.localeCompare(b.account.phone))

  const resetText = '6:00 AM Bangladesh'
  const model = status?.settings?.model || 'deepseek/deepseek-v4-flash-0731'

  return (
    <div className="space-y-5">
      <section className="nb-card p-5 sm:p-6 overflow-hidden relative"
        style={{ background: 'linear-gradient(135deg, rgb(var(--accent-mint) / 0.38), rgb(var(--surface)) 48%, rgb(var(--accent-sky) / 0.30))' }}>
        <div className="relative flex flex-col xl:flex-row gap-6 xl:items-end xl:justify-between">
          <div className="max-w-[62ch]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="micro-label">Live overview</span>
              <span className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.12em] text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-ok animate-pulse" />
                Live
              </span>
            </div>
            <h1 className="display-title mt-2" style={{ fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.02 }}>
              Today's progress, <span className="serif-accent">in one place.</span>
            </h1>
            <p className="text-sm text-muted mt-3 leading-6">
              {done} account{done === 1 ? '' : 's'} finished 100 messages. {working} still working,
              {' '}{limits} hit the bot limit, {paused} paused, {zero} not started, and {errors} need a retry.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2 flex-wrap">
            <button className="nb-btn" onClick={syncCounts} disabled={syncing}>
              {syncing ? 'Reading Telegram...' : 'Refresh counts'}
            </button>
            {errors > 0 && (
              <button className="nb-btn-err" onClick={retryErrors} disabled={retrying}>
                {retrying ? 'Retrying...' : `Retry ${errors} failed`}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-[16px] p-4" style={{ background: 'rgb(var(--surface) / 0.70)', border: '1px solid var(--hairline)' }}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="display-title text-[44px] tabular-nums leading-none">{overall}%</span>
              <span className="text-[11px] text-muted">of today's goal</span>
            </div>
            <div className="text-[11px] text-muted font-mono">
              {total.toLocaleString()} / {goal.toLocaleString()} messages
            </div>
          </div>
          <div className="mt-3">
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ink) / 0.08)' }}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${overall}%`,
                  background: 'linear-gradient(90deg, rgb(var(--accent-mint)), rgb(var(--accent-sky)))',
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap mt-3 text-[10px] text-muted">
            <span><span className="font-mono text-ink">{remaining.toLocaleString()}</span> remaining</span>
            <span><span className="font-mono text-ink">{active}</span> active</span>
            <span>Reset {resetText}</span>
            <span className="ml-auto">Counts: {lastSync ? lastSync.toLocaleTimeString() : 'waiting for Telegram...'}</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 stagger">
        <StatCard label="Done" value={done} hint="at 100 / 100" tone="--accent-mint" />
        <StatCard label="Working" value={working} hint="in progress" tone="--accent-sky" />
        <StatCard label="Active" value={active} hint="talking to Meow" tone="--accent-sun" />
        <StatCard label="Limit reached" value={limits} hint="skip until reset" tone="--accent-rose" />
        <StatCard label="Not started" value={zero} hint="no messages yet" tone="--accent-peach" />
        <StatCard label="Needs retry" value={errors} hint="other errors" tone="--accent-rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 nb-card p-5">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="micro-label">Account board</div>
              <h2 className="display-title text-[20px] mt-1">Every account, live</h2>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={'nb-badge ' + (filter === f.id ? 'bg-brand-pri' : '')}
                  onClick={() => setFilter(f.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {countError && <div className="nb-note nb-note-warn px-3 py-2 text-[11px] mt-3">{countError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 mt-4 max-h-[720px] overflow-auto pr-1">
            {board.map(({ account, chat, count }) => (
              <AccountCard
                key={account.id}
                account={account}
                chat={chat}
                count={count}
                onOpen={onOpenChat}
              />
            ))}
            {board.length === 0 && (
              <div className="empty-state col-span-full">
                <div className="empty-title">Nothing here yet</div>
                <div className="text-sm">Choose another filter or start Fill 100 from AI Chat.</div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="nb-card p-5" style={{ background: 'linear-gradient(155deg, rgb(var(--accent-sky) / 0.30), rgb(var(--surface)) 72%)' }}>
            <div className="micro-label">The story</div>
            <h2 className="display-title text-[19px] mt-1">What is happening</h2>
            <div className="space-y-3 mt-4 text-[12px] leading-6 text-muted">
              <div><span className="font-mono text-ink">{done}</span> accounts are finished. Their daily counter is at least 100.</div>
              <div><span className="font-mono text-ink">{working}</span> accounts are still moving. <span className="font-mono text-ink">{active}</span> are running together now, with sends paced so Meow is not flooded.</div>
              <div><span className="font-mono text-ink">{limits}</span> accounts got the bot's real limit message and are skipped until reset. <span className="font-mono text-ink">{paused}</span> had no reply and can be retried. <span className="font-mono text-ink">{zero}</span> have not sent anything yet; <span className="font-mono text-ink">{errors}</span> have other errors.</div>
              <div className="pt-2 border-t border-[color:var(--hairline)]">
                Total today: <span className="font-mono text-ink">{total.toLocaleString()}</span> messages.
                {' '}Still left: <span className="font-mono text-ink">{remaining.toLocaleString()}</span>.
              </div>
            </div>
          </div>

          <div className="nb-card p-5" style={{ background: 'linear-gradient(155deg, rgb(var(--accent-sun) / 0.34), rgb(var(--surface)) 72%)' }}>
            <div className="micro-label">Run details</div>
            <div className="space-y-2 mt-3 text-[12px] text-muted">
              <div className="flex justify-between gap-3"><span>Connected</span><span className="font-mono text-ink">{connected.length}</span></div>
              <div className="flex justify-between gap-3"><span>Daily goal</span><span className="font-mono text-ink">{goal.toLocaleString()}</span></div>
              <div className="flex justify-between gap-3"><span>Per account</span><span className="font-mono text-ink">{DAILY_LIMIT}</span></div>
              <div className="flex justify-between gap-3"><span>Reset</span><span className="font-mono text-ink">{resetText}</span></div>
              <div className="flex justify-between gap-3"><span>Model</span><span className="font-mono text-ink truncate max-w-[150px]" title={model}>{model.split('/').pop()}</span></div>
            </div>
            <div className="text-[10px] text-muted mt-4 leading-5">
              Counts are read from Telegram. Live progress updates while chats are running. When Meow stops replying, the account pauses instead of hanging forever.
            </div>
          </div>

          {lastSync && (
            <div className="text-[10px] text-muted text-right font-mono">
              Last count sync {fmtTime(lastSync.toISOString())}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
