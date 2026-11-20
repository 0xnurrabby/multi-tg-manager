import { useCallback, useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

// Configure the NurMail-compatible provider used to create mailboxes and read
// verification codes. The key is stored server-side only; the UI never receives it.
export default function NurMailProviderCard({ className = '' }) {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const c = await Endpoints.nurmailConfig()
      setCfg(c)
      setBaseUrl(c?.base_url || '')
    } catch (e) {
      toast.error(e.message)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  async function save() {
    setBusy(true)
    try {
      const payload = { base_url: baseUrl.trim() }
      if (apiKey.trim()) payload.api_key = apiKey.trim()
      const c = await Endpoints.saveNurmail(payload)
      setCfg(c)
      setApiKey('')
      toast.success('Provider saved')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    try {
      const r = await Endpoints.testNurmail()
      toast.success(`Connected: ${r.name || 'provider'} · ${r.domain || ''} · ${r.mailboxes} mailboxes`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Remove the saved NurMail API key? Auto recovery will stop working until a key is added again.')) return
    setBusy(true)
    try {
      const c = await Endpoints.saveNurmail({ clear: true })
      setCfg(c)
      toast.success('API key removed')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className || 'nb-card p-5 mb-4'}>
      <div className="flex items-start sm:items-center gap-3 flex-col sm:flex-row">
        <div className="flex-1">
          <div className="micro-label">Mail provider</div>
          <div className="display-title text-[20px] mt-1">NurMail API</div>
          <div className="text-sm text-muted mt-1">
            Used to create mailboxes and read verification codes (OTP). Works with any
            NurMail-compatible server — set your own base URL if you cloned it.
          </div>
        </div>
        <span className={'nb-badge ' + (cfg?.key_set ? 'bg-brand-ok' : 'bg-brand-warn')}>
          {cfg?.key_set ? `Key ${cfg.key_hint}` : 'No key'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <label className="text-xs">
          <div className="micro-label mb-2">Base URL</div>
          <input
            className="nb-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://nurmail.fun/api/v1"
          />
        </label>
        <label className="text-xs">
          <div className="micro-label mb-2">{cfg?.key_set ? 'Replace API key' : 'API key'}</div>
          <input
            className="nb-input"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={cfg?.key_set ? 'leave blank to keep the saved key' : 'nm_…'}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button className="nb-btn-pri !py-1 !px-3 text-xs" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save provider'}
        </button>
        <button className="nb-btn !py-1 !px-3 text-xs" disabled={busy || !cfg?.key_set} onClick={test}>
          Test connection
        </button>
        <button className="nb-btn-err !py-1 !px-3 text-xs" disabled={busy || !cfg?.key_set} onClick={remove}>
          Remove key
        </button>
        <span className="text-[10px] text-muted">
          The key stays in the backend and is never sent to the browser.
        </span>
      </div>
    </div>
  )
}
