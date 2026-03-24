# Changelog

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
