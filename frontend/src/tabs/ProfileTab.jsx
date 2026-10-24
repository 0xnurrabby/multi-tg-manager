import { useEffect, useState, useRef } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import { CopyButton } from '../lib/CopyButton'
import ChatPanel from '../components/ChatPanel'

function Section({ title, eyebrow, children }) {
  return (
    <section className="nb-card p-5 sm:p-6 mb-4">
      {eyebrow && <div className="micro-label">{eyebrow}</div>}
      <h3 className="display-title text-[20px] mt-1 mb-4">{title}</h3>
      {children}
    </section>
  )
}

export default function ProfileTab({ account, onRefresh, showChat = true }) {
  const toast = useToast()
  const [fn, setFn] = useState('')
  const [ln, setLn] = useState('')
  const [bio, setBio] = useState('')
  const [un, setUn] = useState('')
  const [unStatus, setUnStatus] = useState({ checking: false, ok: null, reason: '' })
  const [photoUrl, setPhotoUrl] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!account) return
    setFn(account.first_name || '')
    setLn(account.last_name || '')
    setBio(account.bio || '')
    setUn(account.username || '')
    setUnStatus({ checking: false, ok: null, reason: '' })
    Endpoints.photoUrl(account.id).then((r) => setPhotoUrl(r?.data_url || null)).catch(() => setPhotoUrl(null))
  }, [account?.id])

  if (!account) {
    return (
      <div className="empty-state">
        <span className="empty-icon">◎</span>
        <div className="empty-title">No account selected</div>
        <div className="text-sm max-w-[32ch]">Choose an account from the sidebar to edit its profile.</div>
      </div>
    )
  }

  async function saveProfileField(field, value) {
    try {
      await Endpoints.updateProfile(account.id, { [field]: value })
      toast.success(`${field} saved`)
      onRefresh?.()
    } catch (e) { toast.error(e.message) }
  }

  async function checkUsername() {
    if (!un || un === account.username) return
    setUnStatus({ checking: true, ok: null, reason: '' })
    try {
      const r = await Endpoints.checkUsername(account.id, un)
      setUnStatus({ checking: false, ok: r.available, reason: r.reason })
    } catch (e) { setUnStatus({ checking: false, ok: false, reason: e.message }) }
  }

  async function saveUsername() {
    try {
      await Endpoints.updateUsername(account.id, un)
      toast.success('Username saved')
      onRefresh?.()
    } catch (e) { toast.error(e.message) }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await Endpoints.uploadPhoto(account.id, file)
      toast.success('Photo updated')
      const r = await Endpoints.photoUrl(account.id)
      setPhotoUrl(r?.data_url || null)
    } catch (err) { toast.error(err.message) }
  }

  return (
    <div className="flex flex-col xl:flex-row gap-4 items-start">
      <div className="flex-1 max-w-3xl min-w-0 w-full">
      <Section eyebrow="Selected account" title={`${account.first_name || ''} ${account.last_name || ''}`.trim() || account.phone}>
        <div className="flex items-center gap-4 mb-3">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="w-20 h-20 border border-[color:var(--hairline)] object-cover" />
          ) : (
            <div className="w-20 h-20 border border-[color:var(--hairline)] flex items-center justify-center font-semibold text-muted">N/A</div>
          )}
          <div>
            <input ref={fileRef} type="file" accept="image/*" onChange={uploadPhoto} className="hidden" />
            <button className="nb-btn" onClick={() => fileRef.current?.click()}>Upload photo</button>
          </div>
          <div className="ml-auto text-sm flex items-center gap-2 font-mono">
            {account.phone}<CopyButton value={account.phone} />
          </div>
        </div>
      </Section>

      <Section title="Name">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="micro-label block mb-2">First name</label>
            <input className="nb-input" value={fn} onChange={(e) => setFn(e.target.value)} />
            <button className="nb-btn-pri mt-2" onClick={() => saveProfileField('first_name', fn)}>Save first name</button>
          </div>
          <div>
            <label className="micro-label block mb-2">Last name</label>
            <input className="nb-input" value={ln} onChange={(e) => setLn(e.target.value)} />
            <button className="nb-btn-pri mt-2" onClick={() => saveProfileField('last_name', ln)}>Save last name</button>
          </div>
        </div>
      </Section>

      <Section title="Username">
        <div className="flex items-center gap-2">
          <span className="font-mono">@</span>
          <input className="nb-input" value={un} onChange={(e) => { setUn(e.target.value); setUnStatus({ checking: false, ok: null, reason: '' }) }} />
          <button className="nb-btn" onClick={checkUsername} disabled={!un || unStatus.checking}>
            {unStatus.checking ? 'Checking…' : 'Check'}
          </button>
          <button className="nb-btn-pri" onClick={saveUsername} disabled={unStatus.ok === false}>Save username</button>
        </div>
        {unStatus.ok === true && <div className="text-sm mt-2 text-brand-ok font-medium">Available</div>}
        {unStatus.ok === false && <div className="text-sm mt-2 text-brand-err font-medium">Unavailable: {unStatus.reason}</div>}
      </Section>

      <Section title="Bio (max 70 chars)">
        <textarea
          className="nb-input min-h-[80px]"
          maxLength={70}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs opacity-60">{bio.length}/70</span>
          <button className="nb-btn-pri" onClick={() => saveProfileField('bio', bio)}>Save bio</button>
        </div>
      </Section>
      </div>
      {showChat && (
        <ChatPanel account={account} className="w-full xl:flex-1 xl:max-w-xl min-w-0 xl:sticky xl:top-4" />
      )}
    </div>
  )
}
