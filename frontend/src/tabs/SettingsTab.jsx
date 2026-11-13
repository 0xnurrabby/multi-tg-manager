import { useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import { DEFAULT_TIME_ZONE, browserTimeZone, getTimeZoneChoice, setTimeZoneChoice } from '../lib/util'

export default function SettingsTab() {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [exportingSessions, setExportingSessions] = useState(false)
  const [timeZone, setTimeZone] = useState(getTimeZoneChoice())
  const [aiKey, setAiKey] = useState(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [editingKey, setEditingKey] = useState(false)
  const [savingKey, setSavingKey] = useState(false)

  useEffect(() => {
    Endpoints.getSettings().then(setS).catch((e) => toast.error(e.message))
    Endpoints.aiKey()
      .then((k) => {
        setAiKey(k)
        setAiModel(k?.model || '')
        setEditingKey(!k?.has_key)
      })
      .catch((e) => toast.error(e.message))
  }, [])

  if (!s) return <div className="opacity-60">Loading settings…</div>

  async function save() {
    setBusy(true)
    try {
      const r = await Endpoints.putSettings(s)
      setS(r)
      toast.success('Settings saved')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function exportJson() {
    try {
      const data = await Endpoints.exportJson()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `accounts-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(e.message) }
  }

  async function saveApiKey() {
    const key = apiKeyInput.trim()
    if (!key) {
      toast.error('Paste an API key first')
      return
    }
    setSavingKey(true)
    try {
      const r = await Endpoints.saveAiKey({ api_key: key, model: aiModel.trim() })
      setAiKey(r)
      setAiModel(r?.model || '')
      setApiKeyInput('')
      setEditingKey(false)
      toast.success(`Saved ${r?.provider_label || 'AI provider'} key`)
      if (r?.warning) toast.info(r.warning)
    } catch (e) { toast.error(e.message) }
    finally { setSavingKey(false) }
  }

  async function removeApiKey() {
    if (!confirm('Remove the saved AI API key?')) return
    try {
      const r = await Endpoints.clearAiKey()
      setAiKey(r)
      setEditingKey(true)
      setApiKeyInput('')
      toast.success('AI API key removed')
    } catch (e) { toast.error(e.message) }
  }

  async function exportSessions() {
    setExportingSessions(true)
    try {
      const blob = await Endpoints.exportSessions()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `telegram-sessions-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Session ZIP downloaded')
    } catch (e) { toast.error(e.message) }
    finally { setExportingSessions(false) }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="nb-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="micro-label">AI provider</div>
            <h3 className="display-title text-[20px] mt-1">API key</h3>
          </div>
          {aiKey?.has_key && (
            <span className="nb-badge bg-brand-ok">{aiKey.provider_label || 'AI provider'}</span>
          )}
        </div>
        <p className="text-sm text-muted mt-2 mb-4">
          Paste a Vercel AI Gateway or OpenRouter key. The provider is detected automatically.
          This key powers Bulk AI profile changes.
        </p>

        {aiKey?.has_key && !editingKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="nb-input !py-2 font-mono text-sm !bg-paper flex-1 min-w-[140px]">{aiKey.key_preview}</div>
              <button className="nb-btn" onClick={() => setEditingKey(true)}>Replace key</button>
              <button className="nb-btn" onClick={removeApiKey}>Remove key</button>
            </div>
            <div>
              <div className="micro-label mb-2">Model</div>
              <input className="nb-input font-mono !py-2 text-[12px]" value={aiModel} onChange={(e) => setAiModel(e.target.value)} />
              <div className="text-[10px] text-muted mt-1">{aiKey.provider_label} ? {aiKey.model}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type={showApiKey ? 'text' : 'password'}
                className="nb-input !py-2 font-mono text-sm flex-1"
                placeholder="Paste Vercel AI Gateway or OpenRouter API key"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                autoComplete="off"
              />
              <button className="nb-btn shrink-0" onClick={() => setShowApiKey((v) => !v)}>
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div>
              <div className="micro-label mb-2">Model</div>
              <input className="nb-input font-mono !py-2 text-[12px]" value={aiModel} onChange={(e) => setAiModel(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="nb-btn-pri" onClick={saveApiKey} disabled={savingKey || !apiKeyInput.trim()}>
                {savingKey ? 'Checking key...' : 'Save API key'}
              </button>
              {aiKey?.has_key && (
                <button className="nb-btn" onClick={() => { setEditingKey(false); setApiKeyInput('') }} disabled={savingKey}>
                  Cancel
                </button>
              )}
              <span className="text-[10px] text-muted">Auto-detects Vercel or OpenRouter.</span>
            </div>
          </div>
        )}
      </div>

      <div className="nb-card p-5">
        <div className="micro-label">Pacing</div>
        <h3 className="display-title text-[20px] mt-1 mb-2">Rate limit window</h3>
        <p className="text-sm text-muted mb-4">
          Delay between each account in every bulk task (join, leave, send, react, view). Tasks run
          one account at a time and wait a random amount in this window before the next. Lower =
          faster, but too low can get accounts flagged. Default 1–2s.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label>
            <div className="micro-label mb-2">Min seconds between actions</div>
            <input type="number" step="0.1" className="nb-input" value={s.rate_min}
              onChange={(e) => setS({ ...s, rate_min: Number(e.target.value) || 0 })} />
          </label>
          <label>
            <div className="micro-label mb-2">Max seconds</div>
            <input type="number" step="0.1" className="nb-input" value={s.rate_max}
              onChange={(e) => setS({ ...s, rate_max: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <label className="block mt-3">
          <div className="micro-label mb-2">Parallel accounts, batch size</div>
          <input type="number" step="1" min="1" max="50" className="nb-input"
            value={s.concurrency ?? 5}
            onChange={(e) => setS({ ...s, concurrency: Math.max(1, parseInt(e.target.value) || 1) })} />
          <p className="text-xs text-muted mt-2">
            How many accounts a bulk task runs at once. Higher = faster. Telegram limits are
            per-account, so running different accounts in parallel is safe. Default 5.
          </p>
        </label>
      </div>

      <div className="nb-card p-5">
        <div className="micro-label">Storage</div>
        <h3 className="display-title text-[20px] mt-1 mb-4">Session files</h3>
        <label className="block">
          <div className="micro-label mb-2">Sessions folder path</div>
          <input className="nb-input" value={s.sessions_dir}
            onChange={(e) => setS({ ...s, sessions_dir: e.target.value })} />
          <p className="text-xs text-muted mt-2">Change takes effect on the next backend restart.</p>
        </label>
        <div
          className="mt-4 rounded-2xl border border-[color:var(--hairline)] p-3"
          style={{ background: 'linear-gradient(120deg, rgb(var(--accent-peach) / 0.5), rgb(var(--accent-rose) / 0.28))' }}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="micro-label">Session export</div>
              <div className="text-sm font-semibold mt-0.5">Download all sessions (.zip)</div>
              <div className="text-[11px] text-muted mt-1 max-w-[52ch] leading-5">
                Full account-access snapshot. Keep the ZIP private. This does not log out or delete anything.
                Import into a Telethon/MTProto-compatible client, not the official Telegram app.
              </div>
            </div>
            <button className="nb-btn-pri shrink-0" disabled={exportingSessions} onClick={exportSessions}>
              {exportingSessions ? 'Building ZIP...' : 'Export sessions'}
            </button>
          </div>
        </div>
      </div>

      <div className="nb-card p-5">
        <div className="micro-label">Display</div>
        <h3 className="display-title text-[20px] mt-1 mb-2">Time zone</h3>
        <p className="text-sm text-muted mb-4">
          Default is Bangladesh (Asia/Dhaka). Choose Auto to use this browser's time zone,
          or pick the country where you are using TG Manager.
        </p>
        <select
          className="nb-input"
          value={timeZone}
          onChange={(e) => {
            const value = e.target.value
            setTimeZone(value)
            setTimeZoneChoice(value)
            toast.success(value === 'auto' ? `Using browser time: ${browserTimeZone()}` : `Time zone: ${value}`)
            setTimeout(() => window.location.reload(), 350)
          }}
        >
          <option value="auto">Auto ? {browserTimeZone()}</option>
          <option value={DEFAULT_TIME_ZONE}>Bangladesh ? Asia/Dhaka</option>
          {(() => {
            let zones = []
            try { zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [] } catch {}
            if (!zones.length) zones = ['Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC']
            return zones
              .filter((z) => z !== DEFAULT_TIME_ZONE && z !== 'UTC')
              .map((z) => <option key={z} value={z}>{z}</option>)
          })()}
        </select>
        <p className="text-xs text-muted mt-2">All message timestamps and ETA times use this time zone.</p>
      </div>

      <div className="nb-card p-5">
        <div className="micro-label">Preferences</div>
        <h3 className="display-title text-[20px] mt-1 mb-4">Behaviour</h3>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={s.auto_reconnect}
            onChange={(e) => setS({ ...s, auto_reconnect: e.target.checked })} />
          <span>Auto-reconnect on disconnect</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.notification_sound}
            onChange={(e) => setS({ ...s, notification_sound: e.target.checked })} />
          <span>Play notification sound for new alerts</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button className="nb-btn-pri" disabled={busy} onClick={save}>Save settings</button>
        <button className="nb-btn" onClick={exportJson}>Export accounts JSON</button>
      </div>
    </div>
  )
}
