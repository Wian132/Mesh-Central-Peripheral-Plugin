"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginFactory = require("../centralreconperipherals").centralreconperipherals;
const pluginMetadata = require("../config.json");

test("plugin factory instantiates expected handlers", () => {
    const instance = pluginFactory({
        parent: {
            datapath: path.join(os.tmpdir(), "centralreconperipherals-tests"),
            config: { domains: { "": { id: "" } } },
            webserver: {
                wsagents: {},
                meshes: {},
                CreateNodeDispatchTargets() { return []; },
                GetNodeWithRights(domain, user, nodeId, callback) { callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true); }
            },
            DispatchEvent() {},
            debug() {}
        },
        registerPluginTab() {}
    });

    assert.equal(typeof instance.server_startup, "function");
    assert.equal(typeof instance.hook_agentCoreIsStable, "function");
    assert.equal(typeof instance.serveraction, "function");
    assert.equal(typeof instance.handleAdminReq, "function");
    assert.equal(typeof instance.handleAdminPostReq, "function");
    assert.equal(typeof instance.onDeviceRefreshEnd, "function");
});

test("plugin resolves webserver lazily when it is attached after plugin construction", async () => {
    const parent = {
        datapath: path.join(os.tmpdir(), "centralreconperipherals-tests"),
        config: { domains: { "": { id: "" } } },
        webserver: null,
        DispatchEvent() {},
        debug() {}
    };

    const instance = pluginFactory({
        parent,
        registerPluginTab() {}
    });

    parent.webserver = {
        wsagents: {},
        meshes: {},
        CreateNodeDispatchTargets() { return []; },
        GetNodeWithRights(domain, user, nodeId, callback) {
            callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true);
        }
    };

    const response = {
        headers: {},
        statusCode: 200,
        set(name, value) { this.headers[name] = value; },
        json(payload) { this.payload = payload; },
        sendStatus(code) { this.statusCode = code; },
        send(payload) { this.body = payload; }
    };

    await instance.handleAdminReq(
        { query: { api: "device-state", nodeid: "node//test/device1" } },
        response,
        { siteadmin: 0xFFFFFFFF, domain: "" }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.nodeId, "node//test/device1");
});

test("server startup queues one-time full scans for scoped online Windows agents after a plugin version change", () => {
    const datapath = fs.mkdtempSync(path.join(os.tmpdir(), "centralreconperipherals-upgrade-"));
    const sent = [];
    const parent = {
        datapath,
        config: { domains: { "": { id: "" } } },
        webserver: {
            wsagents: {
                "node//test/device1": {
                    dbNodeKey: "node//test/device1",
                    dbMeshKey: "mesh//test",
                    agentInfo: { agentId: 3 },
                    send(message) { sent.push(JSON.parse(message)); }
                }
            },
            meshes: {},
            CreateNodeDispatchTargets() { return []; },
            GetNodeWithRights(domain, user, nodeId, callback) { callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true); }
        },
        DispatchEvent() {},
        debug() {}
    };

    const instance = pluginFactory({
        parent,
        registerPluginTab() {}
    });

    instance.persistence.saveConfig({
        scope: {
            meshIds: ["mesh//test"],
            nodeIds: []
        }
    });

    instance.server_startup();
    clearInterval(instance.runtime.schedulerTimer);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].mode, "full");
    assert.match(String(sent[0].initiatedBy), /^plugin-upgrade:/);
});

test("server startup migrates legacy scoped configs to enable scheduled scans", () => {
    const datapath = fs.mkdtempSync(path.join(os.tmpdir(), "centralreconperipherals-migrate-"));
    const parent = {
        datapath,
        config: { domains: { "": { id: "" } } },
        webserver: {
            wsagents: {},
            meshes: {},
            CreateNodeDispatchTargets() { return []; },
            GetNodeWithRights(domain, user, nodeId, callback) { callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true); }
        },
        DispatchEvent() {},
        debug() {}
    };

    const instance = pluginFactory({
        parent,
        registerPluginTab() {}
    });

    instance.persistence.saveConfig({
        version: 1,
        schedule: {
            enabled: false
        },
        scope: {
            meshIds: ["mesh//test"],
            nodeIds: []
        }
    });

    instance.server_startup();
    clearInterval(instance.runtime.schedulerTimer);

    assert.equal(instance.runtime.config.schedule.enabled, true);
    assert.equal(instance.persistence.loadConfig({}).schedule.enabled, true);
});

test("server startup skips upgrade refresh when the current plugin version was already applied", () => {
    const datapath = fs.mkdtempSync(path.join(os.tmpdir(), "centralreconperipherals-current-"));
    const sent = [];
    const now = Date.now();
    const parent = {
        datapath,
        config: { domains: { "": { id: "" } } },
        webserver: {
            wsagents: {
                "node//test/device1": {
                    dbNodeKey: "node//test/device1",
                    dbMeshKey: "mesh//test",
                    agentInfo: { agentId: 3 },
                    send(message) { sent.push(JSON.parse(message)); }
                }
            },
            meshes: {},
            CreateNodeDispatchTargets() { return []; },
            GetNodeWithRights(domain, user, nodeId, callback) { callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true); }
        },
        DispatchEvent() {},
        debug() {}
    };

    const instance = pluginFactory({
        parent,
        registerPluginTab() {}
    });

    instance.persistence.saveConfig({
        scope: {
            meshIds: ["mesh//test"],
            nodeIds: []
        }
    });
    instance.persistence.saveState("node//test/device1", {
        schemaVersion: 1,
        nodeId: "node//test/device1",
        meshId: "mesh//test",
        domainId: "test",
        lastPluginVersionApplied: pluginMetadata.version,
        statusSnapshot: {
            snapshotHash: "status-hash",
            systemSummary: { operatingSystem: { computerName: "DEVICE1" } },
            printers: [],
            paymentTerminalCandidates: [],
            warnings: []
        },
        statusHash: "status-hash",
        lastStatusScanAt: now,
        lastFullScanAt: now,
        lastStatusResult: null,
        lastFullResult: null,
        fullSnapshot: {
            snapshotHash: "full-hash",
            systemSummary: { operatingSystem: { computerName: "DEVICE1" } },
            peripherals: [],
            printers: [],
            paymentTerminalCandidates: [],
            warnings: []
        },
        previousFullSnapshot: null,
        rawFullPayload: null,
        previousRawFullPayload: null,
        diff: null,
        changedSincePrevious: false,
        lastError: null,
        scheduler: {
            queuedFull: false,
            queuedFullReason: null,
            runningMode: null,
            runningSince: null,
            nextStatusScanAt: now + 60_000,
            nextFullScanAt: now + 60_000,
            unsupportedUntil: null
        },
        events: {
            lastFailureEventAt: null,
            lastFailureEventKey: null
        }
    });

    instance.server_startup();
    clearInterval(instance.runtime.schedulerTimer);

    assert.equal(sent.length, 0);
});

test("server startup writes a visible startup summary with FamousRecon config health", () => {
    const datapath = fs.mkdtempSync(path.join(os.tmpdir(), "centralreconperipherals-startup-log-"));
    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => { logs.push(args.join(" ")); };

    try {
        const instance = pluginFactory({
            parent: {
                datapath,
                config: { domains: { "": { id: "" } } },
                webserver: {
                    wsagents: {},
                    meshes: {},
                    CreateNodeDispatchTargets() { return []; },
                    GetNodeWithRights(domain, user, nodeId, callback) { callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true); }
                },
                DispatchEvent() {},
                debug() {}
            },
            registerPluginTab() {}
        });

        instance.persistence.saveConfig({
            integrations: {
                famousRecon: {
                    enabled: true,
                    supabaseUrl: "https://example.supabase.co",
                    supabaseAnonKey: "anon-key",
                    endpointUrl: "https://centralrecon.com/api/fleet/mesh-plugin-telemetry",
                    apiKey: "fok_test_key",
                    forceShutdownAppsClosed: true,
                    exportOnStatusScans: true,
                    exportOnFullScans: true
                }
            }
        });

        instance.server_startup();
        clearInterval(instance.runtime.schedulerTimer);

        assert.ok(
            logs.some((line) =>
                line.includes("centralreconperipherals: startup") &&
                line.includes(`version=${pluginMetadata.version}`) &&
                line.includes("famousRecon=enabled") &&
                line.includes("supabase=set") &&
                line.includes("endpoint=set") &&
                line.includes("shutdownForceClose=enabled")
            )
        );
    } finally {
        console.log = originalConsoleLog;
    }
});

test("blocked same-slot shutdown states are retried when control later allows shutdown", async () => {
    const datapath = fs.mkdtempSync(path.join(os.tmpdir(), "centralreconperipherals-shutdown-retry-"));
    const sent = [];
    const now = Date.now();
    const originalFetch = global.fetch;

    global.fetch = async () => ({
        ok: true,
        status: 200,
        async json() {
            return {
                config: { shutdown_countdown_sec: 300 },
                shutdown_state: {
                    participates_in_waterfall: true,
                    slot_due_now: true,
                    current_slot_key: "2026-04-08:02:00:00",
                    current_date_local: "2026-04-08",
                    shutdown_allowed: true
                }
            };
        }
    });

    try {
        const instance = pluginFactory({
            parent: {
                datapath,
                config: { domains: { "": { id: "" } } },
                webserver: {
                    wsagents: {
                        "node//test/server1": {
                            dbNodeKey: "node//test/server1",
                            dbMeshKey: "mesh//test",
                            agentInfo: { agentId: 3 },
                            send(message) { sent.push(JSON.parse(message)); }
                        }
                    },
                    meshes: {},
                    CreateNodeDispatchTargets() { return []; },
                    GetNodeWithRights(domain, user, nodeId, callback) {
                        callback({ _id: nodeId, meshid: "mesh//test" }, 0xFFFFFFFF, true);
                    }
                },
                DispatchEvent() {},
                debug() {}
            },
            registerPluginTab() {}
        });

        instance.persistence.saveConfig({
            scope: {
                meshIds: ["mesh//test"],
                nodeIds: []
            },
            integrations: {
                famousRecon: {
                    enabled: true,
                    endpointUrl: "https://centralrecon.com/api/fleet/mesh-plugin-telemetry",
                    apiKey: "fok_test_key",
                    requestTimeoutMs: 10000
                }
            }
        });

        instance.persistence.saveState("node//test/server1", {
            schemaVersion: 1,
            nodeId: "node//test/server1",
            meshId: "mesh//test",
            domainId: "test",
            lastPluginVersionApplied: pluginMetadata.version,
            statusSnapshot: {
                snapshotHash: "status-hash",
                systemSummary: {
                    operatingSystem: {
                        computerName: "SERVER1"
                    }
                },
                printers: [],
                paymentTerminalCandidates: [],
                warnings: []
            },
            statusHash: "status-hash",
            lastStatusScanAt: now,
            lastFullScanAt: now,
            lastStatusResult: "ok",
            lastFullResult: "ok",
            fullSnapshot: {
                snapshotHash: "full-hash",
                systemSummary: {
                    operatingSystem: {
                        computerName: "SERVER1"
                    }
                },
                peripherals: [],
                printers: [],
                paymentTerminalCandidates: [],
                warnings: []
            },
            previousFullSnapshot: null,
            rawFullPayload: null,
            previousRawFullPayload: null,
            diff: null,
            changedSincePrevious: false,
            lastError: null,
            shutdown: {
                lastAttemptedSlotKey: "2026-04-08:02:00:00",
                declinedDate: null,
                lastResultStatus: "blocked",
                lastResultAt: now,
                lastError: "Waiting for linked devices.",
                activeRequestId: null,
                activeSince: null,
                activeUntil: null
            },
            scheduler: {
                queuedFull: false,
                queuedFullReason: null,
                runningMode: null,
                runningSince: null,
                nextStatusScanAt: now + 60_000,
                nextFullScanAt: now + 60_000,
                unsupportedUntil: null
            },
            events: {
                lastFailureEventAt: null,
                lastFailureEventKey: null
            }
        });

        instance.server_startup();
        await new Promise((resolve) => setTimeout(resolve, 50));
        clearInterval(instance.runtime.schedulerTimer);

        assert.ok(
            sent.some((message) =>
                message.pluginaction === "shutdown" &&
                message.slotKey === "2026-04-08:02:00:00"
            )
        );
    } finally {
        global.fetch = originalFetch;
    }
});
