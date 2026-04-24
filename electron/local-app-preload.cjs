const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('loiterlyLocalApp', {
  copyText: (value) => ipcRenderer.invoke('local-app:copy-text', value),
  requestAccess: (appId) => ipcRenderer.invoke('local-app:request-access', appId),
  refresh: (appId) => ipcRenderer.send('local-app:refresh', appId),
  revealPath: (targetPath) => ipcRenderer.send('local-app:reveal-path', targetPath),
})
