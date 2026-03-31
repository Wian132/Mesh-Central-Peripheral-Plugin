"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("meshcore collector uses -File flag for direct script execution", () => {
    const collector = require("../modules_meshcore/centralreconperipherals");
    const args = collector.getPowerShellArgs();
    const paths = collector.buildScanPaths();

    assert.deepEqual(args, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]);
    assert.equal(args.includes("powershell"), false);
    assert.match(paths.scriptPath, /^crp-[a-z0-9]+\.ps1$/);
    assert.match(paths.outputPath, /^crp-[a-z0-9]+\.json$/);

    const fullArgs = args.concat(["-File", paths.scriptPath]);
    assert.equal(fullArgs[fullArgs.length - 2], "-File");
    assert.equal(fullArgs[fullArgs.length - 1], paths.scriptPath);
});

test("meshcore collector probes Click-to-Run Office root paths for activation data", () => {
    const collector = require("../modules_meshcore/centralreconperipherals");
    const script = collector.buildPowerShellScript("full", "out.json");

    assert.match(script, /Microsoft Office\\root\\Office16\\OSPP\.VBS/);
    assert.match(script, /Microsoft Office\\root\\Office16\\vnextdiag\.ps1/);
});

test("meshcore collector exposes the native Windows shutdown binary for POS countdowns", () => {
    const collector = require("../modules_meshcore/centralreconperipherals");
    assert.match(collector.getShutdownPath(), /shutdown\.exe$/i);
});
