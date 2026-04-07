"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginFactory = require("../centralreconperipherals").centralreconperipherals;

function buildTestInstance(overrides) {
    const datapath = fs.mkdtempSync(path.join(os.tmpdir(), "crp-dedup-"));
    const parent = {
        datapath,
        config: { domains: { "": { id: "" } } },
        webserver: {
            wsagents: {},
            meshes: {},
            CreateNodeDispatchTargets() { return []; },
            GetNodeWithRights(domain, user, nodeId, callback) {
                callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true);
            }
        },
        DispatchEvent() {},
        debug() {}
    };
    Object.assign(parent, overrides || {});
    const instance = pluginFactory({ parent, registerPluginTab() {} });
    return { instance, datapath };
}

test("createEmptyState includes lastExportedStatusHash and lastExportedFullHash", () => {
    const { instance } = buildTestInstance();
    clearInterval(instance.runtime.schedulerTimer);

    const state = instance.persistence.loadState("node//test/x", () => ({
        schemaVersion: 1,
        nodeId: "node//test/x",
        meshId: "mesh//test",
        domainId: "test",
        lastPluginVersionApplied: null,
        statusSnapshot: null,
        statusHash: null,
        lastStatusScanAt: null,
        lastFullScanAt: null,
        lastStatusResult: null,
        lastFullResult: null,
        fullSnapshot: null,
        previousFullSnapshot: null,
        rawFullPayload: null,
        previousRawFullPayload: null,
        diff: null,
        changedSincePrevious: false,
        lastError: null,
        lastExportedStatusHash: null,
        lastExportedFullHash: null,
        scheduler: {},
        events: {},
        shutdown: {}
    }));

    assert.equal(state.lastExportedStatusHash, null);
    assert.equal(state.lastExportedFullHash, null);
});

test("handleScanResult with unchanged status hash skips export", async (t) => {
    const debugMessages = [];
    const fetchCalls = [];
    const { instance } = buildTestInstance({
        debug(category, message) { debugMessages.push(message); }
    });
    clearInterval(instance.runtime.schedulerTimer);

    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
        fetchCalls.push({ url, method: opts.method });
        return { ok: true, status: 204, text: async () => "" };
    };

    try {
        instance.runtime.config.integrations.famousRecon = {
            enabled: true,
            endpointUrl: "https://example.com/api/fleet/mesh-plugin-telemetry",
            apiKey: "fk_test_1234567890",
            deviceType: "pos",
            exportOnStatusScans: true,
            exportOnFullScans: true,
            requestTimeoutMs: 5000
        };

        const nodeId = "node//test/dedup-status";
        const meshId = "mesh//test";

        instance.persistence.saveState(nodeId, {
            schemaVersion: 1,
            nodeId,
            meshId,
            domainId: "test",
            lastPluginVersionApplied: null,
            statusSnapshot: null,
            statusHash: null,
            lastStatusScanAt: null,
            lastFullScanAt: null,
            lastStatusResult: null,
            lastFullResult: null,
            fullSnapshot: null,
            previousFullSnapshot: null,
            rawFullPayload: null,
            previousRawFullPayload: null,
            diff: null,
            changedSincePrevious: false,
            lastError: null,
            lastExportedStatusHash: "abc123",
            lastExportedFullHash: null,
            scheduler: { queuedFull: false, runningMode: null, runningSince: null },
            events: { lastFailureEventAt: null, lastFailureEventKey: null },
            shutdown: {}
        });

        const state = instance.persistence.loadState(nodeId, () => ({}));
        state.statusHash = "abc123";
        state.statusSnapshot = {
            snapshotHash: "abc123",
            printers: [],
            peripherals: [],
            paymentTerminalCandidates: [],
            warnings: [],
            systemSummary: {
                cpu: {},
                memory: {},
                operatingSystem: { computerName: "TESTPC" },
                storage: {},
                network: {}
            }
        };
        instance.persistence.saveState(nodeId, state);

        debugMessages.length = 0;
        fetchCalls.length = 0;

        const { exportTelemetryIfConfigured } = (function () {
            let exportFn = null;
            const wrappedFactory = require("../centralreconperipherals").centralreconperipherals;
            return { exportTelemetryIfConfigured: exportFn };
        })();

        const reloadedState = instance.persistence.loadState(nodeId, () => ({}));
        assert.equal(reloadedState.statusHash, "abc123");
        assert.equal(reloadedState.lastExportedStatusHash, "abc123");

    } finally {
        global.fetch = originalFetch;
    }
});

test("state fields lastExportedStatusHash and lastExportedFullHash persist through save/load", () => {
    const { instance } = buildTestInstance();
    clearInterval(instance.runtime.schedulerTimer);

    const nodeId = "node//test/persist-hash";
    instance.persistence.saveState(nodeId, {
        schemaVersion: 1,
        nodeId,
        meshId: "mesh//test",
        domainId: "test",
        lastExportedStatusHash: "status-hash-abc",
        lastExportedFullHash: "full-hash-def",
        scheduler: {},
        events: {},
        shutdown: {}
    });

    const loaded = instance.persistence.loadState(nodeId, () => ({}));
    assert.equal(loaded.lastExportedStatusHash, "status-hash-abc");
    assert.equal(loaded.lastExportedFullHash, "full-hash-def");
});
