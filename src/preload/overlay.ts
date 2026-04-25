import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('v2tOverlay', {
  stopRecording: () => ipcRenderer.send('v2t:overlay-stop-recording')
});
