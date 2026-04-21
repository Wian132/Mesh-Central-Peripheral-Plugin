"use strict";

function getRandomJitterMs(maxSeconds, randomFn) {
    const random = typeof randomFn === "function" ? randomFn : Math.random;
    const max = Math.max(0, maxSeconds || 0);
    return Math.floor(random() * (max + 1)) * 1000;
}

function computeNextDueMs(nowMs, intervalMinutes, jitterSeconds, randomFn) {
    return nowMs + (intervalMinutes * 60000) + getRandomJitterMs(jitterSeconds, randomFn);
}

function computeNextDueMsFromHours(nowMs, intervalHours, jitterSeconds, randomFn) {
    return nowMs + (intervalHours * 60 * 60000) + getRandomJitterMs(jitterSeconds, randomFn);
}

function ensureScheduleState(state, nowMs, config, randomFn) {
    const schedule = state.scheduler || (state.scheduler = {});

    if (typeof schedule.nextStatusScanAt !== "number") {
        schedule.nextStatusScanAt = nowMs + getRandomJitterMs(config.schedule.jitterSeconds, randomFn);
    }
    if (typeof schedule.nextFullScanAt !== "number") {
        schedule.nextFullScanAt = nowMs + getRandomJitterMs(config.schedule.jitterSeconds, randomFn);
    }
    // Fleet cadences jitter at first-seen so a restart storm does not push 20 tills
    // to collect inventory in the same second.
    if (typeof schedule.nextFleetInventoryAt !== "number") {
        schedule.nextFleetInventoryAt = nowMs + getRandomJitterMs(config.schedule.jitterSeconds, randomFn);
    }
    if (typeof schedule.nextFleetHealthAt !== "number") {
        schedule.nextFleetHealthAt = nowMs + getRandomJitterMs(config.schedule.jitterSeconds, randomFn);
    }
    return state;
}

function determineDueMode(state, nowMs) {
    const schedule = state.scheduler || {};
    if (schedule.queuedFull) { return "full"; }
    if (typeof schedule.nextFullScanAt === "number" && nowMs >= schedule.nextFullScanAt) { return "full"; }
    if (typeof schedule.nextStatusScanAt === "number" && nowMs >= schedule.nextStatusScanAt) { return "status"; }
    // Fleet modes run behind the heartbeat so they never delay a status/full cycle.
    if (typeof schedule.nextFleetHealthAt === "number" && nowMs >= schedule.nextFleetHealthAt) { return "fleet_health"; }
    if (typeof schedule.nextFleetInventoryAt === "number" && nowMs >= schedule.nextFleetInventoryAt) { return "fleet_inventory"; }
    return null;
}

function shouldQueueFullAfterStatusChange(state, nowMs, cooldownSeconds) {
    const schedule = state.scheduler || {};
    if (schedule.queuedFull) { return false; }
    if (schedule.runningMode === "full") { return false; }
    if (typeof state.lastFullScanAt === "number" && (nowMs - state.lastFullScanAt) < (cooldownSeconds * 1000)) { return false; }
    return true;
}

function applyCompletionSchedule(state, mode, nowMs, config, randomFn) {
    const schedule = state.scheduler || (state.scheduler = {});
    schedule.runningMode = null;
    schedule.runningSince = null;
    schedule.lastCompletedMode = mode;

    if (mode === "status") {
        schedule.nextStatusScanAt = computeNextDueMs(nowMs, config.schedule.statusIntervalMinutes, config.schedule.jitterSeconds, randomFn);
    }
    if (mode === "full") {
        schedule.queuedFull = false;
        schedule.nextFullScanAt = computeNextDueMs(nowMs, config.schedule.fullIntervalMinutes, config.schedule.jitterSeconds, randomFn);
    }
    if (mode === "fleet_inventory") {
        schedule.nextFleetInventoryAt = computeNextDueMsFromHours(nowMs, config.schedule.fleetInventoryIntervalHours, config.schedule.jitterSeconds, randomFn);
    }
    if (mode === "fleet_health") {
        schedule.nextFleetHealthAt = computeNextDueMsFromHours(nowMs, config.schedule.fleetHealthIntervalHours, config.schedule.jitterSeconds, randomFn);
    }

    return state;
}

module.exports = {
    applyCompletionSchedule,
    computeNextDueMs,
    computeNextDueMsFromHours,
    determineDueMode,
    ensureScheduleState,
    getRandomJitterMs,
    shouldQueueFullAfterStatusChange
};
