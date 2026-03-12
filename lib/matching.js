"use strict";

const { normalizeLower, normalizeString, uniqueStrings } = require("./utils");

function compileRegex(pattern) {
    if (pattern == null || pattern === "") { return null; }
    return new RegExp(pattern, "i");
}

function compileRules(rules) {
    return (rules || []).map((rule) => ({
        id: rule.id,
        label: rule.label,
        role: rule.role,
        className: normalizeLower(rule.className),
        confidence: typeof rule.confidence === "number" ? rule.confidence : 0.7,
        nameRegex: compileRegex(rule.nameRegex),
        manufacturerRegex: compileRegex(rule.manufacturerRegex),
        instanceIdRegex: compileRegex(rule.instanceIdRegex),
        serialRegex: compileRegex(rule.serialRegex)
    }));
}

function inferBuiltInRoles(peripheral) {
    const roles = [];
    const name = normalizeLower(peripheral.name);
    const className = normalizeLower(peripheral.class);
    const manufacturer = normalizeLower(peripheral.manufacturer);
    const serialPort = normalizeLower(peripheral.serialPort);

    if (className === "monitor" || className === "display" || /(display|monitor|touchscreen|touch screen)/.test(name)) {
        roles.push("display");
    }
    if (className === "image" || className === "camera" || /(scanner|barcode|imager|camera)/.test(name)) {
        roles.push("scanner");
    }
    if (className === "hidclass" || className === "keyboard" || className === "mouse" || /(keyboard|mouse|touchpad|hid)/.test(name)) {
        roles.push("input");
    }
    if (className === "ports" || serialPort !== "" || /com\d+/.test(name) || /serial/.test(name)) {
        roles.push("serial");
    }
    if (className === "usb" || /usb/.test(name) || /usb/.test(manufacturer)) {
        roles.push("usb");
    }
    if (className === "printer" || /printer/.test(name)) {
        roles.push("printer");
    }
    if (/payment|pin ?pad|speedpoint|card machine|terminal/.test(name)) {
        roles.push("payment-hint");
    }
    return uniqueStrings(roles);
}

function determinePeripheralType(peripheral) {
    const roles = peripheral.matchedRoles || [];
    if (roles.indexOf("payment-terminal-candidate") >= 0) { return "payment-terminal-candidate"; }
    if (roles.indexOf("display") >= 0) { return "display"; }
    if (roles.indexOf("scanner") >= 0) { return "scanner"; }
    if (roles.indexOf("input") >= 0) { return "input"; }
    if (roles.indexOf("serial") >= 0) { return "serial"; }
    if (roles.indexOf("usb") >= 0) { return "usb"; }
    if (roles.indexOf("printer") >= 0) { return "printer"; }
    return "peripheral";
}

function matchesCompiledRule(entity, rule) {
    const name = normalizeString(entity.name);
    const manufacturer = normalizeString(entity.manufacturer);
    const instanceId = normalizeString(entity.instanceId);
    const serialPort = normalizeString(entity.serialPort);
    const className = normalizeLower(entity.class);

    if (rule.className && className !== rule.className) { return false; }
    if (rule.nameRegex && !rule.nameRegex.test(name)) { return false; }
    if (rule.manufacturerRegex && !rule.manufacturerRegex.test(manufacturer)) { return false; }
    if (rule.instanceIdRegex && !rule.instanceIdRegex.test(instanceId)) { return false; }
    if (rule.serialRegex && !rule.serialRegex.test(serialPort)) { return false; }

    return Boolean(rule.className || rule.nameRegex || rule.manufacturerRegex || rule.instanceIdRegex || rule.serialRegex);
}

function applyPrinterRules(printer, printerRules) {
    const matches = [];
    const roles = [];
    for (const rule of printerRules) {
        if (matchesCompiledRule(printer, rule)) {
            matches.push(rule.id);
            roles.push(rule.role);
        }
    }
    return {
        matchedRules: matches,
        matchedRoles: uniqueStrings(roles)
    };
}

function buildPaymentTerminalCandidates(peripherals, paymentRules) {
    const candidates = new Map();

    for (const peripheral of peripherals) {
        for (const rule of paymentRules) {
            if (!matchesCompiledRule(peripheral, rule)) { continue; }

            const candidateKey = peripheral.instanceId || peripheral.name || peripheral.serialPort || "candidate";
            const existing = candidates.get(candidateKey) || {
                key: candidateKey,
                instanceId: peripheral.instanceId,
                name: peripheral.name,
                manufacturer: peripheral.manufacturer,
                class: peripheral.class,
                serialPort: peripheral.serialPort,
                confidence: 0,
                matchedRuleIds: [],
                matchedRuleLabels: []
            };

            existing.confidence = Math.max(existing.confidence, rule.confidence);
            existing.matchedRuleIds = uniqueStrings(existing.matchedRuleIds.concat(rule.id));
            existing.matchedRuleLabels = uniqueStrings(existing.matchedRuleLabels.concat(rule.label));
            candidates.set(candidateKey, existing);
        }
    }

    return Array.from(candidates.values()).sort((left, right) => {
        if (right.confidence !== left.confidence) { return right.confidence - left.confidence; }
        return left.name.localeCompare(right.name);
    });
}

module.exports = {
    applyPrinterRules,
    buildPaymentTerminalCandidates,
    compileRules,
    determinePeripheralType,
    inferBuiltInRoles,
    matchesCompiledRule
};
