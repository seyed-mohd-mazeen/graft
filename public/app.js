import { renderMarkdown } from './markdown.js';
import { parseDiff } from './diff.js';

// ================= DOM ====================================================

const brandSubEl = document.getElementById('brand-sub');
const paletteOpenBtn = document.getElementById('palette-open-btn');
const navItems = {
  board: document.getElementById('nav-board'),
  run: document.getElementById('nav-inflight'),
  runs: document.getElementById('nav-runs'),
  worktrees: document.getElementById('nav-worktrees'),
  settings: document.getElementById('nav-settings'),
};
const navCountBoard = document.getElementById('nav-count-board');
const navCountInflight = document.getElementById('nav-count-inflight');
const navCountRuns = document.getElementById('nav-count-runs');
const navCountWorktrees = document.getElementById('nav-count-worktrees');
const usageMiniLeftEl = document.getElementById('usage-mini-left');
const usageMiniBodyEl = document.getElementById('usage-mini-body');
const userEmailEl = document.getElementById('user-email');
const userAvatarEl = document.getElementById('user-avatar');
const bottomTabs = document.querySelectorAll('.bottom-tab');

const pages = {
  board: document.getElementById('board-page'),
  run: document.getElementById('run-page'),
  runs: document.getElementById('runs-page'),
  worktrees: document.getElementById('worktrees-page'),
  settings: document.getElementById('settings-page'),
};

// Board
const boardSubEl = document.getElementById('board-sub');
const boardViewListBtn = document.getElementById('board-view-list-btn');
const boardViewLanesBtn = document.getElementById('board-view-lanes-btn');
const boardListEl = document.getElementById('board-list');
const boardLanesEl = document.getElementById('board-lanes');
const boardStartBtn = document.getElementById('board-start-btn');
const refreshBtn = document.getElementById('refresh-btn');
const setupBannerEl = document.getElementById('setup-banner');
const setupBannerTextEl = document.getElementById('setup-banner-text');
const setupBannerBtnEl = document.getElementById('setup-banner-btn');

// Drawer
const drawerBackdropEl = document.getElementById('drawer-backdrop');
const drawerEl = document.getElementById('drawer');
const drawerCloseBtn = document.getElementById('drawer-close');
const drawerKeyEl = document.getElementById('drawer-key');
const drawerTypeEl = document.getElementById('drawer-type');
const drawerPriorityEl = document.getElementById('drawer-priority');
const drawerTitleEl = document.getElementById('drawer-title');
const drawerDescriptionEl = document.getElementById('drawer-description');
const drawerLinkedSectionEl = document.getElementById('drawer-linked-section');
const drawerLinkedEl = document.getElementById('drawer-linked');
const drawerStartBtn = document.getElementById('drawer-start-btn');
const modelSelectEl = document.getElementById('model-select');
const refInput = document.getElementById('ref-input');
const refSuggestEl = document.getElementById('ref-suggest');
const refChipsEl = document.getElementById('ref-chips');

// Run page
const runBackBtn = document.getElementById('run-back-btn');
const runCrumbKeyEl = document.getElementById('run-crumb-key');
const runTitleEl = document.getElementById('run-title');
const runStatusPillEl = document.getElementById('run-status-pill');
const runBranchChipEl = document.getElementById('run-branch-chip');
const runModelChipEl = document.getElementById('run-model-chip');
const runElapsedEl = document.getElementById('run-elapsed');
const runActionsEl = document.getElementById('run-actions');
const runProgressRowEl = document.getElementById('run-progress-row');
const runTurnsCountEl = document.getElementById('run-turns-count');
const runTicksEl = document.getElementById('run-ticks');
const runActivityRowEl = document.getElementById('run-activity-row');
const runActivityTextEl = document.getElementById('run-activity-text');
const runLogCountEl = document.getElementById('run-log-count');
const runLogEl = document.getElementById('run-log');
const runPaneTitleEl = document.getElementById('run-pane-title');
const runPaneMetaEl = document.getElementById('run-pane-meta');
const runErrorPanelEl = document.getElementById('run-error-panel');
const runErrorTextEl = document.getElementById('run-error-text');
const runPlanPanelEl = document.getElementById('run-plan-panel');
const runPlanContentEl = document.getElementById('run-plan-content');
const runApproveBtn = document.getElementById('run-approve-btn');
const runEditPlanBtn = document.getElementById('run-edit-plan-btn');
const runDiscardBtn = document.getElementById('run-discard-btn');
const runEditPlanPanelEl = document.getElementById('run-edit-plan-panel');
const runEditPlanInputEl = document.getElementById('run-edit-plan-input');
const runEditPlanSendBtn = document.getElementById('run-edit-plan-send-btn');
const runEditPlanCancelBtn = document.getElementById('run-edit-plan-cancel-btn');
const runLivePanelEl = document.getElementById('run-live-panel');
const runTouchedEl = document.getElementById('run-touched');
const runDiffPanelEl = document.getElementById('run-diff-panel');
const runDiffSummaryEl = document.getElementById('run-diff-summary');
const runDiffSummaryBodyEl = document.getElementById('run-diff-summary-body');
const runIterationsEl = document.getElementById('run-iterations');
const runDiffStatsEl = document.getElementById('run-diff-stats');
const runDiffViewEl = document.getElementById('run-diff-view');
const runIteratePanelEl = document.getElementById('run-iterate-panel');
const runIterateInputEl = document.getElementById('run-iterate-input');
const runIterateSendBtn = document.getElementById('run-iterate-send-btn');
const runIterateCancelBtn = document.getElementById('run-iterate-cancel-btn');

// Runs page
const runsFiltersEl = document.getElementById('runs-filters');
const runsTableBodyEl = document.getElementById('runs-table-body');

// Worktrees page
const wtSelectedCountEl = document.getElementById('wt-selected-count');
const wtRemoveSelectedBtn = document.getElementById('wt-remove-selected-btn');
const wtPageBodyEl = document.getElementById('wt-page-body');

// Settings
const settingsNavEl = document.getElementById('settings-nav');
const settingsMainEl = document.getElementById('settings-main');
const settingsModelEl = document.getElementById('settings-model');
const jiraDomainInput = document.getElementById('set-jira-domain');
const jiraEmailInput = document.getElementById('set-jira-email');
const jiraTokenInput = document.getElementById('set-jira-token');
const jiraSaveBtn = document.getElementById('set-jira-save');
const jiraStatusEl = document.getElementById('set-jira-status');
const projectsRootInput = document.getElementById('set-projects-root');
const scanBtn = document.getElementById('set-scan');
const projectSelect = document.getElementById('set-project');
const baseBranchEl = document.getElementById('set-base-branch');
const projectStatusEl = document.getElementById('set-project-status');
const lintDisplayEl = document.getElementById('set-lint-display');
const testDisplayEl = document.getElementById('set-test-display');
const cmdEditToggleBtn = document.getElementById('set-cmd-edit-toggle');
const cmdFieldsEl = document.getElementById('set-cmd-fields');
const cmdActionsEl = document.getElementById('set-cmd-actions');
const baseBranchInput = document.getElementById('set-base-branch-input');
const baseBranchListEl = document.getElementById('set-base-branch-list');
const baseBranchDetectBtn = document.getElementById('set-base-branch-detect');
const lintCmdInput = document.getElementById('set-lint-cmd');
const testCmdInput = document.getElementById('set-test-cmd');
const cmdSaveBtn = document.getElementById('set-cmd-save');
const cmdStatusEl = document.getElementById('set-cmd-status');
const usageBodyEl = document.getElementById('usage-body');
const usageRefreshBtn = document.getElementById('usage-refresh');
const notifToggleBtn = document.getElementById('notif-toggle-btn');
const notifStatusNoteEl = document.getElementById('notif-status-note');
const tgTokenInput = document.getElementById('set-tg-token');
const tgChatInput = document.getElementById('set-tg-chat');
const tgEnabledInput = document.getElementById('set-tg-enabled'); // hidden checkbox, kept as the source of truth
const tgEnabledToggleBtn = document.getElementById('set-tg-enabled-toggle');
const tgNoteEl = document.getElementById('tg-note');
const tgSaveBtn = document.getElementById('set-tg-save');
const tgTestBtn = document.getElementById('set-tg-test');
const tgStatusEl = document.getElementById('set-tg-status');
const jiraCommentToggleBtn = document.getElementById('jira-comment-toggle-btn');
const jiraCommentNoteEl = document.getElementById('jira-comment-note');
const wtBodyEl = document.createElement('div'); // Settings' worktree summary was folded into the dedicated Worktrees page
const wtRefreshBtn = document.createElement('button');
const doctorBodyEl = document.getElementById('doctor-body');
const doctorRefreshBtn = document.getElementById('doctor-refresh');
const setupNavDotEl = document.getElementById('setup-nav-dot');

// Palette / toast
const paletteBackdropEl = document.getElementById('palette-backdrop');
const paletteInputEl = document.getElementById('palette-input');
const paletteResultsEl = document.getElementById('palette-results');
const toastEl = document.getElementById('toast');
const toastTextEl = document.getElementById('toast-text');

// ================= State ===================================================

let tickets = [];
let ticketsError = null;
let activeTicket = null; // ticket object backing the open drawer
let referenceFiles = [];
let elapsedTimer = null;
let currentTaskId = null; // task id backing whatever is on the Run page right now
let route = 'board';

const activeTasks = new Map(); // ticketKey -> { taskId, es, snap, seenLogCount, doneHandled, planUsageLoaded, lastColumn }
let displayedTaskId = null; // the live task currently painted on the Run page (null if viewing a history record instead)
let displayedHistoryId = null; // the history record currently painted on the Run page (null if viewing a live task)

const isTerminal = (status) => status === 'done' || status === 'error' || status === 'cancelled' || status === 'stopped';

let implByKey = new Map(); // ticketKey -> newest implementation record (for the Board)
let allRuns = []; // every implementation record (for the Runs page)
let ticketsByKey = new Map();
let currentDoctor = null;
let currentConfig = {};

const BOARD_VIEW_KEY = 'graft.boardView';
let boardView = localStorage.getItem(BOARD_VIEW_KEY) === 'lanes' ? 'lanes' : 'list';

const COLUMNS = [
  { id: 'todo', title: 'To do', tone: 'var(--text-ghost)' },
  { id: 'drafting', title: 'Drafting', tone: 'var(--accent)' },
  { id: 'approval', title: 'Needs approval', tone: 'var(--gold)' },
  { id: 'implementing', title: 'Implementing', tone: 'var(--accent)' },
  { id: 'done', title: 'Landed, not committed', tone: 'var(--sage)' },
];

const STATUS_META = {
  planning: ['Drafting', 'pill-running'],
  'awaiting-approval': ['Needs approval', 'pill-await'],
  branching: ['Running', 'pill-running'],
  running: ['Running', 'pill-running'],
  paused: ['Paused', 'pill-idle'],
  stopped: ['Stopped', 'pill-error'],
  error: ['Error', 'pill-error'],
  done: ['Done', 'pill-done'],
};

function columnForKey(key) {
  const state = activeTasks.get(key);
  if (state) {
    const s = state.snap ? state.snap.status : null;
    if (!s || s === 'planning') return 'drafting';
    if (s === 'awaiting-approval') return 'approval';
    if (['branching', 'running', 'paused', 'stopped', 'error'].includes(s)) return 'implementing';
    if (s === 'done') return 'done';
  }
  const rec = implByKey.get(key);
  if (rec) return rec.status === 'done' ? 'done' : 'implementing';
  return 'todo';
}

function statusMetaForKey(key) {
  const state = activeTasks.get(key);
  if (state) {
    const s = state.snap ? state.snap.status : 'planning';
    return STATUS_META[s] || ['Running', 'pill-running'];
  }
  const rec = implByKey.get(key);
  if (rec) return STATUS_META[rec.status] || ['Done', 'pill-done'];
  return null;
}

const DOT = { task: 'var(--accent)', bug: 'var(--danger)', story: 'var(--sage)', epic: 'var(--gold)' };
function dotFor(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('bug')) return DOT.bug;
  if (t.includes('story')) return DOT.story;
  if (t.includes('epic')) return DOT.epic;
  return DOT.task;
}

function setToggleOn(btn, on) {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', String(Boolean(on)));
}

// Makes a non-native clickable row (a <div> standing in for a link/button)
// reachable and activatable from the keyboard, without touching its click behavior.
function makeClickableRow(el, onActivate) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.addEventListener('click', onActivate);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

// ================= Data loaders (same endpoints as before) =================

async function loadTickets() {
  boardListEl.innerHTML = '<p class="hint">Loading tickets…</p>';
  try {
    const res = await fetch('/api/tickets');
    const body = await res.json();
    if (!res.ok) throw new Error((body && body.error) || 'Failed to load tickets');
    tickets = Array.isArray(body) ? body : [];
    ticketsError = null;
    renderBoard();
  } catch (err) {
    tickets = [];
    ticketsError = err.message;
    renderBoard();
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/implementations');
    const items = await res.json();
    if (!res.ok || !Array.isArray(items)) throw new Error((items && items.error) || 'Failed to load history');
    allRuns = items;
    implByKey = new Map();
    for (const it of items) if (!implByKey.has(it.ticketKey)) implByKey.set(it.ticketKey, it);
    renderBoard();
    if (route === 'runs') renderRunsPage();
  } catch {
    // Board still renders from tickets/tasks even if history fails.
  }
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const models = await res.json();
    if (!res.ok) throw new Error('Failed to load models');
    const saved = localStorage.getItem('graft.model');
    for (const sel of [modelSelectEl, settingsModelEl]) {
      if (!sel) continue;
      sel.innerHTML = '';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        sel.appendChild(opt);
      }
      if (saved && models.some((m) => m.id === saved)) sel.value = saved;
    }
  } catch {
    /* the backend defaults to the plan model anyway */
  }
}
function syncModel(value) {
  localStorage.setItem('graft.model', value);
  if (modelSelectEl && modelSelectEl.value !== value) modelSelectEl.value = value;
  if (settingsModelEl && settingsModelEl.value !== value) settingsModelEl.value = value;
}
modelSelectEl.addEventListener('change', () => syncModel(modelSelectEl.value));
if (settingsModelEl) settingsModelEl.addEventListener('change', () => syncModel(settingsModelEl.value));

async function loadUsage() {
  try {
    const res = await fetch('/api/usage');
    const data = await res.json();
    renderUsage(data);
    renderUsageMini(data);
  } catch (err) {
    usageBodyEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

function renderUsage(data) {
  if (!data.available) {
    usageBodyEl.innerHTML = `<p class="hint">${escapeHtml(data.message || 'Usage is currently unavailable.')}</p>`;
    return;
  }
  if (!data.bars.length) {
    usageBodyEl.innerHTML = '<p class="hint">No usage data.</p>';
    return;
  }
  usageBodyEl.innerHTML = '';
  for (const bar of data.bars) {
    const left = Math.max(0, 100 - bar.percent);
    const sev = bar.percent >= 90 ? 'var(--danger)' : bar.percent >= 70 ? 'var(--gold)' : 'var(--sage)';
    const row = document.createElement('div');
    row.className = 'usage-mini-row';
    row.style.marginBottom = '14px';
    row.innerHTML = `
      <div class="usage-mini-row-top"><span class="usage-mini-label" style="color:var(--text)">${escapeHtml(bar.label)}</span><span class="usage-mini-sub" style="color:${sev};font-weight:600">${left}% left</span></div>
      <div class="usage-mini-track" style="height:7px"><div class="usage-mini-fill" style="width:${bar.percent}%;background:${sev}"></div></div>
      <div class="usage-mini-sub" style="margin-top:5px">${bar.percent}% used${bar.resetsAt ? ` · resets ${formatReset(bar.resetsAt)}` : ''}</div>`;
    usageBodyEl.appendChild(row);
  }
}

// The sidebar's compact widget: the two most relevant bars, or a quiet message.
function renderUsageMini(data) {
  if (!data.available || !data.bars.length) {
    usageMiniLeftEl.textContent = '';
    usageMiniBodyEl.innerHTML = `<p class="hint" style="padding:0;font-size:11px;">${data.available ? 'No data' : (data.reason === 'expired' ? 'Token expired' : 'Unavailable')}</p>`;
    return;
  }
  const primary = data.bars[0];
  usageMiniLeftEl.textContent = `${Math.max(0, 100 - primary.percent)}% left`;
  usageMiniBodyEl.innerHTML = '';
  for (const bar of data.bars.slice(0, 2)) {
    const sev = bar.percent >= 90 ? 'var(--danger)' : bar.percent >= 70 ? 'var(--gold)' : 'var(--sage)';
    const row = document.createElement('div');
    row.className = 'usage-mini-row';
    row.innerHTML = `
      <div class="usage-mini-row-top"><span class="usage-mini-label">${escapeHtml(bar.label)}</span><span class="usage-mini-sub">${bar.resetsAt ? `resets ${formatReset(bar.resetsAt)}` : ''}</span></div>
      <div class="usage-mini-track"><div class="usage-mini-fill" style="width:${bar.percent}%;background:${sev}"></div></div>`;
    usageMiniBodyEl.appendChild(row);
  }
}

function formatReset(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (isNaN(ms)) return '';
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}
usageRefreshBtn.addEventListener('click', loadUsage);

async function loadMe() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    const email = data.email || 'unknown';
    userEmailEl.textContent = email;
    userAvatarEl.textContent = (email[0] || '?').toUpperCase();
  } catch {
    userEmailEl.textContent = '';
  }
}

async function restoreActiveTasks() {
  try {
    const res = await fetch('/api/active-tasks');
    const list = await res.json();
    if (!res.ok || !Array.isArray(list)) return;
    for (const snap of list) {
      if (activeTasks.has(snap.ticketKey)) continue;
      const state = {
        taskId: snap.id, ticketKey: snap.ticketKey, es: null, snap,
        seenLogCount: 0, doneHandled: false, planUsageLoaded: snap.status === 'awaiting-approval',
      };
      activeTasks.set(snap.ticketKey, state);
      subscribeToTask(state);
    }
    renderBoard();
  } catch {
    /* not fatal */
  }
}

// ================= Doctor / setup status ====================================

async function loadDoctor() {
  try {
    const res = await fetch('/api/doctor');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Setup check failed');
    currentDoctor = data;
    renderDoctor(data);
  } catch (err) {
    doctorBodyEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

function renderDoctor(data) {
  const checks = data.checks || [];
  doctorBodyEl.innerHTML = '';
  for (const c of checks) {
    const row = document.createElement('div');
    row.className = `doctor-row doctor-${c.status}`;
    const dot = document.createElement('span');
    dot.className = 'doctor-dot';
    dot.innerHTML =
      c.status === 'ok'
        ? '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
        : '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 8v5"/><circle cx="12" cy="16.5" r="0.8" fill="currentColor"/></svg>';
    const text = document.createElement('div');
    text.className = 'doctor-text';
    const label = document.createElement('div');
    label.className = 'doctor-label';
    label.innerHTML = `<span class="doctor-name">${escapeHtml(c.label)}:</span> ${escapeHtml(c.message)}`;
    text.appendChild(label);
    if (c.fix) {
      const fix = document.createElement('div');
      fix.className = 'doctor-fix';
      fix.textContent = c.fix;
      text.appendChild(fix);
    }
    row.appendChild(dot);
    row.appendChild(text);
    doctorBodyEl.appendChild(row);
  }
  setupNavDotEl.classList.toggle('hidden', !data.hasBlocking && !data.coreIncomplete);
  renderSetupBanner(data);
}

function renderSetupBanner(data) {
  if (data.hasBlocking) {
    const blockers = (data.checks || []).filter((c) => c.status === 'fail').map((c) => c.label);
    setupBannerTextEl.textContent = `Setup incomplete — fix ${blockers.join(' and ')} in Settings before anything can run.`;
    setupBannerEl.classList.remove('hidden');
  } else if (data.coreIncomplete) {
    setupBannerTextEl.textContent = 'Finish setup in Settings — connect Jira and pick a project to see your tickets.';
    setupBannerEl.classList.remove('hidden');
  } else {
    setupBannerEl.classList.add('hidden');
  }
}
doctorRefreshBtn.addEventListener('click', loadDoctor);
setupBannerBtnEl.addEventListener('click', () => showPage('settings'));

// ================= Routing =================================================

function showPage(page) {
  route = page;
  for (const [id, el] of Object.entries(pages)) el.classList.toggle('hidden', id !== page);
  for (const [id, btn] of Object.entries(navItems)) {
    btn.classList.toggle('active', id === page);
    if (id === page) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  bottomTabs.forEach((btn) => {
    const isActive = btn.dataset.page === page || (btn.dataset.page === 'board' && page === 'run');
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  const el = pages[page];
  el.classList.remove('page-enter');
  void el.offsetWidth;
  el.classList.add('page-enter');

  if (page === 'settings') {
    loadUsage();
    loadWorktrees();
    loadDoctor();
  } else if (page === 'runs') {
    renderRunsPage();
  } else if (page === 'worktrees') {
    loadWorktreesPage();
  } else if (page === 'run' && !displayedTaskId && !displayedHistoryId) {
    // Landed on the Run nav item with nothing specific open: show the most
    // recently active in-flight task, if any, else send them back to the board.
    const inFlight = [...activeTasks.values()].find((s) => s.snap && !isTerminal(s.snap.status));
    if (inFlight) openRunForTask(inFlight);
    else showPage('board');
  }
}

for (const [id, btn] of Object.entries(navItems)) {
  btn.addEventListener('click', () => {
    if (id === 'run') showPage('run');
    else showPage(id);
  });
}
bottomTabs.forEach((btn) => btn.addEventListener('click', () => showPage(btn.dataset.page)));
runBackBtn.addEventListener('click', () => showPage('board'));

// ================= Board ====================================================

function matchesQuery(key, q) {
  if (!q) return true;
  const t = ticketsByKey.get(key);
  const state = activeTasks.get(key);
  const rec = implByKey.get(key);
  const summary = (t && t.summary) || (state && state.snap && state.snap.ticketSummary) || (rec && rec.ticketSummary) || '';
  const type = (t && t.type) || '';
  return `${key} ${summary} ${type}`.toLowerCase().includes(q.toLowerCase());
}

function summaryFor(key) {
  const t = ticketsByKey.get(key);
  const state = activeTasks.get(key);
  const rec = implByKey.get(key);
  return (t && t.summary) || (state && state.snap && state.snap.ticketSummary) || (rec && rec.ticketSummary) || key;
}
function typeFor(key) {
  const t = ticketsByKey.get(key);
  return (t && t.type) || 'Task';
}
function branchFor(key) {
  const state = activeTasks.get(key);
  if (state && state.snap && state.snap.branch) return state.snap.branch;
  const rec = implByKey.get(key);
  return (rec && rec.branch) || '';
}
function progressFor(key) {
  const state = activeTasks.get(key);
  if (state && state.snap && state.snap.maxTurns) {
    return Math.min(100, Math.round((state.snap.numTurns / state.snap.maxTurns) * 100));
  }
  return 0;
}
function ageFor(key) {
  const state = activeTasks.get(key);
  if (state && state.snap) return timeAgo(new Date(state.snap.startedAt).toISOString());
  const t = ticketsByKey.get(key);
  if (t && t.updated) return timeAgo(t.updated);
  const rec = implByKey.get(key);
  if (rec && rec.finishedAt) return timeAgo(new Date(rec.finishedAt).toISOString());
  return '';
}

function renderBoard() {
  ticketsByKey = new Map(tickets.map((t) => [t.key, t]));
  const keys = new Set();
  for (const t of tickets) keys.add(t.key);
  for (const k of activeTasks.keys()) keys.add(k);
  for (const k of implByKey.keys()) keys.add(k);

  const cols = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  for (const key of keys) cols[columnForKey(key)].push(key);

  navCountBoard.textContent = String(tickets.length || '');
  const inFlightCount = [...activeTasks.values()].filter((s) => s.snap && !isTerminal(s.snap.status)).length;
  navCountInflight.textContent = inFlightCount ? String(inFlightCount) : '';

  const waiting = cols.approval.length;
  boardSubEl.textContent = ticketsError
    ? `Could not load Jira tickets: ${ticketsError}`
    : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} assigned to you · ${inFlightCount} run${inFlightCount === 1 ? '' : 's'} in flight` +
      (waiting ? ` · ${waiting} plan${waiting === 1 ? '' : 's'} waiting on you` : '');

  if (boardView === 'list') {
    boardListEl.classList.remove('hidden');
    boardLanesEl.classList.add('hidden');
    renderBoardList(cols);
  } else {
    boardListEl.classList.add('hidden');
    boardLanesEl.classList.remove('hidden');
    renderBoardLanes(cols);
  }
}

function rowCard(key) {
  const meta = statusMetaForKey(key);
  const card = document.createElement('div');
  card.className = 'row-card';
  card.dataset.key = key;
  const branch = branchFor(key);
  const progress = progressFor(key);
  card.innerHTML = `
    <span class="row-dot" style="background:${dotFor(typeFor(key))}"></span>
    <span class="row-key">${escapeHtml(key)}</span>
    <span class="row-title">${escapeHtml(summaryFor(key))}</span>
    ${branch ? `<span class="row-branch">${escapeHtml(branch)}</span>` : ''}
    ${progress ? `<span class="row-progress" title="turn budget"><span class="row-progress-fill" style="width:${progress}%"></span></span>` : ''}
    ${meta ? `<span class="pill ${meta[1]}${meta[1] === 'pill-running' ? ' pulse' : ''}">${escapeHtml(meta[0])}</span>` : ''}
    <span class="row-age">${escapeHtml(ageFor(key))}</span>
  `;
  makeClickableRow(card, () => openTicket(key));
  return card;
}

const GROUPS = [
  { cols: ['approval'], title: 'Waiting on you', tone: 'var(--gold)', note: 'a plan needs a yes or no' },
  { cols: ['drafting', 'implementing'], title: 'In flight', tone: 'var(--accent)', note: 'running in their own worktrees' },
  { cols: ['todo'], title: 'Assigned to you', tone: 'var(--text-ghost)', note: 'from Jira, newest first' },
  { cols: ['done'], title: 'Landed, not committed', tone: 'var(--sage)', note: 'review the diff and commit yourself' },
];

function renderBoardList(cols) {
  boardListEl.innerHTML = '';
  if (ticketsError) {
    const banner = document.createElement('div');
    banner.className = 'board-error';
    banner.textContent = `Could not load Jira tickets: ${ticketsError}`;
    boardListEl.appendChild(banner);
  }
  let any = false;
  for (const g of GROUPS) {
    const keys = g.cols.flatMap((c) => cols[c]);
    if (!keys.length) continue;
    any = true;
    const section = document.createElement('section');
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `<span class="group-dot" style="background:${g.tone}"></span><h2 class="group-title">${g.title}</h2><span class="group-count">${keys.length}</span><span class="group-rule"></span><span class="group-note">${g.note}</span>`;
    const rows = document.createElement('div');
    rows.className = 'rows';
    keys.forEach((k) => rows.appendChild(rowCard(k)));
    section.appendChild(head);
    section.appendChild(rows);
    boardListEl.appendChild(section);
  }
  if (!any) {
    const section = document.createElement('section');
    section.innerHTML = `
      <div class="group-head"><span class="group-dot" style="background:var(--text-whisper)"></span><h2 class="group-title">Nothing here</h2><span class="group-rule"></span></div>
      <div class="empty-queue">
        <span class="empty-queue-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
        <div class="empty-queue-text"><span class="empty-queue-title">Your queue is clear</span><span class="empty-queue-body">Anything newly assigned in Jira shows up here within a minute of refreshing.</span></div>
      </div>`;
    boardListEl.appendChild(section);
  }
}

const LANES = [
  { col: 'todo', title: 'To do', tone: 'var(--text-ghost)' },
  { col: 'approval', title: 'Needs approval', tone: 'var(--gold)' },
  { col: 'implementing', title: 'Implementing', tone: 'var(--accent)', extra: 'drafting' },
  { col: 'done', title: 'Landed', tone: 'var(--sage)' },
];

function renderBoardLanes(cols) {
  boardLanesEl.innerHTML = '';
  for (const lane of LANES) {
    const keys = [...cols[lane.col], ...(lane.extra ? cols[lane.extra] : [])];
    const laneEl = document.createElement('div');
    laneEl.className = 'lane';
    const head = document.createElement('div');
    head.className = 'lane-head';
    head.innerHTML = `<span class="group-dot" style="background:${lane.tone}"></span><span class="group-title">${lane.title}</span><span class="group-count">${keys.length}</span>`;
    const cardsEl = document.createElement('div');
    cardsEl.className = 'lane-cards';
    if (!keys.length) cardsEl.innerHTML = '<p class="col-empty">Nothing here</p>';
    for (const key of keys) {
      const meta = statusMetaForKey(key);
      const card = document.createElement('div');
      card.className = 'lane-card';
      card.innerHTML = `
        <div class="lane-card-top">
          <span class="row-dot" style="background:${dotFor(typeFor(key))}"></span>
          <span class="row-key">${escapeHtml(key)}</span>
          <span style="flex:1"></span>
          <span class="row-age">${escapeHtml(ageFor(key))}</span>
        </div>
        <span class="lane-card-title">${escapeHtml(summaryFor(key))}</span>
        ${meta ? `<span class="pill ${meta[1]}${meta[1] === 'pill-running' ? ' pulse' : ''}" style="align-self:flex-start">${escapeHtml(meta[0])}</span>` : ''}
      `;
      makeClickableRow(card, () => openTicket(key));
      cardsEl.appendChild(card);
    }
    laneEl.appendChild(head);
    laneEl.appendChild(cardsEl);
    boardLanesEl.appendChild(laneEl);
  }
}

function setBoardView(view) {
  boardView = view;
  localStorage.setItem(BOARD_VIEW_KEY, view);
  boardViewListBtn.classList.toggle('active', view === 'list');
  boardViewListBtn.setAttribute('aria-pressed', String(view === 'list'));
  boardViewLanesBtn.classList.toggle('active', view === 'lanes');
  boardViewLanesBtn.setAttribute('aria-pressed', String(view === 'lanes'));
  renderBoard();
}
boardViewListBtn.addEventListener('click', () => setBoardView('list'));
boardViewLanesBtn.addEventListener('click', () => setBoardView('lanes'));
setBoardView(boardView);

refreshBtn.addEventListener('click', loadTickets);
boardStartBtn.addEventListener('click', () => openPalette(''));

function refreshBoardIfColumnChanged(state) {
  const col = columnForKey(state.ticketKey);
  if (col !== state.lastColumn) {
    state.lastColumn = col;
    renderBoard();
  }
}

// Route a card to the right destination: a live task -> the Run page, a saved
// record -> the Run page in "history" mode, otherwise -> the ticket drawer.
function openTicket(key) {
  const state = activeTasks.get(key);
  if (state) {
    openRunForTask(state);
    return;
  }
  if (implByKey.has(key)) {
    openRunForHistory(implByKey.get(key).id);
    return;
  }
  openDrawer(key);
}

// ================= Ticket drawer ============================================

async function openDrawer(key) {
  activeTicket = { key };
  drawerKeyEl.textContent = key;
  drawerTitleEl.textContent = 'Loading…';
  drawerDescriptionEl.textContent = '';
  drawerLinkedSectionEl.classList.add('hidden');
  referenceFiles = [];
  renderRefChips();
  refInput.value = '';
  hideRefSuggest();
  drawerStartBtn.disabled = false;
  drawerStartBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z"/></svg> Draft a plan';

  drawerBackdropEl.classList.remove('hidden');
  drawerEl.classList.remove('hidden');
  requestAnimationFrame(() => drawerEl.classList.add('open'));

  const res = await fetch(`/api/tickets/${encodeURIComponent(key)}`);
  const ticket = await res.json();
  if (!res.ok) {
    drawerTitleEl.textContent = ticket.error || 'Failed to load ticket';
    return;
  }
  activeTicket = ticket;
  drawerTypeEl.textContent = ticket.type;
  drawerPriorityEl.textContent = ticket.priority || '';
  drawerPriorityEl.style.display = ticket.priority ? 'inline-block' : 'none';
  drawerTitleEl.textContent = ticket.summary;
  drawerDescriptionEl.textContent = ticket.description || '(No description provided.)';

  const linked = [
    ...(ticket.parent ? [{ rel: 'parent', key: ticket.parent.key, title: ticket.parent.summary }] : []),
    ...(ticket.links || []).map((l) => ({ rel: l.type, key: l.key, title: l.summary })),
  ];
  if (linked.length) {
    drawerLinkedEl.innerHTML = '';
    for (const l of linked) {
      const row = document.createElement('div');
      row.className = 'drawer-linked-row';
      row.innerHTML = `<span class="drawer-linked-rel">${escapeHtml(l.rel)}</span><span class="drawer-linked-key">${escapeHtml(l.key)}</span><span class="drawer-linked-title">${escapeHtml(l.title)}</span>`;
      drawerLinkedEl.appendChild(row);
    }
    drawerLinkedSectionEl.classList.remove('hidden');
  }
}

function closeDrawer() {
  drawerEl.classList.remove('open');
  setTimeout(() => {
    drawerEl.classList.add('hidden');
    drawerBackdropEl.classList.add('hidden');
  }, 220);
}
drawerCloseBtn.addEventListener('click', closeDrawer);
drawerBackdropEl.addEventListener('click', closeDrawer);

function renderRefChips() {
  refChipsEl.innerHTML = '';
  for (const f of referenceFiles) {
    const chip = document.createElement('span');
    chip.className = 'ref-chip';
    chip.innerHTML = `<span class="ref-chip-name">${escapeHtml(f)}</span>`;
    const x = document.createElement('button');
    x.className = 'ref-chip-x';
    x.type = 'button';
    x.setAttribute('aria-label', `Remove ${f}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      referenceFiles = referenceFiles.filter((r) => r !== f);
      renderRefChips();
    });
    chip.appendChild(x);
    refChipsEl.appendChild(chip);
  }
}

function hideRefSuggest() {
  refSuggestEl.classList.add('hidden');
  refSuggestEl.innerHTML = '';
}
let refSearchTimer = null;
refInput.addEventListener('input', () => {
  clearTimeout(refSearchTimer);
  const q = refInput.value.trim();
  refSearchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/repo-files?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const matches = (data.files || []).filter((f) => !referenceFiles.includes(f)).slice(0, 12);
      if (!matches.length) {
        refSuggestEl.innerHTML = '<div class="ref-suggest-empty">No matching files</div>';
        refSuggestEl.classList.remove('hidden');
        return;
      }
      refSuggestEl.innerHTML = '';
      for (const f of matches) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ref-suggest-item';
        item.textContent = f;
        item.addEventListener('click', () => {
          if (!referenceFiles.includes(f)) referenceFiles.push(f);
          renderRefChips();
          refInput.value = '';
          hideRefSuggest();
          refInput.focus();
        });
        refSuggestEl.appendChild(item);
      }
      refSuggestEl.classList.remove('hidden');
    } catch {
      hideRefSuggest();
    }
  }, 160);
});
refInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideRefSuggest(); });
document.addEventListener('click', (e) => {
  if (!refSuggestEl.contains(e.target) && e.target !== refInput) hideRefSuggest();
});

drawerStartBtn.addEventListener('click', async () => {
  if (!activeTicket || !activeTicket.summary) return; // still loading
  drawerStartBtn.disabled = true;
  drawerStartBtn.textContent = 'Drafting plan...';

  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: activeTicket.key, model: modelSelectEl.value, referenceFiles }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to start task');
    drawerStartBtn.disabled = false;
    drawerStartBtn.textContent = 'Draft a plan';
    return;
  }
  const state = { taskId: data.taskId, ticketKey: activeTicket.key, es: null, snap: null, seenLogCount: 0, doneHandled: false, planUsageLoaded: false };
  activeTasks.set(activeTicket.key, state);
  closeDrawer();
  openRunForTask(state);
  subscribeToTask(state);
  renderBoard();
});

// ================= Run page =================================================
//
// Handles a live task (SSE-fed) and a saved history record (fetched once)
// through the same rendering path — the mock treats "plan / live / diff" as
// one component regardless of where the data came from, and so does this.

function openRunForTask(state) {
  displayedTaskId = state.taskId;
  displayedHistoryId = null;
  currentTaskId = state.taskId;
  activeTicket = ticketsByKey.get(state.ticketKey) || { key: state.ticketKey };
  showPage('run');
  paintRun(viewFromLiveState(state));
  if (state.snap) {
    taskStartedAt = state.snap.startedAt;
    if (!isTerminal(state.snap.status)) startElapsedTimer();
    else stopElapsedTimer();
  }
  if (!state.es && state.snap && !isTerminal(state.snap.status)) subscribeToTask(state);
}

async function openRunForHistory(id) {
  displayedHistoryId = id;
  displayedTaskId = null;
  currentTaskId = id;
  stopElapsedTimer();
  showPage('run');
  runLogEl.innerHTML = '<p class="hint">Loading…</p>';
  const res = await fetch(`/api/implementations/${encodeURIComponent(id)}`);
  const rec = await res.json();
  if (!res.ok) {
    runLogEl.innerHTML = `<p class="hint">${escapeHtml(rec.error || 'Failed to load record')}</p>`;
    return;
  }
  activeTicket = ticketsByKey.get(rec.ticketKey) || { key: rec.ticketKey };
  paintRun(viewFromRecord(rec));
}

function viewFromLiveState(state) {
  const snap = state.snap;
  if (!snap) {
    return {
      ticketKey: state.ticketKey, isLive: true, hasSnap: false, status: 'planning', phase: 'plan',
      branch: '', model: '', numTurns: 0, maxTurns: 20, currentActivity: 'Reviewing the ticket...',
      log: [], filesChanged: [], worktreePath: null, plan: null, summary: null, error: null, diffs: [],
    };
  }
  return {
    ticketKey: state.ticketKey, isLive: true, hasSnap: true,
    status: snap.status, phase: snap.phase, branch: snap.branch, model: snap.model,
    numTurns: snap.numTurns, maxTurns: snap.maxTurns, currentActivity: snap.currentActivity,
    log: snap.log || [], filesChanged: snap.filesChanged || [], worktreePath: snap.worktreePath,
    plan: snap.plan, summary: snap.summary, error: snap.error, diffs: [], startedAt: snap.startedAt,
  };
}

function viewFromRecord(rec) {
  return {
    ticketKey: rec.ticketKey, isLive: false, hasSnap: true,
    status: rec.status, phase: 'implement', branch: rec.branch, model: rec.model,
    numTurns: rec.numTurns, maxTurns: rec.numTurns || 1, currentActivity: '',
    log: [], filesChanged: rec.filesChanged || [], worktreePath: rec.worktreePath,
    plan: null, summary: rec.summary, error: rec.error,
    diffs: Array.isArray(rec.diffs) ? rec.diffs : [], diff: rec.diff || '', recordId: rec.id,
  };
}

function paintRun(view) {
  runCrumbKeyEl.textContent = view.ticketKey;
  runTitleEl.textContent = summaryFor(view.ticketKey) !== view.ticketKey ? summaryFor(view.ticketKey) : (activeTicket && activeTicket.summary) || view.ticketKey;
  runBranchChipEl.textContent = view.branch || '';
  runBranchChipEl.classList.toggle('hidden', !view.branch);
  runModelChipEl.textContent = view.model || '';
  runModelChipEl.classList.toggle('hidden', !view.model);

  const [label, cls] = STATUS_META[view.status] || ['Running', 'pill-running'];
  runStatusPillEl.textContent = label;
  runStatusPillEl.className = `pill ${cls}${cls === 'pill-running' ? ' pulse' : ''}`;

  const active = ['planning', 'branching', 'running'].includes(view.status);
  const showProgress = view.isLive && (active || view.status === 'paused' || view.status === 'awaiting-approval');
  runProgressRowEl.classList.toggle('hidden', !showProgress);
  if (showProgress) {
    const max = view.maxTurns || 1;
    runTurnsCountEl.textContent = `${view.numTurns} of ${max} turns`;
    runTicksEl.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const tick = document.createElement('span');
      tick.className = `turn-tick${i < view.numTurns ? ' used' : ''}`;
      runTicksEl.appendChild(tick);
    }
    runActivityRowEl.classList.toggle('hidden', !view.currentActivity);
    runActivityTextEl.textContent = view.currentActivity || '';
  }

  renderRunActions(view);

  // ---- Activity log ----
  runLogCountEl.textContent = view.log.length ? `${view.log.length} events` : '';
  runLogEl.innerHTML = '';
  for (const entry of view.log) appendLogLine(entry);

  // ---- Right pane ----
  runErrorPanelEl.classList.toggle('hidden', view.status !== 'error');
  if (view.status === 'error') runErrorTextEl.textContent = view.error || 'Something went wrong.';

  const showPlan = view.status === 'awaiting-approval';
  const implemented = view.phase === 'implement' && Boolean(view.worktreePath);
  const showDiff = implemented && isTerminal(view.status);
  const showLive = view.phase === 'implement' && !isTerminal(view.status) && !showPlan;

  runPlanPanelEl.classList.toggle('hidden', !showPlan);
  runEditPlanPanelEl.classList.add('hidden');
  if (showPlan) {
    runPaneTitleEl.textContent = 'Proposed plan';
    runPaneMetaEl.textContent = 'nothing written yet';
    runPlanContentEl.innerHTML = renderMarkdown(view.plan || 'No plan was produced.');
    if (!view.planUsageLoaded && view.isLive) loadUsage();
  }

  runLivePanelEl.classList.toggle('hidden', !showLive);
  if (showLive) {
    runPaneTitleEl.textContent = 'Files touched so far';
    runPaneMetaEl.textContent = view.filesChanged.length ? `${view.filesChanged.length} files · diff pending` : 'diff pending';
    runTouchedEl.innerHTML = '';
    for (const line of view.filesChanged) {
      const m = /^(\S+)\s+(.+)$/.exec(line.trim());
      const status = m ? (m[1].includes('?') ? 'created' : m[1].includes('D') ? 'deleted' : 'edited') : 'edited';
      const path = m ? m[2] : line;
      const row = document.createElement('div');
      row.className = 'touched-row';
      row.innerHTML = `<span class="touched-dot" style="background:${status === 'created' ? 'var(--sage)' : status === 'deleted' ? 'var(--danger)' : 'var(--accent)'}"></span><span class="touched-path">${escapeHtml(path)}</span><span class="touched-state">${status}</span>`;
      runTouchedEl.appendChild(row);
    }
  }

  runDiffPanelEl.classList.toggle('hidden', !showDiff);
  if (showDiff) {
    runPaneTitleEl.textContent = view.status === 'done' ? 'Changes made' : view.status === 'stopped' ? 'Stopped' : 'Failed';
    runPaneMetaEl.textContent = '';
    const summaryText = view.status === 'done'
      ? view.summary
      : view.status === 'stopped'
        ? 'Stopped before finishing. Any partial changes are left in this run’s worktree for review.'
        : (view.summary || view.error || 'The run ended with an error.') + '\n\nAny changes it had already made are left in this run’s worktree for review.';
    runDiffSummaryEl.classList.toggle('hidden', !summaryText);
    if (summaryText) runDiffSummaryBodyEl.innerHTML = renderMarkdown(summaryText);
    renderRunIterations(view.diffs);
    if (view.isLive) loadDiffForTask(view.recordId || currentTaskId);
    else renderDiff(view.diff || '', runDiffViewEl, runDiffStatsEl);
    runIteratePanelEl.classList.add('hidden');
  }

  if (isTerminal(view.status) && view.isLive) {
    const state = activeTasks.get(view.ticketKey);
    if (state && !state.doneHandled) {
      state.doneHandled = true;
      loadHistory();
      loadUsage();
    }
  }
}

function renderRunActions(view) {
  runActionsEl.innerHTML = '';
  const add = (label, cls, onClick, iconSvg) => {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.innerHTML = (iconSvg || '') + label;
    btn.addEventListener('click', onClick);
    runActionsEl.appendChild(btn);
    return btn;
  };

  if (!view.isLive) {
    // A saved record: full review action set.
    add('Open in VS Code', 'primary-btn', () => openVscodeForRecord(view.recordId));
    add('Request changes', 'ghost-btn', () => runIteratePanelEl.classList.toggle('hidden'));
    if (view.worktreePath) add('Remove worktree', 'ghost-btn', () => removeWorktreeForRecord(view));
    add('Delete record', 'ghost-btn', () => deleteRecord(view.recordId));
    return;
  }

  if (['planning', 'branching', 'running'].includes(view.status)) {
    add('Pause', 'ghost-btn', () => pauseCurrentTask());
    add('Stop', 'danger-btn', () => stopCurrentTask());
  } else if (view.status === 'paused') {
    add('Continue', 'primary-btn', () => resumeCurrentTask());
    add('Stop', 'danger-btn', () => stopCurrentTask());
  } else if (isTerminal(view.status) && view.phase === 'implement' && view.worktreePath) {
    add('Open in VS Code', 'primary-btn', () => openVscodeForTask(currentTaskId));
    add('Request changes', 'ghost-btn', () => runIteratePanelEl.classList.toggle('hidden'));
  }
}

// ---- Log rendering ----
function appendLogLine(entry) {
  const row = document.createElement('div');
  row.className = 'log-line-row';
  const time = new Date(entry.ts).toLocaleTimeString([], { hour12: false });
  row.innerHTML = `<span class="log-ts">${time}</span><span class="log-text">${escapeHtml(entry.text)}</span>`;
  runLogEl.appendChild(row);
  runLogEl.scrollTop = runLogEl.scrollHeight;
}

// ---- Per-run diff snapshots (history mode) ----
function renderRunIterations(diffs) {
  if (!diffs || diffs.length < 2) {
    runIterationsEl.classList.add('hidden');
    runIterationsEl.innerHTML = '';
    return;
  }
  runIterationsEl.innerHTML = '<div class="drawer-label">Runs on this branch</div>';
  diffs.forEach((snap, i) => {
    const row = document.createElement('details');
    row.className = 'iteration-row';
    const when = snap.at ? new Date(snap.at).toLocaleString() : 'unknown time';
    const summary = document.createElement('summary');
    summary.textContent = `Run ${i + 1} · ${snap.status || 'done'} · ${when}`;
    row.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'iteration-body';
    const stats = document.createElement('span');
    stats.className = 'diff-stats';
    const view = document.createElement('div');
    view.className = 'diff-view';
    body.appendChild(stats);
    body.appendChild(view);
    row.appendChild(body);
    let done = false;
    row.addEventListener('toggle', () => {
      if (!row.open || done) return;
      done = true;
      renderDiff(snap.diff || '', view, stats);
    });
    runIterationsEl.appendChild(row);
  });
  runIterationsEl.classList.remove('hidden');
}

// ---- Task control actions ----
async function pauseCurrentTask() {
  if (!currentTaskId) return;
  await fetch(`/api/tasks/${currentTaskId}/pause`, { method: 'POST' }).catch(() => {});
}
async function resumeCurrentTask() {
  if (!currentTaskId) return;
  const res = await fetch(`/api/tasks/${currentTaskId}/resume`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not resume the task.');
  }
}
async function stopCurrentTask() {
  if (!currentTaskId) return;
  if (!confirm('Stop this task? This cannot be resumed — any partial changes stay in the working tree for review.')) return;
  await fetch(`/api/tasks/${currentTaskId}/stop`, { method: 'POST' }).catch(() => {});
}

runApproveBtn.addEventListener('click', async () => {
  if (!currentTaskId) return;
  runApproveBtn.disabled = true;
  runDiscardBtn.disabled = true;
  runApproveBtn.textContent = 'Starting...';
  const res = await fetch(`/api/tasks/${currentTaskId}/approve`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not start implementation');
    runApproveBtn.disabled = false;
    runDiscardBtn.disabled = false;
    runApproveBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Approve &amp; implement';
    return;
  }
  runPlanPanelEl.classList.add('hidden');
});

runDiscardBtn.addEventListener('click', async () => {
  if (!currentTaskId) return;
  runDiscardBtn.disabled = true;
  const state = findTaskById(currentTaskId);
  await fetch(`/api/tasks/${currentTaskId}/cancel`, { method: 'POST' }).catch(() => {});
  if (state) {
    if (state.es) state.es.close();
    activeTasks.delete(state.ticketKey);
  }
  displayedTaskId = null;
  runDiscardBtn.disabled = false;
  showPage('board');
  renderBoard();
});

runEditPlanBtn.addEventListener('click', () => {
  runEditPlanPanelEl.classList.toggle('hidden');
  if (!runEditPlanPanelEl.classList.contains('hidden')) runEditPlanInputEl.focus();
});
runEditPlanCancelBtn.addEventListener('click', () => runEditPlanPanelEl.classList.add('hidden'));
runEditPlanSendBtn.addEventListener('click', async () => {
  if (!currentTaskId) return;
  const feedback = runEditPlanInputEl.value.trim();
  if (!feedback) { runEditPlanInputEl.focus(); return; }
  runEditPlanSendBtn.disabled = true;
  runEditPlanSendBtn.textContent = 'Sending…';
  const res = await fetch(`/api/tasks/${currentTaskId}/revise-plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }),
  });
  runEditPlanSendBtn.disabled = false;
  runEditPlanSendBtn.textContent = 'Send to Claude';
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not revise the plan.');
    return;
  }
  runEditPlanInputEl.value = '';
  runEditPlanPanelEl.classList.add('hidden');
  runPlanPanelEl.classList.add('hidden');
  showToast('Redrafting the plan with your feedback…');
});

// ---- Iterate on a finished run ----
runIterateCancelBtn.addEventListener('click', () => runIteratePanelEl.classList.add('hidden'));
runIterateSendBtn.addEventListener('click', async () => {
  if (!currentTaskId) return;
  const feedback = runIterateInputEl.value.trim();
  if (!feedback) { runIterateInputEl.focus(); return; }
  runIterateSendBtn.disabled = true;
  runIterateSendBtn.textContent = 'Sending…';
  const res = await fetch(`/api/tasks/${currentTaskId}/iterate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }),
  });
  runIterateSendBtn.disabled = false;
  runIterateSendBtn.textContent = 'Send to Claude';
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not start iteration.');
    return;
  }
  const snap = await res.json();
  runIterateInputEl.value = '';
  runIteratePanelEl.classList.add('hidden');
  const state = { taskId: snap.id, ticketKey: snap.ticketKey, es: null, snap, seenLogCount: 0, doneHandled: false, planUsageLoaded: true };
  activeTasks.set(snap.ticketKey, state);
  openRunForTask(state);
  subscribeToTask(state);
});

async function openVscodeForTask(taskId) {
  await fetch(`/api/tasks/${taskId}/open-vscode`, { method: 'POST' }).catch(() => {});
  showToast('Opened the worktree in VS Code');
}
async function openVscodeForRecord(id) {
  const res = await fetch(`/api/implementations/${encodeURIComponent(id)}/open-vscode`, { method: 'POST' }).catch(() => null);
  if (res && !res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not open VS Code.');
    return;
  }
  showToast('Opened the worktree in VS Code');
}
async function removeWorktreeForRecord(view) {
  if (!confirm(`Remove the worktree at ${view.worktreePath}?\n\nThe branch and its commits stay in the repo — only this extra checkout is removed.`)) return;
  const removed = await removeWorktree(view.worktreePath);
  if (removed) showToast('Worktree removed');
}
async function deleteRecord(id) {
  if (!confirm('Delete this run record? This only removes the saved history — the branch and its worktree stay on disk.')) return;
  const res = await fetch(`/api/implementations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.ok) {
    showPage('board');
    loadHistory();
  }
}

// ================= Diff rendering (shared by Run page + Runs iterations) ===

async function loadDiffForTask(taskId) {
  runDiffStatsEl.textContent = '';
  runDiffViewEl.innerHTML = '<p class="hint">Loading diff…</p>';
  try {
    const res = await fetch(`/api/tasks/${taskId}/diff`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load diff');
    renderDiff(data.diff || '', runDiffViewEl, runDiffStatsEl);
  } catch (err) {
    runDiffViewEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

const DIFF_LINES_PER_FILE = 600;
const DIFF_FILES_COLLAPSED_ABOVE = 15;

function renderDiff(diffText, viewEl, statsEl) {
  const files = parseDiff(diffText);
  if (files.length === 0) {
    viewEl.innerHTML = '<p class="hint">No file changes recorded.</p>';
    statsEl.textContent = '';
    return;
  }
  let totalAdd = 0, totalDel = 0;
  for (const f of files) { totalAdd += f.additions; totalDel += f.deletions; }
  statsEl.innerHTML = `${files.length} file${files.length === 1 ? '' : 's'} changed <span class="add">+${totalAdd}</span> <span class="del">-${totalDel}</span>`;
  const startCollapsed = files.length > DIFF_FILES_COLLAPSED_ABOVE;
  viewEl.innerHTML = '';
  for (const file of files) viewEl.appendChild(renderFile(file, startCollapsed));
}

function buildFileTable(file, limit) {
  const table = document.createElement('table');
  table.className = 'diff-table';
  const tbody = document.createElement('tbody');
  let rendered = 0, truncated = false;
  for (const hunk of file.hunks) {
    if (rendered >= limit) { truncated = true; break; }
    const hr = document.createElement('tr');
    hr.className = 'diff-hunk-row';
    hr.innerHTML = `<td class="ln" colspan="2"></td><td class="diff-code diff-hunk">${escapeHtml(hunk.header)}</td>`;
    tbody.appendChild(hr);
    for (const line of hunk.lines) {
      if (rendered >= limit) { truncated = true; break; }
      const tr = document.createElement('tr');
      tr.className = `diff-line diff-${line.type}`;
      const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
      tr.innerHTML = `<td class="ln ln-old">${line.oldNo ?? ''}</td><td class="ln ln-new">${line.newNo ?? ''}</td><td class="diff-code"><span class="sign">${sign}</span>${escapeHtml(line.text)}</td>`;
      tbody.appendChild(tr);
      rendered++;
    }
  }
  table.appendChild(tbody);
  return { table, truncated };
}
function totalLines(file) { return file.hunks.reduce((n, h) => n + h.lines.length, 0); }

function renderFile(file, startCollapsed = false) {
  const wrap = document.createElement('div');
  wrap.className = 'diff-file';
  if (startCollapsed) wrap.classList.add('collapsed');
  const header = document.createElement('button');
  header.className = 'diff-file-header';
  header.innerHTML = `
    <span class="chevron">▾</span>
    <span class="diff-badge badge-${file.changeType}">${file.changeType}</span>
    <span class="diff-path">${escapeHtml(file.displayPath)}</span>
    <span class="diff-file-stats"><span class="add">+${file.additions}</span><span class="del">-${file.deletions}</span></span>`;
  const body = document.createElement('div');
  body.className = 'diff-file-body';
  let filled = false;
  const fill = (limit) => {
    body.innerHTML = '';
    if (file.binary) { body.innerHTML = '<p class="diff-note">Binary file — not shown.</p>'; return; }
    if (file.hunks.length === 0) { body.innerHTML = '<p class="diff-note">No textual changes (mode or rename only).</p>'; return; }
    const { table, truncated } = buildFileTable(file, limit);
    body.appendChild(table);
    if (truncated) {
      const note = document.createElement('button');
      note.type = 'button';
      note.className = 'diff-more-btn';
      note.textContent = `Show all ${totalLines(file)} lines`;
      note.addEventListener('click', () => fill(Infinity));
      body.appendChild(note);
    }
  };
  const ensureFilled = () => { if (!filled) { filled = true; fill(DIFF_LINES_PER_FILE); } };
  if (!startCollapsed) ensureFilled();
  header.addEventListener('click', () => {
    wrap.classList.toggle('collapsed');
    if (!wrap.classList.contains('collapsed')) ensureFilled();
  });
  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

// ================= SSE ======================================================

let taskStartedAt = null;
const MAX_CLIENT_LOG = 1500;

function subscribeToTask(state) {
  const evtSource = new EventSource(`/api/tasks/${state.taskId}/stream`);
  state.es = evtSource;

  evtSource.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.kind === 'log') {
      const log = state.snap ? state.snap.log : null;
      if (log) {
        log.push(msg.entry);
        if (log.length > MAX_CLIENT_LOG) log.splice(0, log.length - MAX_CLIENT_LOG);
      }
      if (isOnScreen(state)) {
        appendLogLine(msg.entry);
        runLogCountEl.textContent = state.snap ? `${state.snap.log.length} events` : '';
      }
      return;
    }

    const prevStatus = state.snap ? state.snap.status : null;
    if (msg.kind === 'snapshot') state.snap = { ...msg.task, log: Array.isArray(msg.task.log) ? msg.task.log : [] };
    else state.snap = { ...msg.task, log: state.snap ? state.snap.log : [] };
    const snap = state.snap;

    refreshBoardIfColumnChanged(state);
    maybeNotify(state, prevStatus, snap);

    const onScreen = isOnScreen(state);
    if (onScreen) {
      if (!taskStartedAt) { taskStartedAt = snap.startedAt; startElapsedTimer(); }
      paintRun(viewFromLiveState(state));
      if (isTerminal(snap.status)) stopElapsedTimer();
    }

    if (isTerminal(snap.status)) {
      evtSource.close();
      state.es = null;
      if (!onScreen) {
        activeTasks.delete(state.ticketKey);
        renderBoard();
        if (!state.doneHandled) {
          state.doneHandled = true;
          loadHistory();
          loadUsage();
        }
      }
    }
  };

  evtSource.onerror = () => {
    /* the browser retries automatically; a fresh snapshot follows on reconnect */
  };
}

function isOnScreen(state) {
  return displayedTaskId === state.taskId && route === 'run';
}
function findTaskById(taskId) {
  for (const state of activeTasks.values()) if (state.taskId === taskId) return state;
  return null;
}

function renderElapsed() {
  if (!taskStartedAt) return;
  const secs = Math.floor((Date.now() - taskStartedAt) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  runElapsedEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
}
function startElapsedTimer() {
  stopElapsedTimer();
  renderElapsed();
  elapsedTimer = setInterval(renderElapsed, 1000);
}
function stopElapsedTimer() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

// ================= Desktop notifications ====================================

const NOTIFY_STATUSES = new Set(['awaiting-approval', 'done', 'error', 'stopped']);
function notifTitleFor(status) {
  switch (status) {
    case 'awaiting-approval': return 'Plan ready for review';
    case 'done': return 'Implementation finished';
    case 'error': return 'Task failed';
    case 'stopped': return 'Task stopped';
    default: return 'Graft';
  }
}
function maybeNotify(state, prevStatus, snap) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (prevStatus === snap.status || !NOTIFY_STATUSES.has(snap.status)) return;
  const onScreen = isOnScreen(state) && document.hasFocus();
  if (onScreen) return;
  const n = new Notification(notifTitleFor(snap.status), { body: `${state.ticketKey}${snap.branch ? ` · ${snap.branch}` : ''}`, tag: `graft-${state.taskId}` });
  n.onclick = () => { window.focus(); openTicket(state.ticketKey); n.close(); };
}

function renderNotifStatus() {
  const supported = 'Notification' in window;
  const perm = supported ? Notification.permission : 'denied';
  const on = supported && perm === 'granted';
  setToggleOn(notifToggleBtn, on);
  notifToggleBtn.disabled = perm === 'denied' && supported;
  if (!supported) { notifStatusNoteEl.textContent = 'Not supported in this browser.'; notifStatusNoteEl.classList.remove('hidden'); }
  else if (perm === 'denied') { notifStatusNoteEl.textContent = 'Blocked — allow notifications for this site in your browser settings.'; notifStatusNoteEl.classList.remove('hidden'); }
  else notifStatusNoteEl.classList.add('hidden');
}
notifToggleBtn.addEventListener('click', async () => {
  if (!('Notification' in window) || Notification.permission === 'denied') return;
  if (Notification.permission !== 'granted') await Notification.requestPermission();
  renderNotifStatus();
});

// ================= Runs history page ========================================

let runsFilter = 'all';
runsFiltersEl.addEventListener('click', (e) => {
  const el = e.target.closest('.runs-filter');
  if (!el) return;
  runsFilter = el.dataset.filter;
  [...runsFiltersEl.children].forEach((c) => {
    c.classList.toggle('active', c === el);
    c.setAttribute('aria-pressed', String(c === el));
  });
  renderRunsPage();
});

function renderRunsPage() {
  navCountRuns.textContent = allRuns.length ? String(allRuns.length) : '';
  const rows = runsFilter === 'all' ? allRuns : allRuns.filter((r) => r.status === runsFilter);
  runsTableBodyEl.innerHTML = '';
  if (!rows.length) {
    runsTableBodyEl.innerHTML = '<div class="runs-empty">No runs recorded yet.</div>';
    return;
  }
  for (const r of rows) {
    const [label, cls] = STATUS_META[r.status] || ['Done', 'pill-done'];
    const row = document.createElement('div');
    row.className = 'runs-table-row';
    row.innerHTML = `
      <span class="rt-key">${escapeHtml(r.ticketKey)}</span>
      <span class="rt-title">${escapeHtml(r.ticketSummary || r.ticketKey)}</span>
      <span class="rt-branch">${escapeHtml(r.branch || '')}</span>
      <span class="rt-changes">${r.fileCount ? `${r.fileCount} files` : ''}</span>
      <span class="rt-turns">${r.numTurns || ''}</span>
      <span class="rt-when">${r.finishedAt ? timeAgo(new Date(r.finishedAt).toISOString()) : ''}</span>
      <span class="rt-result"><span class="pill ${cls}">${escapeHtml(label)}</span></span>`;
    makeClickableRow(row, () => openRunForHistory(r.id));
    runsTableBodyEl.appendChild(row);
  }
}

// ================= Worktrees page ===========================================

const selectedWorktrees = new Set();

async function loadWorktreesPage() {
  wtPageBodyEl.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const res = await fetch('/api/worktrees');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not list worktrees');
    navCountWorktrees.textContent = (data.worktrees || []).length ? String(data.worktrees.length) : '';
    renderWorktreesPage(data.worktrees || []);
  } catch (err) {
    wtPageBodyEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

function renderWorktreesPage(list) {
  selectedWorktrees.clear();
  updateWtToolbar();
  if (!list.length) {
    wtPageBodyEl.innerHTML = '<p class="hint">No worktrees yet — one is created when you approve a plan.</p>';
    return;
  }
  wtPageBodyEl.innerHTML = '';
  for (const wt of list) {
    const row = document.createElement('div');
    row.className = 'wt-page-row';
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'wt-checkbox';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', 'false');
    box.setAttribute('aria-label', 'Select worktree');
    box.addEventListener('click', () => {
      if (selectedWorktrees.has(wt.path)) selectedWorktrees.delete(wt.path);
      else selectedWorktrees.add(wt.path);
      const checked = box.classList.toggle('checked');
      box.setAttribute('aria-checked', String(checked));
      updateWtToolbar();
    });
    const info = document.createElement('div');
    info.className = 'wt-page-info';
    info.innerHTML = `
      <div class="wt-page-top">
        <span class="wt-page-branch">${escapeHtml(wt.branch || '(detached)')}</span>
        ${wt.merged ? `<span class="pill pill-done">Merged</span>` : ''}
        ${wt.merged ? `<span class="wt-page-note">safe to remove</span>` : ''}
      </div>
      <span class="wt-page-path">${escapeHtml(wt.path)}</span>`;
    const actions = document.createElement('div');
    actions.className = 'wt-page-actions';
    const openBtn = document.createElement('button');
    openBtn.className = 'ghost-btn';
    openBtn.textContent = 'Open in VS Code';
    openBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      showToast('Opened that worktree in VS Code');
      await fetch('/api/open-vscode', { method: 'POST' }).catch(() => {});
    });
    const removeBtn = document.createElement('button');
    removeBtn.className = 'ghost-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      await removeWorktree(wt.path);
      removeBtn.disabled = false;
    });
    actions.appendChild(openBtn);
    actions.appendChild(removeBtn);
    row.appendChild(box);
    row.appendChild(info);
    row.appendChild(actions);
    wtPageBodyEl.appendChild(row);
  }
}

function updateWtToolbar() {
  wtSelectedCountEl.textContent = selectedWorktrees.size ? `${selectedWorktrees.size} selected` : '';
  wtRemoveSelectedBtn.classList.toggle('hidden', selectedWorktrees.size === 0);
}
wtRemoveSelectedBtn.addEventListener('click', async () => {
  if (!selectedWorktrees.size) return;
  if (!confirm(`Remove ${selectedWorktrees.size} worktree(s)? Branches and commits stay in the repo.`)) return;
  for (const path of [...selectedWorktrees]) await removeWorktree(path);
  loadWorktreesPage();
});

// Shared by the Run page (history mode), Settings, and the Worktrees page.
async function removeWorktree(worktreePath) {
  const url = `/api/worktrees?path=${encodeURIComponent(worktreePath)}`;
  let res = await fetch(url, { method: 'DELETE' });
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    if (!confirm(`${data.error || 'That worktree has uncommitted changes.'}\n\nDiscard those changes and remove it anyway?`)) return false;
    res = await fetch(`${url}&force=1`, { method: 'DELETE' });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not remove that worktree.');
    return false;
  }
  if (route === 'worktrees') loadWorktreesPage();
  return true;
}
// loadWorktrees(): kept for Settings, which no longer shows the full list but
// still needs the count/refresh plumbing available elsewhere.
async function loadWorktrees() {
  try {
    const res = await fetch('/api/worktrees');
    const data = await res.json();
    if (res.ok) navCountWorktrees.textContent = (data.worktrees || []).length ? String(data.worktrees.length) : '';
  } catch {
    /* ignore */
  }
}

// ================= Command palette ==========================================

function buildPaletteIndex() {
  const groups = [];
  const approvalKeys = [...activeTasks.entries()].filter(([, s]) => s.snap && s.snap.status === 'awaiting-approval');
  if (approvalKeys.length) {
    groups.push({
      title: 'Waiting on you',
      items: approvalKeys.map(([key]) => ({ label: `Approve the plan for ${key} — ${summaryFor(key)}`, meta: 'plan ready', go: () => openTicket(key) })),
    });
  }
  const ticketItems = tickets.map((t) => ({
    label: `${t.key} · ${t.summary}`,
    meta: (statusMetaForKey(t.key) || [])[0] || t.type,
    go: () => openTicket(t.key),
    q: `${t.key} ${t.summary}`.toLowerCase(),
  }));
  groups.push({ title: 'Tickets', items: ticketItems });
  groups.push({
    title: 'Commands',
    items: [
      { label: 'Go to Board', go: () => showPage('board'), q: 'board' },
      { label: 'Go to Runs', go: () => showPage('runs'), q: 'runs history' },
      { label: 'Go to Worktrees', go: () => showPage('worktrees'), q: 'worktrees' },
      { label: 'Re-check setup', go: () => showPage('settings'), q: 'settings setup doctor' },
      { label: 'Refresh tickets', go: () => loadTickets(), q: 'refresh reload' },
    ],
  });
  return groups;
}

let paletteFocusIndex = 0;
function renderPalette(query) {
  const q = query.trim().toLowerCase();
  const groups = buildPaletteIndex()
    .map((g) => ({ ...g, items: q ? g.items.filter((it) => (it.q || it.label.toLowerCase()).includes(q)) : g.items.slice(0, g.title === 'Tickets' ? 8 : g.items.length) }))
    .filter((g) => g.items.length);

  paletteResultsEl.innerHTML = '';
  if (!groups.length) {
    paletteResultsEl.innerHTML = '<div class="palette-empty">No matches</div>';
    return;
  }
  let flatIndex = 0;
  for (const g of groups) {
    const head = document.createElement('div');
    head.className = 'palette-group-title';
    head.textContent = g.title;
    paletteResultsEl.appendChild(head);
    for (const item of g.items) {
      const idx = flatIndex++;
      const btn = document.createElement('button');
      btn.className = `palette-item${idx === paletteFocusIndex ? ' focused' : ''}`;
      btn.innerHTML = `<span class="palette-item-label">${escapeHtml(item.label)}</span>${item.meta ? `<span class="palette-item-meta">${escapeHtml(item.meta)}</span>` : ''}`;
      btn.addEventListener('click', () => { closePalette(); item.go(); });
      paletteResultsEl.appendChild(btn);
    }
  }
}

function openPalette(seed = '') {
  paletteBackdropEl.classList.remove('hidden');
  paletteInputEl.value = seed;
  paletteFocusIndex = 0;
  renderPalette(seed);
  requestAnimationFrame(() => paletteInputEl.focus());
}
function closePalette() {
  paletteBackdropEl.classList.add('hidden');
}
paletteOpenBtn.addEventListener('click', () => openPalette());
paletteBackdropEl.addEventListener('click', (e) => { if (e.target === paletteBackdropEl) closePalette(); });
paletteInputEl.addEventListener('input', () => { paletteFocusIndex = 0; renderPalette(paletteInputEl.value); });
paletteInputEl.addEventListener('keydown', (e) => {
  const items = paletteResultsEl.querySelectorAll('.palette-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteFocusIndex = Math.min(paletteFocusIndex + 1, items.length - 1); renderPalette(paletteInputEl.value); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteFocusIndex = Math.max(paletteFocusIndex - 1, 0); renderPalette(paletteInputEl.value); }
  else if (e.key === 'Enter') { e.preventDefault(); items[paletteFocusIndex]?.click(); }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (paletteBackdropEl.classList.contains('hidden')) openPalette();
    else closePalette();
  } else if (e.key === 'Escape') {
    if (!paletteBackdropEl.classList.contains('hidden')) closePalette();
    else if (!drawerEl.classList.contains('hidden')) closeDrawer();
  }
});

// ================= Toast ====================================================

let toastTimer = null;
function showToast(text) {
  toastTextEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

// ================= Settings =================================================

// The auto-detected branch for the current repo, cached so "Use detected"
// doesn't need its own round trip.
let lastDetectedBranch = '';

async function populateBranchList(repoPath) {
  baseBranchListEl.innerHTML = '';
  lastDetectedBranch = '';
  if (!repoPath) return;
  try {
    const res = await fetch(`/api/branches?repoPath=${encodeURIComponent(repoPath)}`);
    const data = await res.json();
    if (!res.ok) return;
    lastDetectedBranch = data.detected || '';
    for (const b of data.branches || []) {
      const opt = document.createElement('option');
      opt.value = b;
      baseBranchListEl.appendChild(opt);
    }
  } catch {
    /* datalist stays empty; free-text entry still works */
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const c = await res.json();
    currentConfig = c;
    brandSubEl.textContent = c.repoPath ? `${c.repoPath.split(/[\\/]/).pop()} · ${c.baseBranch || 'main'}` : 'No project selected';
    jiraDomainInput.value = c.jiraDomain || '';
    jiraEmailInput.value = c.jiraEmail || '';
    jiraTokenInput.value = '';
    jiraTokenInput.placeholder = c.jiraTokenSet ? '•••••••• (set — enter to replace)' : 'Enter a token to set it';
    projectsRootInput.value = c.projectsRoot || '';
    baseBranchEl.textContent = c.baseBranch || '—';
    baseBranchInput.value = c.baseBranch || '';
    if (c.repoPath) populateBranchList(c.repoPath);
    lintCmdInput.value = c.lintCommand || '';
    testCmdInput.value = c.testCommand || '';
    lintDisplayEl.textContent = c.lintCommand || 'npm run lint';
    testDisplayEl.textContent = c.testCommand || 'npm test';
    tgChatInput.value = c.telegramChatId || '';
    tgTokenInput.value = '';
    tgTokenInput.placeholder = c.telegramBotTokenSet ? '•••••••• (set — enter to replace)' : 'Enter a bot token to set it';
    renderTelegramState(c);
    renderJiraCommentState(c);
    if (c.projectsRoot) await scanProjects(c.projectsRoot, c.repoPath);
    else if (c.repoPath) setProjectOptions([{ name: c.repoPath, path: c.repoPath }], c.repoPath, false);
  } catch {
    /* leave fields as-is */
  }
}

function setProjectOptions(projects, selectPath, withPlaceholder = true) {
  projectSelect.innerHTML = '';
  if (withPlaceholder) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— select a project —';
    projectSelect.appendChild(placeholder);
  }
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.name;
    projectSelect.appendChild(opt);
  }
  if (selectPath) projectSelect.value = selectPath;
}
function setProjectPlaceholder(text) {
  projectSelect.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = text;
  projectSelect.appendChild(opt);
}

async function scanProjects(root, selectPath) {
  projectStatusEl.textContent = 'Scanning…';
  try {
    const res = await fetch(`/api/projects?root=${encodeURIComponent(root)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');
    if (!data.projects.length) {
      setProjectPlaceholder('No git projects found');
      projectStatusEl.textContent = 'No git repositories in that folder.';
      return;
    }
    setProjectOptions(data.projects, selectPath);
    projectStatusEl.textContent = `${data.projects.length} project${data.projects.length === 1 ? '' : 's'} found.`;
  } catch (err) {
    setProjectPlaceholder('— scan a folder first —');
    projectStatusEl.textContent = err.message;
  }
}
scanBtn.addEventListener('click', () => {
  const root = projectsRootInput.value.trim();
  if (!root) { projectsRootInput.focus(); return; }
  scanProjects(root);
});

projectSelect.addEventListener('change', async () => {
  const repoPath = projectSelect.value;
  if (!repoPath) return;
  projectStatusEl.textContent = 'Saving…';
  baseBranchEl.textContent = 'detecting…';
  try {
    const res = await fetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectsRoot: projectsRootInput.value.trim(), repoPath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    currentConfig = data;
    baseBranchEl.textContent = data.baseBranch || '—';
    baseBranchInput.value = data.baseBranch || '';
    populateBranchList(repoPath);
    brandSubEl.textContent = `${repoPath.split(/[\\/]/).pop()} · ${data.baseBranch || 'main'}`;
    projectStatusEl.textContent = `Working in this project · base branch “${data.baseBranch}”.`;
    lintCmdInput.value = data.lintCommand || '';
    testCmdInput.value = data.testCommand || '';
    lintDisplayEl.textContent = data.lintCommand || 'npm run lint';
    testDisplayEl.textContent = data.testCommand || 'npm test';
    cmdStatusEl.textContent = '';
    loadWorktrees();
    loadDoctor();
  } catch (err) {
    projectStatusEl.textContent = err.message;
    baseBranchEl.textContent = currentConfig.baseBranch || '—';
  }
});

cmdEditToggleBtn.addEventListener('click', () => {
  cmdFieldsEl.classList.toggle('hidden');
  cmdActionsEl.classList.toggle('hidden');
});

jiraSaveBtn.addEventListener('click', async () => {
  jiraSaveBtn.disabled = true;
  jiraStatusEl.textContent = 'Saving…';
  const body = { jiraDomain: jiraDomainInput.value.trim(), jiraEmail: jiraEmailInput.value.trim() };
  if (jiraTokenInput.value.trim()) body.jiraToken = jiraTokenInput.value.trim();
  try {
    const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    currentConfig = data;
    jiraTokenInput.value = '';
    jiraTokenInput.placeholder = data.jiraTokenSet ? '•••••••• (set — enter to replace)' : 'Enter a token to set it';
    jiraStatusEl.textContent = 'Saved.';
    loadMe();
    loadTickets();
    loadDoctor();
  } catch (err) {
    jiraStatusEl.textContent = err.message;
  } finally {
    jiraSaveBtn.disabled = false;
  }
});

// ---- Notifications: Telegram + Jira comment-back, as toggle switches ----

function renderTelegramState(c) {
  const enabled = Boolean(c.telegramEnabled);
  tgEnabledInput.checked = enabled;
  setToggleOn(tgEnabledToggleBtn, enabled);
  tgNoteEl.textContent = enabled
    ? 'On — reaches you with the dashboard closed.'
    : c.telegramConfigured
      ? 'Credentials saved, off — tap to enable.'
      : 'Reaches you with the dashboard closed. Credentials needed.';
}
tgEnabledToggleBtn.addEventListener('click', () => {
  tgEnabledInput.checked = !tgEnabledInput.checked;
  setToggleOn(tgEnabledToggleBtn, tgEnabledInput.checked);
});

tgSaveBtn.addEventListener('click', async () => {
  tgSaveBtn.disabled = true;
  tgStatusEl.textContent = 'Saving…';
  const body = { telegramChatId: tgChatInput.value.trim(), telegramEnabled: tgEnabledInput.checked };
  if (tgTokenInput.value.trim()) body.telegramBotToken = tgTokenInput.value.trim();
  try {
    const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    currentConfig = data;
    tgTokenInput.value = '';
    tgTokenInput.placeholder = data.telegramBotTokenSet ? '•••••••• (set — enter to replace)' : 'Enter a bot token to set it';
    renderTelegramState(data);
    tgStatusEl.textContent = data.telegramEnabled ? 'Saved — notifications are on.' : 'Saved — notifications stay off.';
  } catch (err) {
    setToggleOn(tgEnabledToggleBtn, Boolean(currentConfig.telegramEnabled));
    tgEnabledInput.checked = Boolean(currentConfig.telegramEnabled);
    tgStatusEl.textContent = err.message;
  } finally {
    tgSaveBtn.disabled = false;
  }
});

tgTestBtn.addEventListener('click', async () => {
  tgTestBtn.disabled = true;
  tgStatusEl.textContent = 'Sending…';
  try {
    const res = await fetch('/api/telegram/test', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send');
    tgStatusEl.textContent = currentConfig.telegramEnabled ? 'Test message sent — check Telegram.' : 'Test message sent — notifications are still off until you enable them.';
  } catch (err) {
    tgStatusEl.textContent = err.message;
  } finally {
    tgTestBtn.disabled = false;
  }
});

function renderJiraCommentState(c) {
  const enabled = Boolean(c.commentOnJira);
  setToggleOn(jiraCommentToggleBtn, enabled);
  jiraCommentNoteEl.textContent = enabled
    ? 'On — posts the branch and summary when a run finishes.'
    : 'Posts the branch and summary when a run finishes. Off by default.';
}
jiraCommentToggleBtn.addEventListener('click', async () => {
  const next = !jiraCommentToggleBtn.classList.contains('on');
  jiraCommentToggleBtn.disabled = true;
  try {
    const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentOnJira: next }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    currentConfig = data;
    renderJiraCommentState(data);
    showToast(next ? 'Will comment on Jira when a run finishes' : 'Jira comments turned off');
  } catch (err) {
    alert(err.message);
  } finally {
    jiraCommentToggleBtn.disabled = false;
  }
});

baseBranchDetectBtn.addEventListener('click', () => {
  if (lastDetectedBranch) baseBranchInput.value = lastDetectedBranch;
});

cmdSaveBtn.addEventListener('click', async () => {
  if (!currentConfig.repoPath) { cmdStatusEl.textContent = 'Select a project first.'; return; }
  cmdSaveBtn.disabled = true;
  cmdStatusEl.textContent = 'Saving…';
  try {
    const body = { lintCommand: lintCmdInput.value.trim(), testCommand: testCmdInput.value.trim() };
    const branch = baseBranchInput.value.trim();
    if (branch) body.baseBranch = branch;
    const res = await fetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    currentConfig = data;
    baseBranchEl.textContent = data.baseBranch || '—';
    baseBranchInput.value = data.baseBranch || '';
    brandSubEl.textContent = data.repoPath ? `${data.repoPath.split(/[\\/]/).pop()} · ${data.baseBranch || 'main'}` : brandSubEl.textContent;
    lintDisplayEl.textContent = data.lintCommand || 'npm run lint';
    testDisplayEl.textContent = data.testCommand || 'npm test';
    cmdStatusEl.textContent = data.lintCommand || data.testCommand ? 'Saved — Claude may run these in this project.' : 'Cleared — using the npm defaults.';
  } catch (err) {
    cmdStatusEl.textContent = err.message;
  } finally {
    cmdSaveBtn.disabled = false;
  }
});

// ---- Settings sub-nav ----
settingsNavEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...settingsNavEl.children].forEach((c) => {
    c.classList.toggle('active', c === btn);
    if (c === btn) c.setAttribute('aria-current', 'true');
    else c.removeAttribute('aria-current');
  });
  const target = document.getElementById(btn.dataset.target);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ================= Startup ===================================================

loadTickets().then(restoreActiveTasks);
loadHistory();
loadModels();
loadUsage();
loadMe();
loadConfig().then(loadWorktrees);
loadDoctor();
renderNotifStatus();
setInterval(loadUsage, 60000);
