(function installCuratorPanel() {
  const SOURCE = "x-list-curator";
  const STORAGE_KEY = "x-list-curator-state-v1";
  const EXTENSION_VERSION = chrome.runtime.getManifest().version;
  const MAX_USERS = 5000;
  const ROW_HEIGHT = 88;
  const VISIBLE_ROWS = 14;
  const DEFAULT_SETTINGS = {
    betweenMin: 2,
    betweenMax: 6,
    batchSize: 20,
    pauseMin: 2,
    pauseMax: 5,
    maxAttempts: 2
  };
  const DEFAULT_FILTERS = {
    query: "",
    include: "",
    exclude: "",
    location: "",
    minFollowers: "",
    maxFollowers: "",
    minFollowing: "",
    maxFollowing: "",
    minPosts: "",
    maxPosts: "",
    mutual: false
  };

  const state = {
    schemaVersion: 1,
    users: [],
    selectedIds: [],
    filters: { ...DEFAULT_FILTERS },
    filterDraft: { ...DEFAULT_FILTERS },
    listUrl: "",
    settings: { ...DEFAULT_SETTINGS },
    job: null,
    history: [],
    sessionFingerprint: ""
  };
  const runtime = {
    panelOpen: false,
    running: false,
    stopRequested: false,
    cooldownTimer: 0,
    cooldownTicker: 0,
    filteredUsers: [],
    sessionReady: false,
    sessionFingerprint: "",
    hookReady: false,
    persistTimer: 0,
    toastTimer: 0,
    pendingAdds: new Map(),
    storageCorrupt: false,
    captureGeneration: 0,
    captureClearPending: false
  };
  const refs = {};

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .xcurator-panel { position: fixed; z-index: 2147483647; top: 16px; right: 16px; width: min(470px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: hidden; color: #eff6f0; background: #101817; border: 1px solid #2d4941; border-radius: 18px; box-shadow: 0 22px 70px rgba(0,0,0,.46); font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .xcurator-panel[hidden] { display: none; }
    .xcurator-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid #203730; background: linear-gradient(135deg, #14231f, #101817 68%); }
    .header-actions { display: flex; align-items: center; gap: 8px; margin-left: 12px; flex: 0 0 auto; }
    .clear-capture { min-height: 30px; padding: 5px 9px; border: 1px solid #705541; border-radius: 8px; color: #f0c88d; background: rgba(122, 75, 38, .14); font-size: 11px; font-weight: 700; white-space: nowrap; }
    .clear-capture:hover:not(:disabled) { color: #fff1d3; border-color: #c08b57; background: rgba(151, 91, 45, .28); }
    .eyebrow { color: #a8d8b2; letter-spacing: .18em; font-size: 10px; font-weight: 700; }
    h1 { margin: 3px 0 0; color: #f5f1dc; font: 600 23px/1.1 Georgia, Cambria, serif; letter-spacing: -.02em; }
    .close { width: 30px; height: 30px; border: 0; border-radius: 50%; color: #b7cbc0; background: #1c302a; cursor: pointer; font-size: 18px; }
    .close:hover { color: #fff; background: #315246; }
    .xcurator-body { display: flex; flex-direction: column; max-height: calc(100vh - 101px); overflow: auto; }
    .section { padding: 14px 20px; border-bottom: 1px solid #203730; }
    .section-title { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 9px; color: #f4f0dd; font-weight: 700; }
    .muted { color: #8ea99c; }
    .status-line { display: flex; gap: 8px; align-items: center; padding: 8px 10px; color: #c5d5cc; background: #15241f; border-radius: 9px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #e29a55; flex: 0 0 auto; }
    .dot.ready { background: #91e6a8; box-shadow: 0 0 0 3px rgba(145,230,168,.12); }
    .notice { margin-top: 9px; padding: 9px 10px; color: #e9c68b; background: rgba(159, 96, 36, .14); border: 1px solid rgba(223, 158, 81, .26); border-radius: 9px; font-size: 11px; }
    .risk-inline { color: #e9c68b; font-weight: 700; }
    label.field { display: block; color: #9eb8aa; font-size: 11px; }
    label.field span { display: block; margin-bottom: 5px; }
    input[type=text], input[type=number] { width: 100%; min-height: 34px; padding: 7px 9px; border: 1px solid #355448; border-radius: 8px; color: #eef5ef; background: #0d1514; outline: none; font: inherit; }
    input[type=text]:focus, input[type=number]:focus { border-color: #8edca5; box-shadow: 0 0 0 2px rgba(142,220,165,.12); }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .filter-grid { display: grid; gap: 9px; }
    .metric-ranges { display: grid; gap: 7px; }
    .metric-range { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 9px; align-items: end; padding: 8px; border: 1px solid #28453b; border-radius: 9px; background: rgba(10, 23, 19, .38); }
    .metric-name { padding-bottom: 7px; color: #b4cabd; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
    .metric-range label.field span { font-size: 10px; }
    .relationship-filter { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 6px 10px; border: 1px solid #315246; border-radius: 8px; color: #c8dacd; background: #12211c; font-size: 11px; cursor: pointer; }
    .relationship-filter input { accent-color: #98e6aa; }
    .relationship-filter .relationship-mark { color: #9ae5a6; font-size: 15px; line-height: 1; }
    .relationship-filter small { color: #7e9a8d; font-size: 10px; }
    .filter-apply-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; padding-top: 9px; border-top: 1px solid #203730; }
    .filter-commit { display: inline-flex; align-items: center; gap: 8px; }
    .match-count { color: #a6c7ae; font-size: 11px; white-space: nowrap; }
    .match-count.pending { color: #e2c58c; }
    button.filter-reset { color: #9eb8aa; background: transparent; }
    button.filter-apply { min-height: 32px; padding-inline: 13px; color: #102018; background: #9ae5a6; border-color: #9ae5a6; font-weight: 800; }
    button.filter-apply:hover { background: #b1f1b7; }
    .selection-panel { margin-top: 12px; padding: 10px; border: 1px solid #2d4d42; border-radius: 10px; background: #102019; }
    .selection-panel-head { display: flex; justify-content: space-between; align-items: end; gap: 8px; }
    .selection-panel-head strong { display: block; margin-top: 1px; color: #f4f0dd; font-size: 13px; }
    .panel-kicker { color: #86a99a; font-size: 9px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
    .selection-scope { color: #8aa89a; font-size: 10px; white-space: nowrap; }
    .selection-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 9px; }
    .selection-actions button { min-height: 35px; padding-inline: 7px; }
    .selection-actions .selection-export { color: #b9dcc1; border-color: #4d7862; background: #142a20; }
    button { min-height: 31px; padding: 6px 10px; border: 1px solid #395a4e; border-radius: 8px; color: #c7d8ce; background: #15241f; cursor: pointer; font: 600 11px/1.1 inherit; }
    button:hover { border-color: #90dca4; color: #f6fff8; }
    button:disabled { opacity: .42; cursor: not-allowed; }
    button.primary { width: 100%; margin-top: 10px; border-color: #a3e9ad; color: #092216; background: #9ae5a6; font-size: 13px; }
    button.primary:hover { background: #b1f1b7; }
    button.danger { color: #efb3a4; }
    .list-viewport { height: 342px; overflow: auto; border: 1px solid #29463d; border-radius: 10px; background: #0c1413; }
    .list-row { display: grid; grid-template-columns: 21px 44px minmax(0, 1fr); gap: 9px; align-items: center; min-height: ${ROW_HEIGHT}px; padding: 8px 10px; border-bottom: 1px solid #1a2a26; }
    .list-row:last-child { border-bottom: 0; }
    .list-row:hover { background: #12231d; }
    .row-check { accent-color: #98e6aa; }
    .avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: #274238; border: 1px solid #45675a; }
    .user-main { min-width: 0; }
    .user-name { display: flex; gap: 5px; align-items: center; min-width: 0; color: #f4f2e6; font-weight: 700; }
    .user-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { color: #92e6a5; font-size: 11px; }
    .handle { color: #87a99a; font-size: 11px; }
    .bio { display: -webkit-box; overflow: hidden; margin-top: 2px; color: #b1c5b9; font-size: 11px; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .metrics { margin-top: 3px; color: #789588; font-size: 10px; }
    .empty { display: grid; place-items: center; height: 100%; padding: 20px; color: #819a8e; text-align: center; }
    .selection-hint { margin-top: 7px; color: #86a294; font-size: 10px; }
    details { margin-top: 10px; border: 1px solid #28453b; border-radius: 9px; }
    summary { padding: 8px 10px; color: #a4bdaf; cursor: pointer; font-size: 11px; }
    .advanced { display: grid; gap: 9px; padding: 2px 10px 11px; }
    .job-card { padding: 10px; border: 1px solid #315246; border-radius: 10px; background: #12211c; }
    .job-head { display: flex; justify-content: space-between; gap: 8px; color: #dae9df; font-weight: 700; }
    .progress-track { height: 7px; margin: 9px 0 6px; overflow: hidden; border-radius: 99px; background: #263c34; }
    .progress-fill { height: 100%; width: 0%; border-radius: inherit; background: #9ae5a6; transition: width .2s ease; }
    .job-meta { display: flex; justify-content: space-between; color: #8faa9c; font-size: 10px; }
    .job-action-groups { display: grid; grid-template-columns: minmax(0, 2fr) minmax(126px, 1fr); gap: 8px; margin-top: 10px; }
    .job-action-group { padding: 8px; border: 1px solid #2d4d42; border-radius: 9px; background: rgba(8, 21, 17, .42); }
    .job-action-group-label { margin: 0 0 7px; color: #86a99a; font-size: 9px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
    .job-action-grid { display: grid; gap: 6px; }
    .job-action-group.flow .job-action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .job-action-group.export .job-action-grid { grid-template-columns: minmax(0, 1fr); }
    .job-action-group button { min-height: 37px; padding-inline: 7px; }
    .history-list { display: grid; gap: 7px; max-height: 220px; overflow: auto; }
    .history-item { padding: 8px 9px; border: 1px solid #29463d; border-radius: 8px; background: #0d1715; }
    .history-item strong { color: #e9f0e8; }
    .history-item .history-meta { margin-top: 3px; color: #87a294; font-size: 10px; }
    .history-item .history-actions { display: flex; gap: 6px; margin-top: 6px; }
    .toast { position: fixed; right: 18px; bottom: 18px; max-width: 360px; padding: 10px 12px; color: #07170e; background: #a3e9ad; border-radius: 9px; box-shadow: 0 10px 30px rgba(0,0,0,.3); font-weight: 700; }
    @media (max-width: 560px) { .xcurator-panel { top: 8px; right: 8px; width: calc(100vw - 16px); max-height: calc(100vh - 16px); } .xcurator-body { max-height: calc(100vh - 87px); } .job-action-groups { grid-template-columns: 1fr; } .job-action-group.export .job-action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .metric-range { grid-template-columns: 1fr; gap: 5px; } .metric-name { padding-bottom: 0; } .relationship-filter small { display: none; } }
  `;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || min));
  }

  function splitTerms(value) {
    return String(value || "").split(/[\s,，、]+/).map((term) => term.trim().toLowerCase()).filter(Boolean);
  }

  function normalizeUser(raw) {
    const id = String(raw?.id || raw?.rest_id || raw?.id_str || "").trim();
    const handle = String(raw?.handle || raw?.screen_name || "").replace(/^@/, "").trim();
    if (!id || !handle) return null;
    return {
      id,
      handle,
      name: String(raw?.name || handle).trim(),
      bio: String(raw?.bio || "").trim(),
      location: String(raw?.location || "").trim(),
      avatar: String(raw?.avatar || "").trim(),
      followers: Number(raw?.followers || 0) || 0,
      following: Number(raw?.following || 0) || 0,
      posts: Number(raw?.posts || 0) || 0,
      verified: Boolean(raw?.verified),
      protected: Boolean(raw?.protected),
      mutual: Boolean(raw?.mutual),
      capturedAt: Number(raw?.capturedAt || Date.now())
    };
  }

  function parseListUrl(value) {
    try {
      const url = new URL(String(value).trim());
      if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/\/i\/lists\/(\d+)|\/lists\/(\d+)/i);
      if (!match) return null;
      return { id: match[1] || match[2], url: url.toString() };
    } catch (_) {
      return null;
    }
  }

  function isFollowingPage() {
    return /(?:^|\/)(following|friends)(?:\/|$)/i.test(location.pathname) || /following/i.test(document.title);
  }

  function selectedSet() {
    return new Set(state.selectedIds);
  }

  function currentSettings() {
    const read = (name, fallback) => Number(refs[name]?.value ?? fallback);
    const min = clamp(read("betweenMin", DEFAULT_SETTINGS.betweenMin), 1, 60);
    const max = clamp(read("betweenMax", DEFAULT_SETTINGS.betweenMax), min, 120);
    return {
      betweenMin: min,
      betweenMax: max,
      batchSize: clamp(read("batchSize", DEFAULT_SETTINGS.batchSize), 1, 500),
      pauseMin: clamp(read("pauseMin", DEFAULT_SETTINGS.pauseMin), 0.1, 60),
      pauseMax: clamp(read("pauseMax", DEFAULT_SETTINGS.pauseMax), clamp(read("pauseMin", DEFAULT_SETTINGS.pauseMin), 0.1, 60), 120),
      maxAttempts: clamp(read("maxAttempts", DEFAULT_SETTINGS.maxAttempts), 1, 5)
    };
  }

  function randomBetween(min, max) {
    return min + Math.random() * Math.max(0, max - min);
  }

  async function sha256Hex(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function queueFingerprint(listId, ids) {
    return sha256Hex(`${listId}|${ids.join(",")}`);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    if (seconds < 60) return `${seconds} sec`;
    return `${Math.ceil(seconds / 60)} min`;
  }

  function jobStatusLabel(status) {
    return ({ draft: "Not started", running: "Adding accounts", paused: "Paused", cooldown: "Cooling down", completed: "Completed" }[status]) || status || "No task";
  }

  function itemStatusLabel(status) {
    return ({ pending: "Pending", retryable: "Awaiting retry", succeeded: "Added", already_member: "Already in List", failed: "Failed", skipped: "Skipped" }[status]) || status;
  }

  function recomputeJobStats(job) {
    if (!job?.queue) return;
    job.successCount = job.queue.filter((item) => item.status === "succeeded").length;
    job.alreadyCount = job.queue.filter((item) => item.status === "already_member").length;
    job.failureCount = job.queue.filter((item) => item.status === "failed").length;
  }

  async function persistNow() {
    recomputeJobStats(state.job);
    state.job && (state.job.updatedAt = Date.now());
    try {
      await globalThis.XListStore.save(state);
    } catch (error) {
      showToast(`Failed to save local data: ${error?.message || "storage error"}`);
    }
  }

  function persistSoon() {
    clearTimeout(runtime.persistTimer);
    runtime.persistTimer = setTimeout(() => persistNow(), 180);
  }

  function showToast(message) {
    if (!refs.toast) return;
    refs.toast.textContent = message;
    refs.toast.hidden = false;
    clearTimeout(runtime.toastTimer);
    runtime.toastTimer = setTimeout(() => { refs.toast.hidden = true; }, 3500);
  }

  function createUi() {
    const host = document.createElement("div");
    host.id = "x-following-curator-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${css}</style>
      <section class="xcurator-panel" hidden aria-label="X Following Curator">
        <header class="xcurator-header">
          <div><div class="eyebrow">X FOLLOW TO LIST · ${escapeHtml(EXTENSION_VERSION)}</div><h1>Organize your Following into Lists</h1></div>
          <div class="header-actions"><button class="clear-capture" data-ref="clearCaptured" data-action="clearCaptured" title="Clear locally captured accounts and selections without affecting import tasks">Clear captured</button><button class="close" data-action="close" title="Close">×</button></div>
        </header>
        <div class="xcurator-body">
          <section class="section">
            <div class="status-line"><span class="dot" data-ref="sessionDot"></span><span data-ref="pageStatus">Waiting for X page data…</span></div>
            <div class="notice">This extension uses your current X session for list operations. X may rate-limit or restrict automated activity. Only add accounts you explicitly select; you are responsible for account and platform-policy risks.</div>
          </section>
          <section class="section">
            <div class="section-title"><span>Filters</span><span class="muted" data-ref="captureCount">Captured 0  accounts</span></div>
            <div class="filter-grid">
              <label class="field"><span>Search name, @handle, bio, or location</span><input type="text" data-ref="query" placeholder="e.g. design / @alice"></label>
              <div class="grid2"><label class="field"><span>Include keywords</span><input type="text" data-ref="include" placeholder="Space-separated"></label><label class="field"><span>Exclude keywords</span><input type="text" data-ref="exclude" placeholder="Space-separated"></label></div>
              <label class="field"><span>Location keywords</span><input type="text" data-ref="location" placeholder="e.g. Shanghai / Hong Kong"></label>
              <div class="metric-ranges">
                <div class="metric-range"><span class="metric-name">Followers</span><div class="grid2"><label class="field"><span>Minimum</span><input type="number" min="0" data-ref="minFollowers" placeholder="Any"></label><label class="field"><span>Maximum</span><input type="number" min="0" data-ref="maxFollowers" placeholder="Any"></label></div></div>
                <div class="metric-range"><span class="metric-name">Following</span><div class="grid2"><label class="field"><span>Minimum</span><input type="number" min="0" data-ref="minFollowing" placeholder="Any"></label><label class="field"><span>Maximum</span><input type="number" min="0" data-ref="maxFollowing" placeholder="Any"></label></div></div>
                <div class="metric-range"><span class="metric-name">Posts</span><div class="grid2"><label class="field"><span>Minimum</span><input type="number" min="0" data-ref="minPosts" placeholder="Any"></label><label class="field"><span>Maximum</span><input type="number" min="0" data-ref="maxPosts" placeholder="Any"></label></div></div>
              </div>
            </div>
            <div style="margin-top:9px"><label class="relationship-filter"><input type="checkbox" data-ref="mutual"><span class="relationship-mark">↔</span><span>Mutual follows only</span><small>They follow you too</small></label></div>
            <div class="filter-apply-row"><button class="filter-reset" data-action="clearFilters">Clear filters</button><div class="filter-commit"><span class="match-count" data-ref="matchCount">Matched 0  accounts</span><button class="filter-apply" data-action="applyFilters">Apply filters</button></div></div>
            <div class="selection-panel">
              <div class="selection-panel-head"><div><span class="panel-kicker">Select results</span><strong data-ref="selectionCount">Selected 0  accounts</strong></div><span class="selection-scope" data-ref="selectionScope">Current results 0  accounts</span></div>
              <div class="selection-actions"><button data-ref="selectFiltered" data-action="selectFiltered">Select all results</button><button data-action="invertSelection">Invert selection</button><button data-ref="clearSelection" data-action="clearSelection">Clear selection</button><button class="selection-export" data-action="exportCsv">Export selected CSV</button></div>
            </div>
            <div class="list-viewport" data-ref="listViewport"><div class="empty">Open your Following page and scroll to capture visible accounts locally.</div></div>
            <div class="selection-hint">Keep scrolling your Following page to capture more accounts. Data stays on your device.</div>
          </section>
          <section class="section">
            <div class="section-title"><span>Add to List</span><span><button data-action="importSnapshot">Import snapshot</button></span></div>
            <label class="field"><span>List share URL</span><input type="text" data-ref="listUrl" placeholder="https://x.com/i/lists/1234567890"></label>
            <details><summary>Timing and recovery settings</summary><div class="advanced">
              <div class="grid2"><label class="field"><span>Delay between actions (seconds)</span><div class="grid2"><input type="number" min="1" max="60" step="0.1" data-ref="betweenMin"><input type="number" min="1" max="120" step="0.1" data-ref="betweenMax"></div></label><label class="field"><span>Accounts per batch</span><input type="number" min="1" max="500" data-ref="batchSize"></label></div>
              <div class="grid3"><label class="field"><span>Minimum batch pause (minutes)</span><input type="number" min="0.1" max="60" step="0.1" data-ref="pauseMin"></label><label class="field"><span>Maximum batch pause (minutes)</span><input type="number" min="0.1" max="120" step="0.1" data-ref="pauseMax"></label><label class="field"><span>Maximum retries per account</span><input type="number" min="1" max="5" data-ref="maxAttempts"></label></div>
            </div></details>
            <label class="check" style="margin-top:10px"><input type="checkbox" data-ref="ackRisk"> I understand this will perform bulk List operations using my current X session <span class="risk-inline">（X may impose rate limits or account restrictions）</span></label>
            <div class="selection-hint" data-ref="confirmSummary">Target List: not set · To add: 0  accounts</div>
            <button class="primary" data-ref="start" data-action="start">Add to List</button>
            <div class="job-card" data-ref="jobCard" hidden>
              <div class="job-head"><span data-ref="jobStatus">No task</span><span data-ref="jobProgressText">0 / 0</span></div>
              <div class="progress-track"><div class="progress-fill" data-ref="progressFill"></div></div>
              <div class="job-meta"><span data-ref="jobMeta">Ready to start</span><span data-ref="cooldownText"></span></div>
              <div class="job-action-groups">
                <div class="job-action-group flow">
                  <div class="job-action-group-label">Task controls</div>
                  <div class="job-action-grid"><button data-ref="resume" data-action="resume">Resume</button><button class="danger" data-ref="pause" data-action="pause">Pause</button><button data-action="stopJob">Stop and save progress</button><button data-action="archiveJob">End task</button></div>
                </div>
                <div class="job-action-group export">
                  <div class="job-action-group-label">Export data</div>
                  <div class="job-action-grid"><button data-action="exportJob">Export results</button><button data-action="exportSnapshot">Export snapshot</button></div>
                </div>
              </div>
            </div>
          </section>
          <section class="section" data-ref="historySection" hidden>
            <div class="section-title"><span>Task history</span><span><button data-action="importSnapshot">Import snapshot</button> <span class="muted" data-ref="historyCount">0  tasks</span></span></div>
            <div class="history-list" data-ref="historyList"></div>
            <input type="file" data-ref="snapshotInput" accept="application/json,.json" hidden>
          </section>
        </div>
        <div class="toast" data-ref="toast" hidden></div>
      </section>`;
    document.documentElement.appendChild(host);
    refs.host = host;
    refs.panel = shadow.querySelector(".xcurator-panel");
    shadow.querySelectorAll("[data-ref]").forEach((node) => { refs[node.dataset.ref] = node; });
    shadow.addEventListener("click", onClick);
    shadow.addEventListener("input", onInput);
    shadow.addEventListener("change", onChange);
    refs.listViewport.addEventListener("scroll", renderList);
  }

  function onInput(event) {
    const name = event.target?.dataset?.ref;
    if (!name) return;
    if (Object.prototype.hasOwnProperty.call(state.filters, name)) {
      state.filterDraft[name] = event.target.type === "checkbox" ? Boolean(event.target.checked) : event.target.value;
      persistSoon();
      renderFilterSummary();
    }
    if (name === "listUrl") { state.listUrl = event.target.value; persistSoon(); renderJob(); renderConfirmation(); }
  }

  function onChange(event) {
    const name = event.target?.dataset?.ref;
    if (!name) return;
    if (name === "snapshotInput") {
      importSnapshotFile(event.target.files?.[0]);
      event.target.value = "";
      return;
    }
    if (Object.prototype.hasOwnProperty.call(state.filters, name) && event.target.type === "checkbox") {
      state.filterDraft[name] = Boolean(event.target.checked);
      persistSoon();
      renderFilterSummary();
    }
  }

  function onClick(event) {
    const action = event.target?.dataset?.action;
    if (action) {
      event.preventDefault();
      const historyId = event.target?.dataset?.historyId || event.target?.closest?.("[data-history-id]")?.dataset?.historyId;
      const handlers = { close: closePanel, applyFilters, clearFilters, clearCaptured: clearCapturedUsers, selectFiltered, invertSelection, clearSelection, exportCsv, exportJob, exportSnapshot, importSnapshot, start: startOrResume, resume: resumeJob, pause: pauseJob, stopJob, archiveJob };
      if (action === "retryHistory") return retryHistory(historyId);
      if (action === "deleteHistory") return deleteHistory(historyId);
      if (action === "exportHistory") return exportHistory(historyId);
      (handlers[action] || (() => {}))();
      return;
    }
    const checkbox = event.target?.closest?.("input[data-user-id]");
    if (checkbox) {
      const id = checkbox.dataset.userId;
      const set = selectedSet();
      checkbox.checked ? set.add(id) : set.delete(id);
      state.selectedIds = Array.from(set);
      persistSoon();
      renderSelection();
    }
  }

  function openPanel() {
    runtime.panelOpen = true;
    refs.panel.hidden = false;
    render();
  }

  function closePanel() {
    runtime.panelOpen = false;
    refs.panel.hidden = true;
  }

  function filteredUsers(filters = state.filters) {
    const f = filters;
    const query = String(f.query || "").trim().toLowerCase();
    const includes = splitTerms(f.include);
    const excludes = splitTerms(f.exclude);
    const minFollowers = f.minFollowers === "" ? null : Number(f.minFollowers);
    const maxFollowers = f.maxFollowers === "" ? null : Number(f.maxFollowers);
    const location = String(f.location || "").trim().toLowerCase();
    const minFollowing = f.minFollowing === "" ? null : Number(f.minFollowing);
    const maxFollowing = f.maxFollowing === "" ? null : Number(f.maxFollowing);
    const minPosts = f.minPosts === "" ? null : Number(f.minPosts);
    const maxPosts = f.maxPosts === "" ? null : Number(f.maxPosts);
    return state.users.filter((user) => {
      const haystack = `${user.name} @${user.handle} ${user.bio} ${user.location}`.toLowerCase();
      if (query && !haystack.includes(query.replace(/^@/, ""))) return false;
      if (includes.length && !includes.every((term) => haystack.includes(term))) return false;
      if (excludes.some((term) => haystack.includes(term))) return false;
      if (minFollowers != null && user.followers < minFollowers) return false;
      if (maxFollowers != null && user.followers > maxFollowers) return false;
      if (location && !String(user.location || "").toLowerCase().includes(location)) return false;
      if (minFollowing != null && user.following < minFollowing) return false;
      if (maxFollowing != null && user.following > maxFollowing) return false;
      if (minPosts != null && user.posts < minPosts) return false;
      if (maxPosts != null && user.posts > maxPosts) return false;
      if (f.mutual && !user.mutual) return false;
      return true;
    });
  }

  function normalizeFilters(input) {
    const normalized = { ...DEFAULT_FILTERS };
    for (const [key, fallback] of Object.entries(DEFAULT_FILTERS)) {
      const value = input?.[key];
      normalized[key] = typeof fallback === "boolean" ? value === true : (value == null || value === false ? "" : String(value));
    }
    return normalized;
  }

  function sameFilters(left, right) {
    return Object.keys(DEFAULT_FILTERS).every((key) => left?.[key] === right?.[key]);
  }

  function renderFilterSummary() {
    if (!refs.matchCount) return;
    const count = filteredUsers(state.filterDraft).length;
    const pending = !sameFilters(state.filterDraft, state.filters);
    refs.matchCount.textContent = `${pending ? "Preview" : "Matched"} ${formatNumber(count)}  accounts`;
    refs.matchCount.classList.toggle("pending", pending);
  }

  function applyFilters() {
    state.filters = normalizeFilters(state.filterDraft);
    refs.listViewport.scrollTop = 0;
    persistNow();
    render();
    showToast("Filters applied");
  }

  function clearFilters() {
    state.filterDraft = { ...DEFAULT_FILTERS };
    state.filters = { ...DEFAULT_FILTERS };
    refs.listViewport.scrollTop = 0;
    persistNow();
    render();
    showToast("All filters cleared");
  }

  function renderList() {
    if (!refs.listViewport) return;
    runtime.filteredUsers = filteredUsers();
    const users = runtime.filteredUsers;
    if (!users.length) {
      refs.listViewport.innerHTML = `<div class="empty">${state.users.length ? "No accounts match the current filters." : "Open your Following page and scroll to capture visible accounts locally."}</div>`;
      return;
    }
    const scrollTop = refs.listViewport.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
    const end = Math.min(users.length, start + VISIBLE_ROWS + 5);
    const checked = selectedSet();
    const rows = users.slice(start, end).map((user) => {
      const avatar = user.avatar ? `<img class="avatar" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(user.avatar)}" alt="">` : `<div class="avatar"></div>`;
      return `<label class="list-row"><input class="row-check" type="checkbox" data-user-id="${escapeHtml(user.id)}" ${checked.has(user.id) ? "checked" : ""}><span>${avatar}</span><span class="user-main"><span class="user-name"><strong>${escapeHtml(user.name || user.handle)}</strong>${user.verified ? '<span class="badge">●</span>' : ''}</span><span class="handle">@${escapeHtml(user.handle)}</span><span class="bio">${escapeHtml(user.bio || "No bio")}</span><span class="metrics">Followers ${formatNumber(user.followers)} · Following ${formatNumber(user.following)} · Posts ${formatNumber(user.posts)}${user.location ? ` · ${escapeHtml(user.location)}` : ""}${user.mutual ? " · Mutual" : ""}</span></span></label>`;
    }).join("");
    const top = start * ROW_HEIGHT;
    const bottom = Math.max(0, (users.length - end) * ROW_HEIGHT);
    refs.listViewport.innerHTML = `<div style="height:${top}px"></div>${rows}<div style="height:${bottom}px"></div>`;
  }

  function renderFilters() {
    Object.entries(state.filterDraft).forEach(([key, value]) => {
      if (refs[key]) refs[key].type === "checkbox" ? (refs[key].checked = Boolean(value)) : (refs[key].value = value ?? "");
    });
    refs.listUrl.value = state.listUrl || "";
    Object.entries({ ...DEFAULT_SETTINGS, ...(state.settings || {}) }).forEach(([key, value]) => { if (refs[key]) refs[key].value = value; });
    renderFilterSummary();
  }

  function renderSelection() {
    const visibleSelected = runtime.filteredUsers.filter((user) => state.selectedIds.includes(user.id)).length;
    refs.selectionCount.textContent = `Selected ${formatNumber(state.selectedIds.length)}  accounts`;
    refs.selectionScope.textContent = `Current results ${formatNumber(runtime.filteredUsers.length)}  accounts`;
    refs.captureCount.textContent = `Captured ${formatNumber(state.users.length)}  accounts`;
    refs.clearCaptured.disabled = state.users.length === 0;
    refs.selectFiltered.disabled = false;
    refs.clearSelection.disabled = state.selectedIds.length === 0;
    refs.selectionCount.title = `Selected in current results ${visibleSelected}  accounts`;
  }

  function renderPageStatus() {
    const ready = runtime.sessionReady;
    refs.sessionDot.classList.toggle("ready", ready);
    if (runtime.storageCorrupt) refs.pageStatus.textContent = "Local data appears corrupted. Read-only mode is enabled to prevent changes.";
    else if (!isFollowingPage()) refs.pageStatus.textContent = "Open your own Following page and scroll to load accounts.";
    else if (ready && runtime.sessionFingerprint) refs.pageStatus.textContent = `Connected to current X session · ${state.users.length ? "Scroll to capture more" : "Waiting for account data"}`;
    else if (ready) refs.pageStatus.textContent = "X session detected but not yet verified.";
    else if (runtime.hookReady) refs.pageStatus.textContent = "Watching page requests; waiting for Following data from X…";
    else refs.pageStatus.textContent = "Connecting to X…";
  }

  function renderJob() {
    const job = state.job;
    refs.jobCard.hidden = !job;
    if (!job) {
      refs.start.textContent = "Add to List";
      return;
    }
    recomputeJobStats(job);
    const p = globalThis.XListJob.progress(job);
    refs.jobStatus.textContent = jobStatusLabel(job.status);
    refs.jobProgressText.textContent = `${p.done} / ${p.total}`;
    refs.progressFill.style.width = `${p.percent}%`;
    const current = globalThis.XListJob.firstRunnable(job);
    refs.jobMeta.textContent = `${p.pending}  pending · ${job.successCount || 0} Succeeded · ${job.alreadyCount || 0} Already added · ${job.failureCount || 0} Failed${current ? ` · Next @${escapeHtml(state.users.find((u) => u.id === current.userId)?.handle || current.userId)}` : ""}`;
    const batchCooldown = job.status === "cooldown" && job.cooldownReason === "batch";
    const batchWaiting = batchCooldown && job.cooldownUntil > Date.now();
    const platformWaiting = job.status === "cooldown" && job.cooldownReason === "platform" && job.cooldownUntil > Date.now();
    if (batchWaiting) refs.cooldownText.textContent = `About  ${formatDuration(job.cooldownUntil - Date.now())}  until automatic resumption`;
    else if (batchCooldown) refs.cooldownText.textContent = "Will automatically resume when the X session reconnects";
    else if (platformWaiting) refs.cooldownText.textContent = `About  ${formatDuration(job.cooldownUntil - Date.now())}  before you can resume`;
    else refs.cooldownText.textContent = job.status === "completed" ? "Queue completed" : "";
    refs.start.textContent = job.status === "completed" ? "Create new task" : (job.status === "running" ? "Task in progress" : (batchWaiting ? "Cancel delay and resume" : (platformWaiting ? "Waiting for X cooldown" : "Resume previous task")));
    refs.start.disabled = runtime.running || platformWaiting;
    refs.resume.textContent = batchWaiting ? "Cancel delay" : "Resume";
    refs.resume.disabled = runtime.running || job.status === "completed" || platformWaiting;
    refs.pause.disabled = !runtime.running && !["running", "cooldown"].includes(job.status);
  }

  function renderConfirmation() {
    const parsed = parseListUrl(refs.listUrl.value || state.listUrl);
    const pending = state.job ? globalThis.XListJob.progress(state.job).pending : state.selectedIds.length;
    refs.confirmSummary.textContent = `Target List: ${parsed ? `${parsed.id}（valid URL）` : "not set or invalid URL"} · Selected: ${state.selectedIds.length}  accounts · To add: ${pending}  accounts`;
  }

  function renderHistory() {
    const history = Array.isArray(state.history) ? state.history : [];
    refs.historySection.hidden = history.length === 0;
    refs.historyCount.textContent = `${history.length}  tasks`;
    refs.historyList.innerHTML = history.map((job) => {
      recomputeJobStats(job);
      const p = globalThis.XListJob.progress(job);
      const failed = job.queue.filter((item) => item.status === "failed").length;
      const listLabel = escapeHtml(job.listUrl || `list/${job.listId}`);
      return `<article class="history-item" data-history-id="${escapeHtml(job.id)}"><strong>${jobStatusLabel(job.status)} · ${p.done}/${p.total}</strong><div class="history-meta">${listLabel} · Succeeded ${job.successCount || 0} · Already added ${job.queue.filter((item) => item.status === "already_member").length} · Failed ${failed}</div><div class="history-actions"><button data-action="retryHistory" data-history-id="${escapeHtml(job.id)}" ${failed ? "" : "disabled"}>Retry failed items</button><button data-action="exportHistory" data-history-id="${escapeHtml(job.id)}">Export</button><button class="danger" data-action="deleteHistory" data-history-id="${escapeHtml(job.id)}">Delete</button></div></article>`;
    }).join("");
  }

  function render() {
    renderFilters();
    renderPageStatus();
    renderList();
    renderSelection();
    renderJob();
    renderConfirmation();
    renderHistory();
  }

  function mergeUsers(incoming) {
    const map = new Map(state.users.map((user) => [user.id, user]));
    for (const raw of incoming || []) {
      const user = normalizeUser(raw);
      if (!user) continue;
      map.set(user.id, { ...(map.get(user.id) || {}), ...user });
    }
    state.users = Array.from(map.values()).slice(0, MAX_USERS);
    state.selectedIds = state.selectedIds.filter((id) => map.has(id));
    persistSoon();
    if (runtime.panelOpen) render();
  }

  function clearCapturedUsers() {
    if (!state.users.length) return showToast("No captured accounts");
    if (!window.confirm("Clear captured accounts and their selection? This will not delete the active task, progress, or history.")) return;
    state.users = [];
    state.selectedIds = [];
    runtime.filteredUsers = [];
    runtime.captureGeneration += 1;
    runtime.captureClearPending = true;
    persistNow();
    render();
    window.postMessage({ source: SOURCE, kind: "CLEAR_CAPTURED_USERS" }, "*");
    showToast("Captured accounts cleared. Refresh and scroll your Following page to capture them again.");
  }

  function selectFiltered() {
    const set = selectedSet();
    runtime.filteredUsers.forEach((user) => set.add(user.id));
    state.selectedIds = Array.from(set);
    persistSoon();
    render();
  }

  function clearSelection() {
    state.selectedIds = [];
    persistSoon();
    render();
  }

  function invertSelection() {
    const set = selectedSet();
    runtime.filteredUsers.forEach((user) => set.has(user.id) ? set.delete(user.id) : set.add(user.id));
    state.selectedIds = Array.from(set);
    persistSoon();
    render();
  }

  function exportCsv() {
    const chosen = state.users.filter((user) => state.selectedIds.includes(user.id));
    if (!chosen.length) return showToast("Select at least one account first");
    const headers = ["USERID", "handle", "name", "bio", "location", "followers", "following", "posts"];
    const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(","), ...chosen.map((user) => [user.id, user.handle, user.name, user.bio, user.location, user.followers, user.following, user.posts].map(csvCell).join(","))].join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `x-following-selection-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJob() {
    if (!state.job) return showToast("No import task");
    const users = new Map(state.users.map((user) => [user.id, user]));
    const headers = ["USERID", "handle", "name", "status", "attempts", "http_status", "error_code", "error_path", "response_shape", "duration_ms", "last_error"];
    const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(","), ...state.job.queue.map((item) => {
      const user = users.get(item.userId) || {};
      return [item.userId, user.handle || "", user.name || "", item.status, item.attempts || 0, item.httpStatus || 0, item.errorCode || "", item.errorPath || "", item.responseShape || "", item.durationMs || 0, item.lastError || ""].map(csvCell).join(",");
    })].join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `x-list-import-result-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSnapshot() {
    if (!state.job) return showToast("No import task");
    downloadJson(`x-list-job-${state.job.id}.json`, { schemaVersion: state.schemaVersion, exportedAt: Date.now(), job: state.job });
  }

  function importSnapshot() {
    refs.snapshotInput.click();
  }

  function importSnapshotFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const imported = parsed?.job || parsed;
        if (!imported?.id || !imported?.listId || !Array.isArray(imported.queue) || !imported.queue.length) throw new Error("Task snapshot is incomplete");
        if (state.job && !["completed", "stopped"].includes(state.job.status)) throw new Error("Pause or archive the current task first");
        imported.status = "stopped";
        imported.cooldownUntil = 0;
        imported.updatedAt = Date.now();
        imported.queue.forEach((item) => { if (item.status === "in_flight") item.status = "retryable"; });
        state.job = imported;
        state.listUrl = imported.listUrl || state.listUrl;
        persistNow();
        render();
        showToast("Task snapshot imported and validated. You may resume.");
      } catch (error) {
        showToast(`Failed to import task snapshot: ${error?.message || "Invalid format"}`);
      }
    };
    reader.readAsText(file);
  }

  function exportHistory(historyId) {
    const job = state.history.find((entry) => entry.id === historyId);
    if (job) downloadJson(`x-list-job-${job.id}.json`, { schemaVersion: state.schemaVersion, exportedAt: Date.now(), job });
  }

  function retryHistory(historyId) {
    if (state.job && state.job.status !== "completed" && state.job.status !== "stopped") return showToast("Pause or archive the current task first");
    const archived = state.history.find((entry) => entry.id === historyId);
    if (!archived) return;
    const copy = JSON.parse(JSON.stringify(archived));
    copy.id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    copy.status = "paused";
    copy.cooldownUntil = 0;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.queue.forEach((item) => {
      if (["failed", "retryable", "in_flight"].includes(item.status)) {
        item.status = "pending";
        item.attempts = 0;
        item.lastError = "";
        item.httpStatus = 0;
        item.errorCode = "";
        item.errorPath = "";
        item.responseShape = "";
        item.durationMs = 0;
        item.lastAttemptAt = 0;
        item.completedAt = 0;
      }
    });
    state.job = copy;
    persistNow();
    render();
    showToast("Failed items copied to a new task. Click Resume to start.");
  }

  function deleteHistory(historyId) {
    if (!window.confirm("Delete this task from history? Accounts already added to the X List will be unaffected.")) return;
    state.history = state.history.filter((entry) => entry.id !== historyId);
    persistNow();
    render();
  }

  function loadState(saved) {
    if (!saved || typeof saved !== "object") return;
    const invalidJob = saved.job && (!Array.isArray(saved.job.queue) || !saved.job.listId);
    if ((saved.schemaVersion && Number(saved.schemaVersion) > 1) || (saved.users != null && !Array.isArray(saved.users)) || (saved.history != null && !Array.isArray(saved.history)) || invalidJob) {
      runtime.storageCorrupt = true;
      return;
    }
    state.schemaVersion = Number(saved.schemaVersion || 1);
    state.users = Array.isArray(saved.users) ? saved.users.map(normalizeUser).filter(Boolean).slice(0, MAX_USERS) : [];
    state.selectedIds = Array.isArray(saved.selectedIds) ? saved.selectedIds.map(String) : [];
    state.filters = normalizeFilters(saved.filters);
    state.filterDraft = normalizeFilters(saved.filterDraft || state.filters);
    state.listUrl = String(saved.listUrl || "");
    state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    state.job = saved.job ? globalThis.XListJob.normalizeAfterRestart(saved.job) : null;
    state.history = Array.isArray(saved.history) ? saved.history.slice(0, 20) : [];
    state.sessionFingerprint = String(saved.sessionFingerprint || "");
  }

  function addMemberViaPage(listId, userId) {
    const requestId = `add_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        runtime.pendingAdds.delete(requestId);
        resolve({ ok: false, retryable: true, resultKind: "failed", status: 0, message: "Page request timed out" });
      }, 45000);
      runtime.pendingAdds.set(requestId, (result) => { clearTimeout(timeout); resolve(result); });
      window.postMessage({ source: SOURCE, kind: "ADD_MEMBER", requestId, listId, userId }, "*");
    });
  }

  function cooldownFor(status) {
    if (status === 429 || status === 403) return 10 * 60 * 1000;
    if (status === 400) return 2 * 60 * 1000;
    return 60 * 1000;
  }

  function pauseForBatch(job) {
    const settings = job.settings || DEFAULT_SETTINGS;
    return Math.round(randomBetween(settings.pauseMin, settings.pauseMax) * 60 * 1000);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clearCooldownTimers() {
    if (runtime.cooldownTimer) clearTimeout(runtime.cooldownTimer);
    if (runtime.cooldownTicker) clearInterval(runtime.cooldownTicker);
    runtime.cooldownTimer = 0;
    runtime.cooldownTicker = 0;
  }

  function isBatchWaiting(job) {
    return Boolean(job && job.status === "cooldown" && job.cooldownReason === "batch" && Number(job.cooldownUntil || 0) > Date.now());
  }

  function isAutoBatchCooldown(job) {
    return Boolean(job && job.status === "cooldown" && job.cooldownReason === "batch");
  }

  function refreshCooldownDisplay() {
    if (!isAutoBatchCooldown(state.job)) {
      if (runtime.cooldownTicker) clearCooldownTimers();
      return;
    }
    renderJob();
  }

  function scheduleAutoResume(job) {
    clearCooldownTimers();
    if (!isAutoBatchCooldown(job)) return;
    const jobId = job.id;
    const waitMs = Math.max(0, Number(job.cooldownUntil) - Date.now());
    runtime.cooldownTicker = setInterval(refreshCooldownDisplay, 1000);
    runtime.cooldownTimer = setTimeout(() => autoResumeBatch(jobId), waitMs + 25);
  }

  async function autoResumeBatch(jobId) {
    const job = state.job;
    if (!job || job.id !== jobId || !isAutoBatchCooldown(job)) return;
    if (Number(job.cooldownUntil || 0) > Date.now()) return scheduleAutoResume(job);
    if (!runtime.sessionFingerprint) {
      runtime.cooldownTimer = setTimeout(() => autoResumeBatch(jobId), 5000);
      return;
    }
    clearCooldownTimers();
    job.cooldownUntil = 0;
    job.cooldownReason = "";
    await persistNow();
    render();
    runJob();
  }

  async function cancelBatchWaitAndResume() {
    const job = state.job;
    if (!isBatchWaiting(job)) return runJob();
    clearCooldownTimers();
    job.cooldownUntil = 0;
    job.cooldownReason = "";
    await persistNow();
    showToast("Batch delay cancelled. Resuming task.");
    runJob();
  }

  async function runJob() {
    if (runtime.running || !state.job) return;
    const job = state.job;
    if (!(await validateJobForResume(job))) return;
    if (job.status === "completed") return;
    if (job.cooldownUntil && Date.now() < job.cooldownUntil) {
      job.status = "cooldown";
      renderJob();
      if (job.cooldownReason === "batch") {
        scheduleAutoResume(job);
        showToast(`Batch delay; about  ${formatDuration(job.cooldownUntil - Date.now())}  until automatic resumption`);
      } else {
        showToast(`Still cooling down; about  ${formatDuration(job.cooldownUntil - Date.now())}  before resuming`);
      }
      return;
    }
    clearCooldownTimers();
    runtime.running = true;
    runtime.stopRequested = false;
    job.status = "running";
    job.cooldownUntil = 0;
    job.cooldownReason = "";
    await persistNow();
    renderJob();
    try {
      while (!runtime.stopRequested && globalThis.XListJob.firstRunnable(job)) {
        const item = globalThis.XListJob.firstRunnable(job);
        job.currentItemId = item.userId;
        item.status = "in_flight";
        item.attempts = (item.attempts || 0) + 1;
        item.lastAttemptAt = Date.now();
        await persistNow();
        renderJob();
        const result = await addMemberViaPage(job.listId, item.userId);
        item.httpStatus = Number(result.status || 0);
        item.errorCode = String(result.errorCode || "");
        item.errorPath = String(result.errorPath || "");
        item.responseShape = String(result.responseShape || "");
        item.durationMs = Number(result.durationMs || 0);
        if (result.ok) {
          item.status = result.resultKind === "already_member" ? "already_member" : "succeeded";
          item.completedAt = Date.now();
          item.lastError = "";
          job.successCount = (job.successCount || 0) + 1;
        } else if (result.retryable && item.attempts < Number(job.settings.maxAttempts || DEFAULT_SETTINGS.maxAttempts)) {
          item.status = "retryable";
          item.lastError = result.message || `HTTP ${result.status || "?"}`;
          job.status = "cooldown";
          job.cooldownUntil = Date.now() + cooldownFor(result.status);
          job.cooldownReason = "platform";
          await persistNow();
          showToast(`X paused or rejected this operation; ${formatDuration(job.cooldownUntil - Date.now())}  before you can resume`);
          break;
        } else {
          item.status = "failed";
          item.lastError = result.message || `HTTP ${result.status || "?"}`;
          job.failureCount = (job.failureCount || 0) + 1;
        }
        if (globalThis.XListJob.isComplete(job)) {
          job.status = "completed";
          job.completedAt = Date.now();
          break;
        }
        const completed = job.queue.filter((entry) => ["succeeded", "already_member"].includes(entry.status)).length;
        if (completed > 0 && completed % Number(job.settings.batchSize || DEFAULT_SETTINGS.batchSize) === 0) {
          job.status = "cooldown";
          job.cooldownUntil = Date.now() + pauseForBatch(job);
          job.cooldownReason = "batch";
          await persistNow();
          scheduleAutoResume(job);
          showToast(`Processed  ${completed}  accounts; starting batch pause`);
          break;
        }
        await persistNow();
        renderJob();
        await delay(randomBetween(Number(job.settings.betweenMin), Number(job.settings.betweenMax)) * 1000);
      }
      if (!globalThis.XListJob.firstRunnable(job) && job.queue.length) {
        job.status = "completed";
        job.completedAt = Date.now();
      } else if (runtime.stopRequested && job.status === "running") {
        job.status = "paused";
      }
    } finally {
      job.currentItemId = "";
      runtime.running = false;
      await persistNow();
      render();
    }
  }

  async function validateJobForResume(job) {
    const parsed = parseListUrl(refs.listUrl.value || job.listUrl);
    if (!parsed || parsed.id !== String(job.listId) || parsed.id !== String(parseListUrl(job.listUrl)?.id || "")) {
      showToast("The target List URL does not match this task. Restore the original URL or archive the task.");
      return false;
    }
    if (!runtime.sessionFingerprint) {
      showToast("Current X session has not been verified. Wait for the page request before resuming.");
      return false;
    }
    if (job.ownerFingerprint && job.ownerFingerprint !== runtime.sessionFingerprint) {
      showToast("You're signed into a different X account. Resuming has been blocked.");
      return false;
    }
    const ids = job.queue.map((item) => String(item.userId));
    if (job.queueHash && job.queueHash !== await queueFingerprint(job.listId, ids)) {
      showToast("Task queue validation failed. Resuming is blocked to prevent incorrect additions.");
      return false;
    }
    return true;
  }

  async function startOrResume() {
    if (runtime.running) return;
    if (runtime.storageCorrupt) return showToast("Local data appears corrupted. Export or clear data before starting again.");
    if (state.job && state.job.status !== "completed") return cancelBatchWaitAndResume();
    const parsed = parseListUrl(refs.listUrl.value);
    if (!parsed) return showToast("Enter a valid X List share URL");
    if (!state.selectedIds.length) return showToast("Select the accounts you want to add first");
    if (state.selectedIds.length > 5000) return showToast("A single X List supports a maximum of 5,000 accounts");
    if (!refs.ackRisk.checked) return showToast("Acknowledge the risks of bulk operations on your X session first");
    if (!runtime.sessionFingerprint) return showToast("Current X session has not been verified. Wait for the page request before starting.");
    state.listUrl = refs.listUrl.value.trim();
    state.settings = currentSettings();
    const queueHash = await queueFingerprint(parsed.id, state.selectedIds);
    state.job = globalThis.XListJob.createJob({ listUrl: state.listUrl, listId: parsed.id, selectedIds: state.selectedIds, settings: state.settings, queueHash, ownerFingerprint: runtime.sessionFingerprint });
    runJob();
  }

  function resumeJob() {
    if (!state.job) return startOrResume();
    if (state.job.status === "completed") return;
    cancelBatchWaitAndResume();
  }

  function pauseJob() {
    if (!state.job) return;
    clearCooldownTimers();
    runtime.stopRequested = true;
    state.job.status = "paused";
    state.job.cooldownUntil = 0;
    state.job.cooldownReason = "";
    persistNow();
    renderJob();
  }

  function stopJob() {
    if (!state.job) return;
    clearCooldownTimers();
    runtime.stopRequested = true;
    state.job.status = "stopped";
    state.job.cooldownUntil = 0;
    state.job.cooldownReason = "";
    persistNow();
    renderJob();
    showToast("Task stopped. Unprocessed items are saved for later resumption or archiving.");
  }

  function archiveJob() {
    if (!state.job) return showToast("No active task");
    if (runtime.running) return showToast("Pause the task before ending it");
    if (!window.confirm("End the current task? It will not resume automatically and will be saved in history.")) return;
    const archived = JSON.parse(JSON.stringify({ ...state.job, status: state.job.status === "completed" ? "completed" : "stopped" }));
    clearCooldownTimers();
    state.history = [archived, ...(state.history || [])].slice(0, 20);
    state.job = null;
    persistNow();
    render();
  }

  function onMessage(event) {
    if (event.source !== window || event.data?.source !== SOURCE) return;
    const data = event.data;
    if (data.kind === "X_HOOK_READY") runtime.hookReady = true;
    if (data.kind === "X_SESSION_READY") {
      runtime.sessionReady = Boolean(data.ready || data.fingerprint);
      runtime.sessionFingerprint = String(data.fingerprint || runtime.sessionFingerprint || "");
      if (runtime.sessionFingerprint) state.sessionFingerprint = runtime.sessionFingerprint;
      persistSoon();
      if (isBatchWaiting(state.job)) scheduleAutoResume(state.job);
    }
    if (data.kind === "X_CAPTURE_CLEARED") {
      runtime.captureGeneration = Number(data.captureGeneration || runtime.captureGeneration);
      runtime.captureClearPending = false;
    }
    if (data.kind === "X_USERS" || data.kind === "X_SNAPSHOT") {
      const generation = Number(data.captureGeneration || 0);
      if (!runtime.captureClearPending && generation >= runtime.captureGeneration) {
        runtime.captureGeneration = generation;
        mergeUsers(data.users);
      }
    }
    if (data.kind === "X_ADD_RESULT") {
      const resolve = runtime.pendingAdds.get(data.requestId);
      if (resolve) { runtime.pendingAdds.delete(data.requestId); resolve(data); }
    }
    if (runtime.panelOpen) renderPageStatus();
  }

  async function init() {
    window.addEventListener("message", onMessage);
    chrome.runtime.onMessage.addListener((message) => { if (message?.type === "TOGGLE_PANEL") runtime.panelOpen ? closePanel() : openPanel(); });
    createUi();
    try {
      loadState(await globalThis.XListStore.load());
    } catch (error) {
      showToast(`Failed to read local data: ${error?.message || "storage error"}`);
    }
    render();
    if (isBatchWaiting(state.job)) scheduleAutoResume(state.job);
    window.postMessage({ source: SOURCE, kind: "REQUEST_SNAPSHOT" }, "*");
  }

  init();
})();
