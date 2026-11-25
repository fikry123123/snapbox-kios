const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kioskAPI', {
  printPhotostrip: (data) => ipcRenderer.send('print-photostrip', data),
  onPrintStatus: (callback) =>
    ipcRenderer.once('print-status', (_event, value) => callback(value)),
  sendPhotosToEmail: (data) => ipcRenderer.invoke('send-photos-to-email', data),
  savePhotosZip: (data) => ipcRenderer.invoke('save-photos-zip', data),
});