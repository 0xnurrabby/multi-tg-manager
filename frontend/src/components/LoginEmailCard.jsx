import { useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

// Shared, plain-language error mapping for every login-email action.
export function emailErrorMessage(e) {
  const msg = String(e?.message || '')
  if (msg.includes('EMAIL_NOT_SETUP') || msg.includes('EMAIL_INSTALL_MISSING')) {
    return 'This account has no login email yet, and Telegram does not allow adding the first one through this app. Only accounts that already have a login email can be changed here.'
  }
  if (msg.includes('EMAIL_NOT_ALLOWED')) {
    return 'Telegram rejected this email. It may already be linked to another Telegram account, or this address is not allowed. Try a different one.'
  }
  if (msg.includes('CODE_INVALID')) {
    return 'That code is incorrect. Use the code sent to the new email, not the Telegram login code.'
  }
  if (msg.includes('EMAIL_VERIFY_EXPIRED')) {
    return 'The email verification code expired. Send a new code.'
  }
  if (msg.includes('EMAIL_INVALID')) {
    return 'Telegram rejected this email address as invalid.'
  }
  if (msg.includes('Rate limited')) {
    return msg
  }
  return msg || 'Something went wrong. Try again.'
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function LoginEmailCard({ account, onChange, className = '' }) {
  const toast = useToast()
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentPattern, setSentPattern] = useState('')
  const [codeLength, setCodeLength] = useState(0)
  const [busy, setBusy] = useState(false)

  const connected = account?.status === 'connected'
  const known = !!account?.email_checked_at
  const current = (account?.login_email_pattern || '').trim()
  const hasEmail = !!current

  useEffect(() => {
    setOpen(false)
    setStep('email')
    setEmail('')
    setCode('')
    setSentPattern('')
    setCodeLength(0)
  }, [account?.id])

  // Ask Telegram once per account so a stale "Not set" never sticks around.
  useEffect(() => {
    if (!account?.id || account.status !== 'connected' || account.email_checked_at) return
    let alive = true
    setChecking(true)
    Endpoints.emailCheck(account.id)
      .then(() => { if (alive) onChange?.() })
      .catch(() => {})
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [account?.id, account?.status, account?.email_checked_at])

  async function check() {
    if (!account) return
    setChecking(true)
    try {
      await Endpoints.emailCheck(account.id)
      await onChange?.()
    } catch (e) {
      toast.error(emailErrorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  async function sendCode() {
    const value = email.trim()
    if (!EMAIL_RE.test(value)) {
      toast.error('Enter a valid email address')
      return
    }
    setBusy(true)
    try {
      const r = await Endpoints.emailSendCode(account.id, value)
      setSentPattern(r.email_pattern || value)
      setCodeLength(r.length || 0)
      setCode('')
      setStep('code')
      toast.success('Verification code sent to the new email')
    } catch (e) {
      toast.error(emailErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    const value = code.trim()
    if (!value) {
      toast.error('Enter the code from the new email')
      return
    }
    setBusy(true)
    try {
      const r = await Endpoints.emailVerify(account.id, email.trim(), value)
      toast.success(`Login email changed to ${r.email || email.trim()}`)
      setOpen(false)
      setStep('email')
      setEmail('')
      setCode('')
      setSentPattern('')
      setCodeLength(0)
      await onChange?.()
    } catch (e) {
      toast.error(emailErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="micro-label">Login email</div>
          <div className="font-mono text-sm mt-1 break-all">
            {known ? (hasEmail ? current : 'Not set') : (checking ? 'Checking…' : 'Not checked')}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="nb-btn !py-1 !px-3 text-xs"
            onClick={check}
            disabled={checking || !connected}
          >
            {checking ? '…' : 'Check'}
          </button>
          {hasEmail && (
            <button
              className="nb-btn-pri !py-1 !px-3 text-xs"
              onClick={() => { setOpen((v) => !v); setStep('email') }}
              disabled={!connected}
            >
              {open ? 'Cancel' : 'Change'}
            </button>
          )}
        </div>
      </div>

      {known && !hasEmail && (
        <div className="text-[11px] text-muted mt-2 leading-5">
          Telegram will not let an app add a first login email. It only asks for one
          during login, and this account has never had one — so only accounts with an
          existing login email can be changed here.
        </div>
      )}

      {!connected && (
        <div className="text-[11px] text-muted mt-2">Connect the account to change its login email.</div>
      )}

      {open && hasEmail && step === 'email' && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="nb-input flex-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendCode() } }}
              placeholder="new email address"
            />
            <button className="nb-btn-pri !px-4" disabled={busy} onClick={sendCode}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
          <div className="text-[10px] text-muted">
            Telegram sends a code to the new address. The current email keeps working
            until you verify the code.
          </div>
        </div>
      )}

      {open && hasEmail && step === 'code' && (
        <div className="mt-3 space-y-2">
          <div className="nb-note nb-note-info px-3 py-2 text-sm">
            Code sent to {sentPattern || email.trim()}
            {codeLength ? ` (${codeLength} digits)` : ''}. Use the code from the new
            email, not the Telegram login code.
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="nb-input flex-1"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); verifyCode() } }}
              placeholder="code from the new email"
            />
            <button className="nb-btn-pri !px-4" disabled={busy} onClick={verifyCode}>
              {busy ? 'Verifying…' : 'Verify and change'}
            </button>
            <button className="nb-btn !px-4" disabled={busy} onClick={() => setStep('email')}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
