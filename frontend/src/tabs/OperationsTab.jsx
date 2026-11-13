import GroupsTab from './GroupsTab'
import MessagingTab from './MessagingTab'
import TargetCheckTab from './TargetCheckTab'
import BulkTab from './BulkTab'

const OPERATIONS = [
  { id: 'groups', label: 'Groups', hint: 'Join, leave and inspect groups' },
  { id: 'messages', label: 'Messages', hint: 'Open chats and send messages' },
  { id: 'checker', label: 'Checker', hint: 'Check targets and memberships' },
  { id: 'bulk', label: 'Bulk', hint: 'Run profile and account-wide edits' },
]

export default function OperationsTab({ accounts, selected, onDone, active, onChange }) {
  const current = OPERATIONS.find((item) => item.id === active) || OPERATIONS[0]

  return (
    <div className="space-y-4">
      <div className="nb-card p-5">
        <div className="micro-label">Operations</div>
        <h1 className="display-title text-[28px] mt-1">Account tools</h1>
        <p className="text-sm text-muted mt-2 max-w-[68ch] leading-6">
          Group actions, direct messages, target checks and bulk edits live together here.
          The account selected in the sidebar is used where a tool supports one.
        </p>
        <div className="flex gap-1 mt-4 overflow-x-auto pb-1">
          {OPERATIONS.map((item) => (
            <button
              key={item.id}
              className={`nb-tab whitespace-nowrap ${active === item.id ? 'nb-tab-active' : ''}`}
              onClick={() => onChange?.(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-muted mt-2">{current.hint}</div>
      </div>

      {active === 'groups' && <GroupsTab accounts={accounts} selected={selected} />}
      {active === 'messages' && <MessagingTab accounts={accounts} selected={selected} />}
      {active === 'checker' && <TargetCheckTab />}
      {active === 'bulk' && <BulkTab accounts={accounts} onDone={onDone} />}
    </div>
  )
}
