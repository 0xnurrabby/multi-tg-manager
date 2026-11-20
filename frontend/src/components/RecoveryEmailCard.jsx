import { useCallback, useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

// Add the 2FA recovery email to ONE account.
// Manual: type any address, then paste the code Telegram sends to it.
// Auto:   let the backend create a NurMail mailbox and read the code itself.
export default function RecoveryEmailCard({ account, onChange, className = '' }) {
  const toast = useToast()
  const [status, setStatus] = useState(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [needCode, setNeedCode] = useState(false)
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [noteOk, setNoteOk] = useState(false)

  const load = useCallback(async () => {
    if (!account?.id) return
    try {
      setStatus(await Endpoints.recoveryStatus(account.id))
    } catch {
      setStatus(null)
    }
  }, [account?.id])

  useEffect(() => {
    setNeedCode(false)
    setCode('')
    setNote('')
    setNoteOk(false)
    setEmail('')
    load()
  }, [account?.id, load])

  async function start(payload, label) {
    if (!account) return
    setBusy(true)
    setNote('')
    try {
      const r = await Endpoints.setRecovery(account.id, payload)
      if (r?.need_code) {
        setNeedCode(true)
        setNote(r.message || `Code sent to ${r.email}`)
        setNoteOk(false)
        toast.info('Code sent — paste it below')
        await load()
        return
      }
      setNeedCode(false)
      setCode('')
      setNote(r?.message || label)
      setNoteOk(true)
      toast.success(r?.message || label)
      await load()
      onChange?.()
    } catch (e) {
      setNote(e.message)
      setNoteOk(false)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  function addManual() {
    const value = email.trim()
    if (!value) {
      toast.error('Enter the email address first')
      return
    }
    start({ email: value }, 'Recovery email set')
  }

  function addAutomatic() {
    start({ create_mailbox: true }, 'Recovery email set')
  }

  async function confirmCode() {
    if (!account) return
    const value = code.trim()
    if (!value) {
      toast.error('Enter the code from the mailbox')
      return
    }
    setBusy(true)
    try {
      await Endpoints.confirmRecovery(account.id, value)
      setNeedCode(false)
      setCode('')
      setNote('Recovery email confirmed')
      setNoteOk(true)
      toast.success('Recovery email confirmed')
      await load()
      onChange?.()
    } catch (e) {
      setNote(e.message)
      setNoteOk(false)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const current = status?.pending_email
    ? `${status.pending_email} · waiting for code`
    : status?.recovery_email
      ? status.recovery_email
      : status?.unconfirmed_email
        ? `${status.unconfirmed_email} · not confirmed`
        : status?.has_recovery
          ? 'Set (Telegram hides the address)'
          : 'Not set'

  return (
    <div className={className}>
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="micro-label">Recovery email · 2FA</div>
          <div className="text-sm mt-1 break-all">{current}</div>
        </div>
        {status?.recovery_email && <span className="nb-badge bg-brand-ok">ours</span>}
      </div>

      <div className="text-[11px] text-muted mt-2 leading-5">
        Used to recover the account when the 2FA password is lost. It is separate from
        the login email. Add your own address below and paste the code Telegram sends
        there — or let the provider create a mailbox and read the code for you.
      </div>

      {status && !status.password_known && (
        <div className="nb-note nb-note-warn px-3 py-2 text-[11px] mt-2">
          The 2FA password for this account is not saved, so it can&apos;t be changed
          from here. Run the bulk 2FA tool first.
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          className="nb-input flex-1"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual() } }}
          placeholder="your recovery email address"
        />
        <button className="nb-btn-pri !px-4" disabled={busy} onClick={addManual}>
          {busy ? 'Working…' : 'Add recovery email'}
        </button>
      </div>

      {account?.login_email_address && (
        <button
          className="nb-btn !py-1 !px-3 text-[11px] mt-2"
          disabled={busy}
          onClick={() => setEmail(account.login_email_address)}
        >
          Use login email ({account.login_email_address})
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button className="nb-btn !py-1 !px-3 text-[11px]" disabled={busy} onClick={addAutomatic}>
          Generate a NurMail mailbox instead
        </button>
        <span className="text-[10px] text-muted">
          Auto-created mailboxes expire after 7 days.
        </span>
      </div>

      {needCode && (
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <input
            className="nb-input flex-1 min-w-[160px]"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmCode() } }}
            placeholder="code from the mailbox"
          />
          <button className="nb-btn-pri !py-1 !px-3 text-xs" disabled={busy} onClick={confirmCode}>
            {busy ? 'Confirming…' : 'Confirm code'}
          </button>
        </div>
      )}

      {note && (
        <div className={'text-[11px] mt-2 leading-5 ' + (noteOk ? 'text-brand-ok' : 'text-muted')}>
          {note}
        </div>
      )}
    </div>
  )
}
