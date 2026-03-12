"use strict";

function ensureArray(value) {
    if (value == null) { return []; }
    return Array.isArray(value) ? value : [value];
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function uniqueStrings(values) {
    return Array.from(new Set(ensureArray(values).filter((value) => typeof value === "string" && value.trim() !== "")));
}

function normalizeString(value) {
    if (value == null) { return ""; }
    return String(value).trim();
}

function normalizeLower(value) {
    return normalizeString(value).toLowerCase();
}

function sortBy(items, selector) {
    return items.slice().sort((left, right) => {
        const leftKey = selector(left);
        const rightKey = selector(right);
        if (leftKey < rightKey) { return -1; }
        if (leftKey > rightKey) { return 1; }
        return 0;
    });
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

module.exports = {
    deepClone,
    ensureArray,
    escapeHtml,
    normalizeLower,
    normalizeString,
    parseInteger,
    safeJsonParse,
    sortBy,
    uniqueStrings
};
