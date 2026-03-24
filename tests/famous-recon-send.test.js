"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildExportAttemptLogLine,
    buildSupabaseRow,
    maskApiKeyForLog,
    resolveServerId,
    sendTelemetry,
    sendTelemetryToSupabase,
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

// --- buildSupabaseRow tests ---

test("buildSupabaseRow maps payload fields to DB column names", () => {
    const payload = {
        reportedAt: "2026-03-24T12:00:00.000Z",
        nodeId: "node//test/dev1",
        pluginVersion: "0.1.13",
        inventoryHash: "abc123",
        inventoryChanged: true,
        metrics: {
            cpuPercent: 52,
            memoryPercent: 63,
            memoryTotalGb: 4,
            memoryAvailableGb: 1.5,
            diskPercent: 60,
            diskFreeGb: 96,
            uptimeHours: 12.5,
            osVersion: "Windows 10 Pro",
            ipAddress: "192.168.1.50",
            networkState: "online",
            networkLinkType: "ethernet",
            wifiSsid: null,
            wifiSignalPercent: null,
            gatewayPingMs: 2.4,
            internetPingMs: 14.8
        },
        printers: [{ name: "Receipt", status: "idle" }],
        peripherals: [{ name: "COM1", class: "Ports" }],
        paymentTerminalCandidates: [{ name: "Verifone VX820" }]
    };
    const row = buildSupabaseRow(payload, "server-uuid-123");
    assert.equal(row.server_id, "server-uuid-123");
    assert.equal(row.reported_at, "2026-03-24T12:00:00.000Z");
    assert.equal(row.cpu_percent, 52);
    assert.equal(row.memory_percent, 63);
    assert.equal(row.memory_total_gb, 4);
    assert.equal(row.memory_available_gb, 1.5);
    assert.equal(row.disk_percent, 60);
    assert.equal(row.disk_free_gb, 96);
    assert.equal(row.uptime_hours, 12.5);
    assert.equal(row.os_version, "Windows 10 Pro");
    assert.equal(row.ip_address, "192.168.1.50");
    assert.equal(row.network_state, "online");
    assert.equal(row.network_link_type, "ethernet");
    assert.equal(row.gateway_ping_ms, 2.4);
    assert.equal(row.internet_ping_ms, 14.8);
    assert.deepEqual(row.printers, [{ name: "Receipt", status: "idle" }]);
    assert.deepEqual(row.peripherals, [{ name: "COM1", class: "Ports" }]);
    assert.deepEqual(row.payment_terminal_candidates, [{ name: "Verifone VX820" }]);
    assert.equal(row.peripherals_hash, "abc123");
    assert.equal(row.peripherals_changed, true);
    assert.equal(row.telemetry_source, "agent");
    assert.equal(row.collector_kind, "meshcentral_plugin");
    assert.equal(row.agent_version, "0.1.13");
    assert.equal(row.is_online, true);
    assert.equal(row.power_state, "on");
});

test("buildSupabaseRow handles missing metrics gracefully", () => {
    const row = buildSupabaseRow({ reportedAt: "2026-01-01T00:00:00Z" }, "srv-1");
    assert.equal(row.server_id, "srv-1");
    assert.equal(row.cpu_percent, null);
    assert.equal(row.memory_percent, null);
    assert.deepEqual(row.printers, []);
    assert.deepEqual(row.peripherals, []);
    assert.equal(row.collector_kind, "meshcentral_plugin");
});

// --- resolveServerId tests ---

test("resolveServerId returns serverId on success", async (t) => {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        assert.match(url, /fleet_servers/);
        return { ok: true, json: async () => [{ id: "uuid-abc" }] };
    };
    try {
        const result = await resolveServerId("https://proj.supabase.co", "anon-key", "node//test", 5000);
        assert.equal(result.ok, true);
        assert.equal(result.serverId, "uuid-abc");
    } finally {
        global.fetch = originalFetch;
    }
});

test("resolveServerId returns error when no rows found", async (t) => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => [] });
    try {
        const result = await resolveServerId("https://proj.supabase.co", "anon-key", "node//missing", 5000);
        assert.equal(result.ok, false);
        assert.match(result.error, /No fleet_servers row found/);
    } finally {
        global.fetch = originalFetch;
    }
});

test("resolveServerId returns error on HTTP failure", async (t) => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 403, text: async () => "forbidden" });
    try {
        const result = await resolveServerId("https://proj.supabase.co", "anon-key", "node//x", 5000);
        assert.equal(result.ok, false);
        assert.match(result.error, /HTTP 403/);
    } finally {
        global.fetch = originalFetch;
    }
});

// --- sendTelemetryToSupabase tests ---

test("sendTelemetryToSupabase skips when disabled", async () => {
    const result = await sendTelemetryToSupabase({ enabled: false }, {});
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
});

test("sendTelemetryToSupabase returns error when supabaseUrl is missing", async () => {
    const result = await sendTelemetryToSupabase(
        { enabled: true, supabaseUrl: "", supabaseAnonKey: "key" },
        { nodeId: "node//x" }
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /supabaseUrl/);
});

test("sendTelemetryToSupabase happy path resolves + inserts", async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url, method: opts.method });
        if (opts.method === "GET") {
            return { ok: true, json: async () => [{ id: "srv-uuid" }] };
        }
        return { ok: true, status: 201, text: async () => "" };
    };
    try {
        const result = await sendTelemetryToSupabase(
            { enabled: true, supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-key", requestTimeoutMs: 5000 },
            { nodeId: "node//test/dev1", reportedAt: "2026-03-24T12:00:00Z", metrics: { cpuPercent: 10 }, printers: [], peripherals: [], paymentTerminalCandidates: [] }
        );
        assert.equal(result.ok, true);
        assert.equal(result.serverId, "srv-uuid");
        assert.equal(calls.length, 2);
        assert.equal(calls[0].method, "GET");
        assert.equal(calls[1].method, "POST");
    } finally {
        global.fetch = originalFetch;
    }
});

test("sendTelemetryToSupabase propagates insert error", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
        if (opts.method === "GET") {
            return { ok: true, json: async () => [{ id: "srv-uuid" }] };
        }
        return { ok: false, status: 403, text: async () => "RLS violation" };
    };
    try {
        const result = await sendTelemetryToSupabase(
            { enabled: true, supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-key", requestTimeoutMs: 5000 },
            { nodeId: "node//test/dev1", reportedAt: "2026-03-24T12:00:00Z", metrics: {}, printers: [], peripherals: [], paymentTerminalCandidates: [] }
        );
        assert.equal(result.ok, false);
        assert.equal(result.status, 403);
        assert.match(result.error, /RLS violation/);
    } finally {
        global.fetch = originalFetch;
    }
});

test("sendTelemetryToSupabase propagates server lookup failure", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500, text: async () => "internal error" });
    try {
        const result = await sendTelemetryToSupabase(
            { enabled: true, supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-key" },
            { nodeId: "node//test/x", metrics: {} }
        );
        assert.equal(result.ok, false);
        assert.match(result.error, /fleet_servers lookup failed/);
    } finally {
        global.fetch = originalFetch;
    }
});
