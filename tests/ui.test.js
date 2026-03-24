"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderDevicePage } = require("../lib/ui");

test("device page emits a syntactically valid browser script", () => {
    const html = renderDevicePage({
        title: "CentralRecon Peripherals",
        nodeId: "node//domain/device1",
        canRefresh: true,
        apiBase: "/pluginadmin.ashx?pin=centralreconperipherals&user=1&view=device"
    });

    const match = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(match, "expected inline script block in rendered device page");

    assert.doesNotThrow(() => {
        // Validate syntax only; this doesn't execute the page logic.
        new Function(match[1]);
    });
});
