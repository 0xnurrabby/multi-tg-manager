import { useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import { CopyButton } from '../lib/CopyButton'
import ResultModal from '../components/ResultModal.jsx'

export default function GroupsTab({ accounts, selected }) {
  const toast = useToast()
  const [target, setTarget] = useState('')
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [bulkIds, setBulkIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function loadGroups(id) {
    setLoading(true)
    try { setGroups(await Endpoints.listGroups(id)) }
    catch (e) { toast.error(e.message); setGroups([]) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (selected) loadGroups(selected.id)
    else setGroups([])
  }, [selected?.id])

  async function joinOne() {
    if (!selected) { toast.error('Select an account first'); return }
    if (!target.trim()) return
    setBusy(true)
    try {
      await Endpoints.joinGroup(selected.id, target)
      toast.success('Joined!')
      await loadGroups(selected.id)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function bulkJoin() {
    if (!target.trim() || bulkIds.length === 0) { toast.error('Pick accounts and enter a target'); return }
    if (!confirm(`Join ${target} from ${bulkIds.length} accounts?`)) return
    setBusy(true)
    try {
      const r = await Endpoints.bulkJoin(bulkIds, target)
      setResult({ title: 'Bulk Join Result', ...r })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function leaveOne(chat_id) {
    if (!selected) return
    if (!confirm('Leave this group/channel?')) return
    setBusy(true)
    try {
      await Endpoints.leaveGroup(selected.id, chat_id)
      toast.success('Left.')
      await loadGroups(selected.id)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function bulkLeave(chat_id) {
    if (bulkIds.length === 0) { toast.error('Select accounts'); return }
    if (!confirm(`Leave from ${bulkIds.length} accounts?`)) return
    setBusy(true)
    try {
      const r = await Endpoints.bulkLeave(bulkIds, chat_id)
      setResult({ title: 'Bulk Leave Result', ...r })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function deleteMyMessages(chat_id, title) {
    if (!selected) return
    setBusy(true)
    try {
      toast.info('Counting your messages in this chat...')
      const cnt = await Endpoints.countMyMessages(selected.id, chat_id, 2000)
      if (cnt.count === 0) {
        toast.info('No messages found from you in this chat (last 2000 scanned)')
        setBusy(false)
        return
      }
      if (!confirm(
        `Delete ALL ${cnt.count} message(s) you sent in "${title}"?\n\n` +
        `This is PERMANENT and removes them for everyone (revoke=true).\n\n` +
        `Account: ${(selected.first_name || selected.phone)}\n` +
        `Scanned: last 2000 messages.`
      )) { setBusy(false); return }
      const r = await Endpoints.deleteMyMessages(selected.id, chat_id, 2000)
      toast.success(`Deleted ${r.deleted} messages from "${title}"`)
      await loadGroups(selected.id)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const toggleId = (id) => setBulkIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <div className="nb-card p-4 mb-4">
          <h3 className="font-extrabold uppercase mb-3">Join Group / Channel</h3>
          <div className="flex gap-2">
            <input
              className="nb-input"
              placeholder="@username or t.me/joinchat/AAA…"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <button className="nb-btn-pri" disabled={busy} onClick={joinOne}>Join (1 account)</button>
            <button className="nb-btn" disabled={busy} onClick={bulkJoin}>Bulk Join ({bulkIds.length})</button>
          </div>
        </div>

        <div className="nb-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-extrabold uppercase">
              {selected ? `Groups & Channels — ${(selected.first_name || selected.phone)}` : 'Pick an account'}
            </h3>
            {selected && (
              <button className="nb-btn !py-1 !px-2 text-xs" onClick={() => loadGroups(selected.id)}>Refresh</button>
            )}
          </div>
          {loading && <div className="opacity-60 text-sm">Loading…</div>}
          {!loading && !selected && <div className="opacity-60 text-sm">Select an account from the sidebar.</div>}
          {!loading && selected && groups.length === 0 && <div className="opacity-60 text-sm">No groups/channels found.</div>}
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.id} className="nb-card-sm p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate flex items-center gap-1">
                    {g.title}
                    {g.invite_link && <CopyButton value={g.invite_link} label="link" />}
                  </div>
                  <div className="text-xs opacity-70 truncate flex items-center gap-1">
                    <span className="nb-badge bg-white text-black !px-1 !py-0">{g.type}</span>
                    {g.username && (
                      <span className="flex items-center gap-1">@{g.username}<CopyButton value={g.username} /></span>
                    )}
                    {g.members != null && <span>• {g.members.toLocaleString()} members</span>}
                  </div>
                </div>
                <button className="nb-btn-err !py-1 !px-2 text-xs" title="Delete every message YOU sent here (revoke for everyone)"
                  onClick={() => deleteMyMessages(g.id, g.title)} disabled={busy}>
                  Del My Msgs
                </button>
                <button className="nb-btn-err !py-1 !px-2 text-xs" onClick={() => leaveOne(g.id)}>Leave</button>
                <button className="nb-btn !py-1 !px-2 text-xs" onClick={() => bulkLeave(g.id)}>Bulk Leave</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="nb-card p-4 h-fit">
        <h3 className="font-extrabold uppercase mb-3">Bulk Selection</h3>
        <div className="flex items-center gap-2 mb-2">
          <button className="nb-btn !py-1 !px-2 text-xs" onClick={() => setBulkIds(accounts.map((a) => a.id))}>Select all</button>
          <button className="nb-btn !py-1 !px-2 text-xs" onClick={() => setBulkIds([])}>Clear</button>
          <span className="text-xs opacity-70 ml-auto">{bulkIds.length} selected</span>
        </div>
        <div className="space-y-1 max-h-[60vh] overflow-auto">
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 p-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <input type="checkbox" checked={bulkIds.includes(a.id)} onChange={() => toggleId(a.id)} />
              <span className="text-sm truncate">{(a.first_name + ' ' + a.last_name).trim() || a.phone}</span>
            </label>
          ))}
        </div>
      </div>

      {result && <ResultModal onClose={() => setResult(null)} {...result} />}
    </div>
  )
}
