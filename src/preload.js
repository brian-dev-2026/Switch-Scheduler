const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('power', {
  info: () => ipcRenderer.invoke('app:info'),
  getSchedule: () => ipcRenderer.invoke('schedule:get'),
  setSchedule: (action, target) => ipcRenderer.invoke('schedule:set', { action, target }),
  extendSchedule: (minutes) => ipcRenderer.invoke('schedule:extend', minutes),
  cancelSchedule: () => ipcRenderer.invoke('schedule:cancel'),
  runNow: (action) => ipcRenderer.invoke('power:run', action),
  onScheduleChanged: (cb) => ipcRenderer.on('schedule-changed', (_e, s) => cb(s)),
  onActionError: (cb) => ipcRenderer.on('action-error', (_e, msg) => cb(msg)),
});
