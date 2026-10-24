function Chip({ label, value, accent }) {
  return (
    <div className="stat-chip">
      {accent && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: `rgb(var(${accent}))` }}
        />
      )}
      <span className="micro-label">{label}</span>
      <span className="font-mono text-[12px] leading-none tracking-tight">{value}</span>
    </div>
  )
}

export default function TopStats({ stats, onBellClick }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Chip label="Total" value={stats.total} />
      <Chip label="Connected" value={stats.connected} accent="--accent-mint" />
      <Chip label="Banned" value={stats.banned} accent="--accent-rose" />
      <Chip label="2FA" value={stats.with_2fa} accent="--accent-sky" />
      <button
        onClick={onBellClick}
        className="stat-chip transition-colors hover:border-[color:var(--hairline-strong)]"
        title="Open security messages"
      >
        {stats.unread_security > 0 && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgb(var(--accent-rose))' }} />
        )}
        <span className="micro-label">Alerts</span>
        <span
          className="font-mono text-[12px] leading-none tracking-tight"
          style={stats.unread_security > 0 ? { color: 'rgb(var(--danger))' } : undefined}
        >
          {stats.unread_security}
        </span>
      </button>
    </div>
  )
}
