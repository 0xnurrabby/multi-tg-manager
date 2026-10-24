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
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <main className="flex-1 w-full max-w-[1120px] mx-auto px-5 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-[1.15fr_0.85fr] items-center gap-14 lg:gap-20">
        <section className="rise">
          <div className="micro-label">Private workspace</div>
          <h1
            className="display-title mt-5 max-w-[11ch]"
            style={{ fontSize: 'clamp(44px, 7vw, 88px)', lineHeight: 0.98 }}
          >
            A calmer way to run <span className="serif-accent">many</span> Telegram accounts.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[16px] leading-7 text-muted">
            Profiles, security messages, groups and bulk changes — one quiet
            dashboard for all of your accounts.
          </p>
          <div className="mt-10 h-px w-24 bg-[color:var(--hairline)]" />
          <p className="micro-label mt-6 normal-case tracking-[0.08em]">
            Runs locally. Nothing leaves your machine.
          </p>
        </section>

        <form className="nb-card p-6 sm:p-8 w-full max-w-sm justify-self-start lg:justify-self-end rise" onSubmit={submit}>
          <div className="micro-label">Restricted access</div>
          <h2 className="display-title text-[26px] mt-3">Unlock the dashboard.</h2>
          <p className="text-sm text-muted mt-2">Enter your app password to continue.</p>

          <label className="block mt-6">
            <div className="micro-label mb-2">Password</div>
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
            <div className="nb-note nb-note-err mt-4 px-3 py-2 text-sm">{err}</div>
          )}

          <button className="nb-btn-pri w-full mt-5" disabled={busy || !pw} type="submit">
            {busy ? 'Checking…' : 'Unlock'}
          </button>

          <p className="micro-label mt-5 normal-case tracking-[0.06em] leading-5">
            5 wrong attempts will lock this IP for 15 minutes.
          </p>
        </form>
      </main>
    </div>
  )
}
