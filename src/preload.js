const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  chooseFolder: () => ipcRenderer.invoke('dialog:folder'),
  getCache: () => ipcRenderer.invoke('scan:cached'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  getFavorites: () => ipcRenderer.invoke('favorites:get'),
  onActionResult: cb => ipcRenderer.on('action:result', (_, action, cwd) => cb(action, cwd)),
  runAction: (action, cwd) => ipcRenderer.invoke('action:run', action, cwd),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  scan: () => ipcRenderer.invoke('scan'),
  setTheme: mode => ipcRenderer.invoke('theme:set', mode),
  showMenu: (actions, cwd) => ipcRenderer.invoke('action:menu', actions, cwd),
  toggleFavorite: id => ipcRenderer.invoke('favorites:toggle', id),
})
