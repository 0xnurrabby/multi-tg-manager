const BASE = ''  // proxied by vite

// listeners notified when any request returns 401
const _onUnauth = new Set()
export function onUnauthorized(cb) { _onUnauth.add(cb); return () => _onUnauth.delete(cb) }

async function request(method, path, { json, form, query, silent } = {}) {
  let url = path
  if (query) {
    const q = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString()
    if (q) url += '?' + q
  }
  const opts = { method, headers: {}, credentials: 'include' }
  if (json !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(json)
  } else if (form) {
    opts.body = form
  }
  let r
  try {
    r = await fetch(BASE + url, opts)
  } catch (netErr) {
    // network/CORS/abort — surface a cleaner message
    const e = new Error('Cannot reach server')
    e.status = 0
    e.network = true
    throw e
  }
  let body = null
  try { body = await r.json() } catch { /* may not be json */ }
  if (r.status === 401 && !path.startsWith('/api/auth-app/')) {
    _onUnauth.forEach((fn) => { try { fn() } catch {} })
  }
  if (!r.ok) {
    const msg = body?.detail || body?.message || `${r.status} ${r.statusText}`
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    err.status = r.status
    err.body = body
    throw err
  }
  return body
}

export const api = {
  get:  (p, query)        => request('GET',  p, { query }),
  post: (p, json)         => request('POST', p, { json }),
  put:  (p, json)         => request('PUT',  p, { json }),
  del:  (p)               => request('DELETE', p),
  postForm: (p, form)     => request('POST', p, { form }),
}

// Convenience endpoints
export const Endpoints = {
  health: () => api.get('/api/health'),
  stats: () => api.get('/api/stats'),
  accounts: () => api.get('/api/accounts'),
  account: (id) => api.get(`/api/accounts/${id}`),
  deleteAccount: (id) => api.del(`/api/accounts/${id}`),

  sendCode: (phone) => api.post('/api/auth/send_code', { phone }),
  signIn: (phone, code) => api.post('/api/auth/sign_in', { phone, code }),
  signIn2fa: (phone, password) => api.post('/api/auth/sign_in_2fa', { phone, code: '', password }),
  authCancel: (phone) => api.post('/api/auth/cancel', { phone }),

  updateProfile: (id, payload) => api.put(`/api/accounts/${id}/profile`, payload),
  checkUsername: (id, username) => api.get(`/api/accounts/${id}/profile/check_username`, { username }),
  updateUsername: (id, username) => api.put(`/api/accounts/${id}/profile/username`, { username }),
  photoUrl: (id) => api.get(`/api/accounts/${id}/profile/photo_url`),
  uploadPhoto: (id, file) => {
    const fd = new FormData(); fd.append('file', file)
    return api.postForm(`/api/accounts/${id}/profile/photo`, fd)
  },

  bulkProfile: (payload) => api.post('/api/bulk/profile', payload),
  bulkPhoto: (ids, files) => {
    const fd = new FormData()
    fd.append('account_ids', ids.join(','))
    for (const f of files) fd.append('files', f)
    return api.postForm('/api/bulk/photo', fd)
  },

  securityMessages: (accountId, onlyUnread) =>
    api.get('/api/security/messages', { account_id: accountId, only_unread: onlyUnread }),
  markRead: (id) => api.post(`/api/security/messages/${id}/read`),
  markAllRead: (accountId) => api.post('/api/security/messages/mark_all_read' + (accountId ? `?account_id=${accountId}` : '')),
  tgSessions: (id) => api.get(`/api/security/sessions/${id}`),
  terminateSession: (id, hash) => api.del(`/api/security/sessions/${id}/${hash}`),
  terminateOthers: (id) => api.post(`/api/security/sessions/${id}/terminate_others`),

  joinGroup: (id, target) => api.post(`/api/groups/${id}/join`, { target }),
  bulkJoin: (ids, target) => api.post('/api/groups/bulk_join', { account_ids: ids, target }),
  listGroups: (id) => api.get(`/api/groups/${id}/list`),
  leaveGroup: (id, chat_id) => api.post(`/api/groups/${id}/leave`, { chat_id }),
  bulkLeave: (ids, chat_id) => api.post('/api/groups/bulk_leave', { account_ids: ids, chat_id }),

  sendMessage: (id, target, text) => api.post(`/api/messaging/${id}/send`, { target, text }),
  bulkSend: (ids, target, text) => api.post('/api/messaging/bulk_send', { account_ids: ids, target, text }),
  react: (ids, post_link, emoji) => api.post('/api/messaging/react', { account_ids: ids, post_link, emoji }),
  view: (ids, post_link) => api.post('/api/messaging/view', { account_ids: ids, post_link }),

  getSettings: () => api.get('/api/settings'),
  putSettings: (s) => api.put('/api/settings', s),
  exportJson: () => api.get('/api/settings/export'),

  // app auth
  me:     () => api.get('/api/auth-app/me'),
  login:  (password) => api.post('/api/auth-app/login', { password }),
  logout: () => api.post('/api/auth-app/logout'),
}
