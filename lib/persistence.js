"use strict";

const fs = require("fs");
const path = require("path");

class Persistence {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.stateDir = path.join(baseDir, "states");
        this.cache = new Map();
    }

    ensureStructure() {
        fs.mkdirSync(this.stateDir, { recursive: true });
    }

    getConfigPath() {
        return path.join(this.baseDir, "config.json");
    }

    getStatePath(nodeId) {
        return path.join(this.stateDir, Buffer.from(nodeId).toString("base64url") + ".json");
    }

    readJson(filePath, fallback) {
        try {
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (error) {
            return fallback;
        }
    }

    writeJson(filePath, value) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
    }

    loadConfig(fallback) {
        return this.readJson(this.getConfigPath(), fallback);
    }

    saveConfig(config) {
        this.writeJson(this.getConfigPath(), config);
    }

    loadState(nodeId, fallbackFactory) {
        if (this.cache.has(nodeId)) { return this.cache.get(nodeId); }
        const fallback = typeof fallbackFactory === "function" ? fallbackFactory() : {};
        const state = this.readJson(this.getStatePath(nodeId), fallback);
        this.cache.set(nodeId, state);
        return state;
    }

    saveState(nodeId, state) {
        this.cache.set(nodeId, state);
        this.writeJson(this.getStatePath(nodeId), state);
    }

    listAllStates() {
        const results = [];
        let entries;
        try { entries = fs.readdirSync(this.stateDir); } catch (_) { return results; }
        for (const file of entries) {
            if (!file.endsWith(".json")) { continue; }
            const base = file.slice(0, -5);
            let nodeId;
            try { nodeId = Buffer.from(base, "base64url").toString("utf8"); } catch (_) { continue; }
            const state = this.loadState(nodeId, () => ({}));
            results.push({ nodeId, state });
        }
        return results;
    }
}

module.exports = {
    Persistence
};
