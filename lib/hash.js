"use strict";

const crypto = require("crypto");

function normalizeValue(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeValue);
    }
    if (value != null && typeof value === "object") {
        const keys = Object.keys(value).sort();
        const normalized = {};
        for (const key of keys) {
            normalized[key] = normalizeValue(value[key]);
        }
        return normalized;
    }
    return value;
}

function stableStringify(value) {
    return JSON.stringify(normalizeValue(value));
}

function createHashHex(value) {
    return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

module.exports = {
    createHashHex,
    stableStringify
};
