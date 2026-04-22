const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('loiterlyBackdrop', {
  dismiss: () => ipcRenderer.send('backdrop:dismiss'),
})
