"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildExportAttemptLogLine,
    maskApiKeyForLog,
    sendTelemetry,
    truncateForLog
} = require("../lib/famous-recon");

test("maskApiKeyForLog hides long keys", () => {
    assert.equal(maskApiKeyForLog("fk_abcdefghijklmnop"), "fk_a…mnop");
    assert.equal(maskApiKeyForLog("short"), "***");
});

test("truncateForLog caps length", () => {
    assert.equal(truncateForLog("abcdef", 4), "abcd…");
    assert.equal(truncateForLog("ab", 4), "ab");
});

test("buildExportAttemptLogLine includes masked key and metric fields", () => {
    const line = buildExportAttemptLogLine(
        { endpointUrl: "https://app.example.com/api/fleet/mesh-plugin-telemetry", apiKey: "fk_1234567890abcdef" },
        {
            nodeId: "node//d/id",
            deviceId: "DEBMAIN2",
            deviceType: "pos",
            metrics: { cpuPercent: 12, memoryPercent: 45, memoryTotalGb: 8, memoryAvailableGb: 4 }
        }
    );
    assert.match(line, /POST app\.example\.com\/api\/fleet\/mesh-plugin-telemetry/);
    assert.match(line, /x-api-key=fk_1…cdef/);
    assert.match(line, /deviceId=DEBMAIN2/);
    assert.match(line, /nodeId=node\/\/d\/id/);
    assert.match(line, /metrics\.cpuPercent=12/);
});

test("sendTelemetry returns httpStatus on success", async (t) => {
    t.mock.method(global, "fetch", async () => ({
        ok: true,
        status: 204,
        text: async () => ""
    }));
    const result = await sendTelemetry(
        { enabled: true, endpointUrl: "https://example.com/hook", apiKey: "fk_1234567890abcdef", requestTimeoutMs: 5000 },
        { nodeId: "node//x", deviceId: "PC1", deviceType: "pos", metrics: {} }
    );
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.status, 204);
});

test("sendTelemetry returns status and body on HTTP error", async (t) => {
    t.mock.method(global, "fetch", async () => ({
        ok: false,
        status: 422,
        text: async () => '{"error":"invalid collector"}'
    }));
    const result = await sendTelemetry(
        { enabled: true, endpointUrl: "https://example.com/hook", apiKey: "fk_1234567890abcdef" },
        { nodeId: "node//x", deviceId: "PC1", metrics: {} }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
    assert.match(String(result.error), /invalid collector/);
});
