import { useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

export default function AddAccountModal({ onClose, onAdded }) {
  const toast = useToast()
  const [step, setStep] = useState(1) // 1: phone, 2: code, 3: 2fa
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  async function close() {
    if (phone) { try { await Endpoints.authCancel(phone) } catch {} }
    onClose?.()
  }

  async function sendCode() {
    if (!phone.startsWith('+')) {
      toast.error('Enter phone with country code, e.g. +8801712345678')
      return
    }
    setBusy(true); setHint('Sending code via Telegram... up to 30 seconds')
    try {
      await Endpoints.sendCode(phone)
      toast.info('Code sent. Check Telegram.')
      setHint('')
      setStep(2)
    } catch (e) { toast.error(e.message); setHint('') } finally { setBusy(false) }
  }

  async function submitCode() {
    if (!code) return
    setBusy(true); setHint('Verifying code...')
    try {
      const r = await Endpoints.signIn(phone, code)
      if (r?.needs_2fa) {
        toast.info('2FA password required')
        setHint('')
        setStep(3)
      } else {
        toast.success('Account added!')
        onAdded?.()
      }
    } catch (e) {
      toast.error(e.message)
      // Code already consumed by Telegram; go back to phone step so user can re-send
      if (/code|invalid|expired/i.test(e.message)) {
        setStep(1)
      }
    } finally { setBusy(false); setHint('') }
  }

  async function submit2fa() {
    if (!pwd) return
    setBusy(true); setHint('Submitting 2FA password...')
    try {
      await Endpoints.signIn2fa(phone, pwd)
      toast.success('Account added with 2FA!')
      onAdded?.()
    } catch (e) {
      toast.error(e.message)
      setPwd('')
    } finally { setBusy(false); setHint('') }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={close}>
      <div className="nb-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold uppercase tracking-tight text-xl">
            Add Account {step === 3 && <span className="nb-badge bg-brand-violet text-black ml-2">2FA</span>}
          </h2>
          <button className="nb-btn !py-1 !px-2" onClick={close}>✕</button>
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <label className="block">
              <div className="text-xs font-bold uppercase mb-1">Phone (with country code)</div>
              <input
                className="nb-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+8801712345678"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') sendCode() }}
              />
            </label>
            <button className="nb-btn-pri w-full" disabled={busy} onClick={sendCode}>
              {busy ? 'Sending…' : 'Send Code'}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="text-sm">OTP sent to <span className="font-mono">{phone}</span></div>
            <input
              className="nb-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Login code"
              autoFocus
              inputMode="numeric"
              onKeyDown={(e) => { if (e.key === 'Enter') submitCode() }}
            />
            <button className="nb-btn-pri w-full" disabled={busy || !code} onClick={submitCode}>
              {busy ? 'Verifying…' : 'Verify Code'}
            </button>
            <button className="nb-btn w-full" disabled={busy} onClick={() => setStep(1)}>
              Back / Resend
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="nb-card-sm p-3 bg-brand-violet text-black text-sm font-bold">
              2FA enabled. Enter your Two-Step password for <span className="font-mono">{phone}</span>
            </div>
            <input
              type="password"
              className="nb-input"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="Telegram 2FA password"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') submit2fa() }}
            />
            <button className="nb-btn-pri w-full" disabled={busy || !pwd} onClick={submit2fa}>
              {busy ? 'Submitting…' : 'Submit 2FA'}
            </button>
            <div className="text-[10px] opacity-60">
              Wrong password? You can retry without re-sending the code.
            </div>
          </div>
        )}

        {hint && <div className="mt-3 text-xs opacity-70 italic">{hint}</div>}
      </div>
    </div>
  )
}
