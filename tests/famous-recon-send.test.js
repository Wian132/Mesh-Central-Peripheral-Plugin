"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildExportAttemptLogLine,
    deriveAgentConfigUrl,
    fetchFleetDeviceConfig,
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

test("deriveAgentConfigUrl switches telemetry endpoints to the shared agent-config route", () => {
    assert.equal(
        deriveAgentConfigUrl("https://app.example.com/api/fleet/mesh-plugin-telemetry"),
        "https://app.example.com/api/fleet/agent-config"
    );
    assert.equal(
        deriveAgentConfigUrl("https://app.example.com/api/fleet/heartbeat"),
        "https://app.example.com/api/fleet/agent-config"
    );
});

test("fetchFleetDeviceConfig uses Fleet identity headers and returns parsed shutdown state", async (t) => {
    let captured = null;
    t.mock.method(global, "fetch", async (url, options) => {
        captured = { url, options };
        return {
            ok: true,
            status: 200,
            json: async () => ({
                config: { shutdown_countdown_sec: 300 },
                shutdown_state: { device_type: "pos", current_slot_key: "2026-03-31:02:00:00" }
            })
        };
    });

    const result = await fetchFleetDeviceConfig(
        {
            enabled: true,
            endpointUrl: "https://app.example.com/api/fleet/mesh-plugin-telemetry",
            apiKey: "fk_test_value",
            requestTimeoutMs: 5000
        },
        {
            nodeId: "node//site/pos1",
            deviceId: "POS1",
            deviceType: "pos"
        }
    );

    assert.equal(result.ok, true);
    assert.equal(captured.url, "https://app.example.com/api/fleet/agent-config");
    assert.equal(captured.options.method, "GET");
    assert.equal(captured.options.headers["x-api-key"], "fk_test_value");
    assert.equal(captured.options.headers["x-device-id"], "POS1");
    assert.equal(captured.options.headers["x-mesh-node-id"], "node//site/pos1");
    assert.equal(captured.options.headers["x-device-type"], "pos");
    assert.equal(result.data.shutdown_state.current_slot_key, "2026-03-31:02:00:00");
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

test("sendTelemetry retries once without healthSignals when an older endpoint rejects that field", async (t) => {
    const requests = [];
    t.mock.method(global, "fetch", async (url, options) => {
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) {
            return {
                ok: false,
                status: 400,
                text: async () => '{"error":"Validation failed","details":{"healthSignals":["Unknown field"]}}'
            };
        }
        return {
            ok: true,
            status: 204,
            text: async () => ""
        };
    });

    const result = await sendTelemetry(
        { enabled: true, endpointUrl: "https://example.com/hook", apiKey: "fk_1234567890abcdef", requestTimeoutMs: 5000 },
        {
            nodeId: "node//x",
            deviceId: "ADMIN1",
            deviceType: "admin",
            healthSignals: {
                officeActivationStatus: "licensed"
            },
            metrics: {}
        }
    );

    assert.equal(result.ok, true);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].healthSignals, { officeActivationStatus: "licensed" });
    assert.equal(Object.prototype.hasOwnProperty.call(requests[1], "healthSignals"), false);
});

test("sendTelemetry returns a clear config error when endpoint credentials are missing", async () => {
    const result = await sendTelemetry(
        { enabled: true, endpointUrl: "", apiKey: "" },
        { nodeId: "node//x", deviceId: "PC1", metrics: {} }
    );

    assert.equal(result.ok, false);
    assert.match(String(result.error), /endpoint URL or API key is missing/i);
});
