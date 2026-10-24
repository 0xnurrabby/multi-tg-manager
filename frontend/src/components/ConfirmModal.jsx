export default function ConfirmModal({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/35 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="nb-card p-6 w-full max-w-sm rise" onClick={(e) => e.stopPropagation()}>
        <div className="micro-label">{danger ? 'This is permanent' : 'Please confirm'}</div>
        <h2 className="display-title text-[24px] mt-2 mb-2">{title}</h2>
        {message && <div className="text-sm text-muted mb-5 whitespace-pre-wrap leading-6">{message}</div>}
        <div className="flex gap-2 justify-end">
          <button className="nb-btn" onClick={onCancel}>{cancelLabel}</button>
          <button
            className={'nb-btn ' + (danger ? 'nb-btn-err' : 'nb-btn-pri')}
            onClick={onConfirm}
            autoFocus
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
