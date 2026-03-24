"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("meshcore collector launches PowerShell against a script file in the working directory", () => {
    const collector = require("../modules_meshcore/centralreconperipherals");
    const args = collector.getPowerShellArgs("C:\\temp\\scan.ps1");
    const paths = collector.buildScanPaths();

    assert.deepEqual(args, ["-NoProfile", "-NoLogo", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\temp\\scan.ps1"]);
    assert.equal(args.includes("powershell"), false);
    assert.equal(path.dirname(paths.scriptPath), collector.getWorkingDirectory());
    assert.equal(path.dirname(paths.outputPath), collector.getWorkingDirectory());
    assert.match(path.basename(paths.scriptPath), /^crp-[a-z0-9]+\.ps1$/);
    assert.match(path.basename(paths.outputPath), /^crp-[a-z0-9]+\.json$/);
});
