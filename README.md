# CentralRecon Peripherals Plugin

CentralRecon Peripherals is a stock-MeshCentral plugin for Windows peripheral telemetry. It keeps MeshCentral itself unmodified, installs through MeshCentral's plugin system, uses the existing Mesh agent on the endpoint, and does not introduce a second Windows service or executable.

The plugin focuses on:
- printer status and presence
- meaningful peripheral inventory for Admin/POS/server endpoints
- payment-terminal candidate tagging through configurable heuristics
- CPU, RAM, storage, uptime, and basic network telemetry for Windows devices
- pending reboot and best-effort Windows health signals for FamousRecon export
- snapshot hashing, diffing, and change events
- cautious rollout through explicit test groups and optional scheduled scans

It does not try to replace CentralRecon's broader exporter, backup, or maintenance tooling.

## Architecture

The implementation uses a hybrid design:
- a server plugin for config, scheduling, persistence, normalization, diffs, events, and UI
- a small `modules_meshcore/centralreconperipherals.js` collector for Windows status/full scans

This is intentional. MeshCentral's documented plugin hooks are enough for the server-side pieces, but a small agent module is the cleanest way to do scheduled read-only Windows collection and get structured results back without patching MeshCentral core.

## Default Behavior

Manual refresh remains available.

Scheduled scanning is enabled by default for new installs, but it still only runs for explicit device groups or node IDs in the rollout scope.

Older scoped installs that were created with the previous "scheduler off" default are auto-migrated to scheduled scanning on upgrade, so existing pilot groups start scanning without another admin-panel toggle.

Once enabled, the default cadence is:
- status scan every 1 minute
- full inventory every 15 minutes
- full inventory on manual refresh
- full inventory on agent reconnect
- full inventory on detected status-change

Advanced mode allows 1-minute full inventory, but it is not the default.

When the plugin version itself is upgraded, the plugin automatically queues a one-time full refresh for scoped online Windows agents. Devices that reconnect later will also trigger a full refresh until they have completed one full scan on the new plugin version, so a plugin upgrade does not require opening each device page manually.

## What Gets Collected

Status scans:
- `Get-Printer` with CIM fallback
- `Get-PnpDevice -PresentOnly`
- pending reboot detection from read-only Windows reboot indicators

Full scans:
- `Get-Printer`
- `Get-PnpDevice`
- `Get-CimInstance Win32_PnPEntity`
- `Get-CimInstance Win32_SerialPort`
- `Get-CimInstance Win32_Processor`
- `Get-CimInstance Win32_OperatingSystem`
- `Get-CimInstance Win32_LogicalDisk`
- `OSPP.VBS /dstatus` when available for Office activation
- `vnextdiag.ps1 -action list` as a fallback for Microsoft 365 Apps activation
- `Get-WinEvent` for unexpected shutdown count over the last 7 days
- `Get-PhysicalDisk` for best-effort disk health
- network adapter, gateway, and internet connectivity probes using read-only commands

Normalized printer fields:
- `name`
- `status`
- `portName`
- `isOffline`
- `isError`
- `sourceMethod`

Normalized peripheral fields:
- `type`
- `name`
- `class`
- `instanceId`
- `manufacturer`
- `present`
- `status`
- `location`
- `serialPort`
- `matchedRoles`
- `sourceMethods`

The UI emphasizes meaningful peripherals while the server still stores the fuller raw full-scan payload for diagnostics.

System summary fields:
- CPU model, usage, cores, logical processors, and max clock speed
- RAM total, free, used, and used percent
- OS caption/version and boot time
- system drive used/free space
- network state, link type, IP, Wi-Fi SSID/signal, gateway ping, and internet ping

Health signal fields exported to FamousRecon when available:
- `pendingReboot`
- `officeActivationStatus`
- `officeProductName`
- `unexpectedShutdownCount7d`
- `diskHealthStatus`

Office activation notes:
- Office activation is normalized in JS on the plugin server from raw collector output.
- Admin exports prefer `OSPP.VBS /dstatus` first and fall back to `vnextdiag.ps1 -action list` when OSPP is unavailable or not applicable.
- Expensive health signals are collected on full scans and merged into later status-scan exports from the last known full snapshot.

## Installation

Official MeshCentral references used for this plugin:
- <https://docs.meshcentral.com/meshcentral/plugins/>
- <https://docs.meshcentral.com/meshcentral/agents/>
- <https://docs.meshcentral.com/meshcentral/devicetabs/>
- <https://docs.meshcentral.com/meshctrl/>

On the Hetzner-hosted MeshCentral server, enable plugins in:
- `/opt/meshcentral/meshcentral-data/config.json`

Use:

```json
{
  "settings": {
    "plugins": {
      "enabled": true
    }
  }
}
```

Then restart MeshCentral:

```bash
sudo systemctl restart meshcentral
```

Install from the MeshCentral UI:
1. Log in as full administrator.
2. Go to `My Server -> Plugins`.
3. Click `Download Plugin`.
4. Use the plugin URL or config URL for this repository.
5. Enable the plugin.
6. Open the plugin admin panel and restrict rollout to a dedicated test group first.

The plugin metadata points to:
- `configUrl`: `https://raw.githubusercontent.com/Wian132/Mesh-Central-Peripheral-Plugin/main/config.json`
- `downloadUrl`: `https://github.com/Wian132/Mesh-Central-Peripheral-Plugin/archive/refs/heads/main.zip`
- `changelogUrl`: `https://raw.githubusercontent.com/Wian132/Mesh-Central-Peripheral-Plugin/main/CHANGELOG.md`
- `versionHistoryUrl`: `https://api.github.com/repos/Wian132/Mesh-Central-Peripheral-Plugin/tags`

## Configuration

Key settings:
- `schedule.enabled`
- `schedule.statusIntervalMinutes`
- `schedule.fullIntervalMinutes`
- `schedule.fullOnReconnect`
- `schedule.fullOnDetectedChange`
- `schedule.advancedOneMinuteFullInventory`
- `scope.meshIds`
- `scope.nodeIds`
- `execution.powershellTimeoutMs`
- `execution.maxConcurrentScans`
- `logging.changeEvents`
- `matching.printers[]`
- `matching.paymentTerminals[]`
- `integrations.famousRecon.enabled`
- `integrations.famousRecon.endpointUrl`
- `integrations.famousRecon.apiKey`
- `integrations.famousRecon.deviceType`
- `integrations.famousRecon.exportOnStatusScans`
- `integrations.famousRecon.exportOnFullScans`
- `integrations.famousRecon.requestTimeoutMs`

Recommended v1 rollout config:
- set only one Windows test group in `scope.meshIds`
- leave scheduled scans on once that test group is selected
- leave status interval at `1`
- leave full interval at `15`
- leave `advancedOneMinuteFullInventory` off
- keep `maxConcurrentScans` at `3`

Optional CentralRecon dashboard export:
- leave `integrations.famousRecon.enabled` off until the FamousRecon API route and Supabase migration are deployed
- set `integrations.famousRecon.endpointUrl` to your CentralRecon web app route, for example `https://app.centralrecon.com/api/fleet/mesh-plugin-telemetry`
- use a FamousRecon fleet organization deployment key for `integrations.famousRecon.apiKey`
- set `integrations.famousRecon.deviceType` to `admin`, `pos`, or `other` for this rollout lane
- Office activation fields are only populated when the plugin's FamousRecon device type override is `admin`
- keep server devices on the existing server telemetry lane rather than exporting them through this plugin
- legacy HTTP export retries once without `healthSignals` if an older endpoint rejects that field
- direct Supabase export retries once without unsupported plugin/health columns if the target schema has not been migrated yet

Debugging export (0.1.12+): with Famous Recon enabled, MeshCentral plugin debug output includes each POST attempt (masked API key), HTTP status, failure bodies (truncated), and skip reasons. On the MeshCentral host, run `bash scripts/verify-famous-recon-deploy.sh` (set `MESHCENTRAL_DATA` if your data directory is not `/opt/meshcentral/meshcentral-data`) to confirm the installed plugin version, `lib/famous-recon.js` on disk, and masked runtime integration settings.

## Testing

Automated tests:

```bash
npm test
```

Explicit Supabase E2E coverage remains opt-in:

```bash
npm run test:e2e:supabase
```

Automated coverage includes:
- config validation
- parser and normalizer behavior
- Office activation normalization and merged health-signal behavior
- status/full hash stability
- diff detection
- scheduler no-overlap/cooldown behavior
- payment-terminal heuristics
- metadata and module export checks

## Manual Validation

Primary manual path for v1:
- use the existing production MeshCentral server
- create one dedicated Windows test device group
- place one Windows development PC in that group

Manual test matrix:
1. Install the plugin through MeshCentral's plugin UI.
2. Restrict the plugin to the dedicated test group.
3. Confirm the device tab renders.
4. Trigger a manual full refresh.
5. Confirm printers and peripherals render.
6. Confirm scheduled 1-minute status scans and 15-minute full scans update timestamps.
7. Plug in or remove a USB device and confirm a change is detected.
8. If possible, change printer availability and confirm status transitions are shown.
9. Print while scans run and confirm there is no visible lag on the dev PC.
10. If the dev PC has the actual POS application/peripherals, repeat while using the POS workflow.

If the dev PC does not have the live POS workflow, live POS interaction remains a pre-rollout validation gate.

Optional VM-based validation remains allowed, but it is not required.

## Rollout Plan

1. Enable plugins on MeshCentral.
2. Install the plugin from GitHub.
3. Configure one Windows test group only.
4. Validate on one development PC.
5. Add one or two pilot store devices.
6. Observe scan timings, printer transitions, and peripheral change events.
7. Expand rollout gradually only after the pilot remains stable.

## Rollback

1. Open `My Server -> Plugins`.
2. Disable the plugin.
3. If necessary, remove the plugin from MeshCentral's plugin UI.
4. Remove the plugin's runtime config from the MeshCentral data path if you want a clean re-install later.
5. Restart MeshCentral only if your operational process requires it after plugin changes.

## Known Limitations

- Payment-terminal detection is heuristic and should be treated as candidate matching until validated against real hardware.
- Non-Windows devices return unsupported status instead of inventory data.
- The plugin stores current and previous raw full snapshots, not an unlimited full-history archive.
- Office activation is best-effort and depends on `OSPP.VBS` and/or `vnextdiag.ps1` being present on the endpoint.
- Disk health and unexpected shutdown counts are best-effort full-scan signals and do not block exports if Windows cannot provide them.
- Live POS workflow validation still depends on access to the actual POS application/peripherals.
