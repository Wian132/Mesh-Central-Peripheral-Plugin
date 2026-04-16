# Project Context: MeshCentral Peripheral Plugin

## 1. Project Overview
* **Nature:** MeshCentral server plugin + Windows meshcore module + PowerShell collectors.
* **Core Responsibility:** Hardware health monitoring (Printers/Network/Power) and peripheral inventory for POS/Admin/Office Windows machines.
* **Telemetry Destination:** CentralRecon fleet API (`/api/fleet/mesh-plugin-telemetry`).
* **Current Version:** 0.4.0 — API-only export. Direct Supabase path was retired in v0.4.0.

---

## 2. Plugin ↔ MeshCentral Core Integration

### Server-side lifecycle hooks (`centralreconperipherals.js`)

| Hook | Purpose |
|---|---|
| `server_startup` | Loads config, starts scheduler interval (15s), queues plugin-upgrade full scans for online agents |
| `hook_agentCoreIsStable` | Agent connected → clears unsupported backoff, dispatches reconnect full scan if enabled |
| `hook_setupHttpHandlers` | Registered but empty — all HTTP routes go through `pluginadmin.ashx` |
| `onDeviceRefreshEnd` | Injects "CentralRecon" iframe tab into the MeshCentral device page |
| `serveraction` | Receives `scanResult` and `shutdownResult` messages from the meshcore module |
| `handleAdminReq` | GET handler: admin config page, device state page, shutdown debug API |
| `handleAdminPostReq` | POST handler: `saveConfig`, `manualScan` |

### Meshcore module (`modules_meshcore/centralreconperipherals.js`) — runs on the Windows agent

| Agent command | What it does |
|---|---|
| `pluginaction: "scan"` | Writes a temp `.ps1`, runs `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`, reads JSON output file, sends back `pluginaction: "scanResult"` |
| `pluginaction: "shutdown"` | Runs `shutdown.exe /s /t <countdown>` via PS wrapper, sends back `pluginaction: "shutdownResult"` |

### Data flow

```
MeshCentral Server                   Windows Agent (meshcore)
   evaluateSchedule()
       └─ agent.send({ pluginaction: "scan", mode, requestId })
                                            └─ buildPowerShellScript()
                                            └─ execFile powershell.exe -File crp-xxx.ps1
                                            └─ JSON written to crp-xxx.json
                                            └─ mesh.SendCommand({ pluginaction: "scanResult", payload })
   serveraction("scanResult")
       └─ handleScanResult()
       └─ normalizeStatusPayload() / normalizeFullPayload()
       └─ exportTelemetryIfConfigured()
           └─ buildTelemetryPayload()
           └─ POST /api/fleet/mesh-plugin-telemetry
```

---

## 3. PowerShell Scan Modes

### Status scan (fast, default every 5 min)
Collects: printers, filtered PnP devices, system summary, pending reboot check.

```powershell
Get-Printer                          # live printer list + status (Win32_Printer fallback)
Get-PnpDevice -PresentOnly           # filtered by class: Printer/USB/Ports/HIDClass/Keyboard/Mouse/Monitor/Image/Camera/Bluetooth
Win32_Processor                      # CPU model, cores, load%
Win32_OperatingSystem                # OS name, version, CSName, boot time, memory
Win32_LogicalDisk (DriveType=3)      # system drive size/free
Win32_NetworkAdapterConfiguration    # IP, gateway; + netsh wlan for WiFi SSID/signal
Test-PendingReboot                   # 3 registry key checks (CBS, WindowsUpdate, PendingFileRenameOperations)
```

### Full scan (deep, default every 15 min — adds these on top of status scan)
```powershell
Win32_SerialPort                     # serial port enumeration (COM port names, baud, PNP IDs)
Get-OfficeActivationProbe            # vnextdiag.ps1 -action list first; OSPP.VBS /dstatus fallback
Get-UnexpectedShutdownCount7d        # Event Log ID 6008 last 7 days
Get-PhysicalDisk                     # disk health (HealthStatus, OperationalStatus)
```

---

## 4. Auth

Auth is **HTTP-header only**. No OAuth, no session tokens, no cookies.

### Headers sent on every request (telemetry POST + agent-config GET)

| Header | Value | Description |
|---|---|---|
| `x-api-key` | `integrations.famousRecon.apiKey` | The Fleet Org Key (FOK) stored in plugin config |
| `x-device-id` | Windows `CSName` (computer name) | Device identity for backend routing |
| `x-mesh-node-id` | MeshCentral `nodeId` | Server-side mesh node reference |
| `x-device-type` | `pos` / `admin` / `other` / `server` | Optional device classification |
| `Content-Type` | `application/json` | POST only |

### Config location
```json
{
  "integrations": {
    "famousRecon": {
      "enabled": true,
      "endpointUrl": "https://<hub>/api/fleet/mesh-plugin-telemetry",
      "apiKey": "<FOK>",
      "deviceType": "pos",
      "forceShutdownAppsClosed": false,
      "exportOnStatusScans": true,
      "exportOnFullScans": true,
      "requestTimeoutMs": 10000
    }
  }
}
```

**Note:** `supabaseUrl` + `supabaseAnonKey` fields still exist in config schema for migration detection but are flagged as deprecated and ignored for exports since v0.4.0.

### Agent config endpoint (shutdown waterfall control)
The plugin derives a second endpoint from `endpointUrl` by replacing the path suffix:
- `/api/fleet/mesh-plugin-telemetry` → `/api/fleet/agent-config`

Uses a `GET` request with the same identity headers. Returns `shutdown_state` used by the waterfall.

---

## 5. Telemetry Payload Structure

Built by `buildTelemetryPayload()` in `lib/famous-recon.js`.

```json
{
  "source": "meshcentral-plugin",
  "pluginVersion": "0.4.0",
  "reportedAt": "<ISO timestamp>",
  "scanMode": "status | full",
  "nodeId": "<meshcentral node ID>",
  "deviceId": "<Windows CSName>",
  "deviceType": "pos | admin | other | server | ''",
  "lastStatusScanAt": 1234567890000,
  "lastFullScanAt": 1234567890000,
  "inventoryHash": "<sha256 hex>",
  "inventoryChanged": true,

  "systemSummary": {
    "cpu": {
      "model": "Intel Core i5-8500 @ 3.00GHz",
      "totalCores": 6,
      "totalLogicalProcessors": 6,
      "maxClockSpeedMHz": 3000,
      "loadPercent": 31
    },
    "memory": {
      "totalBytes": 17179869184,
      "freeBytes": 6442450944,
      "usedBytes": 10737418240,
      "usedPercent": 62
    },
    "operatingSystem": {
      "computerName": "FISHMAIN5",
      "caption": "Microsoft Windows 10 Pro",
      "version": "10.0.19045",
      "lastBootUpTime": "2026-03-24T05:30:00.000Z"
    },
    "storage": {
      "systemDrive": "C:",
      "totalBytes": 499963174912,
      "freeBytes": 200000000000,
      "usedBytes": 299963174912,
      "usedPercent": 60
    },
    "network": {
      "state": "online | lan_only | unknown",
      "linkType": "ethernet | wifi",
      "ipAddress": "192.168.1.10",
      "wifiSsid": "MyNetwork",
      "wifiSignalPercent": 85,
      "gatewayPingMs": 2,
      "internetPingMs": 18
    }
  },

  "metrics": {
    "cpuPercent": 31,
    "memoryPercent": 62,
    "memoryTotalGb": 16,
    "memoryAvailableGb": 6,
    "diskPercent": 60,
    "diskFreeGb": 186.26,
    "uptimeHours": 23.5,
    "osVersion": "Microsoft Windows 10 Pro | 10.0.19045",
    "ipAddress": "192.168.1.10",
    "networkState": "online",
    "networkLinkType": "ethernet",
    "wifiSsid": null,
    "wifiSignalPercent": null,
    "gatewayPingMs": 2,
    "internetPingMs": 18
  },

  "printers": [
    {
      "name": "Epson TM-T88VI Receipt",
      "status": "idle",
      "port_name": "USB001",
      "is_offline": false,
      "is_error": false,
      "matched_roles": ["receipt-printer"]
    }
  ],

  "peripherals": [
    {
      "type": "payment-terminal",
      "name": "Verifone VX820 Pin Pad",
      "id": "USB\\VID_11CA&PID_0200\\TERM001",
      "status": "OK",
      "manufacturer": "Verifone",
      "class": "Ports",
      "serial_port": "COM4",
      "matchedRoles": ["payment-terminal-candidate"],
      "present": true,
      "location": ""
    }
  ],

  "paymentTerminalCandidates": [],

  "warnings": [],

  "healthSignals": {
    "pendingReboot": false,
    "unexpectedShutdownCount7d": 0,
    "diskHealthStatus": "healthy | warning | critical | unknown",
    "officeActivationStatus": "licensed | unlicensed | notification | unknown",
    "officeProductName": "Microsoft 365 Apps for Business",
    "officeExpiresAt": "2027-01-01T00:00:00.000Z",
    "officeLicenseDescription": "...",
    "officeErrorCode": null,
    "officeErrorDescription": null
  }
}
```

**Notes:**
- `healthSignals` is omitted from the payload if all values are null/empty.
- `pendingReboot` is collected on every scan (status + full). All other health signals are full-scan only, but merged into subsequent status exports from cache.
- If the endpoint returns a 4xx response mentioning `healthSignals` in the body, the plugin retries once without that field (backward-compat for older hub versions).
- Hash dedup: the plugin skips export when the hash is unchanged, but forces a re-export at least every 15 minutes.

---

## 6. Shutdown Waterfall

Every scheduler cycle (`evaluateShutdownWaterfall`):

1. For each online scoped Windows agent, fetch `GET /api/fleet/agent-config` (cached for 60s).
2. Read `response.data.shutdown_state`:
   - `participates_in_waterfall` — if false, skip device.
   - `slot_due_now` + `current_slot_key` — if no active slot, skip.
   - `shutdown_allowed` — if false, mark `blocked` with `blocking_reasons`.
3. If allowed, dispatch: `agent.send({ pluginaction: "shutdown", requestId, slotKey, countdownSec, forceAppsClosed })`.
4. Agent runs: `shutdown.exe /s /t <countdown> /c "<message>"` (optionally `/f` for force-close).
5. On countdown expiry: agent sends `shutdownResult: { status: "cancelled" | "error" | ... }`.
6. If user runs `shutdown /a`: result is `cancelled`, `declinedDate` is recorded — no retry for that night.
7. Blocked slots with status `blocked` or `control_error` are retryable within the same slot window.

**Config knobs:**
- `forceShutdownAppsClosed` (default `false`) — adds `/f` flag.
- `shutdown_countdown_sec` comes from the backend response (default 300s, min 30s).

---

## 7. Key Files

| File | Role |
|---|---|
| `centralreconperipherals.js` | Plugin entry point: scheduler, lifecycle hooks, HTTP handlers |
| `modules_meshcore/centralreconperipherals.js` | Agent-side collector: PS script builder, scan runner, shutdown runner |
| `lib/famous-recon.js` | Telemetry payload builder, HTTP send, auth headers, agent-config fetch |
| `lib/normalize.js` | Normalizes raw PS output into typed snapshots (printers, peripherals, health signals) |
| `lib/config.js` | Default config, sanitize/migrate, `SHORT_NAME` |
| `lib/scheduler.js` | Scan scheduling logic (status/full intervals, due mode, jitter) |
| `lib/matching.js` | Printer and payment terminal matching rules (compiled regex) |
| `lib/persistence.js` | Per-device state persistence (JSON files in MeshCentral data dir) |
| `lib/diff.js` | Builds inventory diff between full snapshots |
| `lib/ui.js` | Renders admin + device page HTML |

---

## 8. Supabase Tables (Referenced — Hub owns the schema)

The plugin no longer writes directly to Supabase. The Hub (`FamousRecon`) ingests telemetry via the fleet API. For reference, the old direct-insert columns were:

- `fleet_servers`: `id`, `mesh_node_id`, `computer_name`, `device_type`
- `server_telemetry`: `server_id`, `collector_kind` (`meshcentral_plugin`), `telemetry_source` (`agent`), `reported_at`, `scan_mode`, `plugin_version`, `cpu_percent`, `memory_percent`, `memory_total_gb`, `memory_available_gb`, `disk_percent`, `disk_free_gb`, `uptime_hours`, `os_version`, `ip_address`, `network_state`, `network_link_type`, `pending_reboot`, `office_activation_status`, `office_product_name`, `unexpected_shutdown_count_7d`, `disk_health_status`, `inventory_hash`, `inventory_changed`, `printers` (jsonb), `peripherals` (jsonb), `warnings` (text[])

The live schema in FamousRecon may differ — always verify via Supabase MCP before writing migrations.
