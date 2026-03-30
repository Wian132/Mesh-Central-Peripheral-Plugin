"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { cloneDefaultConfig } = require("../lib/config");
const { compileRules } = require("../lib/matching");
const {
    mergeHealthSignals,
    normalizeDateTime,
    normalizeFullPayload,
    normalizeHealthSignals,
    normalizeOfficeActivation,
    normalizeStatusPayload,
    normalizeSystemSummary
} = require("../lib/normalize");
const { parseJsonCommandOutput } = require("../lib/parsers");

function readFixture(name) {
    return fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

function buildCompiledMatching() {
    const config = cloneDefaultConfig();
    return {
        printers: compileRules(config.matching.printers),
        paymentTerminals: compileRules(config.matching.paymentTerminals)
    };
}

test("status normalization tracks printers and payment terminal hints", () => {
    const payload = JSON.parse(readFixture("status-payload.json"));
    const snapshot = normalizeStatusPayload(payload, buildCompiledMatching());

    assert.equal(snapshot.printers.length, 2);
    assert.equal(snapshot.printers[1].isOffline, true);
    assert.ok(snapshot.paymentTerminalCandidates.some((candidate) => /verifone/i.test(candidate.name)));
    assert.equal(snapshot.systemSummary.cpu.totalCores, 6);
    assert.equal(snapshot.systemSummary.cpu.loadPercent, 27);
    assert.equal(snapshot.systemSummary.memory.usedPercent, 63);
    assert.equal(snapshot.systemSummary.operatingSystem.computerName, "FISHMAIN5");
    assert.ok(snapshot.snapshotHash);
});

test("full normalization merges PnP and serial data into meaningful peripherals", () => {
    const payload = JSON.parse(readFixture("full-payload.json"));
    const snapshot = normalizeFullPayload(payload, buildCompiledMatching());

    assert.ok(snapshot.peripherals.some((peripheral) => peripheral.type === "payment-terminal-candidate"));
    assert.ok(snapshot.peripherals.some((peripheral) => peripheral.type === "scanner"));
    assert.ok(snapshot.peripherals.some((peripheral) => peripheral.type === "display"));
    assert.ok(snapshot.peripherals.some((peripheral) => peripheral.serialPort === "COM4"));
    assert.equal(snapshot.systemSummary.cpu.model, "Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz");
    assert.equal(snapshot.systemSummary.memory.totalBytes, 17179869184);
});

test("command-output parser converts single objects to arrays", () => {
    const parsed = parseJsonCommandOutput("{\"Name\":\"Single Printer\"}", "printers");
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].Name, "Single Printer");
});

test("Windows DMTF timestamps normalize to ISO strings", () => {
    assert.equal(
        normalizeDateTime("20260324062234.500000+000"),
        "2026-03-24T06:22:34.500Z"
    );
});

test("system normalization captures storage and network summary when present", () => {
    const summary = normalizeSystemSummary({
        cpu: [
            {
                Name: "Intel(R) Celeron(R) CPU J1900 @ 1.99GHz",
                NumberOfCores: 4,
                NumberOfLogicalProcessors: 4,
                MaxClockSpeed: 1990,
                LoadPercentage: 52
            }
        ],
        operatingSystem: [
            {
                Caption: "Microsoft Windows 10 Pro",
                Version: "10.0.19045",
                CSName: "DEBMAIN2",
                LastBootUpTime: "20260324090032.000000+000",
                TotalVisibleMemorySize: 4128768,
                FreePhysicalMemory: 1441792
            }
        ],
        storage: {
            systemDrive: "C:",
            systemDisk: {
                DeviceID: "C:",
                Size: 255980290048,
                FreeSpace: 103079215104
            }
        },
        network: {
            state: "online",
            linkType: "ethernet",
            ipAddress: "192.168.1.50",
            gatewayPingMs: 2.4,
            internetPingMs: 14.8
        }
    });

    assert.equal(summary.storage.systemDrive, "C:");
    assert.equal(summary.storage.usedPercent, 60);
    assert.equal(summary.network.state, "online");
    assert.equal(summary.network.linkType, "ethernet");
    assert.equal(summary.network.ipAddress, "192.168.1.50");
});

test("office normalization maps OSPP statuses into shared admin health values", () => {
    const licensed = normalizeOfficeActivation({
        method: "ospp-vbs",
        rawOutput: readFixture("ospp-dstatus-licensed.txt")
    });
    const unlicensed = normalizeOfficeActivation({
        method: "ospp-vbs",
        rawOutput: readFixture("ospp-dstatus-unlicensed.txt")
    });
    const notification = normalizeOfficeActivation({
        method: "ospp-vbs",
        rawOutput: readFixture("ospp-dstatus-notification.txt")
    });
    const unknown = normalizeOfficeActivation({
        method: "none",
        rawOutput: readFixture("office-probe-none.txt")
    });

    assert.equal(licensed.officeActivationStatus, "licensed");
    assert.equal(licensed.officeProductName, "Office 16, Office16ProPlusVL_KMS_Client edition");
    assert.equal(unlicensed.officeActivationStatus, "unlicensed");
    assert.equal(notification.officeActivationStatus, "notification");
    assert.equal(notification.officeLicenseDescription, "Office 16, RETAIL(Grace) channel");
    assert.equal(notification.officeErrorDescription, "Remaining grace: 4 days");
    assert.equal(unknown.officeActivationStatus, "unknown");
    assert.equal(unknown.officeProductName, null);
});

test("office normalization preserves OSPP diagnostic error details", () => {
    const notification = normalizeOfficeActivation({
        method: "ospp-vbs",
        rawOutput: readFixture("ospp-dstatus-notifications-secure-store.txt")
    });

    assert.equal(notification.officeActivationStatus, "notification");
    assert.equal(notification.officeProductName, "Office 16, Office16O365HomePremR_Subscription4 edition");
    assert.equal(notification.officeLicenseDescription, "Office 16, TIMEBASED_SUB channel");
    assert.equal(notification.officeErrorCode, "0xC004E022");
    assert.equal(
        notification.officeErrorDescription,
        "The Software Licensing Service reported that the secure store id value in license does not match with the current value."
    );
});

test("health signal normalization parses vnext output and preserves generic signals", () => {
    const signals = normalizeHealthSignals({
        pendingReboot: true,
        office: {
            method: "vnextdiag",
            rawOutput: readFixture("vnextdiag-licensed.txt")
        },
        unexpectedShutdownCount7d: 0,
        disk: {
            method: "Get-PhysicalDisk",
            items: [
                {
                    FriendlyName: "Disk 0",
                    HealthStatus: "Healthy",
                    OperationalStatus: "OK"
                }
            ]
        }
    });

    assert.deepEqual(signals, {
        pendingReboot: true,
        officeActivationStatus: "licensed",
        officeProductName: "Microsoft 365 Apps for enterprise",
        unexpectedShutdownCount7d: 0,
        diskHealthStatus: "healthy"
    });
});

test("office normalization parses JSON-style vnextdiag output and captures expiry", () => {
    const licensed = normalizeOfficeActivation({
        method: "vnextdiag",
        rawOutput: readFixture("vnextdiag-json-licensed.txt")
    });

    assert.equal(licensed.officeActivationStatus, "licensed");
    assert.equal(licensed.officeProductName, "O365ProPlusRetail");
    assert.equal(licensed.officeExpiresAt, "2026-06-26T16:58:25.936Z");
});

test("health signal merge prefers cached full data with the latest pending reboot value", () => {
    const merged = mergeHealthSignals(
        {
            healthSignals: {
                pendingReboot: false
            }
        },
        {
            healthSignals: {
                pendingReboot: true,
                officeActivationStatus: "licensed",
                officeProductName: "Microsoft 365 Apps for enterprise",
                officeExpiresAt: "2026-06-26T16:58:25.936Z",
                officeLicenseDescription: "Microsoft 365 Apps for enterprise",
                officeErrorCode: "0x0",
                officeErrorDescription: "Licensed",
                unexpectedShutdownCount7d: 1,
                diskHealthStatus: "warning"
            }
        }
    );

    assert.deepEqual(merged, {
        pendingReboot: false,
        officeActivationStatus: "licensed",
        officeProductName: "Microsoft 365 Apps for enterprise",
        officeExpiresAt: "2026-06-26T16:58:25.936Z",
        officeLicenseDescription: "Microsoft 365 Apps for enterprise",
        officeErrorCode: "0x0",
        officeErrorDescription: "Licensed",
        unexpectedShutdownCount7d: 1,
        diskHealthStatus: "warning"
    });
});

test("full normalization includes normalized health signals from collector payload", () => {
    const payload = JSON.parse(readFixture("health-full-payload.json"));
    const snapshot = normalizeFullPayload(payload, buildCompiledMatching());

    assert.deepEqual(snapshot.healthSignals, {
        pendingReboot: true,
        officeActivationStatus: "licensed",
        officeProductName: "Microsoft 365 Apps for enterprise",
        unexpectedShutdownCount7d: 0,
        diskHealthStatus: "healthy"
    });
});
