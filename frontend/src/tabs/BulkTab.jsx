import { useState, useRef, useMemo } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import ProgressModal from '../components/ProgressModal.jsx'
import { useBulkProgress } from '../lib/useBulkProgress'

// Parse CSV/TXT: each line = "firstname,lastname,username,bio".
// username is col 3 (no separators inside it); bio is col 4+ (commas inside bio
// allowed by taking the rest). Any field may be blank to skip it.
function parseCsv(text) {
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // allow tab or comma separator
    const sep = line.includes('\t') ? '\t' : ','
    const parts = line.split(sep)
    const first = (parts[0] ?? '').trim()
    const last = (parts[1] ?? '').trim()
    const username = (parts[2] ?? '').trim().replace(/^@/, '')
    const bio = parts.slice(3).join(sep).trim()
    rows.push({ first_name: first, last_name: last, username, bio })
  }
  return rows
}

export default function BulkTab({ accounts, onDone }) {
  const toast = useToast()
  const { progress, run, close } = useBulkProgress()
  const [ids, setIds] = useState([])
  // simple mode (one value to all)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [appendNumber, setAppendNumber] = useState(false)
  const [startNumber, setStartNumber] = useState(1)
  // CSV mode
  const [csvRows, setCsvRows] = useState([])  // [{first_name, last_name, bio}, ...]
  const csvRef = useRef(null)
  // photos (accumulating)
  const [photos, setPhotos] = useState([])    // File[]
  const photoRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const allChecked = ids.length === accounts.length && accounts.length > 0
  const toggleAll = () => setIds(allChecked ? [] : accounts.map((a) => a.id))
  const toggle = (id) => setIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  // ----- CSV -----
  function loadCsv(e) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCsv(String(reader.result || ''))
      setCsvRows(rows)
      toast.info(`Loaded ${rows.length} CSV rows`)
    }
    reader.onerror = () => toast.error('Failed to read CSV file')
    reader.readAsText(file)
    if (csvRef.current) csvRef.current.value = ''
  }
  function clearCsv() { setCsvRows([]) }

  async function applyProfile() {
    if (ids.length === 0) { toast.error('Pick accounts'); return }
    const usingCsv = csvRows.length > 0
    if (!usingCsv && !firstName && !lastName && !username && bio === '') {
      toast.error('Set at least one field, or load a CSV')
      return
    }
    if (!usingCsv && username && !appendNumber && ids.length > 1) {
      toast.error('Username must be unique. Enable "Append number" or use CSV for multiple accounts.')
      return
    }
    if (!confirm(`Apply profile changes to ${ids.length} accounts?` + (usingCsv ? ` (CSV will map first ${Math.min(ids.length, csvRows.length)} rows)` : ''))) return
    let per_account = null
    if (usingCsv) {
      per_account = {}
      ids.forEach((aid, i) => {
        const row = csvRows[i]
        if (!row) return
        per_account[String(aid)] = {
          first_name: row.first_name || null,
          last_name:  row.last_name  || null,
          username:   row.username   || null,
          bio:        row.bio        || null,
        }
      })
    }
    const payload = {
      account_ids: ids,
      first_name: usingCsv ? null : (firstName || null),
      last_name:  usingCsv ? null : (lastName || null),
      username:   usingCsv ? null : (username || null),
      bio:        usingCsv ? null : (bio === '' ? null : bio),
      append_number: !usingCsv && appendNumber,
      start_number: startNumber,
      per_account,
    }
    setBusy(true)
    await run(`Bulk Profile (${ids.length} accounts)`, (onEvent) => Endpoints.bulkProfile(payload, onEvent))
    setBusy(false)
    onDone?.()
  }

  // ----- PHOTOS -----
  function addPhotos(e) {
    const list = Array.from(e.target.files || [])
    if (!list.length) return
    setPhotos((cur) => [...cur, ...list])
    if (photoRef.current) photoRef.current.value = ''  // allow re-picking same files
    toast.info(`Added ${list.length} photos (total ${photos.length + list.length})`)
  }
  function removePhoto(i) { setPhotos((cur) => cur.filter((_, j) => j !== i)) }
  function clearPhotos() { setPhotos([]) }

  const photoThumbs = useMemo(
    () => photos.map((f) => ({ name: f.name, size: f.size, url: URL.createObjectURL(f) })),
    [photos]
  )

  async function applyPhoto() {
    if (photos.length === 0) { toast.error('Pick at least one photo'); return }
    if (ids.length === 0) { toast.error('Pick accounts'); return }
    const usable = Math.min(photos.length, ids.length)
    const extra = photos.length > ids.length ? ` (${photos.length - ids.length} extra photos ignored)` : ''
    const missing = ids.length > photos.length ? ` (${ids.length - photos.length} accounts skipped, no photo)` : ''
    if (!confirm(`Apply ${usable} photo(s) to ${ids.length} accounts in order?${extra}${missing}`)) return
    setBusy(true)
    await run(`Bulk Photo (${usable} of ${ids.length})`, (onEvent) => Endpoints.bulkPhoto(ids, photos, onEvent))
    setBusy(false)
    onDone?.()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="nb-card p-4">
          <h3 className="font-extrabold uppercase mb-3">Bulk Profile Edit</h3>

          <div className="nb-card-sm p-3 mb-3 bg-zinc-50 dark:bg-zinc-800">
            <div className="text-xs font-bold uppercase mb-2">CSV / TXT import (optional)</div>
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={csvRef} type="file" accept=".csv,.txt" onChange={loadCsv}
                className="text-xs file:nb-btn file:!py-1 file:!px-2" />
              {csvRows.length > 0 && (
                <>
                  <span className="text-xs font-bold">{csvRows.length} rows loaded</span>
                  <button className="nb-btn !py-0.5 !px-2 text-xs" onClick={clearCsv}>Clear</button>
                </>
              )}
            </div>
            <div className="text-[10px] opacity-60 mt-1">
              Format: each line = <code>firstname,lastname,username,bio</code> (tab or comma). Row N applies to selected account N.
              Any field can be blank to skip it. <b>Username must be unique</b> per account (Telegram rule) — taken ones are reported per account.
              {csvRows.length > 0 && firstName === '' && lastName === '' && bio === '' ? '' : ' When CSV is loaded, the fields below are ignored.'}
            </div>
            {csvRows.length > 0 && (
              <div className="mt-2 max-h-32 overflow-auto text-xs font-mono opacity-80">
                {csvRows.slice(0, 5).map((r, i) => (
                  <div key={i}>{i + 1}. {r.first_name} | {r.last_name} | {r.username ? '@' + r.username : '—'} | {r.bio.slice(0, 40)}</div>
                ))}
                {csvRows.length > 5 && <div>... +{csvRows.length - 5} more</div>}
              </div>
            )}
          </div>

          <div className={'grid grid-cols-2 gap-3 ' + (csvRows.length > 0 ? 'opacity-50 pointer-events-none' : '')}>
            <label>
              <div className="text-xs font-bold uppercase mb-1">First Name (same for all)</div>
              <input className="nb-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="leave blank to skip" />
            </label>
            <label>
              <div className="text-xs font-bold uppercase mb-1">Last Name (same for all)</div>
              <input className="nb-input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="leave blank to skip" />
            </label>
            <label className="col-span-2">
              <div className="text-xs font-bold uppercase mb-1">Username (without @)</div>
              <input className="nb-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="leave blank to skip" />
              <div className="text-[10px] opacity-60 mt-1">
                Must be unique per account. Use "Append number" below to auto-generate (e.g., myuser1, myuser2), or use CSV for custom usernames.
              </div>
            </label>
            <label className="col-span-2">
              <div className="text-xs font-bold uppercase mb-1">Bio (max 70)</div>
              <textarea maxLength={70} className="nb-input" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="leave blank to skip" />
            </label>
          </div>
          <label className={'flex items-center gap-2 mt-3 ' + (csvRows.length > 0 ? 'opacity-50 pointer-events-none' : '')}>
            <input type="checkbox" checked={appendNumber} onChange={(e) => setAppendNumber(e.target.checked)} />
            <span className="text-sm">Append number to first/last name{username ? ' and username' : ''} (e.g. "Family 1", "Family 2"{username ? `, "${username}1", "${username}2"` : ''})</span>
            {appendNumber && (
              <input type="number" min={1} className="nb-input !w-20 !py-1" value={startNumber}
                onChange={(e) => setStartNumber(Number(e.target.value) || 1)} />
            )}
          </label>

          <button className="nb-btn-pri mt-3" disabled={busy} onClick={applyProfile}>
            Apply Profile to {ids.length}
            {csvRows.length > 0 && ids.length > 0 && (
              <span className="ml-1 opacity-70">(using CSV — {Math.min(ids.length, csvRows.length)} mapped)</span>
            )}
          </button>
        </div>

        <div className="nb-card p-4">
          <h3 className="font-extrabold uppercase mb-3">Bulk Profile Photo</h3>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input ref={photoRef} type="file" accept="image/*" multiple onChange={addPhotos}
              className="text-xs file:nb-btn file:!py-1 file:!px-2" />
            <button className="nb-btn !py-1 !px-2 text-xs" disabled={photos.length === 0} onClick={clearPhotos}>
              Clear all
            </button>
            <div className="text-xs ml-auto">
              <span className="font-bold">{photos.length}</span> photos •{' '}
              <span className="font-bold">{ids.length}</span> accounts
              {photos.length > 0 && ids.length > 0 && (
                <span className={'ml-2 nb-badge text-black ' + (photos.length >= ids.length ? 'bg-brand-ok' : 'bg-brand-warn')}>
                  {photos.length >= ids.length ? 'enough' : `need ${ids.length - photos.length} more`}
                </span>
              )}
            </div>
          </div>
          <div className="text-[11px] opacity-70 mb-2">
            Pick photos in batches (click "Choose Files" repeatedly to accumulate). Photo #1 → account #1, photo #2 → account #2, etc. Extra photos are ignored; if there are fewer photos than accounts, the remaining accounts are skipped.
          </div>
          {photos.length > 0 && (
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 mb-3 max-h-72 overflow-auto p-2 bg-zinc-50 dark:bg-zinc-800 border-2 border-black dark:border-white">
              {photoThumbs.map((p, i) => (
                <div key={i} className="relative group">
                  <img src={p.url} alt={p.name} className="w-full aspect-square object-cover border-2 border-black dark:border-white" />
                  <span className="absolute top-0 left-0 bg-black text-white text-[10px] font-bold px-1">{i + 1}</span>
                  <button onClick={() => removePhoto(i)}
                    className="absolute top-0 right-0 bg-brand-err text-black text-[10px] font-bold px-1 opacity-0 group-hover:opacity-100 transition">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <button className="nb-btn-pri" disabled={busy || photos.length === 0 || ids.length === 0} onClick={applyPhoto}>
            Apply Photos to {Math.min(photos.length, ids.length)} of {ids.length} accounts
          </button>
        </div>
      </div>

      <div className="nb-card p-4 h-fit">
        <h3 className="font-extrabold uppercase mb-3">Pick Accounts</h3>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          <span className="font-bold text-sm">Select all ({accounts.length})</span>
        </label>
        <div className="text-[10px] opacity-60 mb-2">
          Order matters: row N of CSV / photo #N → account #N (top to bottom of this list).
        </div>
        <div className="space-y-1 max-h-[60vh] overflow-auto">
          {accounts.map((a, i) => (
            <label key={a.id} className="flex items-center gap-2 p-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <input type="checkbox" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="text-[10px] opacity-50 font-mono w-5">{ids.indexOf(a.id) + 1 || ''}</span>
              <span className="text-sm truncate flex-1">{(a.first_name + ' ' + a.last_name).trim() || a.phone}</span>
              <span className="text-xs opacity-60 font-mono">{a.status === 'connected' ? '●' : '○'}</span>
            </label>
          ))}
        </div>
      </div>

      <ProgressModal progress={progress} onClose={close} />
    </div>
  )
}
