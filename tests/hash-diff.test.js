"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { cloneDefaultConfig } = require("../lib/config");
const { buildFullDiff } = require("../lib/diff");
const { compileRules } = require("../lib/matching");
const { normalizeFullPayload } = require("../lib/normalize");

function readFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));
}

function buildCompiledMatching() {
    const config = cloneDefaultConfig();
    return {
        printers: compileRules(config.matching.printers),
        paymentTerminals: compileRules(config.matching.paymentTerminals)
    };
}

test("snapshot hashes remain stable regardless of array order", () => {
    const fixture = readFixture("full-payload.json");
    const reversed = JSON.parse(JSON.stringify(fixture));
    reversed.pnpDevices.items.reverse();
    reversed.pnpEntities.items.reverse();

    const first = normalizeFullPayload(fixture, buildCompiledMatching());
    const second = normalizeFullPayload(reversed, buildCompiledMatching());

    assert.equal(first.snapshotHash, second.snapshotHash);
});

test("snapshot hashes ignore CPU and memory telemetry changes", () => {
    const fixture = readFixture("full-payload.json");
    const mutated = JSON.parse(JSON.stringify(fixture));
    mutated.system.cpu[0].LoadPercentage = 88;
    mutated.system.operatingSystem[0].FreePhysicalMemory = 3145728;

    const first = normalizeFullPayload(fixture, buildCompiledMatching());
    const second = normalizeFullPayload(mutated, buildCompiledMatching());

    assert.equal(first.snapshotHash, second.snapshotHash);
});

test("full diff detects added peripherals", () => {
    const fixture = readFixture("full-payload.json");
    const first = normalizeFullPayload(fixture, buildCompiledMatching());
    const mutated = JSON.parse(JSON.stringify(fixture));
    mutated.pnpDevices.items.push({
        FriendlyName: "USB Cash Drawer",
        Class: "USB",
        InstanceId: "USB\\VID_9999&PID_0001\\DRAWER001",
        Manufacturer: "DrawerVendor",
        Status: "OK",
        Present: true
    });

    const second = normalizeFullPayload(mutated, buildCompiledMatching());
    const diff = buildFullDiff(first, second);

    assert.equal(diff.changed, true);
    assert.ok(diff.peripherals.added.some((peripheral) => peripheral.name === "USB Cash Drawer"));
});
