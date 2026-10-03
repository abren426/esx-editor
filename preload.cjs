const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('esxFiles', {
  openEsx: () => ipcRenderer.invoke('file:open-esx'),
  openAudio: () => ipcRenderer.invoke('file:open-audio'),
  saveEsx: (payload) => ipcRenderer.invoke('file:save-esx', payload)
});
