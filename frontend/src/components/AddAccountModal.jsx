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

  async function sendCode() {
    if (!phone.startsWith('+')) {
      toast.error('Enter phone with country code, e.g. +8801712345678')
      return
    }
    setBusy(true)
    try {
      await Endpoints.sendCode(phone)
      toast.info('Code sent. Check Telegram.')
      setStep(2)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function signIn() {
    setBusy(true)
    try {
      await Endpoints.signIn(phone, code, pwd || null)
      toast.success('Account added!')
      onAdded?.()
    } catch (e) {
      if (e.status === 401) {
        toast.info('2FA password required')
        setStep(3)
      } else {
        toast.error(e.message)
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="nb-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold uppercase tracking-tight text-xl">Add Account</h2>
          <button className="nb-btn !py-1 !px-2" onClick={onClose}>✕</button>
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
              onKeyDown={(e) => { if (e.key === 'Enter') signIn() }}
            />
            <button className="nb-btn-pri w-full" disabled={busy || !code} onClick={signIn}>
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="text-sm">2FA password required for <span className="font-mono">{phone}</span></div>
            <input
              type="password"
              className="nb-input"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="2FA password"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') signIn() }}
            />
            <button className="nb-btn-pri w-full" disabled={busy || !pwd} onClick={signIn}>
              {busy ? 'Signing in…' : 'Submit'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
