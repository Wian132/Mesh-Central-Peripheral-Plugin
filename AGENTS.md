# CentralRecon MeshCentral Plugin Agent Instructions

## Mission

Build a production-oriented MeshCentral plugin for CentralRecon that can be installed into an existing self-hosted MeshCentral instance and used to monitor Windows POS peripherals with no second custom Windows agent/service/exe on the endpoint.

The plugin must use MeshCentral as the transport and operational vehicle. The target outcome is:

- one installed MeshCentral agent per endpoint
- plugin deployable from MeshCentral's plugin mechanism
- no MeshCentral core fork
- no manual patching of MeshCentral source files
- no separate CentralRecon Windows telemetry executable for this plugin's scope

This repository is for the plugin only, not for the main CentralRecon app and not for a MeshCentral fork.

## Context

CentralRecon already has:

- a MeshCentral server running on a Hetzner VPS
- an existing CentralRecon application and fleet dashboard
- prior custom telemetry scripts/executables for servers and POS devices

The immediate plugin goal is narrower than the existing exporter/maintenance stack:

- detect printers connected to a Windows POS or server
- show printer online/offline state where Windows exposes it
- detect peripheral inventory and changes over time
- attempt to identify payment terminal / Speedpoint-like devices using configurable heuristics
- surface this inside MeshCentral first

This plugin is not required to replace the existing Aura exporter, backup orchestrator, or maintenance scheduler.

## Primary Product Decision

Prefer the simplest viable MeshCentral plugin architecture:

1. Keep MeshCentral itself stock.
2. Build a standalone plugin repository.
3. Prefer a server-side plugin plus MeshCentral-delivered endpoint logic only where necessary.
4. Prefer read-only Windows inspection commands and passive inventory collection.
5. Avoid introducing a second long-running Windows agent or service.

If two implementation approaches are possible, choose the one with lower operational complexity, easier testing, and easier rollback.

## Important Constraint

Do not assume MeshCentral's plugin system is richly documented for every internal API. Official docs are limited. Use official docs first, then inspect MeshCentral source code only as needed for plugin hooks and safe integration points.

Do not modify MeshCentral core source unless there is no plugin-based path. If you conclude a plugin-only approach is blocked, stop and document the exact blocker instead of silently forking MeshCentral.

## Official Sources To Use First

Use these first and cite them in the README:

- <https://docs.meshcentral.com/meshcentral/plugins/>
- <https://docs.meshcentral.com/meshcentral/agents/>
- <https://docs.meshcentral.com/meshcentral/devicetabs/>
- <https://docs.meshcentral.com/meshctrl/>

Only inspect MeshCentral source after reviewing the docs above.

## Existing Deployment Facts

The current production MeshCentral install is expected to look like:

- install root: `/opt/meshcentral`
- config path: `/opt/meshcentral/meshcentral-data/config.json`
- service name: `meshcentral`

The plugin must be deployable without editing `node_modules/meshcentral` files directly.

The only expected server-level change outside plugin installation is enabling plugins in MeshCentral config:

```json
"settings": {
  "plugins": {
    "enabled": true
  }
}
```

Then restart:

```bash
sudo systemctl restart meshcentral
```

## Non-Goals

Do not attempt these in v1:

- replacing the Aura exporter
- replacing backup orchestration
- replacing Windows Update orchestration
- building a second custom Windows service
- building a full Fleet dashboard clone inside MeshCentral
- requiring FamousRecon APIs for the core plugin to function
- writing a MeshCentral fork

## Target Outcome For v1

The plugin should provide:

1. A MeshCentral device tab or equivalent UI on the device page.
2. Manual refresh for a single device.
3. Optional scheduled refresh for selected Windows devices or selected device groups.
4. Storage of last-known peripheral snapshot and diff state.
5. Readable status for:
   - printers
   - detected peripherals
   - matched payment terminal candidates
   - last scan time
   - scan errors
6. Change detection between scans.
7. Basic event logging when:
   - printer status changes
   - a configured payment terminal candidate appears or disappears
   - peripheral inventory changes

The plugin must degrade gracefully on unsupported devices and non-Windows endpoints.

## Architectural Preference

Use this order of preference:

### Preferred path

Server-side plugin logic triggers remote Windows inspection through existing MeshCentral capabilities and stores normalized results on the server side.

Rationale:

- simpler to debug than custom meshcore logic
- simpler to test on a Windows dev PC
- lower risk than relying immediately on undocumented meshcore behavior
- avoids a second installed endpoint service

### Acceptable fallback

If server-side remote inspection is too limited, use plugin-delivered endpoint logic through `modules_meshcore`, but only if you can explain why the server-side approach is insufficient.

### Avoid

- a second local exe
- NSSM service
- Task Scheduler setup
- custom CentralRecon Windows updater

## Repo Tech Stack

Keep runtime simple:

- plugin runtime: plain JavaScript
- module format: CommonJS unless MeshCentral clearly requires otherwise
- target compatibility: Node 20-compatible server runtime
- avoid TypeScript in runtime paths unless it compiles to clean JS before packaging

Development tooling is allowed if lightweight:

- `npm`
- `node:test` or `vitest` for automated tests
- ESLint only if it does not slow delivery

Do not require a build step on the MeshCentral server if avoidable. The installed plugin contents should be directly runnable JS plus static assets.

## Suggested Repo Layout

Use a layout close to this unless MeshCentral plugin conventions require a different name:

```text
/
  AGENTS.md
  README.md
  CHANGELOG.md
  package.json
  config.json
  centralrecon-peripherals.js
  lib/
  web/
  scripts/
  tests/
  fixtures/
  modules_meshcore/          # only if necessary
```

At minimum, the plugin repo must include:

- plugin `config.json`
- main plugin JS file
- README with install and rollout steps
- changelog
- tests

## Plugin Configuration Requirements

Implement configuration for at least:

- enable or disable scheduled scans
- polling interval in minutes
- allowlist of device groups or device IDs for rollout
- PowerShell timeout
- printer matching rules
- payment terminal matching rules
- vendor/product/name regex configuration
- whether to log change events

The plugin must be safe by default:

- manual scans enabled
- scheduled scans disabled or restricted to explicit test groups until configured

## Windows Data Collection Requirements

The plugin must collect or attempt to collect:

### Printers

Use `Get-Printer` where available. Fallback to WMI/CIM if needed.

Capture:

- printer name
- printer status
- port name
- whether it appears offline or in error

### Peripherals

Use Windows device inventory commands such as:

- `Get-PnpDevice`
- `Win32_PnPEntity`
- `Win32_SerialPort`

Normalize to a common structure with fields like:

- type
- name
- class
- instance id
- manufacturer
- present / status
- matched role if identified

### Payment terminal / Speedpoint heuristic

There will not be a universal built-in Windows class called "Speedpoint". The plugin must use configurable heuristics rather than hard-coded assumptions.

Support matching by:

- device friendly name regex
- manufacturer regex
- instance id regex
- class name
- COM/serial indications

The plugin should expose "candidate" devices when certainty is low rather than pretending certainty it does not have.

## Data Model Requirements

Persist normalized scan results with enough information to compare current vs previous state.

At minimum store:

- device identifier
- last scanned at
- scan source and method
- scan success or error
- printers array
- peripherals array
- payment terminal candidates array
- snapshot hash
- changed since previous scan

If MeshCentral offers a clean plugin-local persistence mechanism, use it. Otherwise, use a plugin-owned JSON data file on the server in a predictable location.

Do not make persistence depend on FamousRecon.

## UI Requirements

Add a device tab if supported cleanly by MeshCentral plugin hooks.

The tab should show:

- last scan timestamp
- scan status
- printers table
- peripherals table
- payment terminal candidates
- whether inventory changed since the previous scan
- manual refresh action if possible

Keep the UI simple and functional. Avoid a heavy frontend build system unless necessary.

## Safety Requirements

All remote commands must be read-only.

Do not:

- install software on the endpoint
- change printer configuration
- restart services
- modify registry values
- update drivers
- write files to POS devices except where MeshCentral itself must manage its own plugin delivery

If you need elevated commands, explain why and keep them read-only.

## Testing Requirements

Be realistic. Full end-to-end automated testing of a MeshCentral plugin is limited unless a real MeshCentral instance and Windows endpoint are available.

You must still produce a serious test strategy with both automated and manual coverage.

### Automated tests required

Implement automated tests for:

- config validation
- parser / normalizer behavior
- hash and change detection behavior
- matching heuristics for printers and payment terminal candidates
- fallback parsing from fixture outputs

Use fixtures for sample command outputs from:

- `Get-Printer`
- `Get-PnpDevice`
- `Win32_PnPEntity`
- error cases

### Local/manual tests required

The plugin should be testable on a Windows development PC connected to MeshCentral in a dedicated test device group.

Manual tests must cover:

1. plugin installation into a test MeshCentral instance or test group
2. manual scan on a Windows dev PC
3. printer detection with any real or virtual printer available
4. peripheral inventory detection
5. change detection by plugging in or removing a USB device
6. graceful behavior when a command is unavailable
7. non-Windows endpoint behavior

### Realism note

You may not be able to fully prove Speedpoint detection on a development PC without actual payment terminal hardware. That is acceptable. In that case:

- implement configurable matching
- provide sample matching rules
- clearly state that live validation against real terminal hardware is still required before broad rollout

## Recommended Manual Test Matrix

Include this or something equivalent in the README:

1. Install plugin in test MeshCentral environment or production test group only.
2. Assign one Windows dev PC to the test group.
3. Trigger manual scan from the plugin UI or plugin action.
4. Confirm:
   - printers list renders
   - peripherals list renders
   - scan timestamp updates
   - no destructive actions occur
5. Plug in a USB flash drive and rescan.
6. Confirm peripheral change is detected.
7. If a network or USB printer is available, disconnect it or disable it and rescan.
8. Confirm offline/error state changes.
9. If no real printer is available, document that offline-printer validation remains pending.
10. If any payment terminal hardware is available later, validate heuristic matching before wider rollout.

## Local Dev Strategy

Prefer this order:

1. Unit tests with fixtures.
2. Smoke testing against either:
   - a local MeshCentral dev instance, or
   - the existing production MeshCentral server using a dedicated test device group and one development PC.

If a local MeshCentral dev instance is practical, create a minimal reproducible setup script or README section. If not, document a safe production-test-group workflow instead.

## Deployment Strategy To Optimize For

Optimize for the simplest realistic deployment that the project owner can perform.

### Preferred deployment strategy

1. Put this plugin in a standalone GitHub repo.
2. Make the plugin installable from MeshCentral's plugin UI.
3. Use proper plugin metadata:
   - `configUrl`
   - `downloadUrl`
   - `changelogUrl`
   - `versionHistoryUrl`
4. Enable plugins in MeshCentral config.
5. Restart MeshCentral once.
6. Install plugin from `My Server -> Plugins -> Download plugin`.
7. Configure plugin to target only a test group first.
8. Validate manually.
9. Expand rollout after successful testing.

### Do not optimize for

- manual copying into MeshCentral source directories as the normal path
- patching MeshCentral internals
- deploying by SSHing in and editing core files

## GitHub Packaging Expectations

Because the repo will be used directly by MeshCentral's plugin installer, the repo must be structured so that:

- the plugin metadata points to valid GitHub-hosted URLs
- a tagged release or branch archive can be used as the plugin zip
- versioning is explicit and semantic

Use real repository URLs if the repo remote is already known. If not, clearly mark placeholders that the owner must replace.

## Required Documentation Deliverables

Produce:

1. `README.md`
   Must explain:
   - what the plugin does
   - what it does not do
   - install steps
   - test steps
   - rollout plan
   - rollback plan

2. `CHANGELOG.md`
   Start with initial version.

3. Example configuration documentation
   Explain:
   - test group restriction
   - scan interval
   - matching rules

4. Deployment section for Hetzner
   Include:
   - config file path `/opt/meshcentral/meshcentral-data/config.json`
   - plugin enable snippet
   - restart command `sudo systemctl restart meshcentral`
   - MeshCentral UI install path

## Rollout Requirements

The plugin must support a cautious rollout:

- first test on one Windows dev PC
- then one or two pilot store devices
- then wider rollout

Do not design the plugin assuming immediate organization-wide scheduled scanning.

## Rollback Requirements

Document exactly how to roll back:

- disable plugin in MeshCentral UI
- uninstall plugin in MeshCentral UI if needed
- remove plugin config
- restart MeshCentral only if required

## Delivery Checklist

Before declaring completion, verify and report:

- plugin repo structure is valid
- plugin metadata file is valid
- automated tests pass
- README contains install, test, rollout, rollback steps
- plugin can be installed without modifying MeshCentral core files
- plugin can be limited to a test group
- known gaps are documented

## Output Format Required From The Agent

At completion, provide:

1. a short architecture summary
2. exact files created
3. automated test status
4. manual tests completed
5. manual tests still required before production rollout
6. exact deployment steps for the owner
7. exact rollback steps
8. known limitations

## Specific Guidance On Scope Decisions

If faced with a choice between:

- a smaller plugin that is installable, testable, and safe
- or a more ambitious plugin that depends on undocumented MeshCentral internals

Choose the smaller installable/testable/safe plugin.

If a feature cannot be proven to work safely through the plugin system in the available environment, document it as a follow-up instead of faking completeness.

## Success Definition

Success means the owner can:

1. create a new GitHub repo with this project
2. install the plugin into MeshCentral without changing MeshCentral core code
3. test it on a Windows dev PC
4. see printers and peripheral inventory in MeshCentral
5. detect basic change events
6. roll it out gradually with low operational burden

Failure means:

- requiring a second custom Windows agent
- requiring a MeshCentral fork
- relying on undocumented hacks without documenting them
- claiming tests were done when they were not
