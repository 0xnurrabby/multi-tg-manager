export function initials(first, last) {
  const a = (first || '').trim()[0] || ''
  const b = (last  || '').trim()[0] || ''
  return (a + b).toUpperCase() || '?'
}

export const DEFAULT_TIME_ZONE = 'Asia/Dhaka'
const TIME_ZONE_KEY = 'tg_manager_timezone'

export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE } catch { return DEFAULT_TIME_ZONE }
}

export function getTimeZoneChoice() {
  try {
    const value = localStorage.getItem(TIME_ZONE_KEY)
    return value || DEFAULT_TIME_ZONE
  } catch { return DEFAULT_TIME_ZONE }
}

export function getTimeZone() {
  const choice = getTimeZoneChoice()
  if (choice === 'auto') {
    const tz = browserTimeZone()
    return (!tz || tz === 'UTC' || tz === 'Etc/UTC') ? DEFAULT_TIME_ZONE : tz
  }
  return choice || DEFAULT_TIME_ZONE
}

export function setTimeZoneChoice(value) {
  try { localStorage.setItem(TIME_ZONE_KEY, value || DEFAULT_TIME_ZONE) } catch {}
}

export function parseApiDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  let text = String(value).trim()
  if (!text) return null
  if (/^\d{4}-\d\d-\d\d \d/.test(text)) text = text.replace(' ', 'T')
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(text)) text += 'Z'
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatInTimeZone(value, options = {}) {
  const d = parseApiDate(value)
  if (!d) return ''
  try {
    return d.toLocaleString('en-GB', { timeZone: getTimeZone(), ...options })
  } catch { return '' }
}

export function fmtTime(iso) {
  return formatInTimeZone(iso, {
    hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit',
  })
}

export function fmtTimeOnly(iso) {
  return formatInTimeZone(iso, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(iso) {
  return formatInTimeZone(iso, { day: '2-digit', month: 'short', year: 'numeric' })
}

// Human "how old is this account" label used next to every account row.
export function ageLabel(value) {
  const d = parseApiDate(value)
  if (!d) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days < 30) return `${days}d old`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo old`
  return `${Math.floor(days / 365)}y old`
}

export function colorForString(s) {
  let h = 0
  for (const c of s || '') h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 38% 78%)`
}

export function ensureNotificationPermission() {
  if (!('Notification' in window)) return Promise.resolve('unsupported')
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Promise.resolve(Notification.permission)
}

export function desktopNotify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch {}
}
