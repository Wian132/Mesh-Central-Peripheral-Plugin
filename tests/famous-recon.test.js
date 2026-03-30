"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTelemetryPayload } = require("../lib/famous-recon");

test("telemetry payload converts system summary and inventory into Famous Recon export shape", () => {
    const payload = buildTelemetryPayload({
        nodeId: "node//sample/device1",
        lastStatusScanAt: 1774338113943,
        lastFullScanAt: 1774338113943,
        inventoryHash: "abc123",
        warnings: ["Printer spooler warning"],
        systemSummary: {
            cpu: {
                model: "Intel(R) Celeron(R) CPU J1900 @ 1.99GHz",
                totalCores: 4,
                totalLogicalProcessors: 4,
                maxClockSpeedMHz: 1990,
                loadPercent: 52
            },
            memory: {
                totalBytes: 4294967296,
                freeBytes: 1610612736,
                usedBytes: 2684354560,
                usedPercent: 63
            },
            operatingSystem: {
                computerName: "DEBMAIN2",
                caption: "Microsoft Windows 10 Pro",
                version: "10.0.19045",
                lastBootUpTime: "2026-03-24T07:00:00.000Z"
            },
            storage: {
                systemDrive: "C:",
                totalBytes: 255980290048,
                freeBytes: 103079215104,
                usedBytes: 152901074944,
                usedPercent: 60
            },
            network: {
                state: "online",
                linkType: "ethernet",
                ipAddress: "192.168.1.50",
                gatewayPingMs: 2.4,
                internetPingMs: 14.8
            }
        },
        printers: [
            {
                name: "Invoice",
                status: "idle",
                portName: "COM1:",
                isOffline: false,
                isError: false,
                matchedRoles: ["receipt-printer"]
            }
        ],
        peripherals: [
            {
                type: "serial",
                name: "Communications Port (COM1)",
                class: "Ports",
                instanceId: "ACPI\\PNP0501\\0",
                serialPort: "COM1",
                manufacturer: "",
                status: "OK",
                matchedRoles: ["serial"]
            }
        ],
        paymentTerminalCandidates: [
            {
                type: "payment-terminal-candidate",
                name: "Verifone VX820",
                instanceId: "USB\\VID_11CA&PID_0200\\TERM001",
                matchedRoles: ["payment-terminal-candidate"]
            }
        ]
    }, {
        scanMode: "full",
        pluginVersion: "0.1.12",
        deviceId: "DEBMAIN2",
        deviceType: "pos",
        inventoryChanged: true
    });

    assert.equal(payload.deviceId, "DEBMAIN2");
    assert.equal(payload.deviceType, "pos");
    assert.equal(payload.inventoryChanged, true);
    assert.equal(payload.metrics.cpuPercent, 52);
    assert.equal(payload.metrics.memoryTotalGb, 4);
    assert.equal(payload.metrics.diskPercent, 60);
    assert.equal(payload.metrics.ipAddress, "192.168.1.50");
    assert.equal(payload.printers[0].port_name, "COM1:");
    assert.equal(payload.peripherals[0].id, "ACPI\\PNP0501\\0");
    assert.equal(payload.paymentTerminalCandidates.length, 1);
    assert.equal(payload.healthSignals, undefined);
});

test("telemetry payload includes health signals for admin exports", () => {
    const payload = buildTelemetryPayload({
        nodeId: "node//sample/admin1",
        systemSummary: {
            operatingSystem: {
                computerName: "ADMIN1"
            }
        },
        healthSignals: {
            pendingReboot: true,
            officeActivationStatus: "licensed",
            officeProductName: "Microsoft 365 Apps for enterprise",
            officeExpiresAt: "2026-06-26T16:58:25.936Z",
            unexpectedShutdownCount7d: 0,
            diskHealthStatus: "healthy"
        },
        printers: [],
        peripherals: [],
        paymentTerminalCandidates: []
    }, {
        scanMode: "full",
        pluginVersion: "0.1.16",
        deviceId: "ADMIN1",
        deviceType: "admin",
        inventoryChanged: false
    });

    assert.deepEqual(payload.healthSignals, {
        pendingReboot: true,
        officeActivationStatus: "licensed",
        officeProductName: "Microsoft 365 Apps for enterprise",
        officeExpiresAt: "2026-06-26T16:58:25.936Z",
        unexpectedShutdownCount7d: 0,
        diskHealthStatus: "healthy"
    });
});

test("telemetry payload preserves Office fields when the rollout preserves existing device type", () => {
    const payload = buildTelemetryPayload({
        nodeId: "node//sample/pos1",
        systemSummary: {
            operatingSystem: {
                computerName: "POS1"
            }
        },
        healthSignals: {
            pendingReboot: false,
            officeActivationStatus: "licensed",
            officeProductName: "Microsoft 365 Apps for enterprise",
            officeExpiresAt: "2026-06-26T16:58:25.936Z",
            unexpectedShutdownCount7d: 2,
            diskHealthStatus: "warning"
        },
        printers: [],
        peripherals: [],
        paymentTerminalCandidates: []
    }, {
        scanMode: "status",
        pluginVersion: "0.1.16",
        deviceId: "POS1",
        deviceType: "",
        inventoryChanged: false
    });

    assert.deepEqual(payload.healthSignals, {
        pendingReboot: false,
        officeActivationStatus: "licensed",
        officeProductName: "Microsoft 365 Apps for enterprise",
        officeExpiresAt: "2026-06-26T16:58:25.936Z",
        unexpectedShutdownCount7d: 2,
        diskHealthStatus: "warning"
    });
});
