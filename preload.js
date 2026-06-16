const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  changeTheme: (theme) => ipcRenderer.send('theme-changed', theme)
});
