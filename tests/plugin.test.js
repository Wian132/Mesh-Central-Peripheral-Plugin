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
