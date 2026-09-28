// The page's only window onto the desktop shell: Steam achievements and the player's name.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('apexDesktop', {
  achievement: (id) => ipcRenderer.send('steam:achievement', String(id)),
  steamInfo: () => ipcRenderer.invoke('steam:info'),
});
