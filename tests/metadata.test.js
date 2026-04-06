"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("plugin metadata uses direct GitHub endpoints", () => {
    const pluginConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"));
    assert.equal(pluginConfig.shortName, "centralreconperipherals");
    assert.equal(pluginConfig.hasAdminPanel, true);
    assert.match(pluginConfig.configUrl, /^https:\/\/raw\.githubusercontent\.com\//);
    assert.match(pluginConfig.changelogUrl, /^https:\/\/raw\.githubusercontent\.com\//);
    assert.match(pluginConfig.downloadUrl, /^https:\/\/github\.com\/.+\/archive\/refs\/heads\/main\.zip$/);
    assert.match(pluginConfig.versionHistoryUrl, /^https:\/\/api\.github\.com\/repos\//);
});

test("package and plugin metadata versions stay in sync", () => {
    const pluginConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"));
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    assert.equal(packageJson.version, pluginConfig.version);
});

test("root plugin module exports the configured short name", () => {
    const plugin = require("../centralreconperipherals");
    assert.equal(typeof plugin.centralreconperipherals, "function");
});
