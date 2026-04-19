import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const on = (channel, cb) => {
  const handler = (_, ...args) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

contextBridge.exposeInMainWorld('api', {
  // App
  getInfo: () => invoke('app:info'),

  // FFmpeg
  ffmpegDetect: () => invoke('ffmpeg:detect'),
  ffmpegInstall: () => invoke('ffmpeg:install'),
  ffmpegProbe: (filePath) => invoke('ffmpeg:probe', filePath),

  // Convert
  convertStart: (opts) => invoke('convert:start', opts),
  convertCancel: (convId) => invoke('convert:cancel', convId),
  onConvertProgress: (cb) => on('convert:progress', cb),
  onConvertDone: (cb) => on('convert:done', cb),
  onConvertStatus: (cb) => on('convert:status', cb),

  // Files
  filesTree: (dir) => invoke('files:tree', dir),
  filesPickFolder: () => invoke('files:pick-folder'),
  filesPickFile: () => invoke('files:pick-file'),
  filesPickOutput: () => invoke('files:pick-output'),

  // Accounts
  accountsList: () => invoke('accounts:list'),
  accountsActive: () => invoke('accounts:active'),
  accountsAdd: (payload) => invoke('accounts:add', payload),
  accountsConnect: (payload) => invoke('accounts:connect', payload),
  accountsSwitch: (id) => invoke('accounts:switch', id),
  accountsRemove: (id) => invoke('accounts:remove', id),
  onAccountsStatus: (cb) => on('accounts:status', cb),

  // Keys
  keysList: () => invoke('keys:list'),
  keysAdd: (payload) => invoke('keys:add', payload),
  keysDelete: (id) => invoke('keys:delete', id),

  // History
  historyList: () => invoke('history:list'),

  // Settings
  settingsGetAll: () => invoke('settings:get-all'),
  settingsSet: (key, value) => invoke('settings:set', key, value),
  settingsDetectTools: () => invoke('settings:detect-tools')
})
