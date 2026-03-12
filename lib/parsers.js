"use strict";

const { ensureArray } = require("./utils");

function parseJsonCommandOutput(raw, label) {
    if (raw == null || String(raw).trim() === "") { return []; }

    let parsed;
    try {
        parsed = JSON.parse(String(raw));
    } catch (error) {
        throw new Error("Unable to parse " + label + " JSON output: " + error.message);
    }

    return ensureArray(parsed);
}

function parseAgentPayload(payload) {
    if (payload == null || typeof payload !== "object") { return {}; }

    const result = Object.assign({}, payload);
    if (typeof result.printers === "string") {
        result.printers = { method: "parsed", items: parseJsonCommandOutput(result.printers, "printers") };
    }
    if (typeof result.pnpDevices === "string") {
        result.pnpDevices = { items: parseJsonCommandOutput(result.pnpDevices, "pnpDevices") };
    }
    if (typeof result.pnpEntities === "string") {
        result.pnpEntities = { items: parseJsonCommandOutput(result.pnpEntities, "pnpEntities") };
    }
    if (typeof result.serialPorts === "string") {
        result.serialPorts = { items: parseJsonCommandOutput(result.serialPorts, "serialPorts") };
    }
    return result;
}

module.exports = {
    parseAgentPayload,
    parseJsonCommandOutput
};
