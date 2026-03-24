"use strict";

const { escapeHtml } = require("./utils");

function serializeForInlineScript(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderDevicePage(params) {
    const title = escapeHtml(params.title || "CentralRecon Peripherals");
    const nodeId = escapeHtml(params.nodeId || "");
    const canRefresh = params.canRefresh === true;
    const apiBase = escapeHtml(params.apiBase);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; --ink:#1e293b; --muted:#64748b; --line:#cbd5e1; --bg:#f8fafc; --panel:#ffffff; --accent:#0f766e; --accent-soft:#ccfbf1; --warn:#92400e; --error:#991b1b; }
    body { margin:0; font:14px/1.4 "Segoe UI", Tahoma, sans-serif; color:var(--ink); background:linear-gradient(180deg,#f8fafc 0%,#eef2ff 100%); }
    .wrap { padding:16px 16px 104px; }
    .hero { display:flex; justify-content:space-between; align-items:center; gap:16px; background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:16px 18px; box-shadow:0 10px 30px rgba(15,23,42,0.06); }
    h1 { margin:0; font-size:20px; }
    .sub { color:var(--muted); }
    button { background:var(--accent); color:#fff; border:0; border-radius:999px; padding:10px 16px; cursor:pointer; font-weight:600; }
    button[disabled] { opacity:.5; cursor:not-allowed; }
    .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); margin-top:16px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:16px; box-shadow:0 10px 30px rgba(15,23,42,0.04); }
    .metric { font-size:24px; font-weight:700; margin-top:4px; }
    .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .status { display:inline-flex; padding:4px 10px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-weight:600; }
    .status.error { background:#fee2e2; color:var(--error); }
    .status.warn { background:#fef3c7; color:var(--warn); }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:10px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
    th { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
    .table-card { margin-top:16px; overflow:auto; }
    .mono { font-family:Consolas, "Courier New", monospace; font-size:12px; }
    .empty { color:var(--muted); padding:8px 0; }
    .split { display:grid; gap:16px; grid-template-columns:2fr 1fr; margin-top:16px; }
    .list { margin:0; padding-left:18px; }
    .meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
    .pill { display:inline-flex; padding:4px 8px; border-radius:999px; background:#e2e8f0; color:#334155; font-size:12px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:12px; }
    .ghost-button { background:#fff; color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:8px 14px; cursor:pointer; font-weight:600; }
    .ghost-button.active { background:var(--accent-soft); color:var(--accent); border-color:#99f6e4; }
    .note { color:var(--muted); margin-top:10px; }
    #content { padding-bottom:48px; }
    @media (max-width:900px) { .split { grid-template-columns:1fr; } .hero { flex-direction:column; align-items:flex-start; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div>
        <h1>${title}</h1>
        <div class="sub">Device: <span class="mono">${nodeId}</span></div>
      </div>
      <div>
        <button id="refreshButton"${canRefresh ? "" : " disabled"}>${canRefresh ? "Run Full Refresh" : "View Only"}</button>
      </div>
    </div>
    <div id="message" class="sub" style="margin-top:12px;"></div>
    <div id="content"></div>
  </div>
  <script>
    const apiBase = ${serializeForInlineScript(apiBase)};
    const nodeId = ${serializeForInlineScript(params.nodeId)};
    const canRefresh = ${canRefresh ? "true" : "false"};
    let currentData = null;
    let inventoryMode = 'focused';

    function fmtDate(value) {
      if (!value) { return "Never"; }
      const parsed = parseDateValue(value);
      return parsed ? parsed.toLocaleString() : String(value);
    }

    function fmtBytes(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) { return "n/a"; }
      const units = ["B", "KB", "MB", "GB", "TB"];
      let size = numeric;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }
      const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
      return size.toFixed(digits) + " " + units[unitIndex];
    }

    function fmtUptime(value) {
      if (!value) { return "n/a"; }
      const startedAt = parseDateValue(value);
      if (!startedAt) { return "n/a"; }
      let remainingMs = Date.now() - startedAt.getTime();
      if (!Number.isFinite(remainingMs) || remainingMs < 0) { return "n/a"; }

      const dayMs = 24 * 60 * 60 * 1000;
      const hourMs = 60 * 60 * 1000;
      const minuteMs = 60 * 1000;
      const days = Math.floor(remainingMs / dayMs);
      remainingMs -= days * dayMs;
      const hours = Math.floor(remainingMs / hourMs);
      remainingMs -= hours * hourMs;
      const minutes = Math.floor(remainingMs / minuteMs);
      const parts = [];
      if (days > 0) { parts.push(days + "d"); }
      if (hours > 0 || days > 0) { parts.push(hours + "h"); }
      parts.push(minutes + "m");
      return parts.join(" ");
    }

    function parseDateValue(value) {
      const text = String(value == null ? '' : value).trim();
      if (!text) { return null; }

      const nativeDate = new Date(text);
      if (!Number.isNaN(nativeDate.getTime())) { return nativeDate; }

      const dmtfMatch = text.match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(?:\\.(\\d{1,6}))?([+-]\\d{3}|[-+]\\d{4}|Z)?$/);
      if (dmtfMatch) {
        const year = Number(dmtfMatch[1]);
        const month = Number(dmtfMatch[2]) - 1;
        const day = Number(dmtfMatch[3]);
        const hour = Number(dmtfMatch[4]);
        const minute = Number(dmtfMatch[5]);
        const second = Number(dmtfMatch[6]);
        const millisecond = Math.floor(Number((dmtfMatch[7] || '0').slice(0, 3).padEnd(3, '0')));
        const offsetRaw = dmtfMatch[8] || '';
        let utcMillis = Date.UTC(year, month, day, hour, minute, second, millisecond);

        if (/^[+-]\\d{3,4}$/.test(offsetRaw)) {
          const normalizedOffset = offsetRaw.length === 4 ? offsetRaw : (offsetRaw[0] + '0' + offsetRaw.slice(1));
          const sign = normalizedOffset[0] === '-' ? -1 : 1;
          const offsetMinutes = sign * Number(normalizedOffset.slice(1));
          utcMillis -= offsetMinutes * 60 * 1000;
        }

        const parsed = new Date(utcMillis);
        if (!Number.isNaN(parsed.getTime())) { return parsed; }
      }

      const epochMatch = text.match(/^\\/Date\\((\\d+)\\)\\/$/);
      if (epochMatch) {
        const parsed = new Date(Number(epochMatch[1]));
        if (!Number.isNaN(parsed.getTime())) { return parsed; }
      }

      return null;
    }

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function tableMarkup(columns, rows, emptyText) {
      if (!rows || rows.length === 0) { return '<div class="empty">' + esc(emptyText) + '</div>'; }
      const head = '<tr>' + columns.map((column) => '<th>' + esc(column.label) + '</th>').join('') + '</tr>';
      const body = rows.map((row) => '<tr>' + columns.map((column) => '<td>' + (column.render ? column.render(row) : esc(row[column.key])) + '</td>').join('') + '</tr>').join('');
      return '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    }

    function normalizeLower(value) {
      return String(value == null ? '' : value).trim().toLowerCase();
    }

    function fmtStatus(value) {
      const normalized = normalizeLower(value);
      const labels = {
        unknown: 'Detected',
        ok: 'OK',
        idle: 'Idle',
        offline: 'Offline',
        error: 'Error',
        printing: 'Printing',
        'warming-up': 'Warming up',
        'stopped-printing': 'Stopped printing'
      };
      if (!normalized) { return 'Detected'; }
      return labels[normalized] || normalized.replace(/-/g, ' ').replace(/\\b\\w/g, (char) => char.toUpperCase());
    }

    function classifyPrinter(printer) {
      const name = normalizeLower(printer.name);
      const port = normalizeLower(printer.portName);
      if (/(fax|microsoft print to pdf|microsoft xps document writer|onenote|adobe pdf|rustdesk printer)/.test(name)) { return 'virtual'; }
      if (/(shrfax|portprompt|nul|xps|pdf|rustdesk)/.test(port)) { return 'virtual'; }
      return 'physical';
    }

    function printerRoles(printer) {
      const roles = printer.matchedRoles || [];
      if (roles.length > 0) { return roles.join(', '); }
      return classifyPrinter(printer) === 'virtual' ? 'virtual-printer' : 'printer';
    }

    function hasRole(peripheral, role) {
      return (peripheral.matchedRoles || []).indexOf(role) >= 0;
    }

    function isFocusedPeripheral(peripheral) {
      const roles = peripheral.matchedRoles || [];
      if (roles.some((role) => ['payment-terminal-candidate', 'scanner', 'serial', 'printer'].indexOf(role) >= 0)) { return true; }

      const className = normalizeLower(peripheral.class);
      const name = normalizeLower(peripheral.name);
      if (className === 'ports') { return true; }
      return /(barcode|scanner|payment|pin ?pad|terminal|speedpoint|receipt|printer|cash drawer|scale|com\\d+)/.test(name);
    }

    function summarizeInventory(printers, peripherals, candidates) {
      const physicalPrinters = printers.filter((printer) => classifyPrinter(printer) === 'physical');
      const virtualPrinters = printers.filter((printer) => classifyPrinter(printer) === 'virtual');
      const serialPorts = Array.from(new Set(peripherals.map((peripheral) => normalizeLower(peripheral.serialPort)).filter(Boolean)));
      const focusedPeripherals = peripherals.filter(isFocusedPeripheral);
      const scannerCount = peripherals.filter((peripheral) => hasRole(peripheral, 'scanner')).length;
      const noisyDeviceCount = peripherals.filter((peripheral) => {
        const className = normalizeLower(peripheral.class);
        return hasRole(peripheral, 'input') || hasRole(peripheral, 'display') || className === 'media' || className === 'monitor';
      }).length;

      return {
        physicalPrinters,
        virtualPrinters,
        serialPorts,
        focusedPeripherals,
        scannerCount,
        noisyDeviceCount,
        paymentCandidateCount: candidates.length
      };
    }

    function render(data) {
      currentData = data;
      const content = document.getElementById('content');
      const scanStatusClass = data.scanHealth === 'error' ? 'status error' : (data.scanHealth === 'warning' ? 'status warn' : 'status');
      const printers = (data.printers || []).slice().sort((left, right) => {
        const leftKind = classifyPrinter(left);
        const rightKind = classifyPrinter(right);
        if (leftKind !== rightKind) { return leftKind === 'physical' ? -1 : 1; }
        return normalizeLower(left.name).localeCompare(normalizeLower(right.name));
      });
      const peripherals = (data.peripherals || []);
      const candidates = (data.paymentTerminalCandidates || []);
      const diff = data.diffSummary || { printers: {}, peripherals: {}, paymentTerminalCandidates: {} };
      const warnings = data.warnings || [];
      const errorText = data.lastError ? esc(data.lastError.message || data.lastError.error || data.lastError) : '';
      const summary = summarizeInventory(printers, peripherals, candidates);
      const systemSummary = data.systemSummary || {};
      const cpu = systemSummary.cpu || {};
      const memory = systemSummary.memory || {};
      const operatingSystem = systemSummary.operatingSystem || {};
      const visiblePeripherals = inventoryMode === 'all' ? peripherals : summary.focusedPeripherals;
      const hiddenPeripheralCount = Math.max(0, peripherals.length - visiblePeripherals.length);
      const baselineText = data.lastFullScanAt && !data.hasPreviousFullSnapshot
        ? 'Baseline captured on the first successful full scan. Future scans will show meaningful adds, removals, and changes.'
        : '';
      const cpuMetric = cpu.loadPercent != null ? esc(String(cpu.loadPercent) + '%') : esc(cpu.model ? 'Detected' : 'n/a');
      const cpuDetailParts = [];
      if (cpu.model) { cpuDetailParts.push(cpu.model); }
      if (cpu.totalCores || cpu.totalLogicalProcessors) {
        cpuDetailParts.push(String(cpu.totalCores || '?') + ' cores / ' + String(cpu.totalLogicalProcessors || '?') + ' logical');
      }
      if (cpu.maxClockSpeedMHz) {
        cpuDetailParts.push(String(Math.round(cpu.maxClockSpeedMHz / 100) / 10) + ' GHz max');
      }
      const ramMetric = (memory.usedBytes != null && memory.totalBytes != null)
        ? esc(fmtBytes(memory.usedBytes) + ' / ' + fmtBytes(memory.totalBytes))
        : esc(memory.totalBytes != null ? fmtBytes(memory.totalBytes) : 'n/a');
      const ramDetail = memory.usedPercent != null
        ? 'Used ' + esc(String(memory.usedPercent)) + '% | Free ' + esc(fmtBytes(memory.freeBytes))
        : 'No live memory usage reported yet.';
      const systemMetric = esc(operatingSystem.computerName || operatingSystem.caption || 'n/a');
      const systemDetailParts = [];
      if (operatingSystem.caption) { systemDetailParts.push(operatingSystem.caption); }
      if (operatingSystem.version) { systemDetailParts.push('Version ' + operatingSystem.version); }
      const systemDetail = systemDetailParts.length > 0 ? esc(systemDetailParts.join(' | ')) : 'No operating-system details reported yet.';
      const uptimeMetric = esc(fmtUptime(operatingSystem.lastBootUpTime));
      const uptimeDetail = operatingSystem.lastBootUpTime ? 'Booted: ' + esc(fmtDate(operatingSystem.lastBootUpTime)) : 'No boot-time data reported yet.';

      content.innerHTML = \`
        <div class="grid">
          <div class="card"><div class="label">Scan Health</div><div class="metric"><span class="\${scanStatusClass}">\${esc(data.scanHealth || 'unknown')}</span></div><div class="sub">Running: \${esc(data.runningMode || 'none')} | Queued full: \${data.queuedFull ? 'yes' : 'no'}</div></div>
          <div class="card"><div class="label">Last Status Scan</div><div class="metric">\${esc(fmtDate(data.lastStatusScanAt))}</div><div class="sub">Hash: <span class="mono">\${esc(data.statusHash || 'n/a')}</span></div></div>
          <div class="card"><div class="label">Last Full Scan</div><div class="metric">\${esc(fmtDate(data.lastFullScanAt))}</div><div class="sub">Snapshot changed: \${data.changedSincePrevious ? 'yes' : 'no'}</div></div>
          <div class="card"><div class="label">Next Due</div><div class="metric">\${esc(fmtDate(data.nextDueAt))}</div><div class="sub">Status: \${esc(fmtDate(data.nextStatusScanAt))}<br>Full: \${esc(fmtDate(data.nextFullScanAt))}</div></div>
        </div>
        <div class="grid">
          <div class="card"><div class="label">POS Printers</div><div class="metric">\${summary.physicalPrinters.length}</div><div class="sub">Virtual/system printers: \${summary.virtualPrinters.length}</div></div>
          <div class="card"><div class="label">Serial Ports</div><div class="metric">\${summary.serialPorts.length}</div><div class="sub">\${summary.serialPorts.length ? esc(summary.serialPorts.map((port) => port.toUpperCase()).join(', ')) : 'No COM ports detected'}</div></div>
          <div class="card"><div class="label">Scanners</div><div class="metric">\${summary.scannerCount}</div><div class="sub">Payment terminal candidates: \${summary.paymentCandidateCount}</div></div>
          <div class="card"><div class="label">Focused Devices</div><div class="metric">\${summary.focusedPeripherals.length}</div><div class="sub">Background/system noise in full inventory: \${summary.noisyDeviceCount}</div></div>
        </div>
        <div class="grid">
          <div class="card"><div class="label">CPU</div><div class="metric">\${cpuMetric}</div><div class="sub">\${esc(cpuDetailParts.join(' | ') || 'No CPU details reported yet.')}</div></div>
          <div class="card"><div class="label">RAM</div><div class="metric">\${ramMetric}</div><div class="sub">\${ramDetail}</div></div>
          <div class="card"><div class="label">System</div><div class="metric">\${systemMetric}</div><div class="sub">\${systemDetail}</div></div>
          <div class="card"><div class="label">Uptime</div><div class="metric">\${uptimeMetric}</div><div class="sub">\${uptimeDetail}</div></div>
        </div>
        <div class="split">
          <div class="card">
            <div class="label">Latest Notes</div>
            \${baselineText ? '<div class="note">' + esc(baselineText) + '</div>' : '<div class="meta">' +
              '<span class="pill">Printers +' + esc((diff.printers.added || []).length) + '/-' + esc((diff.printers.removed || []).length) + '/~' + esc((diff.printers.changed || []).length) + '</span>' +
              '<span class="pill">Peripherals +' + esc((diff.peripherals.added || []).length) + '/-' + esc((diff.peripherals.removed || []).length) + '/~' + esc((diff.peripherals.changed || []).length) + '</span>' +
              '<span class="pill">Terminals +' + esc((diff.paymentTerminalCandidates.added || []).length) + '/-' + esc((diff.paymentTerminalCandidates.removed || []).length) + '</span>' +
            '</div>'}
            \${warnings.length ? '<ul class="list">' + warnings.map((warning) => '<li>' + esc(warning) + '</li>').join('') + '</ul>' : '<div class="empty">No warnings.</div>'}
            \${errorText ? '<div style="margin-top:12px;color:#991b1b;"><strong>Last error:</strong> ' + errorText + '</div>' : ''}
          </div>
          <div class="card">
            <div class="label">Payment Terminal Candidates</div>
            \${candidates.length ? '<ul class="list">' + candidates.map((candidate) => '<li><strong>' + esc(candidate.name || candidate.instanceId || 'candidate') + '</strong> (' + esc(String(Math.round((candidate.confidence || 0) * 100))) + '%) ' + '<div class="sub">' + esc((candidate.matchedRuleLabels || []).join(', ')) + '</div></li>').join('') + '</ul>' : '<div class="empty">No candidates matched the current payment-terminal rules yet.</div>'}
          </div>
        </div>
        <div class="card table-card">
          <div class="label">Printers</div>
          <div class="note">Physical printers are shown first. Virtual/system printers are still listed, but tagged so they are easier to ignore.</div>
          \${tableMarkup([
            { label: 'Name', key: 'name' },
            { label: 'Kind', render: (row) => esc(classifyPrinter(row)) },
            { label: 'Status', render: (row) => esc(fmtStatus(row.status)) },
            { label: 'Port', key: 'portName' },
            { label: 'Roles', render: (row) => esc(printerRoles(row)) },
            { label: 'Offline', render: (row) => esc(row.isOffline ? 'yes' : 'no') },
            { label: 'Error', render: (row) => esc(row.isError ? 'yes' : 'no') }
          ], printers, 'No printers detected yet.')}
        </div>
        <div class="card table-card">
          <div class="label">Peripherals</div>
          <div class="toolbar">
            <button type="button" class="ghost-button \${inventoryMode === 'focused' ? 'active' : ''}" data-view="focused">Focused View</button>
            <button type="button" class="ghost-button \${inventoryMode === 'all' ? 'active' : ''}" data-view="all">Full Inventory</button>
            <div class="sub">\${inventoryMode === 'focused'
              ? 'Showing ' + esc(visiblePeripherals.length) + ' POS-relevant items out of ' + esc(peripherals.length) + ' total. Hidden mostly: displays, input devices, and audio/system components.'
              : 'Showing the full merged Windows device inventory, including background and built-in devices.'}</div>
          </div>
          \${tableMarkup([
            { label: 'Type', key: 'type' },
            { label: 'Name', key: 'name' },
            { label: 'Class', key: 'class' },
            { label: 'Status', render: (row) => esc(fmtStatus(row.status)) },
            { label: 'Port', key: 'serialPort' },
            { label: 'Instance ID', render: (row) => '<span class="mono">' + esc(row.instanceId || '') + '</span>' },
            { label: 'Roles', render: (row) => esc((row.matchedRoles || []).join(', ')) }
          ], visiblePeripherals, inventoryMode === 'focused' ? 'No POS-relevant peripherals detected in the current snapshot.' : 'No peripherals detected yet.')}
          \${inventoryMode === 'focused' && hiddenPeripheralCount > 0 ? '<div class="note">' + esc(hiddenPeripheralCount) + ' lower-signal Windows devices are hidden in Focused View. Switch to Full Inventory if you need the raw merged device list.</div>' : ''}
        </div>\`;

      content.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => {
          inventoryMode = button.getAttribute('data-view') || 'focused';
          render(currentData);
        });
      });
    }

    async function fetchState() {
      const response = await fetch(apiBase + '&api=device-state&nodeid=' + encodeURIComponent(nodeId), { credentials: 'same-origin' });
      if (!response.ok) { throw new Error('Unable to load device state.'); }
      return response.json();
    }

    async function runRefresh() {
      if (!canRefresh) { return; }
      const form = new URLSearchParams();
      form.set('action', 'manualScan');
      form.set('nodeid', nodeId);
      const response = await fetch(apiBase, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: form.toString()
      });
      const result = await response.json();
      document.getElementById('message').textContent = result.message || 'Full scan requested.';
      return refresh();
    }

    async function refresh() {
      try {
        const data = await fetchState();
        render(data);
      } catch (error) {
        document.getElementById('message').textContent = error.message;
      }
    }

    document.getElementById('refreshButton').addEventListener('click', runRefresh);
    refresh();
    setInterval(refresh, 15000);
  </script>
</body>
</html>`;
}

function renderAdminPage(params) {
    const title = escapeHtml(params.title || "CentralRecon Peripherals Settings");
    const apiBase = escapeHtml(params.apiBase);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; --ink:#1f2937; --muted:#6b7280; --line:#d1d5db; --panel:#ffffff; --accent:#14532d; --accent-soft:#dcfce7; --bg:#f3f4f6; }
    body { margin:0; font:14px/1.4 "Segoe UI", Tahoma, sans-serif; color:var(--ink); background:radial-gradient(circle at top left,#dcfce7,transparent 30%), var(--bg); }
    .wrap { max-width:1100px; margin:0 auto; padding:20px; }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:20px; box-shadow:0 10px 30px rgba(15,23,42,0.05); margin-bottom:16px; }
    h1, h2 { margin:0 0 12px 0; }
    .sub { color:var(--muted); }
    label { display:block; margin-bottom:10px; font-weight:600; }
    input[type="text"], input[type="number"], textarea { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--line); border-radius:12px; font:inherit; }
    textarea { min-height:110px; resize:vertical; }
    .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
    .actions { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
    button { background:var(--accent); color:#fff; border:0; border-radius:999px; padding:10px 18px; font-weight:700; cursor:pointer; }
    .mesh-list { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); }
    .mesh-item { border:1px solid var(--line); border-radius:14px; padding:12px; }
    .chip { display:inline-flex; background:var(--accent-soft); color:var(--accent); padding:4px 8px; border-radius:999px; font-size:12px; margin-bottom:6px; }
    .status { color:var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <h1>${title}</h1>
      <div class="sub">Configure safe rollout scope, scan cadence, and matching heuristics.</div>
    </div>
    <div id="app"></div>
  </div>
  <script>
    const apiBase = ${serializeForInlineScript(apiBase)};

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    async function loadState() {
      const response = await fetch(apiBase + '&api=admin-state', { credentials: 'same-origin' });
      if (!response.ok) { throw new Error('Unable to load admin state.'); }
      return response.json();
    }

    function render(state) {
      const config = state.config;
      const meshList = state.meshes || [];
      const app = document.getElementById('app');
      app.innerHTML = \`
        <form id="configForm">
          <div class="panel">
            <h2>Schedule</h2>
            <div class="grid">
              <label><input type="checkbox" name="enabled" \${config.schedule.enabled ? 'checked' : ''}> Enable scheduled scans</label>
              <label><input type="checkbox" name="fullOnReconnect" \${config.schedule.fullOnReconnect ? 'checked' : ''}> Full scan on reconnect</label>
              <label><input type="checkbox" name="fullOnDetectedChange" \${config.schedule.fullOnDetectedChange ? 'checked' : ''}> Full scan on detected status change</label>
              <label><input type="checkbox" name="advancedOneMinuteFullInventory" \${config.schedule.advancedOneMinuteFullInventory ? 'checked' : ''}> Allow 1-minute full inventory mode</label>
            </div>
            <div class="grid" style="margin-top:16px;">
              <label>Status interval (minutes)<input type="number" min="1" max="60" name="statusIntervalMinutes" value="\${esc(config.schedule.statusIntervalMinutes)}"></label>
              <label>Full interval (minutes)<input type="number" min="1" max="1440" name="fullIntervalMinutes" value="\${esc(config.schedule.fullIntervalMinutes)}"></label>
              <label>Scheduler tick (seconds)<input type="number" min="5" max="60" name="evaluationIntervalSeconds" value="\${esc(config.schedule.evaluationIntervalSeconds)}"></label>
              <label>Jitter (seconds)<input type="number" min="0" max="60" name="jitterSeconds" value="\${esc(config.schedule.jitterSeconds)}"></label>
            </div>
          </div>
          <div class="panel">
            <h2>Execution</h2>
            <div class="grid">
              <label>PowerShell timeout (ms)<input type="number" min="10000" max="300000" name="powershellTimeoutMs" value="\${esc(config.execution.powershellTimeoutMs)}"></label>
              <label>Max concurrent scans<input type="number" min="1" max="10" name="maxConcurrentScans" value="\${esc(config.execution.maxConcurrentScans)}"></label>
              <label>Full scan cooldown (seconds)<input type="number" min="30" max="900" name="fullScanCooldownSeconds" value="\${esc(config.execution.fullScanCooldownSeconds)}"></label>
              <label>Failure event cooldown (minutes)<input type="number" min="1" max="1440" name="failureEventCooldownMinutes" value="\${esc(config.logging.failureEventCooldownMinutes)}"></label>
            </div>
            <label style="margin-top:16px;"><input type="checkbox" name="changeEvents" \${config.logging.changeEvents ? 'checked' : ''}> Emit change events into MeshCentral</label>
          </div>
          <div class="panel">
            <h2>Target Device Groups</h2>
            <div class="mesh-list">
              \${meshList.map((mesh) => '<label class="mesh-item"><span class="chip">' + esc(mesh._id) + '</span><div><input type="checkbox" name="meshIds" value="' + esc(mesh._id) + '" ' + (config.scope.meshIds.indexOf(mesh._id) >= 0 ? 'checked' : '') + '> ' + esc(mesh.name || mesh._id) + '</div><div class="status">' + esc(mesh.desc || 'No description') + '</div></label>').join('')}
            </div>
            <label style="margin-top:16px;">Explicit node allowlist (one node id per line)<textarea name="nodeIds">\${esc((config.scope.nodeIds || []).join('\\n'))}</textarea></label>
          </div>
          <div class="panel">
            <h2>Matching Rules</h2>
            <label>Printer matching rules (JSON)<textarea name="printerRules">\${esc(JSON.stringify(config.matching.printers, null, 2))}</textarea></label>
            <label>Payment terminal matching rules (JSON)<textarea name="paymentRules">\${esc(JSON.stringify(config.matching.paymentTerminals, null, 2))}</textarea></label>
          </div>
          <div class="panel actions">
            <button type="submit">Save Configuration</button>
            <div id="saveStatus" class="sub"></div>
          </div>
        </form>\`;

      document.getElementById('configForm').addEventListener('submit', saveConfig);
    }

    async function saveConfig(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        schedule: {
          enabled: form.enabled.checked,
          fullOnReconnect: form.fullOnReconnect.checked,
          fullOnDetectedChange: form.fullOnDetectedChange.checked,
          advancedOneMinuteFullInventory: form.advancedOneMinuteFullInventory.checked,
          statusIntervalMinutes: Number(form.statusIntervalMinutes.value),
          fullIntervalMinutes: Number(form.fullIntervalMinutes.value),
          evaluationIntervalSeconds: Number(form.evaluationIntervalSeconds.value),
          jitterSeconds: Number(form.jitterSeconds.value)
        },
        scope: {
          meshIds: Array.from(form.querySelectorAll('input[name="meshIds"]:checked')).map((element) => element.value),
          nodeIds: form.nodeIds.value.split(/\\r?\\n/).map((value) => value.trim()).filter(Boolean)
        },
        execution: {
          powershellTimeoutMs: Number(form.powershellTimeoutMs.value),
          maxConcurrentScans: Number(form.maxConcurrentScans.value),
          fullScanCooldownSeconds: Number(form.fullScanCooldownSeconds.value)
        },
        logging: {
          changeEvents: form.changeEvents.checked,
          failureEventCooldownMinutes: Number(form.failureEventCooldownMinutes.value)
        },
        matching: {
          printers: JSON.parse(form.printerRules.value),
          paymentTerminals: JSON.parse(form.paymentRules.value)
        }
      };

      const body = new URLSearchParams();
      body.set('action', 'saveConfig');
      body.set('payload', JSON.stringify(payload));

      const response = await fetch(apiBase, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString()
      });
      const result = await response.json();
      document.getElementById('saveStatus').textContent = result.message || (result.ok ? 'Saved.' : 'Save failed.');
      if (!response.ok) { throw new Error(result.message || 'Save failed.'); }
    }

    loadState().then(render).catch((error) => {
      document.getElementById('app').innerHTML = '<div class="panel"><strong>Unable to load admin state.</strong><div class="sub">' + esc(error.message) + '</div></div>';
    });
  </script>
</body>
</html>`;
}

module.exports = {
    renderAdminPage,
    renderDevicePage
};
