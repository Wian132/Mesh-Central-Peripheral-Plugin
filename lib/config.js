"use strict";

const { deepClone, ensureArray, normalizeString, uniqueStrings } = require("./utils");

const SHORT_NAME = "centralreconperipherals";
const DEFAULT_STATUS_INTERVAL_MINUTES = 1;
const DEFAULT_FULL_INTERVAL_MINUTES = 15;
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_CONCURRENT_SCANS = 3;
const DEFAULT_JITTER_SECONDS = 15;
const DEFAULT_FAILURE_EVENT_COOLDOWN_MINUTES = 15;
const DEFAULT_FULL_SCAN_COOLDOWN_SECONDS = 120;

const DEFAULT_CONFIG = Object.freeze({
    version: 1,
    schedule: {
        enabled: false,
        statusIntervalMinutes: DEFAULT_STATUS_INTERVAL_MINUTES,
        fullIntervalMinutes: DEFAULT_FULL_INTERVAL_MINUTES,
        fullOnReconnect: true,
        fullOnDetectedChange: true,
        advancedOneMinuteFullInventory: false,
        evaluationIntervalSeconds: 15,
        jitterSeconds: DEFAULT_JITTER_SECONDS
    },
    scope: {
        meshIds: [],
        nodeIds: []
    },
    execution: {
        powershellTimeoutMs: DEFAULT_TIMEOUT_MS,
        maxConcurrentScans: DEFAULT_MAX_CONCURRENT_SCANS,
        fullScanCooldownSeconds: DEFAULT_FULL_SCAN_COOLDOWN_SECONDS
    },
    logging: {
        changeEvents: true,
        failureEventCooldownMinutes: DEFAULT_FAILURE_EVENT_COOLDOWN_MINUTES
    },
    integrations: {
        famousRecon: {
            enabled: false,
            supabaseUrl: "",
            supabaseAnonKey: "",
            endpointUrl: "",
            apiKey: "",
            deviceType: "",
            exportOnStatusScans: true,
            exportOnFullScans: true,
            requestTimeoutMs: 10000
        }
    },
    matching: {
        printers: [
            {
                id: "receipt-printer",
                label: "Receipt printers",
                role: "receipt-printer",
                nameRegex: "(receipt|epson tm|star tsp|bixolon)",
                manufacturerRegex: "(epson|star|bixolon)",
                confidence: 0.8
            },
            {
                id: "label-printer",
                label: "Label printers",
                role: "label-printer",
                nameRegex: "(zebra|label|ql-|gk420|zd4)",
                manufacturerRegex: "(zebra|brother)",
                confidence: 0.75
            }
        ],
        paymentTerminals: [
            {
                id: "verifone",
                label: "Verifone terminals",
                role: "payment-terminal-candidate",
                nameRegex: "(verifone|pin ?pad|mx9|vx\\d+)",
                manufacturerRegex: "(verifone)",
                confidence: 0.9
            },
            {
                id: "ingenico",
                label: "Ingenico terminals",
                role: "payment-terminal-candidate",
                nameRegex: "(ingenico|lane\\/?\\d+|move\\/?\\d+|desk\\/?\\d+)",
                manufacturerRegex: "(ingenico)",
                confidence: 0.9
            },
            {
                id: "pax",
                label: "PAX terminals",
                role: "payment-terminal-candidate",
                nameRegex: "(^pax\\b|s300|s800|a80|a920)",
                manufacturerRegex: "(pax)",
                confidence: 0.85
            },
            {
                id: "speedpoint",
                label: "Speedpoint terms",
                role: "payment-terminal-candidate",
                nameRegex: "(speedpoint|payment terminal|card machine|pin ?pad)",
                confidence: 0.75
            },
            {
                id: "serial-payment",
                label: "Serial payment hints",
                role: "payment-terminal-candidate",
                className: "Ports",
                nameRegex: "(payment|pin ?pad|terminal)",
                instanceIdRegex: "(USB|FTDI|VID_)",
                confidence: 0.65
            }
        ]
    }
});

function cloneDefaultConfig() {
    return deepClone(DEFAULT_CONFIG);
}

function isObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function validateRegex(pattern, label, errors) {
    if (pattern == null || pattern === "") { return; }
    try {
        new RegExp(pattern, "i");
    } catch (error) {
        errors.push(label + " is not a valid regular expression.");
    }
}

function sanitizeRule(rule, index, prefix, errors) {
    if (!isObject(rule)) {
        errors.push(prefix + "[" + index + "] must be an object.");
        return null;
    }

    const sanitized = {
        id: normalizeString(rule.id) || (prefix + "-" + index),
        label: normalizeString(rule.label) || (prefix + " rule " + (index + 1)),
        role: normalizeString(rule.role) || "candidate"
    };

    if (normalizeString(rule.nameRegex) !== "") { sanitized.nameRegex = normalizeString(rule.nameRegex); }
    if (normalizeString(rule.manufacturerRegex) !== "") { sanitized.manufacturerRegex = normalizeString(rule.manufacturerRegex); }
    if (normalizeString(rule.instanceIdRegex) !== "") { sanitized.instanceIdRegex = normalizeString(rule.instanceIdRegex); }
    if (normalizeString(rule.className) !== "") { sanitized.className = normalizeString(rule.className); }
    if (normalizeString(rule.serialRegex) !== "") { sanitized.serialRegex = normalizeString(rule.serialRegex); }

    const confidence = Number(rule.confidence);
    sanitized.confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7;

    validateRegex(sanitized.nameRegex, prefix + "[" + index + "].nameRegex", errors);
    validateRegex(sanitized.manufacturerRegex, prefix + "[" + index + "].manufacturerRegex", errors);
    validateRegex(sanitized.instanceIdRegex, prefix + "[" + index + "].instanceIdRegex", errors);
    validateRegex(sanitized.serialRegex, prefix + "[" + index + "].serialRegex", errors);

    return sanitized;
}

function sanitizeConfig(input) {
    const candidate = isObject(input) ? input : {};
    const config = cloneDefaultConfig();
    const errors = [];

    if (isObject(candidate.schedule)) {
        if (typeof candidate.schedule.enabled === "boolean") { config.schedule.enabled = candidate.schedule.enabled; }
        if (Number.isInteger(candidate.schedule.statusIntervalMinutes)) { config.schedule.statusIntervalMinutes = candidate.schedule.statusIntervalMinutes; }
        if (Number.isInteger(candidate.schedule.fullIntervalMinutes)) { config.schedule.fullIntervalMinutes = candidate.schedule.fullIntervalMinutes; }
        if (typeof candidate.schedule.fullOnReconnect === "boolean") { config.schedule.fullOnReconnect = candidate.schedule.fullOnReconnect; }
        if (typeof candidate.schedule.fullOnDetectedChange === "boolean") { config.schedule.fullOnDetectedChange = candidate.schedule.fullOnDetectedChange; }
        if (typeof candidate.schedule.advancedOneMinuteFullInventory === "boolean") { config.schedule.advancedOneMinuteFullInventory = candidate.schedule.advancedOneMinuteFullInventory; }
        if (Number.isInteger(candidate.schedule.evaluationIntervalSeconds)) { config.schedule.evaluationIntervalSeconds = candidate.schedule.evaluationIntervalSeconds; }
        if (Number.isInteger(candidate.schedule.jitterSeconds)) { config.schedule.jitterSeconds = candidate.schedule.jitterSeconds; }
    }

    if (isObject(candidate.scope)) {
        config.scope.meshIds = uniqueStrings(candidate.scope.meshIds);
        config.scope.nodeIds = uniqueStrings(candidate.scope.nodeIds);
    }

    if (isObject(candidate.execution)) {
        if (Number.isInteger(candidate.execution.powershellTimeoutMs)) { config.execution.powershellTimeoutMs = candidate.execution.powershellTimeoutMs; }
        if (Number.isInteger(candidate.execution.maxConcurrentScans)) { config.execution.maxConcurrentScans = candidate.execution.maxConcurrentScans; }
        if (Number.isInteger(candidate.execution.fullScanCooldownSeconds)) { config.execution.fullScanCooldownSeconds = candidate.execution.fullScanCooldownSeconds; }
    }

    if (isObject(candidate.logging)) {
        if (typeof candidate.logging.changeEvents === "boolean") { config.logging.changeEvents = candidate.logging.changeEvents; }
        if (Number.isInteger(candidate.logging.failureEventCooldownMinutes)) { config.logging.failureEventCooldownMinutes = candidate.logging.failureEventCooldownMinutes; }
    }

    if (isObject(candidate.integrations) && isObject(candidate.integrations.famousRecon)) {
        const famousRecon = candidate.integrations.famousRecon;
        if (typeof famousRecon.enabled === "boolean") { config.integrations.famousRecon.enabled = famousRecon.enabled; }
        if (typeof famousRecon.supabaseUrl === "string") { config.integrations.famousRecon.supabaseUrl = normalizeString(famousRecon.supabaseUrl); }
        if (typeof famousRecon.supabaseAnonKey === "string") { config.integrations.famousRecon.supabaseAnonKey = famousRecon.supabaseAnonKey; }
        if (normalizeString(famousRecon.endpointUrl) !== "") { config.integrations.famousRecon.endpointUrl = normalizeString(famousRecon.endpointUrl); }
        if (typeof famousRecon.apiKey === "string") { config.integrations.famousRecon.apiKey = famousRecon.apiKey; }
        if (typeof famousRecon.deviceType === "string") {
            const deviceType = normalizeString(famousRecon.deviceType).toLowerCase();
            config.integrations.famousRecon.deviceType = ["server", "pos", "other"].indexOf(deviceType) >= 0 ? deviceType : "";
        }
        if (typeof famousRecon.exportOnStatusScans === "boolean") { config.integrations.famousRecon.exportOnStatusScans = famousRecon.exportOnStatusScans; }
        if (typeof famousRecon.exportOnFullScans === "boolean") { config.integrations.famousRecon.exportOnFullScans = famousRecon.exportOnFullScans; }
        if (Number.isInteger(famousRecon.requestTimeoutMs)) { config.integrations.famousRecon.requestTimeoutMs = famousRecon.requestTimeoutMs; }
    }

    if (isObject(candidate.matching)) {
        config.matching.printers = ensureArray(candidate.matching.printers)
            .map((rule, index) => sanitizeRule(rule, index, "matching.printers", errors))
            .filter(Boolean);
        if (config.matching.printers.length === 0) { config.matching.printers = cloneDefaultConfig().matching.printers; }

        config.matching.paymentTerminals = ensureArray(candidate.matching.paymentTerminals)
            .map((rule, index) => sanitizeRule(rule, index, "matching.paymentTerminals", errors))
            .filter(Boolean);
        if (config.matching.paymentTerminals.length === 0) { config.matching.paymentTerminals = cloneDefaultConfig().matching.paymentTerminals; }
    }

    if (config.schedule.statusIntervalMinutes < 1) {
        errors.push("schedule.statusIntervalMinutes must be at least 1.");
    }
    if (config.schedule.fullIntervalMinutes < 1) {
        errors.push("schedule.fullIntervalMinutes must be at least 1.");
    }
    if (!config.schedule.advancedOneMinuteFullInventory && config.schedule.fullIntervalMinutes < 5) {
        errors.push("schedule.fullIntervalMinutes must be at least 5 unless advancedOneMinuteFullInventory is enabled.");
    }
    if (config.schedule.evaluationIntervalSeconds < 5 || config.schedule.evaluationIntervalSeconds > 60) {
        errors.push("schedule.evaluationIntervalSeconds must be between 5 and 60.");
    }
    if (config.schedule.jitterSeconds < 0 || config.schedule.jitterSeconds > 60) {
        errors.push("schedule.jitterSeconds must be between 0 and 60.");
    }
    if (config.execution.powershellTimeoutMs < 10000 || config.execution.powershellTimeoutMs > 300000) {
        errors.push("execution.powershellTimeoutMs must be between 10000 and 300000.");
    }
    if (config.execution.maxConcurrentScans < 1 || config.execution.maxConcurrentScans > 10) {
        errors.push("execution.maxConcurrentScans must be between 1 and 10.");
    }
    if (config.execution.fullScanCooldownSeconds < 30 || config.execution.fullScanCooldownSeconds > 900) {
        errors.push("execution.fullScanCooldownSeconds must be between 30 and 900.");
    }
    if (config.logging.failureEventCooldownMinutes < 1 || config.logging.failureEventCooldownMinutes > 1440) {
        errors.push("logging.failureEventCooldownMinutes must be between 1 and 1440.");
    }
    if (config.integrations.famousRecon.requestTimeoutMs < 3000 || config.integrations.famousRecon.requestTimeoutMs > 60000) {
        errors.push("integrations.famousRecon.requestTimeoutMs must be between 3000 and 60000.");
    }
    if (config.integrations.famousRecon.enabled) {
        const hasSupabase = normalizeString(config.integrations.famousRecon.supabaseUrl) !== "";
        const hasLegacy = normalizeString(config.integrations.famousRecon.endpointUrl) !== "";
        if (hasSupabase) {
            if (normalizeString(config.integrations.famousRecon.supabaseAnonKey) === "") {
                errors.push("integrations.famousRecon.supabaseAnonKey is required when supabaseUrl is set.");
            }
        } else if (hasLegacy) {
            if (normalizeString(config.integrations.famousRecon.apiKey) === "") {
                errors.push("integrations.famousRecon.apiKey is required when using legacy endpoint export.");
            }
        } else {
            errors.push("integrations.famousRecon requires either supabaseUrl or endpointUrl when enabled.");
        }
    }

    return { config, errors };
}

module.exports = {
    DEFAULT_CONFIG,
    DEFAULT_FAILURE_EVENT_COOLDOWN_MINUTES,
    DEFAULT_FULL_INTERVAL_MINUTES,
    DEFAULT_JITTER_SECONDS,
    DEFAULT_MAX_CONCURRENT_SCANS,
    DEFAULT_STATUS_INTERVAL_MINUTES,
    DEFAULT_TIMEOUT_MS,
    SHORT_NAME,
    cloneDefaultConfig,
    sanitizeConfig
};
