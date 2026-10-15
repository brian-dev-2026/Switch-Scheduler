const $ = (id) => document.getElementById(id);

const LABELS = { sleep: 'Sleep', restart: 'Restart', shutdown: 'Shut down' };
const VERBS = { sleep: 'Going to sleep', restart: 'Restarting', shutdown: 'Shutting down' };
const ICONS = { sleep: '#i-moon', restart: '#i-restart', shutdown: '#i-power' };
const CONFIRM_SECONDS = 5;
const RING_C = 2 * Math.PI * 54;

const state = { action: 'sleep', mode: 'delay', schedule: null, dryRun: false };

const pad = (n) => String(n).padStart(2, '0');
const timeFmt = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const clockFmt = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateFmt = new Intl.DateTimeFormat([], { weekday: 'long', day: 'numeric', month: 'long' });

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

function describeTarget(ms) {
  const target = new Date(ms);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  let day;
  if (target.toDateString() === today.toDateString()) day = 'today';
  else if (target.toDateString() === tomorrow.toDateString()) day = 'tomorrow';
  else day = target.toLocaleDateString([], { weekday: 'long' });
  return `${day} at <b>${timeFmt.format(target)}</b>`;
}

function clampInput(input) {
  const max = Number(input.max);
  let v = Math.floor(Number(input.value));
  if (!Number.isFinite(v) || v < 0) v = 0;
  if (v > max) v = max;
  return v;
}

function computeTarget() {
  const now = new Date();
  if (state.mode === 'delay') {
    const minutes = clampInput($('hours')) * 60 + clampInput($('minutes'));
    return minutes > 0 ? now.getTime() + minutes * 60_000 : null;
  }
  const [h, m] = ($('atTime').value || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function updateClock() {
  const now = new Date();
  const parts = Object.fromEntries(clockFmt.formatToParts(now).map((p) => [p.type, p.value]));
  const period = parts.dayPeriod ? `<span class="period">${parts.dayPeriod}</span>` : '';
  $('clock').innerHTML = `${parts.hour}:${parts.minute}<span class="sec">:${parts.second}</span>${period}`;
  $('date').textContent = dateFmt.format(now);
}

function updateSummary() {
  const target = computeTarget();
  $('startBtn').disabled = !target;
  $('summary').innerHTML = target
    ? `${LABELS[state.action]} ${describeTarget(target)}`
    : 'Set a delay longer than 0 minutes';
}

function renderSchedule() {
  const s = state.schedule;
  $('scheduleForm').hidden = !!s;
  $('activeCard').hidden = !s;
  if (!s) return updateSummary();

  $('activeCard').dataset.action = s.action;
  $('activeIcon').setAttribute('href', ICONS[s.action]);
  $('activeLabel').textContent = `until ${LABELS[s.action].toLowerCase()}`;
  $('activeAt').innerHTML = `${LABELS[s.action]} ${describeTarget(s.target)}`;
  updateCountdown();
}

function updateCountdown() {
  const s = state.schedule;
  if (!s) return;
  const remaining = s.target - Date.now();
  const total = Math.max(1, s.target - s.createdAt);
  const fraction = Math.min(1, Math.max(0, remaining / total));
  $('countdown').textContent = formatDuration(remaining);
  $('ringProgress').style.strokeDashoffset = String(RING_C * (1 - fraction));
}

function setupSegmented(id, onChange) {
  const seg = $(id);
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    onChange(btn.dataset.value);
  });
}

function setMode(mode) {
  state.mode = mode;
  $('delayPane').hidden = mode !== 'delay';
  $('timePane').hidden = mode !== 'time';
  $('modeSeg')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.value === mode));
  updateSummary();
}

/* Instant action with a short countdown so a misclick doesn't power off the PC. */
let confirmTimer = null;

function openConfirm(action) {
  const dialog = $('confirm');
  dialog.dataset.action = action;
  dialog.querySelector('.dialog').dataset.action = action;
  $('confirmTitle').textContent = `${VERBS[action]}…`;
  $('confirmNote').textContent =
    action === 'sleep' ? 'Press Esc to cancel.' : 'Open apps will be force-closed. Press Esc to cancel.';
  dialog.hidden = false;
  $('confirmCancel').focus();

  const ring = $('confirmRing');
  ring.style.transition = 'none';
  ring.style.strokeDashoffset = '0';
  let left = CONFIRM_SECONDS;
  $('confirmSecs').textContent = left;
  requestAnimationFrame(() => (ring.style.transition = ''));

  clearInterval(confirmTimer);
  confirmTimer = setInterval(() => {
    left -= 1;
    $('confirmSecs').textContent = Math.max(left, 0);
    ring.style.strokeDashoffset = String(RING_C * (1 - left / CONFIRM_SECONDS));
    if (left <= 0) runNow(action);
  }, 1000);
}

function closeConfirm() {
  clearInterval(confirmTimer);
  confirmTimer = null;
  $('confirm').hidden = true;
}

async function runNow(action) {
  closeConfirm();
  try {
    await window.power.runNow(action);
    if (state.dryRun) toast(`Dry run: “${LABELS[action]}” triggered`);
  } catch (err) {
    toast(cleanError(err));
  }
}

async function init() {
  const info = await window.power.info();
  state.dryRun = info.dryRun;
  $('dryBadge').hidden = !info.dryRun;

  document.querySelectorAll('.action-card').forEach((card) => {
    card.addEventListener('click', () => openConfirm(card.dataset.action));
  });

  setupSegmented('actionSeg', (value) => {
    state.action = value;
    updateSummary();
  });
  setupSegmented('modeSeg', setMode);

  ['hours', 'minutes'].forEach((id) => {
    $(id).addEventListener('input', updateSummary);
    $(id).addEventListener('change', (e) => {
      e.target.value = clampInput(e.target);
      updateSummary();
    });
    $(id).addEventListener('focus', (e) => e.target.select());
  });
  $('atTime').addEventListener('input', updateSummary);

  document.querySelectorAll('.chips button').forEach((chip) => {
    chip.addEventListener('click', () => {
      const min = Number(chip.dataset.min);
      $('hours').value = Math.floor(min / 60);
      $('minutes').value = min % 60;
      setMode('delay');
    });
  });

  const next = new Date(Date.now() + 60 * 60_000);
  $('atTime').value = `${pad(next.getHours())}:00`;

  $('startBtn').addEventListener('click', async () => {
    const target = computeTarget();
    if (!target) return;
    try {
      state.schedule = await window.power.setSchedule(state.action, target);
      renderSchedule();
    } catch (err) {
      toast(cleanError(err));
    }
  });
  $('cancelBtn').addEventListener('click', () => window.power.cancelSchedule());
  $('extendBtn').addEventListener('click', () => window.power.extendSchedule(15));

  $('confirmCancel').addEventListener('click', closeConfirm);
  $('confirmNow').addEventListener('click', () => runNow($('confirm').dataset.action));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('confirm').hidden) closeConfirm();
  });

  window.power.onScheduleChanged((s) => {
    state.schedule = s;
    renderSchedule();
  });
  window.power.onActionError((msg) => toast(msg));

  state.schedule = await window.power.getSchedule();
  renderSchedule();
  updateClock();

  setInterval(() => {
    updateClock();
    if (state.schedule) updateCountdown();
    else updateSummary();
  }, 1000);
}

$('ringProgress').style.strokeDasharray = String(RING_C);
$('confirmRing').style.strokeDasharray = String(RING_C);
init();
