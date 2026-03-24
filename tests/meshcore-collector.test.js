"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("meshcore collector mirrors the known-working PowerShell launch shape", () => {
    const collector = require("../modules_meshcore/centralreconperipherals");
    const args = collector.getPowerShellArgs();
    const paths = collector.buildScanPaths();
    const command = collector.buildExecutionCommand(paths);

    assert.deepEqual(args, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]);
    assert.equal(args.includes("powershell"), false);
    assert.match(paths.scriptPath, /^crp-[a-z0-9]+\.ps1$/);
    assert.match(paths.outputPath, /^crp-[a-z0-9]+\.json$/);
    assert.equal(command, ".\\" + paths.scriptPath + "\r\n");
});
