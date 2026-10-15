const { execFile } = require('child_process');

const ACTION_LABELS = {
  sleep: 'Sleep',
  restart: 'Restart',
  shutdown: 'Shut down',
};

// Each command is [file, args] so nothing goes through a shell.
const COMMANDS = {
  win32: {
    shutdown: ['shutdown', ['/s', '/f', '/t', '0']],
    restart: ['shutdown', ['/r', '/f', '/t', '0']],
    sleep: [
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; if (-not [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)) { exit 1 }",
      ],
    ],
  },
  darwin: {
    shutdown: ['osascript', ['-e', 'tell app "System Events" to shut down']],
    restart: ['osascript', ['-e', 'tell app "System Events" to restart']],
    sleep: ['pmset', ['sleepnow']],
  },
  linux: {
    shutdown: ['systemctl', ['poweroff']],
    restart: ['systemctl', ['reboot']],
    sleep: ['systemctl', ['suspend']],
  },
};

function runAction(action, { dryRun = false } = {}) {
  const command = COMMANDS[process.platform]?.[action];
  if (!command) return Promise.reject(new Error(`"${action}" is not supported on ${process.platform}`));

  const [file, args] = command;
  if (dryRun) {
    console.log(`[dry run] ${file} ${args.join(' ')}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

module.exports = { ACTION_LABELS, runAction };
