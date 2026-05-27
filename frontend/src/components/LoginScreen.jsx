import { useState } from 'react'
import { Endpoints } from '../lib/api'

export default function LoginScreen({ onAuthed }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e?.preventDefault?.()
    if (!pw) return
    setBusy(true); setErr('')
    try {
      await Endpoints.login(pw)
      onAuthed?.()
    } catch (e) {
      setErr(e.message || 'Login failed')
      setPw('')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-100 dark:bg-zinc-950">
      <form className="nb-card p-6 w-full max-w-sm" onSubmit={submit}>
        <div className="mb-1 text-xs font-extrabold uppercase tracking-tight text-brand-pri inline-block bg-black px-2 py-0.5">
          Protected
        </div>
        <h1 className="font-extrabold uppercase tracking-tighter text-2xl mb-1">Multi TG Manager</h1>
        <p className="text-sm opacity-70 mb-4">Enter password to continue.</p>
        <label className="block">
          <div className="text-xs font-bold uppercase mb-1">Password</div>
          <input
            type="password"
            className="nb-input"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </label>
        {err && (
          <div className="mt-3 nb-card-sm bg-brand-err text-black px-3 py-2 text-sm font-bold">
            {err}
          </div>
        )}
        <button className="nb-btn-pri w-full mt-4" disabled={busy || !pw} type="submit">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <p className="text-[10px] opacity-50 mt-4 leading-snug">
          5 wrong attempts will lock this IP for 15 minutes.
        </p>
      </form>
    </div>
  )
}
