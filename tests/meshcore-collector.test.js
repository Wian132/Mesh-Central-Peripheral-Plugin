"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("meshcore collector launches PowerShell with an encoded command", () => {
    const collector = require("../modules_meshcore/centralreconperipherals");
    const script = "$result = @{ hello = 'world' }\r\n$result | ConvertTo-Json -Compress\r\nexit\r\n";
    const args = collector.getPowerShellArgs(script);

    assert.deepEqual(args.slice(0, 6), ["-NoProfile", "-NoLogo", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
    assert.equal(args.includes("powershell"), false);
    assert.equal(Buffer.from(args[6], "base64").toString("utf16le"), script);
});
