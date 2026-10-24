import { useEffect, useRef, useState } from 'react'
import { Endpoints } from '../lib/api'
import { useToast } from '../lib/toast.jsx'

function fmtTime(iso) {
  if (!iso) return ''
  const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z'
  const d = new Date(norm)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function kindBadge(kind, isBot) {
  const label = isBot ? 'bot' : (kind || 'chat')
  const color = isBot ? 'bg-brand-violet' : kind === 'channel' ? 'bg-brand-info'
    : kind === 'group' ? 'bg-brand-ok' : 'bg-brand-warn'
  return <span className={'nb-badge text-black ' + color}>{label}</span>
}

export default function ChatPanel({ account, className = '' }) {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [peer, setPeer] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [opening, setOpening] = useState(false)
  const [sending, setSending] = useState(false)
  const listRef = useRef(null)

  // Reset everything when the selected account changes — the chat is opened
  // from that account's perspective.
  useEffect(() => {
    setInput(''); setPeer(null); setMessages([]); setDraft('')
    setOpening(false); setSending(false)
  }, [account?.id])

  // Poll history every 4s while a chat is open (incoming replies, referral acks).
  useEffect(() => {
    if (!account?.id || !peer?.ref) return
    let alive = true
    const tick = async () => {
      try {
        const r = await Endpoints.chatHistory(account.id, peer.ref)
        if (alive && r?.messages) setMessages(r.messages)
      } catch { /* silent — transient */ }
    }
    const id = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(id) }
  }, [account?.id, peer?.ref])

  // Auto-scroll to newest.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function openChat() {
    const val = input.trim()
    if (!val || !account?.id) return
    setOpening(true)
    try {
      const r = await Endpoints.openChat(account.id, val)
      setPeer(r.peer)
      setMessages(r.messages || [])
      if (r.started) toast.success('Referral /start sent ✔')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setOpening(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || !peer?.ref || !account?.id) return
    setSending(true)
    try {
      await Endpoints.chatSend(account.id, peer.ref, text)
      setDraft('')
      const r = await Endpoints.chatHistory(account.id, peer.ref)
      if (r?.messages) setMessages(r.messages)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSending(false)
    }
  }

  function newChat() {
    setPeer(null); setMessages([]); setInput(''); setDraft('')
  }

  if (!account) return null
  const notConnected = account.status !== 'connected'

  return (
    <div className={'nb-card flex flex-col h-[75vh] ' + className}>
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[color:var(--hairline)]">
        <span className="micro-label shrink-0">Chat</span>
        {peer && (
          <>
            <span className="font-bold truncate">{peer.title}</span>
            {kindBadge(peer.kind, peer.is_bot)}
            <button className="nb-btn !py-0.5 !px-2 ml-auto shrink-0" onClick={newChat} title="Open another chat">
              + New
            </button>
          </>
        )}
      </div>

      {/* open bar — paste @username or t.me link (referral links supported) */}
      <div className="px-4 py-3 border-b border-[color:var(--hairline)] space-y-2">
        <div className="flex gap-2">
          <input
            className="nb-input !py-1 text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); openChat() } }}
            placeholder="@username or t.me link…"
          />
          <button className="nb-btn-pri !py-1 !px-3 shrink-0" onClick={openChat} disabled={opening || !input.trim()}>
            {opening ? '…' : 'Open'}
          </button>
        </div>
        <div className="text-[10px] opacity-50">
          Tip: paste a referral link like <span className="font-mono">t.me/Bot?start=CODE</span> — Open fires the bot /start so the referral counts.
        </div>
      </div>

      {notConnected && (
        <div className="nb-note nb-note-warn mx-4 mt-3 px-3 py-2 text-[11px]">
          This account is <b>{account.status}</b> — connect it to chat.
        </div>
      )}

      {/* messages */}
      <div ref={listRef} className="flex-1 overflow-auto p-4 space-y-2 bg-paper">
        {!peer && (
          <div className="empty-state h-full">
            <span className="empty-icon"><span className="text-lg">↗</span></span>
            <div className="empty-title">Open a conversation</div>
            <div className="text-sm max-w-[34ch]">
              Paste a @username or a t.me link above to start messaging the way you would in Telegram.
            </div>
          </div>
        )}
        {peer && messages.length === 0 && (
          <div className="empty-state h-full">
            <span className="empty-icon"><span className="text-lg">…</span></span>
            <div className="empty-title">No messages yet</div>
            <div className="text-sm">Send the first one below.</div>
          </div>
        )}
        {peer && messages.map((m) => {
          if (m.service) {
            return (
              <div key={m.id} className="text-center text-[10px] opacity-50 my-1">
                {m.text || 'service message'}
              </div>
            )
          }
          return (
            <div key={m.id} className={'flex ' + (m.out ? 'justify-end' : 'justify-start')}>
              <div className={
                'max-w-[80%] px-3 py-2 rounded-[12px] border text-sm break-words ' +
                (m.out
                  ? 'bg-ink text-paper border-ink'
                  : 'bg-surface text-ink border-[color:var(--hairline)]')
              }>
                {m.text
                  ? <span className="whitespace-pre-wrap">{m.text}</span>
                  : <span className="italic opacity-70">{m.media || '[empty]'}</span>}
                <div className={'text-[9px] mt-1 text-right font-mono ' + (m.out ? 'text-paper/55' : 'text-muted')}>
                  {fmtTime(m.date)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* composer */}
      {peer && (
        <div className="px-4 py-3 border-t border-[color:var(--hairline)] flex gap-2">
          <input
            className="nb-input !py-1 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Type a message…"
          />
          <button className="nb-btn-pri !py-1 !px-3 shrink-0" onClick={send} disabled={sending || !draft.trim()}>
            {sending ? '…' : 'Send'}
          </button>
        </div>
      )}
    </div>
  )
}
