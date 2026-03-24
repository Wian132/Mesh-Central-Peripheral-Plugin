"use strict";

/**
 * End-to-end test for direct Supabase telemetry insert.
 *
 * Usage:
 *   set SUPABASE_URL=https://yourproject.supabase.co
 *   set SUPABASE_ANON_KEY=eyJhbGciOi...
 *   node tests/supabase-e2e.test.js
 *
 * Optional:
 *   set TEST_MESH_NODE_ID=node//...   (defaults to first fleet_server found)
 */

const { buildSupabaseRow, resolveServerId, sendTelemetryToSupabase } = require("../lib/famous-recon");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const TEST_MESH_NODE_ID = (process.env.TEST_MESH_NODE_ID || "").trim();
const TIMEOUT_MS = 15000;

function fail(message) {
    console.error("FAIL:", message);
    process.exit(1);
}

function ok(message) {
    console.log("OK:", message);
}

async function supabaseGet(path) {
    const url = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" + path;
    const res = await fetch(url, {
        method: "GET",
        headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Accept": "application/json"
        }
    });
    if (!res.ok) {
        const text = await res.text();
        fail("GET " + path + " -> HTTP " + res.status + ": " + text);
    }
    return res.json();
}

async function supabaseDelete(path) {
    const url = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" + path;
    const res = await fetch(url, {
        method: "DELETE",
        headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Prefer": "return=minimal"
        }
    });
    return res;
}

async function run() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        fail("Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.");
    }
    console.log("Supabase URL:", SUPABASE_URL);
    console.log("");

    // 1. Find a fleet_server to use
    let meshNodeId = TEST_MESH_NODE_ID;
    let serverId;

    if (meshNodeId) {
        console.log("--- Step 1: Resolve fleet_server for mesh_node_id:", meshNodeId);
        const result = await resolveServerId(SUPABASE_URL, SUPABASE_ANON_KEY, meshNodeId, TIMEOUT_MS);
        if (!result.ok) { fail("resolveServerId failed: " + result.error); }
        serverId = result.serverId;
        ok("Resolved server_id = " + serverId);
    } else {
        console.log("--- Step 1: Pick first fleet_server (no TEST_MESH_NODE_ID set)");
        const servers = await supabaseGet("fleet_servers?select=id,display_name,mesh_node_id&limit=1");
        if (!servers.length) { fail("No fleet_servers found. Seed the table first."); }
        serverId = servers[0].id;
        meshNodeId = servers[0].mesh_node_id;
        ok("Using " + servers[0].display_name + " (id=" + serverId + ", mesh_node_id=" + meshNodeId + ")");
    }

    // 2. Build + insert a test telemetry row via sendTelemetryToSupabase
    console.log("");
    console.log("--- Step 2: Insert test telemetry row via sendTelemetryToSupabase");
    const testTimestamp = new Date().toISOString();
    const testPayload = {
        source: "meshcentral-plugin",
        pluginVersion: "0.1.13-e2e-test",
        reportedAt: testTimestamp,
        scanMode: "full",
        nodeId: meshNodeId,
        deviceId: "E2E-TEST-DEVICE",
        deviceType: "pos",
        inventoryHash: "e2e-test-hash-" + Date.now(),
        inventoryChanged: true,
        metrics: {
            cpuPercent: 42.5,
            memoryPercent: 65.3,
            memoryTotalGb: 8,
            memoryAvailableGb: 2.78,
            diskPercent: 55,
            diskFreeGb: 100,
            uptimeHours: 24.5,
            osVersion: "Windows 10 Pro | 10.0.19045",
            ipAddress: "10.0.0.99",
            networkState: "online",
            networkLinkType: "ethernet",
            wifiSsid: null,
            wifiSignalPercent: null,
            gatewayPingMs: 1.2,
            internetPingMs: 12.5
        },
        printers: [
            { name: "E2E-TestPrinter", status: "idle", port_name: "USB001", is_offline: false, is_error: false, matched_roles: [] }
        ],
        peripherals: [
            { type: "serial", name: "E2E COM1", id: "ACPI\\TEST\\0", status: "OK", manufacturer: "Test", class: "Ports", serial_port: "COM1", matchedRoles: ["serial"], present: true, location: "" }
        ],
        paymentTerminalCandidates: [
            { type: "payment-terminal-candidate", name: "E2E Verifone VX820", id: "USB\\VID_TEST", matchedRoles: ["payment-terminal-candidate"] }
        ],
        warnings: []
    };

    const config = {
        enabled: true,
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        requestTimeoutMs: TIMEOUT_MS
    };

    const insertResult = await sendTelemetryToSupabase(config, testPayload);
    if (!insertResult.ok) {
        fail("sendTelemetryToSupabase failed: " + JSON.stringify(insertResult));
    }
    ok("Insert succeeded: serverId=" + insertResult.serverId + " httpStatus=" + insertResult.status);

    // 3. Query back the row we just inserted
    console.log("");
    console.log("--- Step 3: Verify inserted row");
    const rows = await supabaseGet(
        "server_telemetry?server_id=eq." + encodeURIComponent(serverId) +
        "&collector_kind=eq.meshcentral_plugin" +
        "&agent_version=eq.0.1.13-e2e-test" +
        "&order=reported_at.desc&limit=1"
    );
    if (!rows.length) {
        fail("No rows returned for collector_kind=meshcentral_plugin and agent_version=0.1.13-e2e-test");
    }
    const row = rows[0];
    ok("Retrieved row id=" + row.id);

    const checks = [
        ["server_id", row.server_id, serverId],
        ["telemetry_source", row.telemetry_source, "agent"],
        ["collector_kind", row.collector_kind, "meshcentral_plugin"],
        ["agent_version", row.agent_version, "0.1.13-e2e-test"],
        ["cpu_percent", Number(row.cpu_percent), 42.5],
        ["memory_percent", Number(row.memory_percent), 65.3],
        ["memory_total_gb", Number(row.memory_total_gb), 8],
        ["disk_percent", Number(row.disk_percent), 55],
        ["os_version", row.os_version, "Windows 10 Pro | 10.0.19045"],
        ["ip_address", row.ip_address, "10.0.0.99"],
        ["is_online", row.is_online, true],
        ["power_state", row.power_state, "on"],
        ["peripherals_changed", row.peripherals_changed, true],
        ["printers count", Array.isArray(row.printers) ? row.printers.length : -1, 1],
        ["peripherals count", Array.isArray(row.peripherals) ? row.peripherals.length : -1, 1],
        ["payment_terminal_candidates count", Array.isArray(row.payment_terminal_candidates) ? row.payment_terminal_candidates.length : -1, 1]
    ];

    let failures = 0;
    for (const [label, actual, expected] of checks) {
        if (actual === expected) {
            ok("  " + label + " = " + JSON.stringify(actual));
        } else {
            console.error("  MISMATCH " + label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
            failures++;
        }
    }

    // 4. Cleanup
    console.log("");
    console.log("--- Step 4: Cleanup test row");
    const delRes = await supabaseDelete(
        "server_telemetry?id=eq." + encodeURIComponent(row.id)
    );
    if (delRes.ok) {
        ok("Deleted test row id=" + row.id);
    } else {
        console.warn("WARN: Could not delete test row (may need manual cleanup). HTTP " + delRes.status);
    }

    // Summary
    console.log("");
    if (failures > 0) {
        fail(failures + " column check(s) failed.");
    } else {
        console.log("=== ALL E2E CHECKS PASSED ===");
    }
}

run().catch((error) => {
    fail("Unhandled error: " + (error && error.message ? error.message : String(error)));
});
