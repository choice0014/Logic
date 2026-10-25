const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logicFiles', Object.freeze({
  saveCircuit: data => ipcRenderer.invoke('logic:save-circuit', data),
  loadCircuit: () => ipcRenderer.invoke('logic:load-circuit')
}));
