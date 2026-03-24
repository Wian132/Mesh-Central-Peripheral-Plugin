"use strict";

const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginFactory = require("../centralreconperipherals").centralreconperipherals;

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
