import { useState, useRef } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import ResultModal from '../components/ResultModal.jsx'

export default function BulkTab({ accounts, onDone }) {
  const toast = useToast()
  const [ids, setIds] = useState([])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [bio, setBio] = useState('')
  const [appendNumber, setAppendNumber] = useState(false)
  const [startNumber, setStartNumber] = useState(1)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const photoRef = useRef(null)

  const allChecked = ids.length === accounts.length && accounts.length > 0
  const toggleAll = () => setIds(allChecked ? [] : accounts.map((a) => a.id))
  const toggle = (id) => setIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  async function applyProfile() {
    if (ids.length === 0) { toast.error('Pick accounts'); return }
    if (!firstName && !lastName && bio === '') { toast.error('Set at least one field'); return }
    if (!confirm(`Apply profile changes to ${ids.length} accounts?`)) return
    setBusy(true)
    try {
      const r = await Endpoints.bulkProfile({
        account_ids: ids,
        first_name: firstName || null,
        last_name: lastName || null,
        bio: bio === '' ? null : bio,
        append_number: appendNumber,
        start_number: startNumber,
      })
      setResult({ title: 'Bulk Profile Result', ...r })
      onDone?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function applyPhoto() {
    const file = photoRef.current?.files?.[0]
    if (!file) { toast.error('Pick a photo'); return }
    if (ids.length === 0) { toast.error('Pick accounts'); return }
    if (!confirm(`Apply photo to ${ids.length} accounts?`)) return
    setBusy(true)
    try {
      const r = await Endpoints.bulkPhoto(ids, file)
      setResult({ title: 'Bulk Photo Result', ...r })
      onDone?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="nb-card p-4">
          <h3 className="font-extrabold uppercase mb-3">Bulk Profile Edit</h3>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <div className="text-xs font-bold uppercase mb-1">First Name</div>
              <input className="nb-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="leave blank to skip" />
            </label>
            <label>
              <div className="text-xs font-bold uppercase mb-1">Last Name</div>
              <input className="nb-input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="leave blank to skip" />
            </label>
            <label className="col-span-2">
              <div className="text-xs font-bold uppercase mb-1">Bio (max 70)</div>
              <textarea maxLength={70} className="nb-input" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="leave blank to skip" />
            </label>
          </div>
          <label className="flex items-center gap-2 mt-3">
            <input type="checkbox" checked={appendNumber} onChange={(e) => setAppendNumber(e.target.checked)} />
            <span className="text-sm">Append number to first/last name (e.g. "Family 1", "Family 2")</span>
            {appendNumber && (
              <input type="number" min={1} className="nb-input !w-20 !py-1" value={startNumber}
                onChange={(e) => setStartNumber(Number(e.target.value) || 1)} />
            )}
          </label>
          <button className="nb-btn-pri mt-3" disabled={busy} onClick={applyProfile}>
            Apply Profile to {ids.length}
          </button>
        </div>

        <div className="nb-card p-4">
          <h3 className="font-extrabold uppercase mb-3">Bulk Profile Photo</h3>
          <input ref={photoRef} type="file" accept="image/*" className="nb-input" />
          <button className="nb-btn-pri mt-3" disabled={busy} onClick={applyPhoto}>
            Apply Photo to {ids.length}
          </button>
        </div>
      </div>

      <div className="nb-card p-4 h-fit">
        <h3 className="font-extrabold uppercase mb-3">Pick Accounts</h3>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          <span className="font-bold text-sm">Select all ({accounts.length})</span>
        </label>
        <div className="space-y-1 max-h-[60vh] overflow-auto">
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 p-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <input type="checkbox" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="text-sm truncate flex-1">{(a.first_name + ' ' + a.last_name).trim() || a.phone}</span>
              <span className="text-xs opacity-60 font-mono">{a.status === 'connected' ? '●' : '○'}</span>
            </label>
          ))}
        </div>
      </div>

      {result && <ResultModal onClose={() => setResult(null)} {...result} />}
    </div>
  )
}
