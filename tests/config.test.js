"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { cloneDefaultConfig, migrateConfig, sanitizeConfig } = require("../lib/config");

test("default config enables scheduled scans with the planned cadence and concurrency", () => {
    const config = cloneDefaultConfig();
    assert.equal(config.schedule.enabled, true);
    assert.equal(config.schedule.statusIntervalMinutes, 5);
    assert.equal(config.schedule.fullIntervalMinutes, 15);
    assert.equal(config.execution.maxConcurrentScans, 3);
    assert.equal(config.schedule.advancedOneMinuteFullInventory, false);
});

test("legacy scoped configs auto-enable scheduled scans during migration", () => {
    const migrated = migrateConfig({
        version: 1,
        schedule: {
            enabled: false
        },
        scope: {
            meshIds: ["mesh//pilot"],
            nodeIds: []
        }
    });

    assert.equal(migrated.schedule.enabled, true);
});

test("legacy unscoped configs stay disabled during migration", () => {
    const migrated = migrateConfig({
        version: 1,
        schedule: {
            enabled: false
        },
        scope: {
            meshIds: [],
            nodeIds: []
        }
    });

    assert.equal(migrated.schedule.enabled, false);
});

test("full inventory at one minute requires advanced opt-in", () => {
    const result = sanitizeConfig({
        schedule: {
            enabled: true,
            statusIntervalMinutes: 1,
            fullIntervalMinutes: 1,
            advancedOneMinuteFullInventory: false
        }
    });

    assert.ok(result.errors.some((error) => error.includes("fullIntervalMinutes")));
});

test("advanced full inventory mode allows one-minute full scans", () => {
    const result = sanitizeConfig({
        schedule: {
            enabled: true,
            statusIntervalMinutes: 1,
            fullIntervalMinutes: 1,
            advancedOneMinuteFullInventory: true
        }
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.config.schedule.fullIntervalMinutes, 1);
});

test("invalid regex rules are rejected", () => {
    const result = sanitizeConfig({
        matching: {
            paymentTerminals: [
                {
                    id: "bad",
                    label: "Bad",
                    role: "payment-terminal-candidate",
                    nameRegex: "[broken"
                }
            ]
        }
    });

    assert.ok(result.errors.some((error) => error.includes("nameRegex")));
});

test("famous recon device type accepts admin", () => {
    const result = sanitizeConfig({
        integrations: {
            famousRecon: {
                deviceType: "admin"
            }
        }
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.config.integrations.famousRecon.deviceType, "admin");
});

test("famous recon config preserves opt-in forced shutdown setting", () => {
    const result = sanitizeConfig({
        integrations: {
            famousRecon: {
                forceShutdownAppsClosed: true
            }
        }
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.config.integrations.famousRecon.forceShutdownAppsClosed, true);
});

test("famous recon export now requires endpoint configuration instead of direct supabase settings", () => {
    const result = sanitizeConfig({
        integrations: {
            famousRecon: {
                enabled: true,
                supabaseUrl: "https://example.supabase.co",
                supabaseAnonKey: "anon-key"
            }
        }
    });

    assert.ok(result.errors.some((error) => error.includes("endpointUrl")));
});
