"use strict";

function getRandomJitterMs(maxSeconds, randomFn) {
    const random = typeof randomFn === "function" ? randomFn : Math.random;
    const max = Math.max(0, maxSeconds || 0);
    return Math.floor(random() * (max + 1)) * 1000;
}

function computeNextDueMs(nowMs, intervalMinutes, jitterSeconds, randomFn) {
    return nowMs + (intervalMinutes * 60000) + getRandomJitterMs(jitterSeconds, randomFn);
}

function ensureScheduleState(state, nowMs, config, randomFn) {
    const schedule = state.scheduler || (state.scheduler = {});

    if (typeof schedule.nextStatusScanAt !== "number") {
        schedule.nextStatusScanAt = nowMs + getRandomJitterMs(config.schedule.jitterSeconds, randomFn);
    }
    if (typeof schedule.nextFullScanAt !== "number") {
        schedule.nextFullScanAt = nowMs + getRandomJitterMs(config.schedule.jitterSeconds, randomFn);
    }
    return state;
}

function determineDueMode(state, nowMs) {
    const schedule = state.scheduler || {};
    if (schedule.queuedFull) { return "full"; }
    if (typeof schedule.nextFullScanAt === "number" && nowMs >= schedule.nextFullScanAt) { return "full"; }
    if (typeof schedule.nextStatusScanAt === "number" && nowMs >= schedule.nextStatusScanAt) { return "status"; }
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

    return state;
}

module.exports = {
    applyCompletionSchedule,
    computeNextDueMs,
    determineDueMode,
    ensureScheduleState,
    getRandomJitterMs,
    shouldQueueFullAfterStatusChange
};
