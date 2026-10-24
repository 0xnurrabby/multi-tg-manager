export default function ResultModal({ title, success = 0, failed = 0, skipped = 0, results = [], onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/35 flex items-center justify-center p-4" onClick={onClose}>
      <div className="nb-card p-6 w-full max-w-lg max-h-[80vh] overflow-auto rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="micro-label">Result</div>
            <h2 className="display-title text-[24px] mt-1">{title}</h2>
          </div>
          <button className="nb-btn !py-1 !px-3" onClick={onClose}>Close</button>
        </div>
        <div className="flex gap-2 mb-5 flex-wrap">
          <span className="nb-badge bg-brand-ok">{success} success</span>
          <span className="nb-badge bg-brand-err">{failed} failed</span>
          <span className="nb-badge bg-brand-warn">{skipped} skipped</span>
        </div>
        <div className="space-y-1">
          {results.map((r, i) => (
            <div key={i} className="nb-card-sm px-3 py-2 text-sm flex items-center gap-2">
              <span className={'w-2 h-2 rounded-full shrink-0 ' + (r.status === 'ok' ? 'bg-brand-ok' : r.status === 'failed' ? 'bg-brand-err' : 'bg-brand-warn')} />
              <span className="font-mono text-[11px] text-muted">{r.phone}</span>
              {r.detail && <span className="text-xs text-muted truncate">{r.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
