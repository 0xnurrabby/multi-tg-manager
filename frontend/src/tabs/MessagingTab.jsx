import { useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'
import ResultModal from '../components/ResultModal.jsx'

const REACTIONS = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '🎉', '😱']

function AccountPicker({ accounts, ids, setIds }) {
  return (
    <div className="nb-card-sm p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-bold text-xs uppercase">Accounts</span>
        <button className="nb-btn !py-0.5 !px-1 text-[10px]" onClick={() => setIds(accounts.map((a) => a.id))}>All</button>
        <button className="nb-btn !py-0.5 !px-1 text-[10px]" onClick={() => setIds([])}>None</button>
        <span className="text-xs opacity-70 ml-auto">{ids.length} selected</span>
      </div>
      <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
        {accounts.map((a) => (
          <label key={a.id} className={'nb-badge cursor-pointer ' + (ids.includes(a.id) ? 'bg-brand-pri text-black' : 'bg-white text-black')}>
            <input type="checkbox" className="mr-1"
              checked={ids.includes(a.id)}
              onChange={() => setIds((arr) => arr.includes(a.id) ? arr.filter((x) => x !== a.id) : [...arr, a.id])}
            />
            {(a.first_name || a.phone).slice(0, 14)}
          </label>
        ))}
      </div>
    </div>
  )
}

export default function MessagingTab({ accounts, selected }) {
  const toast = useToast()
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [bulkIds, setBulkIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // react
  const [postLink, setPostLink] = useState('')
  const [emoji, setEmoji] = useState('🔥')
  const [reactIds, setReactIds] = useState([])

  // view
  const [viewLink, setViewLink] = useState('')
  const [viewIds, setViewIds] = useState([])
  const [viewCount, setViewCount] = useState(null)

  async function sendOne() {
    if (!selected) { toast.error('Select an account first'); return }
    setBusy(true)
    try {
      await Endpoints.sendMessage(selected.id, target, text)
      toast.success('Sent!')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function sendBulk() {
    if (bulkIds.length === 0 || !target || !text) { toast.error('Pick accounts, target, text'); return }
    if (!confirm(`Send from ${bulkIds.length} accounts?`)) return
    setBusy(true)
    try {
      const r = await Endpoints.bulkSend(bulkIds, target, text)
      setResult({ title: 'Bulk Send Result', ...r })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function doReact() {
    if (reactIds.length === 0 || !postLink || !emoji) { toast.error('Pick accounts, link, emoji'); return }
    setBusy(true)
    try {
      const r = await Endpoints.react(reactIds, postLink, emoji)
      setResult({ title: 'Reactions Result', ...r })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function doView() {
    if (viewIds.length === 0 || !viewLink) { toast.error('Pick accounts and link'); return }
    setBusy(true)
    try {
      const r = await Endpoints.view(viewIds, viewLink)
      setViewCount(r.views ?? null)
      setResult({ title: 'View Result', ...r })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="nb-card p-4">
        <h3 className="font-extrabold uppercase mb-3">Send Message</h3>
        <input className="nb-input mb-2" placeholder="@username or chat link"
          value={target} onChange={(e) => setTarget(e.target.value)} />
        <textarea className="nb-input min-h-[100px] mb-2" placeholder="Message text"
          value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2">
          <button className="nb-btn-pri flex-1" disabled={busy || !target || !text} onClick={sendOne}>
            Send (1 account)
          </button>
        </div>
        <div className="mt-4">
          <AccountPicker accounts={accounts} ids={bulkIds} setIds={setBulkIds} />
        </div>
        <button className="nb-btn mt-3 w-full" disabled={busy} onClick={sendBulk}>
          Bulk Send from {bulkIds.length}
        </button>
      </div>

      <div className="nb-card p-4">
        <h3 className="font-extrabold uppercase mb-3">React to Post</h3>
        <input className="nb-input mb-2" placeholder="https://t.me/channel/123"
          value={postLink} onChange={(e) => setPostLink(e.target.value)} />
        <div className="flex gap-1 flex-wrap mb-2">
          {REACTIONS.map((r) => (
            <button key={r} onClick={() => setEmoji(r)}
              className={'w-10 h-10 text-xl border-2 border-black dark:border-white ' + (emoji === r ? 'bg-brand-pri' : 'bg-white dark:bg-zinc-900')}>
              {r}
            </button>
          ))}
        </div>
        <AccountPicker accounts={accounts} ids={reactIds} setIds={setReactIds} />
        <button className="nb-btn-pri mt-3 w-full" disabled={busy} onClick={doReact}>
          Send Reactions ({reactIds.length})
        </button>
      </div>

      <div className="nb-card p-4 lg:col-span-2">
        <h3 className="font-extrabold uppercase mb-3">View / Open Post</h3>
        <input className="nb-input mb-2" placeholder="https://t.me/channel/123"
          value={viewLink} onChange={(e) => setViewLink(e.target.value)} />
        <AccountPicker accounts={accounts} ids={viewIds} setIds={setViewIds} />
        <button className="nb-btn-pri mt-3" disabled={busy} onClick={doView}>
          Visit Post ({viewIds.length})
        </button>
        {viewCount != null && <div className="mt-2 text-sm">Last view count: <b>{viewCount}</b></div>}
      </div>

      {result && <ResultModal onClose={() => setResult(null)} {...result} />}
    </div>
  )
}
