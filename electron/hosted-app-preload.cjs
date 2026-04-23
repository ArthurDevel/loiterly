const { ipcRenderer } = require('electron')

window.addEventListener('loiterly:hosted-app-unread-count', (event) => {
  const detail = event?.detail || {}
  const appId = typeof detail.appId === 'string' ? detail.appId : ''
  const unreadCount = Number.isFinite(detail.unreadCount) ? Math.max(0, Math.trunc(detail.unreadCount)) : 0

  if (!appId) {
    return
  }

  ipcRenderer.send('hosted-app:unread-count', {
    appId,
    unreadCount,
  })
})
