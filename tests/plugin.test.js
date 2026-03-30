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

test("server startup skips upgrade refresh when the current plugin version was already applied", () => {
    const datapath = fs.mkdtempSync(path.join(os.tmpdir(), "centralreconperipherals-current-"));
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
    instance.persistence.saveState("node//test/device1", {
        schemaVersion: 1,
        nodeId: "node//test/device1",
        meshId: "mesh//test",
        domainId: "test",
        lastPluginVersionApplied: pluginMetadata.version,
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
        scheduler: {
            queuedFull: false,
            queuedFullReason: null,
            runningMode: null,
            runningSince: null,
            nextStatusScanAt: null,
            nextFullScanAt: null,
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
