"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { cloneDefaultConfig } = require("../lib/config");
const { compileRules } = require("../lib/matching");
const { normalizeDateTime, normalizeFullPayload, normalizeStatusPayload } = require("../lib/normalize");
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
