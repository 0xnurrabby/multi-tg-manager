import { useEffect, useState, useRef, useCallback } from 'react'
import { Endpoints, onUnauthorized } from './lib/api'
import { useToast } from './lib/toast.jsx'
import { useTheme } from './lib/theme'
import { ensureNotificationPermission, desktopNotify } from './lib/util'
import LoginScreen from './components/LoginScreen.jsx'
import Sidebar from './components/Sidebar.jsx'
import TopStats from './components/TopStats.jsx'
import AddAccountModal from './components/AddAccountModal.jsx'
import AccountPage from './components/AccountPage.jsx'
import Icon from './components/Icon.jsx'
import DashboardTab from './tabs/DashboardTab.jsx'
import ProfileTab from './tabs/ProfileTab.jsx'
import SecurityTab from './tabs/SecurityTab.jsx'
import GroupsTab from './tabs/GroupsTab.jsx'
import MessagingTab from './tabs/MessagingTab.jsx'
import AiChatTab from './tabs/AiChatTab.jsx'
import TargetCheckTab from './tabs/TargetCheckTab.jsx'
import BulkTab from './tabs/BulkTab.jsx'
import SettingsTab from './tabs/SettingsTab.jsx'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'profile',   label: 'Profile'   },
  { id: 'security',  label: 'Security'  },
  { id: 'groups',    label: 'Groups'    },
  { id: 'messages',  label: 'Messages'  },
  { id: 'ai',        label: 'AI Chat'   },
  { id: 'checker',   label: 'Checker'   },
  { id: 'bulk',      label: 'Bulk'      },
  { id: 'settings',  label: 'Settings'  },
]

// Account URLs look like /+8801889426746 (or /8801889426746).
function phoneFromPath(pathname) {
  try {
    const raw = decodeURIComponent((pathname || '/').replace(/^\/+|\/+$/g, ''))
    return /^\+?\d{6,}$/.test(raw) ? raw : null
  } catch {
    return null
  }
}

const samePhone = (a, b) => String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, '')

export default function App() {
  const toast = useToast()
  const { theme, toggle } = useTheme()
  const [authState, setAuthState] = useState('checking') // checking | in | out
  const [accounts, setAccounts] = useState([])
  const [gone, setGone] = useState([])  // banned/removed account history
  const [stats, setStats] = useState({ total: 0, connected: 0, banned: 0, with_2fa: 0, unread_security: 0 })
  const [selectedId, setSelectedId] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 1024))
  const [addOpen, setAddOpen] = useState(false)
  // { accountId, messageId, ts } — lets an alert click jump straight to the
  // security message that produced it.
  const [focusAlert, setFocusAlert] = useState(null)
  // Increments on every sidebar click so selecting the already-selected
  // account still re-focuses its security messages.
  const [selectTick, setSelectTick] = useState(0)
  // Phone number currently shown in the URL (/+880...). Drives the account page.
  const [routePhone, setRoutePhone] = useState(() => (typeof window === 'undefined' ? null : phoneFromPath(window.location.pathname)))
  const prevUnreadRef = useRef(0)

  // initial auth check
  useEffect(() => {
    Endpoints.me()
      .then((r) => setAuthState(r?.authed ? 'in' : 'out'))
      .catch(() => setAuthState('out'))
  }, [])

  // global 401 handler: kick back to login
  useEffect(() => onUnauthorized(() => {
    setAuthState('out')
    setAccounts([]); setGone([]); setSelectedId(null)
    setRoutePhone(null)
    window.history.replaceState({}, '', '/')
  }), [])

  async function logout() {
    try { await Endpoints.logout() } catch {}
    setAuthState('out')
    setAccounts([]); setGone([]); setSelectedId(null)
    setRoutePhone(null)
    window.history.replaceState({}, '', '/')
    prevUnreadRef.current = 0
  }

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await Endpoints.accounts()
      setAccounts(list)
      if (!selectedId && list.length) setSelectedId(list[0].id)
    } catch (e) {
      // Stay silent on polling failures — only show error on first-load
      if (accounts.length === 0 && !e.network && e.status !== 401) {
        toast.error('Load accounts: ' + e.message)
      }
    }
  }, [selectedId, toast, accounts.length])

  const refreshGone = useCallback(async () => {
    try { setGone(await Endpoints.goneAccounts()) } catch (e) { /* silent */ }
  }, [])

  // Keep selectedId in sync with the account phone in the URL.
  useEffect(() => {
    if (!routePhone || accounts.length === 0) return
    const acc = accounts.find((a) => samePhone(a.phone, routePhone))
    if (acc && selectedId !== acc.id) setSelectedId(acc.id)
  }, [routePhone, accounts, selectedId])

  // Browser back / forward between account pages.
  useEffect(() => {
    const onPop = () => {
      const phone = phoneFromPath(window.location.pathname)
      setRoutePhone(phone)
      if (phone && accounts.length) {
        const acc = accounts.find((a) => samePhone(a.phone, phone))
        if (acc) setSelectedId(acc.id)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [accounts])

  const closeAccountRoute = useCallback(() => {
    setRoutePhone(null)
    if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
  }, [])

  const openAccount = useCallback((id) => {
    const acc = accounts.find((a) => a.id === id)
    setSelectedId(id)
    setSelectTick((n) => n + 1)
    setFocusAlert(null)
    // Dashboard clicks open the full account page. Inside a tool tab (AI Chat,
    // Groups, Messages, etc.) selection should stay in that tool.
    if (acc?.phone && (routePhone || tab === 'dashboard')) {
      setRoutePhone(acc.phone)
      window.history.pushState({}, '', '/' + acc.phone)
    } else {
      closeAccountRoute()
    }
  }, [accounts, routePhone, tab, closeAccountRoute])

  const refreshStats = useCallback(async () => {
    try {
      const s = await Endpoints.stats()
      setStats(s)
      if (s.unread_security > prevUnreadRef.current && prevUnreadRef.current !== 0) {
        desktopNotify('New security message', `Unread: ${s.unread_security}`)
      }
      prevUnreadRef.current = s.unread_security
    } catch (e) { /* silent */ }
  }, [])

  useEffect(() => {
    if (authState !== 'in') return
    ensureNotificationPermission()
    refreshAccounts()
    refreshStats()
    refreshGone()
    const id = setInterval(() => { refreshAccounts(); refreshStats(); refreshGone() }, 30000)
    return () => clearInterval(id)
  }, [authState, refreshAccounts, refreshStats, refreshGone])

  if (authState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink">
        <div className="text-center rise">
          <div className="micro-label">Loading workspace</div>
          <div className="display-title text-2xl mt-2">Multi TG Manager</div>
        </div>
      </div>
    )
  }
  if (authState === 'out') {
    return <LoginScreen onAuthed={() => setAuthState('in')} />
  }

  const selected = accounts.find((a) => a.id === selectedId) || null
  const routedAccount = routePhone ? accounts.find((a) => samePhone(a.phone, routePhone)) || null : null

  return (
    <div className="h-screen w-screen flex flex-col bg-paper text-ink">
      <header className="app-header sticky top-0 z-40 shrink-0">
        <div className="flex items-center gap-3 px-5 sm:px-6 py-3 flex-wrap">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="icon-btn"
            aria-label={sidebarOpen ? 'Hide accounts' : 'Show accounts'}
          >
            <Icon name="menu" />
          </button>

          <div className="min-w-0">
            <div className="wordmark text-[21px]">Multi TG Manager</div>
            <div className="micro-label mt-1">Telegram operations</div>
          </div>

          <div className="hidden md:block h-8 w-px bg-[color:var(--hairline)] mx-1" />

          <div className="flex-1" />

          <div className="hidden md:flex">
            <TopStats stats={stats} onBellClick={() => { setFocusAlert(null); closeAccountRoute(); setTab('security') }} />
          </div>

          <div className="flex items-center gap-2">
            <button onClick={toggle} className="icon-btn" title="Toggle theme" aria-label="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button onClick={logout} className="icon-btn" title="Logout" aria-label="Logout">
              <Icon name="power" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {sidebarOpen && (
          <Sidebar
            accounts={accounts}
            gone={gone}
            selectedId={selectedId}
            onSelect={openAccount}
            onAdd={() => setAddOpen(true)}
            onDeleted={() => { refreshAccounts(); refreshGone() }}
            onGoneChange={refreshGone}
          />
        )}

        <main className="flex-1 min-w-0 flex flex-col">
          <nav className="shrink-0 border-b border-[color:var(--hairline)] bg-paper/70">
            <div className="mx-auto w-full max-w-[1120px] px-5 sm:px-6 overflow-x-auto">
              <div className="flex gap-1 py-2 min-w-max">
                {routePhone && <span className="nb-tab nb-tab-active">Account</span>}
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className={`nb-tab ${!routePhone && tab === t.id ? 'nb-tab-active' : ''}`}
                    onClick={() => { setFocusAlert(null); closeAccountRoute(); setTab(t.id) }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </nav>

          <div className="flex-1 min-h-0 overflow-auto">
            <div key={routePhone ? 'account-' + routePhone : tab} className="mx-auto w-full max-w-[1120px] px-5 sm:px-6 py-6 sm:py-8 rise">
              {routePhone ? (
                routedAccount ? (
                  <AccountPage
                    account={routedAccount}
                    onRefresh={() => { refreshAccounts(); refreshStats() }}
                    onOpenTab={(id) => { closeAccountRoute(); setFocusAlert(null); setTab(id) }}
                  />
                ) : accounts.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon"><span className="text-lg">…</span></span>
                    <div className="empty-title">Loading account</div>
                    <div className="text-sm">Fetching {routePhone}.</div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon"><Icon name="users" size={18} /></span>
                    <div className="empty-title">Account not found</div>
                    <div className="text-sm max-w-[32ch]">No account matches {routePhone}.</div>
                    <button className="nb-btn-pri mt-2" onClick={closeAccountRoute}>Back to dashboard</button>
                  </div>
                )
              ) : (
                <>
                  {tab === 'dashboard' && <DashboardTab stats={stats} accounts={accounts} onSelect={openAccount} onOpenAlert={(m) => { setSelectedId(m.account_id); setFocusAlert({ accountId: m.account_id, messageId: m.id, ts: Date.now() }); closeAccountRoute(); setTab('security') }} onChange={() => { refreshStats(); refreshAccounts() }} />}
                  {tab === 'profile'   && <ProfileTab account={selected} onRefresh={refreshAccounts} />}
                  {tab === 'security'  && <SecurityTab accounts={accounts} focusAlert={focusAlert} focusAccountId={selectedId} focusTick={selectTick} onChange={refreshStats} />}
                  {tab === 'groups'    && <GroupsTab accounts={accounts} selected={selected} />}
                  {tab === 'messages'  && <MessagingTab accounts={accounts} selected={selected} />}
                  {tab === 'ai'        && <AiChatTab accounts={accounts} focusAccountId={selectedId} focusTick={selectTick} />}
                  {tab === 'checker'   && <TargetCheckTab />}
                  {tab === 'bulk'      && <BulkTab accounts={accounts} onDone={refreshAccounts} />}
                  {tab === 'settings'  && <SettingsTab />}
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      {addOpen && (
        <AddAccountModal
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); refreshAccounts(); refreshStats() }}
          onImported={() => { refreshAccounts(); refreshStats() }}
        />
      )}
    </div>
  )
}
