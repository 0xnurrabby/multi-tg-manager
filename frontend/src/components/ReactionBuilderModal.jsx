import { useEffect, useState } from 'react'
import { Endpoints } from '../lib/api'

const PRESET_REACTIONS = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '🎉', '😱', '😢', '🙏', '💯', '🤩']

// Stable key per chosen reaction: custom emoji are keyed by their document id,
// standard ones by their glyph (so two custom emoji with the same fallback glyph
// don't collide).
const keyOf = (e) => (e.custom_emoji_id ? `c:${e.custom_emoji_id}` : `s:${e.emoji}`)

// Popup builder for "React to Post". The user picks one or more reactions — the
// chat's allowed standard emoji, its allowed premium custom emoji, or any pasted
// emoji — and for each drags a bar to set what % of the selected accounts react
// with it. onConfirm(list) receives [{ emoji, pct, custom_emoji_id? }].
// Reactions the chat has disabled are simply skipped at send time (no error).
export default function ReactionBuilderModal({ accountCount = 0, accountId = null, postLink = '', initial = [], onConfirm, onClose }) {
  const [emojis, setEmojis] = useState(initial.length ? initial : [{ emoji: '🔥', pct: 100 }])
  const [emojiInput, setEmojiInput] = useState('')

  // What the chat actually allows. null until loaded / on error (then we fall
  // back to presets and just let the server skip anything disabled).
  const [allowed, setAllowed] = useState(null)
  const [loadingAllowed, setLoadingAllowed] = useState(false)
  const [allowedErr, setAllowedErr] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!postLink || !postLink.trim()) { setAllowed(null); setAllowedErr(''); return }
    setLoadingAllowed(true); setAllowedErr('')
    Endpoints.allowedReactions(postLink.trim(), accountId || undefined)
      .then((r) => { if (!cancelled) setAllowed(r) })
      .catch((e) => { if (!cancelled) { setAllowed(null); setAllowedErr(e.message || 'Could not read this chat') } })
      .finally(() => { if (!cancelled) setLoadingAllowed(false) })
    return () => { cancelled = true }
  }, [postLink, accountId])

  const totalPct = emojis.reduce((s, e) => s + (Number(e.pct) || 0), 0)
  const reactionsOff = allowed?.mode === 'none'
  const standardPresets = (allowed?.standard?.length ? allowed.standard : PRESET_REACTIONS)
  const customAllowed = allowed?.custom || []

  function addStandard(em) {
    const e = (em || '').trim()
    if (!e) return
    // If the pasted glyph is actually one of this chat's allowed custom (premium)
    // emoji — matched by its fallback glyph — add it as a custom reaction so the
    // real document id is sent, not a plain emoticon that Telegram would drop.
    const match = customAllowed.find((c) => (c.alt || '') === e)
    if (match) { addCustom(match); return }
    setEmojis((arr) => {
      if (arr.some((x) => !x.custom_emoji_id && x.emoji === e)) return arr
      const used = arr.reduce((s, x) => s + (Number(x.pct) || 0), 0)
      return [...arr, { emoji: e, pct: Math.max(0, 100 - used) }]
    })
  }
  function addCustom(c) {
    setEmojis((arr) => {
      if (arr.some((x) => x.custom_emoji_id === c.id)) return arr
      const used = arr.reduce((s, x) => s + (Number(x.pct) || 0), 0)
      return [...arr, { emoji: c.alt || '⭐', custom_emoji_id: c.id, pct: Math.max(0, 100 - used) }]
    })
  }
  function removeKey(k) { setEmojis((arr) => arr.filter((x) => keyOf(x) !== k)) }
  function setPct(k, pct) { setEmojis((arr) => arr.map((x) => keyOf(x) === k ? { ...x, pct } : x)) }
  function evenSplit() {
    if (emojis.length === 0) return
    const base = Math.floor(100 / emojis.length)
    setEmojis((arr) => arr.map((x, i) => ({ ...x, pct: i === 0 ? 100 - base * (arr.length - 1) : base })))
  }

  const countFor = (pct) => Math.round((Number(pct) || 0) / 100 * accountCount)
  const hasStd = (em) => emojis.some((x) => !x.custom_emoji_id && x.emoji === em)
  const hasCustom = (id) => emojis.some((x) => x.custom_emoji_id === id)

  function done() { onConfirm(emojis.filter((e) => e.pct > 0)) }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="nb-card p-6 w-full max-w-lg max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold uppercase tracking-tight">Choose Reactions & %</h2>
          <button className="nb-btn !py-1 !px-2" onClick={onClose}>✕</button>
        </div>

        <p className="text-xs opacity-70 mb-2">
          Pick reactions and drag each bar to set what share of the <b>{accountCount}</b> selected
          account{accountCount === 1 ? '' : 's'} react with it. Any reaction the chat has disabled is
          simply skipped (shown in the results) — no error.
        </p>

        {/* what this chat allows */}
        {loadingAllowed && <div className="text-xs opacity-60 mb-2">Reading this chat's allowed reactions…</div>}
        {reactionsOff && (
          <div className="nb-card-sm p-2 mb-2 bg-brand-err text-black text-xs font-bold">
            This chat has reactions turned OFF — no reaction will work here.
          </div>
        )}
        {allowed?.mode === 'some' && !reactionsOff && (
          <div className="nb-card-sm p-2 mb-2 bg-brand-warn text-black text-[11px] font-bold">
            This chat allows only the reactions shown below. Others will be skipped.
          </div>
        )}
        {allowed?.mode === 'all' && !allowed?.allow_custom && (
          <div className="text-[11px] opacity-70 mb-2">All standard emoji are allowed here, but custom (premium) emoji are not.</div>
        )}
        {allowedErr && (
          <div className="text-[11px] opacity-70 mb-2">Couldn't read this chat's allowed reactions ({allowedErr}). You can still pick standard emoji — disabled ones get skipped.</div>
        )}
        {!postLink?.trim() && (
          <div className="text-[11px] opacity-70 mb-2">Tip: paste the post link first to see exactly which reactions this chat allows.</div>
        )}

        {/* standard preset grid — click to add/remove */}
        <div className="text-[11px] font-bold uppercase opacity-70 mb-1">Standard reactions</div>
        <div className="flex gap-1 flex-wrap mb-2">
          {standardPresets.map((r) => {
            const on = hasStd(r)
            return (
              <button key={r} onClick={() => on ? removeKey(`s:${r}`) : addStandard(r)}
                className={'w-9 h-9 text-lg border-2 border-black dark:border-white ' + (on ? 'bg-brand-pri' : 'bg-white dark:bg-zinc-900')}>
                {r}
              </button>
            )
          })}
        </div>

        {/* custom (premium) emoji this chat allows */}
        {customAllowed.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase opacity-70 mb-1">Custom emoji this chat allows</div>
            <div className="flex gap-1 flex-wrap mb-2">
              {customAllowed.map((c) => {
                const on = hasCustom(c.id)
                return (
                  <button key={c.id} title={`custom emoji ${c.id}`} onClick={() => on ? removeKey(`c:${c.id}`) : addCustom(c)}
                    className={'h-9 px-2 text-lg border-2 border-black dark:border-white flex items-center gap-1 ' + (on ? 'bg-brand-pri' : 'bg-white dark:bg-zinc-900')}>
                    <span>{c.alt || '⭐'}</span>
                    <span className="text-[9px] font-bold opacity-60">★</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* add any (standard/pasted) emoji */}
        <div className="flex gap-2 mb-3">
          <input className="nb-input !py-1 text-sm" placeholder="paste / type any emoji"
            value={emojiInput} onChange={(e) => setEmojiInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { addStandard(emojiInput); setEmojiInput('') } }} />
          <button className="nb-btn !px-3" onClick={() => { addStandard(emojiInput); setEmojiInput('') }}>Add</button>
        </div>

        {/* per-emoji percentage bars */}
        <div className="nb-card-sm p-3 mb-3 space-y-2 overflow-auto flex-1">
          <div className="flex items-center mb-1">
            <span className="font-bold text-xs uppercase">% of accounts per reaction</span>
            <button className="nb-btn !py-0.5 !px-1 text-[10px] ml-2" onClick={evenSplit}>Even split</button>
            <span className={'text-xs ml-auto font-bold ' + (totalPct > 100 ? 'text-brand-err' : 'opacity-70')}>
              total {totalPct}%
            </span>
          </div>
          {emojis.length === 0 && (
            <div className="text-xs opacity-60">Add at least one reaction above.</div>
          )}
          {emojis.map((e) => {
            const k = keyOf(e)
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xl w-7 text-center relative">
                  {e.emoji}
                  {e.custom_emoji_id && <span className="absolute -top-1 -right-1 text-[8px] font-bold text-brand-violet">★</span>}
                </span>
                <input type="range" min="0" max="100" value={e.pct} className="flex-1"
                  onChange={(ev) => setPct(k, Number(ev.target.value))} />
                <span className="font-mono text-xs w-10 text-right">{e.pct}%</span>
                <span className={'font-mono text-[11px] w-16 text-right ' + (countFor(e.pct) === 0 ? 'text-brand-warn font-bold' : 'opacity-70')}>→ {countFor(e.pct)} acc</span>
                <button className="text-xs opacity-60 hover:opacity-100" onClick={() => removeKey(k)}>✕</button>
              </div>
            )
          })}
          {totalPct > 100 && <div className="text-[11px] text-brand-err">Total is over 100% — lower some bars.</div>}
          {totalPct < 100 && emojis.length > 0 && (
            <div className="text-[11px] opacity-60">{100 - totalPct}% of accounts ({countFor(100 - totalPct)}) won't react.</div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button className="nb-btn" onClick={onClose}>Cancel</button>
          <button className="nb-btn-pri" disabled={emojis.length === 0 || totalPct === 0 || totalPct > 100 || reactionsOff} onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
