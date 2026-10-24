import React, { createContext, useContext, useState, useCallback } from 'react'

const ToastCtx = createContext(null)

let id = 0
const next = () => ++id

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])

  const push = useCallback((kind, text, ms = 3500) => {
    const i = next()
    setItems((s) => [...s, { id: i, kind, text }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== i)), ms)
  }, [])

  const api = {
    success: (t) => push('success', t),
    error:   (t) => push('error', t, 6000),
    info:    (t) => push('info', t),
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              'toast ' +
              (t.kind === 'success' ? 'toast-ok' : t.kind === 'error' ? 'toast-err' : 'toast-info')
            }
          >
            <span className="toast-dot" />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const c = useContext(ToastCtx)
  if (!c) throw new Error('useToast outside provider')
  return c
}
