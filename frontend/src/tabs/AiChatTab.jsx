import { useCallback, useEffect, useRef, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-0731'
const DEFAULT_TARGET = '@folkapp_bot'
const TONES = ['--accent-sun', '--accent-mint', '--accent-sky', '--accent-peach', '--accent-rose']

function fmtClock(iso) {
  if (!iso) return ''
  const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z'
  const d = new Date(norm)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function statusMeta(chat) {
  if (chat.status === 'error') return { label: 'Error', color: 'rgb(var(--accent-rose))' }
  if (chat.status === 'completed') return { label: 'Completed', color: 'rgb(var(--accent-mint))' }
  if (!chat.running) return { label: 'Stopped', color: 'rgb(var(--muted))' }
  const map = {
    starting: { label: 'Starting', color: 'rgb(var(--accent-sky))' },
    thinking: { label: 'Thinking', color: 'rgb(var(--accent-sun))' },
    typing:   { label: 'Typing', color: 'rgb(var(--accent-sun))' },
    waiting:  { label: 'Waiting for bot', color: 'rgb(var(--accent-peach))' },
    reading:  { label: 'Reading reply', color: 'rgb(var(--accent-sky))' },
    queued:   { label: 'Queued', color: 'rgb(var(--accent-sky))' },
    cooldown: { label: 'Cooling down', color: 'rgb(var(--accent-peach))' },
  }
  return map[chat.status] || { label: 'Live', color: 'rgb(var(--accent-mint))' }
}

function ChatCard({ chat, target, focused, onStop, stopping }) {
  const listRef = useRef(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length, chat.status])

  const st = statusMeta(chat)
  const tone = TONES[(chat.account_id || 0) % TONES.length]
  const progress = chat.turn_target
    ? `${chat.turns_done || 0} of ${chat.turn_target} ${chat.fill_daily ? 'to fill' : 'chats'}`
    : ''
  const daily = chat.daily_limit ? `${chat.daily_sent || 0}/${chat.daily_limit} today` : ''

  return (
    <div
      id={`ai-chat-${chat.account_id}`}
      className={'nb-card overflow-hidden flex flex-col min-w-0 ' + (focused ? 'border-[color:var(--hairline-strong)]' : '')}
    >
      <div className="px-4 py-3 border-b border-[color:var(--hairline)]">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: `rgb(var(${tone}))` }} />
              <span className="font-semibold text-[14px] truncate">{chat.name}</span>
              <span className="micro-label">{chat.persona}</span>
              {chat.language && <span className="nb-badge !text-[9px]">{chat.language}</span>}
            </div>
            <div className="font-mono text-[10px] text-muted mt-1 truncate">
              {chat.phone} · {target || DEFAULT_TARGET}
              {chat.topic ? ` · ${chat.topic}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-[0.08em] flex items-center gap-1.5" style={{ color: st.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />
              {st.label}
            </span>
            {daily && <span className="text-[10px] font-mono text-muted">{daily}</span>}
            {progress && <span className="text-[10px] font-mono text-muted">{progress}</span>}
            {chat.running && (
              <button className="nb-btn-err !py-1 !px-3 !text-[11px]" onClick={() => onStop(chat.account_id)} disabled={stopping}>
                Stop
              </button>
            )}
          </div>
        </div>
        {chat.last_error && (
          <div className="nb-note nb-note-err px-2 py-1.5 text-[11px] mt-2">{chat.last_error}</div>
        )}
      </div>

      <div ref={listRef} className="p-3 space-y-2 overflow-auto bg-paper" style={{ maxHeight: '360px', minHeight: '220px' }}>
        {chat.messages.length === 0 && (
          <div className="empty-state" style={{ padding: '36px 16px' }}>
            <span className="empty-icon"><span className="text-lg">...</span></span>
            <div className="empty-title">Waiting for the first message</div>
            <div className="text-sm">The conversation will appear here.</div>
          </div>
        )}
        {chat.messages.map((m) => {
          const out = m.direction === 'me'
          return (
            <div key={m.id} className={'flex ' + (out ? 'justify-end' : 'justify-start')}>
              <div className={
                'max-w-[88%] rounded-[12px] px-3 py-2 text-[12px] leading-5 break-words border ' +
                (out
                  ? 'bg-ink text-paper border-ink'
                  : 'bg-surface text-ink border-[color:var(--hairline)]')
              }>
                {out && m.reply_to_text && (
                  <div className="mb-1.5 pl-2 border-l-2 border-paper/40 text-[10px] leading-4 opacity-80 line-clamp-2">
                    {m.reply_to_text}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.reaction && <div className="mt-1 text-[13px] leading-none">{m.reaction}</div>}
                <div className={'text-[9px] font-mono mt-1 text-right ' + (out ? 'text-paper/55' : 'text-muted')}>
                  {fmtClock(m.created_at)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-4 py-2 border-t border-[color:var(--hairline)] flex items-center justify-between text-[10px] text-muted font-mono">
        <span>Meow's replies are read automatically</span>
        <span>{chat.last_activity ? fmtClock(chat.last_activity) : ''}</span>
      </div>
    </div>
  )
}

export default function AiChatTab({ accounts, focusAccountId, focusTick }) {
  const toast = useToast()
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState(null)
  const [selected, setSelected] = useState([])
  const [search, setSearch] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [editKey, setEditKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [minTurns, setMinTurns] = useState(4)
  const [maxTurns, setMaxTurns] = useState(10)
  const [focusChatId, setFocusChatId] = useState(null)
  const [showAllChats, setShowAllChats] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [filling, setFilling] = useState(false)
  const [checkingDaily, setCheckingDaily] = useState(false)
  const [dailyCounts, setDailyCounts] = useState({})
  const [dailyLimit, setDailyLimit] = useState(100)
  const lastFocusRef = useRef(0)

  useEffect(() => {
    Endpoints.aiSettings()
      .then((s) => {
        setSettings(s)
        setModel(s?.model || DEFAULT_MODEL)
        setTarget(s?.target || DEFAULT_TARGET)
        setMinTurns(s?.min_turns ?? 4)
        setMaxTurns(s?.max_turns ?? 10)
        if (!s?.has_key) setEditKey(true)
      })
      .catch((e) => toast.error(e.message))
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await Endpoints.aiStatus(12)
      setStatus(s)
      return s
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let alive = true
    let timer = null
    let delay = 6000
    const tick = async () => {
      const s = await refreshStatus()
      if (s?.settings) {
        setSettings((prev) => (prev ? { ...prev, ...s.settings } : s.settings))
      }
      delay = s?.running ? (s.running > 20 ? 4000 : 2500) : 8000
      if (alive) timer = setTimeout(tick, delay)
    }
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [refreshStatus])

  // Keep daily counters moving while a fill task is running.
  useEffect(() => {
    const chats = status?.accounts || []
    setDailyCounts((prev) => {
      let changed = false
      const next = { ...prev }
      for (const chat of chats) {
        if (!chat.daily_limit) continue
        const value = Number(chat.daily_sent || 0)
        if (next[chat.account_id] !== value) {
          next[chat.account_id] = value
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [status])

  // A sidebar account click on the AI tab focuses that account's live chat.
  useEffect(() => {
    if (!focusAccountId || !focusTick || focusTick === lastFocusRef.current || !status) return
    lastFocusRef.current = focusTick
    const has = (status.accounts || []).some((c) => c.account_id === focusAccountId)
    if (!has) {
      toast.info('No Meow chat yet for this account. Tick it and run.')
      return
    }
    setFocusChatId(focusAccountId)
    setTimeout(() => document.getElementById('ai-chats')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [focusAccountId, focusTick, status, toast])

  useEffect(() => {
    if (focusChatId && status && !(status.accounts || []).some((c) => c.account_id === focusChatId)) {
      setFocusChatId(null)
    }
  }, [focusChatId, status])

  function focusChat(id) {
    const has = (status?.accounts || []).some((c) => c.account_id === id)
    if (!has) {
      toast.info('No Meow chat yet for this account. Tick it and run.')
      return
    }
    setFocusChatId(id)
    setTimeout(() => document.getElementById('ai-chats')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const connectedAccounts = accounts.filter((a) => a.status === 'connected')
  const visibleAccounts = accounts.filter((a) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${a.first_name} ${a.last_name} ${a.username} ${a.phone}`.toLowerCase().includes(q)
  })
  const selectable = visibleAccounts.filter((a) => a.status === 'connected')
  const allSelected = selectable.length > 0 && selectable.every((a) => selected.includes(a.id))
  const toggle = (id) => setSelected((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])
  const toggleAll = () => {
    if (allSelected) {
      setSelected((arr) => arr.filter((id) => !selectable.some((a) => a.id === id)))
    } else {
      setSelected((arr) => Array.from(new Set([...arr, ...selectable.map((a) => a.id)])))
    }
  }

  async function saveSettings() {
    if (!settings?.has_key && !keyInput.trim()) {
      toast.error('Enter your Vercel AI Gateway API key first')
      return
    }
    if (!model.trim() || !target.trim()) {
      toast.error('Model and target bot are required')
      return
    }
    const lo = Math.max(1, Math.min(Number(minTurns) || 1, 500))
    const hi = Math.max(1, Math.min(Number(maxTurns) || 1, 500))
    if (lo > hi) {
      toast.error('Minimum chats cannot be higher than maximum chats')
      return
    }
    setSaving(true)
    try {
      const s = await Endpoints.saveAiSettings({
        api_key: keyInput.trim() || undefined,
        model: model.trim(),
        target: target.trim(),
        min_turns: lo,
        max_turns: hi,
      })
      setSettings(s)
      setMinTurns(s?.min_turns ?? lo)
      setMaxTurns(s?.max_turns ?? hi)
      setKeyInput('')
      setEditKey(false)
      toast.success('Gateway settings saved')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function clearKey() {
    if (!confirm('Remove the saved AI Gateway API key from this machine?')) return
    setSaving(true)
    try {
      const s = await Endpoints.clearAiKey()
      setSettings(s)
      setKeyInput('')
      setEditKey(true)
      toast.success('API key removed')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function runSelected() {
    if (selected.length === 0) {
      toast.error('Pick at least one account')
      return
    }
    if (!settings?.has_key) {
      toast.error('Add your Vercel AI Gateway API key first')
      setEditKey(true)
      return
    }
    setBusy(true)
    try {
      const ids = selected.filter((id) => accounts.some((a) => a.id === id && a.status === 'connected'))
      if (ids.length === 0) {
        toast.error('None of the selected accounts are connected')
        return
      }
      if (ids.length > 5 && !confirm(
        `Start Meow chats on ${ids.length} accounts?\n\n` +
        `Each account will send between ${minTurns} and ${maxTurns} messages.`
      )) {
        return
      }
      const r = await Endpoints.startAiChats(ids)
      if (r.started?.length) toast.success(`Started ${r.started.length} chat${r.started.length === 1 ? '' : 's'}`)
      if (r.errors?.length) toast.error(`${r.errors.length} account${r.errors.length === 1 ? '' : 's'} could not start`)
      await refreshStatus()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function checkDaily() {
    const ids = (selected.length
      ? selected
      : accounts.filter((a) => a.status === 'connected').map((a) => a.id))
      .filter((id) => accounts.some((a) => a.id === id && a.status === 'connected'))
    if (ids.length === 0) {
      toast.error('No connected accounts to check')
      return
    }
    setCheckingDaily(true)
    try {
      const r = await Endpoints.aiDailyCounts(ids)
      setDailyCounts((prev) => ({ ...prev, ...(r.counts || {}) }))
      if (r.daily_limit) setDailyLimit(r.daily_limit)
      const values = Object.values(r.counts || {})
      const total = values.reduce((sum, n) => sum + Number(n || 0), 0)
      const full = values.filter((n) => Number(n) >= (r.daily_limit || 100)).length
      toast.success(`Checked ${values.length} accounts: ${total} messages today${full ? `, ${full} already at 100` : ''}`)
      if (r.errors?.length) toast.error(`${r.errors.length} account${r.errors.length === 1 ? '' : 's'} could not be checked`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setCheckingDaily(false)
    }
  }

  async function fillDaily() {
    if (!settings?.has_key) {
      toast.error('Add your Vercel AI Gateway API key first')
      setEditKey(true)
      return
    }
    const source = selected.length ? selected : connectedAccounts.map((a) => a.id)
    const ids = source.filter((id) => accounts.some((a) => a.id === id && a.status === 'connected'))
    if (ids.length === 0) {
      toast.error('No connected accounts to fill')
      return
    }
    if (ids.length > 5 && !confirm(
      `Fill today's 100 messages on ${ids.length} account${ids.length === 1 ? '' : 's'}?\n\n` +
      `Each account is counted first, then only the remaining messages are sent.`
    )) {
      return
    }
    setFilling(true)
    try {
      const r = await Endpoints.startAiChats(ids, true)
      if (r.counts) {
        setDailyCounts((prev) => ({ ...prev, ...r.counts }))
        if (r.daily_limit) setDailyLimit(r.daily_limit)
      }
      const started = r.started?.length || 0
      const skipped = r.skipped?.length || 0
      if (started) toast.success(`Filling ${started} account${started === 1 ? '' : 's'} to 100`)
      if (skipped) toast.info(`${skipped} account${skipped === 1 ? ' is' : 's are'} already at 100 or running`)
      if (r.errors?.length) toast.error(`${r.errors.length} account${r.errors.length === 1 ? '' : 's'} could not start`)
      await refreshStatus()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setFilling(false)
    }
  }

  async function stopSelected() {
    if (selected.length === 0) {
      toast.error('Pick accounts to stop')
      return
    }
    setStopping(true)
    try {
      await Endpoints.stopAiChats(selected)
      await refreshStatus()
      toast.success('Stopped selected chats')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setStopping(false)
    }
  }

  async function stopAll() {
    setStopping(true)
    try {
      await Endpoints.stopAiChats([])
      await refreshStatus()
      toast.success('Stopped all chats')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setStopping(false)
    }
  }

  async function stopOne(accountId) {
    setStopping(true)
    try {
      await Endpoints.stopAiChats([accountId])
      await refreshStatus()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setStopping(false)
    }
  }

  const allChats = status?.accounts || []
  const chats = focusChatId ? allChats.filter((c) => c.account_id === focusChatId) : allChats
  const displayedChats = focusChatId || showAllChats ? chats : chats.slice(0, 12)
  const focusedChat = focusChatId ? allChats.find((c) => c.account_id === focusChatId) : null
  const chatIds = new Set(allChats.map((c) => c.account_id))
  const runningCount = status?.running || 0
  const activeCount = status?.active ?? runningCount
  const dailyValues = Object.values(dailyCounts).map((n) => Number(n) || 0)
  const dailyTotal = dailyValues.reduce((sum, n) => sum + n, 0)
  const dailyFull = dailyValues.filter((n) => n >= dailyLimit).length

  return (
    <div className="space-y-5">
      <div className="nb-card p-5">
        <div className="micro-label">Companion</div>
        <h1 className="display-title text-[30px] mt-2">Meow chat</h1>
        <p className="text-sm text-muted mt-2 max-w-[68ch] leading-6">
          Each selected account chats with Meow, a fat fluffy orange cat who is fully
          convinced he is royalty. Every account gets its own personality and its own
          cat conversation. The daily goal is 100 messages per account, reset at
          12:00 AM Bangladesh every day. The API key and model are stored only on this machine.
        </p>
        <p className="text-[11px] text-muted mt-3">
          Replies are paced like a real person: read, think, type, then a short random gap.
          The first message usually takes 10 to 30 seconds.
        </p>
      </div>

      {/* Gateway setup */}
      <div className="nb-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="micro-label">Setup</div>
            <h2 className="display-title text-[20px] mt-1">Vercel AI Gateway</h2>
          </div>
          <span className={'nb-badge ' + (settings?.has_key ? 'bg-brand-ok' : 'bg-brand-warn')}>
            {settings?.has_key ? 'Key saved' : 'No key yet'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div>
            <div className="micro-label mb-2">API key</div>
            {settings?.has_key && !editKey ? (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="nb-input !py-2 font-mono text-sm !bg-paper flex-1 min-w-[140px]">{settings.key_preview}</div>
                <button className="nb-btn shrink-0" onClick={() => setEditKey(true)}>Replace key</button>
                <button className="nb-btn shrink-0" onClick={clearKey}>Remove key</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type={showKey ? 'text' : 'password'}
                  className="nb-input !py-2 font-mono text-sm"
                  placeholder="Paste your AI Gateway API key"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  autoComplete="off"
                />
                <button className="nb-btn shrink-0" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
            )}
            <div className="text-[10px] text-muted mt-2">
              Sent only to ai-gateway.vercel.sh. Never exposed to the browser again after saving.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label>
              <div className="micro-label mb-2">Model</div>
              <input className="nb-input !py-2 font-mono text-[12px]" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label>
              <div className="micro-label mb-2">Meow bot</div>
              <input className="nb-input !py-2 font-mono text-[12px]" value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
            <label>
              <div className="micro-label mb-2">Min chats per account</div>
              <input type="number" min="1" max="500" className="nb-input !py-2 font-mono text-[12px]"
                value={minTurns} onChange={(e) => setMinTurns(e.target.value)} />
            </label>
            <label>
              <div className="micro-label mb-2">Max chats per account</div>
              <input type="number" min="1" max="500" className="nb-input !py-2 font-mono text-[12px]"
                value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="text-[10px] text-muted mt-3">
          Every selected account gets a random number of sent messages between the minimum and maximum.
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button className="nb-btn-pri" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving...' : (settings?.has_key ? 'Save settings' : 'Save API key')}
          </button>
          {settings?.has_key && editKey && (
            <button className="nb-btn" onClick={() => { setEditKey(false); setKeyInput('') }} disabled={saving}>
              Cancel
            </button>
          )}
          <span className="micro-label ml-auto">
            {model.includes('deepseek') ? 'DeepSeek V4 Flash' : model.includes('haiku') ? 'Claude Haiku 5.5' : model.split('/').pop()}
          </span>
        </div>
      </div>

      {/* Accounts and controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 nb-card p-5">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="micro-label">Run queue</div>
              <h2 className="display-title text-[20px] mt-1">Choose accounts</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="micro-label">{selected.length} selected</span>
              <button className="nb-btn !py-1 !px-3 !text-[11px]" onClick={toggleAll}>
                {allSelected ? 'Clear' : 'Select all connected'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button
              className="nb-btn-pri"
              onClick={fillDaily}
              disabled={filling || busy || stopping || connectedAccounts.length === 0 || !settings?.has_key}
            >
              {filling ? 'Filling…' : `Fill 100 (${selected.length || `all ${connectedAccounts.length}`})`}
            </button>
            <button className="nb-btn" onClick={checkDaily} disabled={checkingDaily || filling}>
              {checkingDaily ? 'Checking...' : 'Check today'}
            </button>
            <button className="nb-btn" onClick={runSelected} disabled={busy || filling || stopping || selected.length === 0 || !settings?.has_key}>
              {busy ? 'Starting...' : `Run selected (${selected.length})`}
            </button>
            <button className="nb-btn-err" onClick={stopSelected} disabled={stopping || selected.length === 0}>
              Stop selected
            </button>
            <button className="nb-btn" onClick={stopAll} disabled={stopping || runningCount === 0}>
              Stop all
            </button>
          </div>
          <div className="text-[10px] text-muted mt-2">
            Fill 100 counts each account's outgoing messages to the bot today, then sends only the rest.
            With no selection it fills all connected accounts. Counts reset every day at 12:00 AM Bangladesh.
            Check today also checks all connected accounts when nothing is selected.
          </div>
          {!settings?.has_key && (
            <div className="nb-note nb-note-warn px-3 py-2 text-[11px] mt-3">
              Add your AI Gateway API key above before running.
            </div>
          )}

          <input
            className="nb-input mt-4"
            placeholder="Search name, username or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-[300px] overflow-auto mt-3 pr-1">
            {visibleAccounts.map((a) => {
              const isSelected = selected.includes(a.id)
              const disabled = a.status !== 'connected'
              return (
                <label key={a.id} className={
                  'flex items-center gap-2 px-2 py-1.5 rounded-full text-[12px] transition-colors ' +
                  (disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer ') +
                  (isSelected ? 'bg-brand-pri/30 text-ink' : 'text-muted hover:bg-[rgb(var(--ink)/0.04)] hover:text-ink')
                }>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={isSelected}
                    onChange={() => toggle(a.id)}
                  />
                  <span
                    className="truncate"
                    title={chatIds.has(a.id) ? 'Open live chat' : 'Select account'}
                    onClick={(e) => {
                      if (chatIds.has(a.id)) {
                        e.preventDefault()
                        e.stopPropagation()
                        focusChat(a.id)
                      }
                    }}
                  >
                    {((a.first_name || '') + ' ' + (a.last_name || '')).trim() || a.phone}
                  </span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {dailyCounts[a.id] !== undefined && (
                      <span
                        className="font-mono text-[9px] text-muted"
                        title={`${dailyCounts[a.id]} of ${dailyLimit} sent today`}
                      >
                        {dailyCounts[a.id]}/{dailyLimit}
                      </span>
                    )}
                    <span className="font-mono text-[9px] text-muted">{a.status}</span>
                    {chatIds.has(a.id) && (
                      <button
                        type="button"
                        className="font-mono text-[9px] underline underline-offset-2 text-muted hover:text-ink"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); focusChat(a.id) }}
                      >
                        Chat
                      </button>
                    )}
                  </span>
                </label>
              )
            })}
            {visibleAccounts.length === 0 && (
              <div className="text-sm text-muted py-4">No accounts match this search.</div>
            )}
          </div>

        </div>

        <div className="nb-card p-5">
          <div className="micro-label">Status</div>
          <h2 className="display-title text-[20px] mt-1">Cat chats</h2>
          <div className="flex items-baseline gap-2 mt-4">
            <span className="display-title text-[38px] tabular-nums">{activeCount}</span>
            <span className="text-xs text-muted">active</span>
          </div>
          <div className="h-px bg-[color:var(--hairline)] my-4" />
          <div className="space-y-2 text-[12px] text-muted">
            <div className="flex justify-between gap-2"><span>Connected accounts</span><span className="font-mono text-ink">{connectedAccounts.length}</span></div>
            <div className="flex justify-between gap-2"><span>Cat chats</span><span className="font-mono text-ink">{allChats.length}</span></div>
            <div className="flex justify-between gap-2"><span>Chats per account</span><span className="font-mono text-ink">{settings?.min_turns ?? 4} to {settings?.max_turns ?? 10}</span></div>
            <div className="flex justify-between gap-2"><span>Model</span><span className="font-mono text-ink truncate max-w-[160px]">{settings?.model || DEFAULT_MODEL}</span></div>
            <div className="flex justify-between gap-2"><span>Checked today</span><span className="font-mono text-ink">{dailyValues.length} accounts</span></div>
            <div className="flex justify-between gap-2"><span>Messages today</span><span className="font-mono text-ink">{dailyTotal}</span></div>
            <div className="flex justify-between gap-2"><span>At daily limit</span><span className="font-mono text-ink">{dailyFull} accounts</span></div>
            <div className="flex justify-between gap-2"><span>Daily reset</span><span className="font-mono text-ink">12:00 AM Bangladesh</span></div>
          </div>
          <div className="text-[10px] text-muted mt-4 leading-5">
            Each account has its own style and its own history. Stopping one account does not affect the others. Chats use your AI Gateway credits while running.
          </div>
        </div>
      </div>

      {/* Live conversations */}
      <div id="ai-chats" className="scroll-mt-4">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="micro-label">Live</div>
            <h2 className="display-title text-[22px] mt-1">Meow conversations</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {focusedChat && (
              <>
                <span className="micro-label">Showing {focusedChat.name}</span>
                <button className="nb-btn !py-1 !px-3 !text-[11px]" onClick={() => { setFocusChatId(null); setShowAllChats(true) }}>
                  Show all
                </button>
              </>
            )}
            {!focusChatId && chats.length > 12 && (
              <button className="nb-btn !py-1 !px-3 !text-[11px]" onClick={() => setShowAllChats((v) => !v)}>
                {showAllChats ? 'Show latest 12' : `Show all ${chats.length}`}
              </button>
            )}
            <div className="text-[11px] text-muted">Updates every few seconds while chats are running</div>
          </div>
        </div>

        {chats.length === 0 ? (
          <div className="nb-card">
            <div className="empty-state">
              <span className="empty-icon"><span className="text-lg">...</span></span>
              <div className="empty-title">No cat chats yet</div>
              <div className="text-sm max-w-[40ch]">Pick a few accounts above and run them. Meow chats will appear here.</div>
            </div>
          </div>
        ) : (
          <div className={'grid gap-4 ' + (focusChatId ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2')}>
            {displayedChats.map((c) => (
              <ChatCard
                key={c.account_id}
                chat={c}
                target={settings?.target}
                focused={c.account_id === focusChatId}
                onStop={stopOne}
                stopping={stopping}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
