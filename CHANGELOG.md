# Changelog

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
