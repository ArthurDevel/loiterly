const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('loiterlyShell', {
  getState: () => ipcRenderer.invoke('shell:get-state'),
  setActiveApp: (appId) => ipcRenderer.send('shell:set-active-app', appId),
  setContentBounds: (bounds) => ipcRenderer.send('shell:set-content-bounds', bounds),
  navigate: (value) => ipcRenderer.send('shell:navigate', value),
  goBack: () => ipcRenderer.send('shell:go-back'),
  goForward: () => ipcRenderer.send('shell:go-forward'),
  reload: () => ipcRenderer.send('shell:reload'),
  toggleWindow: () => ipcRenderer.send('shell:toggle-window'),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  onState: (handler) => {
    const listener = (_event, state) => handler(state)
    ipcRenderer.on('shell:state', listener)
    return () => ipcRenderer.removeListener('shell:state', listener)
  },
})
