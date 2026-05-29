import { useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

export default function SettingsTab() {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Endpoints.getSettings().then(setS).catch((e) => toast.error(e.message))
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

  return (
    <div className="max-w-2xl space-y-4">
      <div className="nb-card p-5">
        <h3 className="font-extrabold uppercase mb-4">Rate Limit Window</h3>
        <p className="text-xs opacity-70 mb-3">
          Delay between each account in every bulk task (join, leave, send, react, view). Tasks run
          one account at a time and wait a random amount in this window before the next. Lower =
          faster, but too low can get accounts flagged. Default 1–2s.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <div className="text-xs font-bold uppercase mb-1">Min seconds between actions</div>
            <input type="number" step="0.1" className="nb-input" value={s.rate_min}
              onChange={(e) => setS({ ...s, rate_min: Number(e.target.value) || 0 })} />
          </label>
          <label>
            <div className="text-xs font-bold uppercase mb-1">Max seconds</div>
            <input type="number" step="0.1" className="nb-input" value={s.rate_max}
              onChange={(e) => setS({ ...s, rate_max: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <label className="block mt-3">
          <div className="text-xs font-bold uppercase mb-1">Parallel accounts (batch size)</div>
          <input type="number" step="1" min="1" max="50" className="nb-input"
            value={s.concurrency ?? 5}
            onChange={(e) => setS({ ...s, concurrency: Math.max(1, parseInt(e.target.value) || 1) })} />
          <p className="text-xs opacity-70 mt-1">
            How many accounts a bulk task runs at once. Higher = faster. Telegram limits are
            per-account, so running different accounts in parallel is safe. Default 5.
          </p>
        </label>
      </div>

      <div className="nb-card p-5">
        <h3 className="font-extrabold uppercase mb-4">Session Files</h3>
        <label className="block">
          <div className="text-xs font-bold uppercase mb-1">Sessions folder path</div>
          <input className="nb-input" value={s.sessions_dir}
            onChange={(e) => setS({ ...s, sessions_dir: e.target.value })} />
          <p className="text-xs opacity-70 mt-1">Change takes effect on next backend restart.</p>
        </label>
      </div>

      <div className="nb-card p-5">
        <h3 className="font-extrabold uppercase mb-4">Behavior</h3>
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
        <button className="nb-btn-pri" disabled={busy} onClick={save}>Save Settings</button>
        <button className="nb-btn" onClick={exportJson}>Export Accounts JSON</button>
      </div>
    </div>
  )
}
