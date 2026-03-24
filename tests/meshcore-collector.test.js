"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("meshcore collector launches PowerShell without an extra command token", () => {
    const collector = require("../modules_meshcore/centralreconperipherals");
    const args = collector.getPowerShellArgs();

    assert.deepEqual(args, ["-NoProfile", "-NoLogo", "-NonInteractive", "-Command", "-"]);
    assert.equal(args.includes("powershell"), false);
});

