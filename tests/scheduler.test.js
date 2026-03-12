"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { cloneDefaultConfig } = require("../lib/config");
const {
    applyCompletionSchedule,
    determineDueMode,
    ensureScheduleState,
    shouldQueueFullAfterStatusChange
} = require("../lib/scheduler");

test("ensureScheduleState assigns initial due times", () => {
    const config = cloneDefaultConfig();
    const state = { scheduler: {} };
    ensureScheduleState(state, 1000, config, () => 0);
    assert.equal(state.scheduler.nextStatusScanAt, 1000);
    assert.equal(state.scheduler.nextFullScanAt, 1000);
});

test("full scans have priority over status scans", () => {
    const state = {
        scheduler: {
            nextStatusScanAt: 1000,
            nextFullScanAt: 500,
            queuedFull: false
        }
    };
    assert.equal(determineDueMode(state, 1000), "full");
});

test("queued full scan suppresses duplicate status-change queueing", () => {
    const state = {
        scheduler: {
            queuedFull: true,
            runningMode: null
        },
        lastFullScanAt: 0
    };
    assert.equal(shouldQueueFullAfterStatusChange(state, 10000, 120), false);
});

test("completion updates next due times and clears running state", () => {
    const config = cloneDefaultConfig();
    const state = {
        scheduler: {
            queuedFull: true,
            runningMode: "full",
            runningSince: 500
        }
    };
    applyCompletionSchedule(state, "full", 1000, config, () => 0);
    assert.equal(state.scheduler.runningMode, null);
    assert.equal(state.scheduler.queuedFull, false);
    assert.equal(state.scheduler.nextFullScanAt, 1000 + (15 * 60000));
});
