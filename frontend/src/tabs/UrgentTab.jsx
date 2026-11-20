import { ResetRequestsPanel, LoginRequestsPanel } from './SecurityTab'

// Everything urgent: account-deletion requests, login approvals, login codes and
// other security messages. Kept out of the Security tab so it can't be missed.
export default function UrgentTab({ onChange }) {
  return (
    <div>
      <div className="nb-card p-5 mb-4">
        <div className="micro-label">Urgent</div>
        <div className="display-title text-[26px] mt-2">Resets &amp; login codes</div>
        <div className="text-sm text-muted mt-2 max-w-[68ch] leading-6">
          Account reset requests, login approvals and every login code from Telegram.
          Cancel a reset or approve/decline a login right here.
        </div>
      </div>

      <ResetRequestsPanel onChange={onChange} />
      <LoginRequestsPanel onChange={onChange} />
    </div>
  )
}
