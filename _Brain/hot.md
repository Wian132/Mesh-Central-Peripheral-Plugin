# Hot Cache — CentralRecon Peripheral Plugin

**Date:** 2026-04-17 | **Plugin version:** 0.4.1

---

## Current State

The plugin is in production operation. All core subsystems are functional and the architecture is stable post-v0.4.1 metadata refresh.

---

## Functionality Currently In Place

### Scan engine
- **Status scan** (default every 5 min): printers, filtered PnP devices, system summary (CPU/RAM/OS/network/storage), pending reboot.
- **Full scan** (default every 15 min): everything in status scan + serial ports, Office activation, unexpected shutdown count (7d), physical disk health.
- Scans are dispatched server-side and run via a temp `.ps1` file on the agent (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File`).
- `Get-PnpDevice -PresentOnly` used on both scan types (no ghost device enumeration).
- PS-level ping uses `System.Net.NetworkInformation.Ping` directly (no `Test-Connection` overhead).

### Telemetry export
- Exports to `POST /api/fleet/mesh-plugin-telemetry` via `x-api-key` + `x-device-id` + `x-mesh-node-id` headers.
- Hash dedup: skips export when status/full hash is unchanged; forces re-export every 15 min regardless.
- Backward-compat retry: if endpoint rejects `healthSignals` field (4xx), retries once without it.
- Deprecated Supabase direct-insert path removed in v0.4.0. `supabaseUrl`/`supabaseAnonKey` config fields are detected and flagged but ignored.

### Printer monitoring
- Two PS collection methods with fallback: `Get-Printer` → `Win32_Printer`.
- Printer status normalized from numeric `PrinterStatus` codes (1–7) + string `Status` + `ExtendedPrinterStatus`.
- `isOffline`: set if `WorkOffline = true` OR status text is "offline".
- `isError`: set if `ErrorInformation` or status text contains "error", or status is "stopped-printing" / "paper-out".
- **Matching rules** (compiled regex at startup): receipt printers (Epson TM, Star TSP, Bixolon), label printers (Zebra, Brother QL/GK/ZD), payment terminals (Verifone, Ingenico, PAX, Speedpoint, serial-port heuristics).
- Printer status change events emitted to MeshCentral event log (per printer, on status/offline/error transitions).
- Full scan diff emits inventory-change events with `+/-/~` counts per category.

### Payment terminal candidate detection
- Heuristic matching across PnP devices: name regex, manufacturer regex, instanceId regex, class (`Ports` for serial payment hints).
- Candidates surfaced in both status and full snapshots; promoted to `matchedRoles: ["payment-terminal-candidate"]`.

### Health signals (full scan, merged into status exports)
- `pendingReboot`: 3 registry key checks (CBS, WindowsUpdate, PendingFileRenameOperations).
- `unexpectedShutdownCount7d`: Event Log ID 6008, last 7 days.
- `diskHealthStatus`: worst across all physical disks (`healthy` / `warning` / `critical` / `unknown`).
- `officeActivationStatus`: `licensed` / `unlicensed` / `notification` / `unknown`.
- `officeProductName`, `officeExpiresAt`, `officeLicenseDescription`, `officeErrorCode`, `officeErrorDescription`.
- Office probe: `vnextdiag.ps1 -action list` preferred (M365 Click-to-Run); `OSPP.VBS /dstatus` fallback for perpetual installs. Both `Program Files` and `Program Files (x86)` paths checked; `root\Office16` Click-to-Run path covered.

### Shutdown waterfall (nightly POS/Admin power-down)
- Runs every scheduler cycle alongside scan evaluation.
- Fetches `GET /api/fleet/agent-config` per device (cached 60s).
- Backend returns `shutdown_state.participates_in_waterfall`, `slot_due_now`, `shutdown_allowed`, `blocking_reasons`, `current_slot_key`.
- Dispatches `shutdown.exe /s /t <countdown>` via PS wrapper; optional `/f` (force-close apps) via `forceShutdownAppsClosed` config.
- User cancel path: `shutdown /a` → agent reports `shutdownResult: cancelled` → `declinedDate` set, no retry that night.
- Blocked slots (`shutdown_allowed: false`) record `blocking_reasons`; status `blocked` and `control_error` are retryable within the same slot.
- `activeUntil` grace window prevents double-dispatch while countdown is in progress.
- Both POS and Other device types participate (no device-type gate since v0.1.25).

### Scheduler
- Server-side interval: 15s evaluation cycle.
- Per-device: next status scan time, next full scan time, jitter (0–15s default).
- `queuedFull` flag: ensures one follow-up full scan when status hash changes.
- `unsupportedUntil`: non-Windows agents back off for 6 hours after `unsupported` response.
- Plugin-upgrade full scans auto-queued on startup and on reconnect for agents that haven't run the current plugin version.
- `fullScanCooldownSeconds` (120s default) prevents rapid full scan churn on status changes.

### MeshCentral UI integration
- Device tab: CentralRecon iframe injected via `onDeviceRefreshEnd`.
- Admin page: config editor, scope management, shutdown debug panel (on-demand, color-coded per-device status).
- All routes served through `pluginadmin.ashx?pin=centralreconperipherals`.
- No-cache headers on all plugin HTML/API responses.

---

## Recent Additions (v0.3.x – v0.4.1)

### v0.4.1 — metadata refresh
- Bumped plugin metadata to publish a fresh MeshCentral update after the related Admin office shutdown rollout landed in FamousRecon.
- No plugin runtime behavior changed in this release; the shutdown logic update itself lives in the hub backend.

### v0.4.0 — API-only export
- **Retired direct Supabase export path.** Telemetry now goes exclusively to `Famous Recon fleet API`. No more double-writes to `server_telemetry`.
- Admin UI and startup logs updated to reflect API-only path; deprecated direct-DB config still detected and flagged.
- Legacy Supabase E2E tests removed; shipped plugin surface now matches production architecture.

### v0.3.4 — Shutdown waterfall retry fix
- Fixed bug where a `blocked` device would not be re-checked during the same slot window after backend unblocked it.

### v0.3.3 — Force-shutdown flag + shutdown diagnostics
- Added `forceShutdownAppsClosed` config option (adds `/f` to `shutdown.exe`). Default off; cannot bypass trading-hour protections.
- Shutdown now uses a PowerShell wrapper to capture `shutdown.exe` stdout/stderr reliably.

### v0.3.2 — Shutdown failure diagnostics
- Non-zero `shutdown.exe` exit now records exit code + stdout/stderr instead of opaque error string.

### v0.3.1 — Force export every 15 min
- Hash dedup forced re-export at 15-min threshold to keep dashboard freshness accurate.

### v0.3.0 — Hash dedup + status interval increase
- Hash-based export deduplication added (~90% reduction in redundant writes).
- Default status interval raised from 1 min to 5 min for new installs.

---

## Known Config Gotchas

- `scope.meshIds` or `scope.nodeIds` must be set — no devices are scanned until scope is configured.
- `integrations.famousRecon.enabled` must be `true` AND `endpointUrl` + `apiKey` must be set for exports.
- `supabaseUrl`/`supabaseAnonKey` present in config → startup warns "directDbDeprecated=present"; harmless but should be cleared.
- `deviceType` accepted values: `pos`, `admin`, `other`, `server` (empty string = "preserve existing").

---

## Next Likely Work Areas

- Hub-side ingestion of the new `healthSignals` fields into dashboard views.
- Potential: network speed test (currently only latency ping, no bandwidth).
- Potential: Aura POS daily batch export integration into this plugin's scan cycle.
