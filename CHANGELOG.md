# Changelog

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
