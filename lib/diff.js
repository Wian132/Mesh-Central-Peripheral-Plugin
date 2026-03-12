"use strict";

const { stableStringify } = require("./hash");

function defaultKey(item) {
    return item.key || item.instanceId || item.name || stableStringify(item);
}

function diffCollections(previousItems, nextItems, keySelector) {
    const selectKey = keySelector || defaultKey;
    const previousMap = new Map((previousItems || []).map((item) => [selectKey(item), item]));
    const nextMap = new Map((nextItems || []).map((item) => [selectKey(item), item]));

    const added = [];
    const removed = [];
    const changed = [];

    for (const [key, nextItem] of nextMap.entries()) {
        if (!previousMap.has(key)) {
            added.push(nextItem);
            continue;
        }
        const previousItem = previousMap.get(key);
        if (stableStringify(previousItem) !== stableStringify(nextItem)) {
            changed.push({ key, before: previousItem, after: nextItem });
        }
    }

    for (const [key, previousItem] of previousMap.entries()) {
        if (!nextMap.has(key)) {
            removed.push(previousItem);
        }
    }

    return { added, removed, changed };
}

function buildFullDiff(previousSnapshot, nextSnapshot) {
    const previous = previousSnapshot || {};
    const next = nextSnapshot || {};

    const printers = diffCollections(previous.printers || [], next.printers || [], (printer) => printer.name);
    const peripherals = diffCollections(previous.peripherals || [], next.peripherals || [], (peripheral) => peripheral.instanceId || peripheral.name);
    const paymentTerminalCandidates = diffCollections(
        previous.paymentTerminalCandidates || [],
        next.paymentTerminalCandidates || [],
        (candidate) => candidate.instanceId || candidate.name
    );

    return {
        printers,
        peripherals,
        paymentTerminalCandidates,
        changed: Boolean(
            printers.added.length || printers.removed.length || printers.changed.length ||
            peripherals.added.length || peripherals.removed.length || peripherals.changed.length ||
            paymentTerminalCandidates.added.length || paymentTerminalCandidates.removed.length || paymentTerminalCandidates.changed.length
        )
    };
}

module.exports = {
    buildFullDiff,
    diffCollections
};
