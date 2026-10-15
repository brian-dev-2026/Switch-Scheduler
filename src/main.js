const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ACTION_LABELS, runAction } = require('./power');

const DRY_RUN = process.env.DRY_RUN === '1';
const WARN_BEFORE_MS = 60 * 1000;
// If the PC was asleep when the timer was due, don't fire long after the fact on wake.
const MISSED_GRACE_MS = 2 * 60 * 1000;
const MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const BG = '#0b0d14';

let win = null;
let tray = null;
let schedule = null; // { action, target, createdAt } — times are epoch ms
let warned = false;
let ticker = null;
let quitting = false;
let trayHintShown = false;
// Hold references so notifications aren't garbage-collected before they're clicked.
const liveNotifications = new Set();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
}

app.setAppUserModelId('com.powerscheduler.app');

const stateFile = () => path.join(app.getPath('userData'), 'schedule.json');

function loadSchedule() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (s && ACTION_LABELS[s.action] && s.target > Date.now()) return s;
  } catch {
    // no saved schedule
  }
  return null;
}

function saveSchedule() {
  try {
    if (schedule) fs.writeFileSync(stateFile(), JSON.stringify(schedule));
    else fs.rmSync(stateFile(), { force: true });
  } catch (err) {
    console.error('Could not save schedule:', err);
  }
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setSchedule(next) {
  schedule = next;
  warned = next ? next.target - Date.now() <= WARN_BEFORE_MS : false;
  saveSchedule();

  if (schedule && !ticker) ticker = setInterval(tick, 1000);
  if (!schedule && ticker) {
    clearInterval(ticker);
    ticker = null;
  }

  win?.webContents.send('schedule-changed', schedule);
  updateTray();
}

function tick() {
  if (!schedule) return;
  const remaining = schedule.target - Date.now();
  const label = ACTION_LABELS[schedule.action];

  if (remaining <= 0) {
    const due = schedule;
    setSchedule(null);
    if (-remaining > MISSED_GRACE_MS) {
      notify('Scheduled action skipped', `${label} at ${formatTime(due.target)} was missed while the PC was asleep.`);
      return;
    }
    perform(due.action);
  } else if (!warned && remaining <= WARN_BEFORE_MS) {
    warned = true;
    notify(`${label} in 1 minute`, 'Click to open Power Scheduler and cancel.');
  }
}

async function perform(action) {
  if (!ACTION_LABELS[action]) return;
  if (DRY_RUN) notify(`[Dry run] ${ACTION_LABELS[action]}`, 'No command was actually run.');
  try {
    await runAction(action, { dryRun: DRY_RUN });
  } catch (err) {
    notify(`${ACTION_LABELS[action]} failed`, err.message);
    win?.webContents.send('action-error', err.message);
  }
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON_PATH });
  const release = () => liveNotifications.delete(n);
  liveNotifications.add(n);
  n.on('click', () => {
    release();
    showWindow();
  });
  n.on('close', release);
  n.show();
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function updateTray() {
  if (!tray) return;
  const status = schedule
    ? `${ACTION_LABELS[schedule.action]} at ${formatTime(schedule.target)}`
    : 'No schedule';
  tray.setToolTip(`Power Scheduler — ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Open', click: showWindow },
      { label: 'Cancel schedule', enabled: !!schedule, click: () => setSchedule(null) },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.on('click', showWindow);
  updateTray();
}

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 820,
    minWidth: 420,
    minHeight: 640,
    show: false,
    backgroundColor: BG,
    icon: ICON_PATH,
    title: 'Power Scheduler',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#cbd5e1', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Keep running in the tray while a schedule is pending, otherwise it would never fire.
  win.on('close', (e) => {
    if (quitting || !schedule) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      notify('Still running in the tray', 'Your schedule stays active. Right-click the tray icon to quit.');
    }
  });

  // Don't let hide-to-tray block Windows from logging off or shutting down.
  const allowClose = () => {
    quitting = true;
  };
  win.on('query-session-end', allowClose);
  win.on('session-end', allowClose);

  win.on('closed', () => {
    win = null;
  });
}

ipcMain.handle('app:info', () => ({ dryRun: DRY_RUN, platform: process.platform }));
ipcMain.handle('schedule:get', () => schedule);

ipcMain.handle('schedule:set', (_e, { action, target }) => {
  const now = Date.now();
  if (!ACTION_LABELS[action]) throw new Error('Unknown action');
  if (!Number.isFinite(target) || target <= now || target > now + MAX_AHEAD_MS) {
    throw new Error('Pick a time within the next 7 days');
  }
  setSchedule({ action, target, createdAt: now });
  return schedule;
});

ipcMain.handle('schedule:extend', (_e, minutes) => {
  if (!schedule || !Number.isFinite(minutes)) return schedule;
  setSchedule({ ...schedule, target: schedule.target + minutes * 60 * 1000 });
  return schedule;
});

ipcMain.handle('schedule:cancel', () => setSchedule(null));
ipcMain.handle('power:run', (_e, action) => perform(action));

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!schedule) app.quit();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  createTray();
  createWindow();
  const saved = loadSchedule();
  if (saved) setSchedule(saved);
});
