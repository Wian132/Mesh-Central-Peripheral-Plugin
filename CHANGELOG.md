# Changelog

## 0.2.1

- Aligned the shipped package metadata with the published plugin manifest so installs and local tooling now report the same plugin version.
- Added a visible startup summary line to MeshCentral server output showing the plugin version plus FamousRecon config health, making restart verification easier even when historical `mesherrors.txt` entries are stale.

## 0.1.25

- Removed the POS-only device type gate from the shutdown waterfall so both POS and Other devices can participate in nightly shutdown orchestration, controlled entirely by the backend's `participates_in_waterfall` flag.

## 0.1.24

- Restructured the Famous Recon admin panel section into clear Telemetry Export and Fleet Control sub-sections, replacing the misleading "Legacy" labels with "Fleet endpoint URL" and "Fleet API key" so the shutdown orchestration fields are no longer mistaken for deprecated options.
- Added a Shutdown Debug panel to the admin page with on-demand loading, config health badges, per-device status table with color-coded results, and summary counts for quick fleet-wide shutdown diagnostics without SSH.

## 0.1.23

- Added Office activation diagnostic telemetry fields for richer Admin troubleshooting: license description, error code, and error description.
- FamousRecon exports can now surface specific OSPP-style activation problems such as `0xC004E022` instead of only the generic `notification` status.

## 0.1.22

- Fixed Office probe path detection for Click-to-Run installs under `Microsoft Office\\root\\Office16`, which was causing some Admin devices to report Office as `unknown` even though Microsoft 365 was installed.
- Added a meshcore regression test to keep the `root\\Office16` Office probe paths covered.

## 0.1.21

- Fixed FamousRecon Office export when the plugin is left on `Preserve existing device type`, so Office status, product, and expiry are no longer dropped from mixed Admin/POS/Other rollouts.
- Kept the generic health signals unchanged while updating payload tests to cover the preserve-existing-device-type path explicitly.

## 0.1.20

- Fixed `vnextdiag.ps1 -action list` normalization for the real JSON-style output emitted by Microsoft 365 endpoints, so Admin Office status no longer falls through to `unknown`.
- Updated the Office probe to prefer `vnextdiag.ps1` when it exposes live license records, with `OSPP.VBS` retained as the fallback for older perpetual-style installs.
- Added `officeExpiresAt` / `office_expires_at` through the MeshCentral plugin export path so FamousRecon can track when the detected Office entitlement expires.
- Added fixture coverage for JSON-style `vnextdiag` payloads with `NotAfter` dates and updated export-row tests for the new Office expiry field.

## 0.1.19

- Enabled scheduled scans by default for new installs while still requiring explicit `scope.meshIds` or `scope.nodeIds` targets before any device is polled.
- Added a config migration that auto-enables scheduled scans for older scoped installs created with the previous scheduler-off default, so pilot groups start scanning immediately after upgrade.

## 0.1.18

- Added `admin` as a valid FamousRecon device type override in config validation, admin UI, and test coverage.
- Extended the FamousRecon payload contract with optional `healthSignals` and mapped the new fields into direct Supabase columns: `pending_reboot`, `office_activation_status`, `office_product_name`, `unexpected_shutdown_count_7d`, and `disk_health_status`.
- Added read-only Windows health collection for pending reboot on every scan plus Office activation, unexpected shutdown count, and disk health on full scans.
- Office activation now probes `OSPP.VBS /dstatus` first and falls back to `vnextdiag.ps1 -action list` for Microsoft 365 Apps when available.
- Full-scan health signals are cached and merged into later status-scan exports so Admin Office activation survives lightweight status polling.
- Legacy HTTP export now retries once without `healthSignals` when an older FamousRecon endpoint rejects that field.
- Direct Supabase export now retries once without unsupported plugin/health columns when posting into an older schema.
- Added fixture-driven tests for Office normalization, merged health-signal behavior, backward-compat retries, and the Admin device type path.
- Gated the Supabase E2E test behind environment variables so `npm test` stays green by default while `npm run test:e2e:supabase` remains available for manual credentialed validation.
- Plugin upgrades now queue one-time full refreshes for scoped online Windows agents automatically, and agents that reconnect later will also refresh until they have completed a full scan on the new plugin version.

## 0.1.15

- Switched meshcore PowerShell execution from stdin piping to direct `-File` invocation, fixing scan timeouts on machines where the mesh agent's `child_process` stdin was not flushing reliably.
- The plugin now runs `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File crp-xxx.ps1` instead of starting an interactive PowerShell process and writing the script path to stdin.
- This eliminates the dependency on stdin buffering behavior in the mesh agent runtime, which was causing indefinite hangs on STEMAIN2/STEMAIN3 while working fine on DEBMAIN1/DEBMAIN2.

## 0.1.14

- Optimized the meshcore PowerShell collector for slow POS hardware that was timing out at 120 seconds.
- Full scans now use `Get-PnpDevice -PresentOnly` instead of enumerating all historical/ghost devices (typically 10x fewer items).
- Removed the redundant `Win32_PnPEntity` WMI query from full scans; `Get-PnpDevice` already covers the same devices.
- Replaced `Test-Connection` ping calls with direct `System.Net.NetworkInformation.Ping` using a hard 2-second timeout, eliminating cmdlet startup overhead and long blocking waits on flaky networks.
- Status scans also use `-PresentOnly` consistently now.

## 0.1.13

- Replaced broken HTTP-to-middleware telemetry export with direct Supabase PostgREST inserts into `server_telemetry`.
- Added `supabaseUrl` and `supabaseAnonKey` config fields under `integrations.famousRecon`; when set, the plugin resolves `server_id` from `fleet_servers` by `mesh_node_id` and inserts telemetry rows directly.
- Legacy HTTP endpoint fields (`endpointUrl`, `apiKey`) are preserved for backward compatibility but ignored when Supabase is configured.
- Added Supabase URL and anon key input fields to the plugin admin panel.
- Created RLS policies on FamousRecon Supabase: `plugin_lookup_fleet_server` (SELECT on `fleet_servers`), `plugin_insert_telemetry` (INSERT on `server_telemetry`), `plugin_read_own_telemetry` and `plugin_delete_own_telemetry` (scoped to `collector_kind = 'meshcentral_plugin'`).
- Added unit tests for `buildSupabaseRow`, `resolveServerId`, and `sendTelemetryToSupabase`.
- Added E2E test (`tests/supabase-e2e.test.js`) that inserts, verifies, and cleans up a real telemetry row against live Supabase.
- Rows inserted by the plugin use `telemetry_source = 'agent'` and `collector_kind = 'meshcentral_plugin'`.

## 0.1.12

- Famous Recon export: detailed plugin debug lines for each attempt (URL host/path, masked `x-api-key`, header set, payload size, key `metrics.*` fields), HTTP status on success, and truncated error bodies on failure; explicit skip reasons when export is enabled but gated by `exportOnStatusScans` / `exportOnFullScans` or missing CSName/nodeId.
- Added `scripts/verify-famous-recon-deploy.sh` for on-server checks (installed plugin version, `lib/famous-recon.js` presence, masked runtime `integrations.famousRecon` settings, log correlation hints).

## 0.1.11

- Fixed device-page timestamp rendering so `Last Full Scan` and `Next Due` stay human-readable when MeshCentral stores scan times as epoch milliseconds.
- Added Windows storage and network summary collection alongside CPU, RAM, OS, and uptime telemetry.
- Added optional FamousRecon export settings in the plugin admin panel so POS and Other device telemetry can be forwarded into the CentralRecon dashboard pipeline.
- Added automated coverage for the FamousRecon payload builder and the new system-summary normalization paths.

## 0.1.10

- Fixed a client-side script escaping regression that could leave the device page shell visible but the content area blank.
- Added a regression test that syntax-checks the rendered device-page browser script.

## 0.1.9

- Added extra bottom padding to the device page so the lower tables are easier to reach inside MeshCentral.
- Fixed uptime boot-time parsing for Windows DMTF-style timestamps so `Booted` no longer shows `Invalid Date`.
- Added a regression test for Windows boot-time normalization.

## 0.1.8

- Fixed a MeshCentral startup-order bug where the plugin could cache a null `webserver` reference and crash the server when opening device pages.
- Resolved webserver access lazily at request/dispatch time so plugin routes stay safe after server restarts.
- Added a regression test covering delayed webserver attachment.

## 0.1.7

- Added CPU, RAM, OS, and uptime collection from Windows via `Win32_Processor` and `Win32_OperatingSystem`.
- Surfaced system telemetry in the device tab without treating normal CPU/RAM fluctuation as an inventory-change event.
- Added no-cache headers for plugin HTML/API responses so upgraded UI changes show up more reliably after plugin updates.

## 0.1.6

- Improved the device tab to default to a more meaningful POS-focused view instead of a raw Windows inventory dump.
- Added summary cards for physical printers, serial ports, scanners, and focused-device counts.
- Tagged likely virtual/system printers and added a focused-vs-full inventory toggle.
- Treated the first successful full scan as a baseline in the UI so the initial import reads more clearly.

## 0.1.5

- Removed explicit `utf8` file-encoding arguments from the meshcore collector file I/O to avoid the live agent `unsupported encoding in method 'handleServerCommand()'` exception.

## 0.1.4

- Adjusted the meshcore PowerShell argument list to explicit tokens while keeping the temp-file/stdin execution pattern.
- This avoids the meshcore startup error `number required, found undefined (stack index 1)` seen on the live agent.

## 0.1.3

- Replaced the meshcore collector `-EncodedCommand` launch with a temp `.ps1` plus temp JSON file pattern that better matches known-working MeshCentral agent plugin execution.
- Avoided `Buffer` usage in the meshcore collector to stay compatible with the agent runtime.
- Added a regression test for temp-file PowerShell execution setup.

## 0.1.2

- Switched the meshcore collector from stdin-fed PowerShell commands to `-EncodedCommand` for better compatibility with Mesh agent runtime process handling.
- Added clearer scan failure diagnostics for PowerShell spawn failures and zero-output runs.

## 0.1.1

- Fixed the meshcore PowerShell launch arguments so manual and scheduled scans return JSON correctly on Windows agents.
- Improved the empty-output error message when PowerShell exits successfully but returns no JSON payload.
- Added a regression test for the meshcore collector PowerShell invocation.

## 0.1.0

- Initial release of the CentralRecon Peripherals MeshCentral plugin.
- Added device tab and plugin admin UI.
- Added status and full Windows scan modes.
- Added normalized printer/peripheral snapshots, hashing, and diffs.
- Added payment-terminal candidate heuristics.
- Added automated tests and rollout documentation.
