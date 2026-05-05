const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件操作
  saveFile: (config) => ipcRenderer.invoke('save-file', config),
});
