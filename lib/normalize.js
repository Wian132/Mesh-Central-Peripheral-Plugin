"use strict";

const { createHashHex } = require("./hash");
const { buildPaymentTerminalCandidates, determinePeripheralType, inferBuiltInRoles, applyPrinterRules } = require("./matching");
const { parseAgentPayload } = require("./parsers");
const { ensureArray, normalizeLower, normalizeString, sortBy, uniqueStrings } = require("./utils");

const PRINTER_STATUS_MAP = {
    1: "other",
    2: "unknown",
    3: "idle",
    4: "printing",
    5: "warming-up",
    6: "stopped-printing",
    7: "offline"
};
const BYTES_PER_KIB = 1024;
const OFFICE_STATUS_PRIORITY = {
    unknown: 0,
    unlicensed: 1,
    notification: 2,
    licensed: 3
};
const DISK_HEALTH_PRIORITY = {
    unknown: 0,
    healthy: 1,
    warning: 2,
    critical: 3
};

function hasOwn(object, key) {
    return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

function coerceBoolean(value) {
    if (typeof value === "boolean") { return value; }
    if (typeof value === "number") { return value !== 0; }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "true" || normalized === "yes" || normalized === "1";
    }
    return false;
}

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function bytesFromKib(value) {
    const kib = toFiniteNumber(value);
    return kib == null ? null : Math.round(kib * BYTES_PER_KIB);
}

function toRoundedInteger(value) {
    const numeric = toFiniteNumber(value);
    return numeric == null ? null : Math.round(numeric);
}

function toNonNegativeInteger(value) {
    const numeric = toFiniteNumber(value);
    if (numeric == null || numeric < 0) { return null; }
    return Math.round(numeric);
}

function normalizeDateTime(value) {
    const text = normalizeString(value);
    if (text === "") { return ""; }

    const nativeDate = new Date(text);
    if (!Number.isNaN(nativeDate.getTime())) {
        return nativeDate.toISOString();
    }

    const dmtfMatch = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?([+-]\d{3}|[-+]\d{4}|Z)?$/);
    if (dmtfMatch) {
        const year = Number(dmtfMatch[1]);
        const month = Number(dmtfMatch[2]) - 1;
        const day = Number(dmtfMatch[3]);
        const hour = Number(dmtfMatch[4]);
        const minute = Number(dmtfMatch[5]);
        const second = Number(dmtfMatch[6]);
        const millisecond = Math.floor(Number((dmtfMatch[7] || "0").slice(0, 3).padEnd(3, "0")));
        const offsetRaw = dmtfMatch[8] || "";
        let utcMillis = Date.UTC(year, month, day, hour, minute, second, millisecond);

        if (/^[+-]\d{3,4}$/.test(offsetRaw)) {
            const normalizedOffset = offsetRaw.length === 4 ? offsetRaw : offsetRaw[0] + "0" + offsetRaw.slice(1);
            const sign = normalizedOffset[0] === "-" ? -1 : 1;
            const offsetMinutes = sign * Number(normalizedOffset.slice(1));
            utcMillis -= offsetMinutes * 60 * 1000;
        }

        const parsed = new Date(utcMillis);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }

    const epochMatch = text.match(/^\/Date\((\d+)\)\/$/);
    if (epochMatch) {
        const parsed = new Date(Number(epochMatch[1]));
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }

    return text;
}

function buildSnapshotHash(snapshot) {
    return createHashHex({
        printers: snapshot.printers || [],
        peripherals: snapshot.peripherals || [],
        paymentTerminalCandidates: snapshot.paymentTerminalCandidates || []
    });
}

function normalizePrinterStatus(rawPrinter) {
    const numericStatus = Number(rawPrinter.PrinterStatus || rawPrinter.printerStatus);
    const extendedStatus = normalizeString(rawPrinter.ExtendedPrinterStatus || rawPrinter.extendedPrinterStatus);
    const explicitStatus = normalizeString(rawPrinter.Status || rawPrinter.status);
    const status = explicitStatus || PRINTER_STATUS_MAP[numericStatus] || extendedStatus || "unknown";
    return status.toLowerCase();
}

function normalizePrinterRecord(rawPrinter, sourceMethod, printerRules) {
    const printer = {
        name: normalizeString(rawPrinter.Name || rawPrinter.name),
        status: normalizePrinterStatus(rawPrinter),
        portName: normalizeString(rawPrinter.PortName || rawPrinter.portName),
        isOffline: coerceBoolean(rawPrinter.WorkOffline || rawPrinter.workOffline) || normalizeLower(rawPrinter.Status || rawPrinter.status) === "offline",
        isError: normalizeLower(rawPrinter.ErrorInformation || rawPrinter.errorInformation || rawPrinter.Status || rawPrinter.status).indexOf("error") >= 0 ||
            ["stopped-printing", "error", "paper-out"].indexOf(normalizePrinterStatus(rawPrinter)) >= 0,
        sourceMethod: sourceMethod || "unknown"
    };

    const matches = applyPrinterRules(printer, printerRules || []);
    if (matches.matchedRules.length > 0) {
        printer.matchedRules = matches.matchedRules;
        printer.matchedRoles = matches.matchedRoles;
    }
    return printer;
}

function buildPeripheralKey(rawRecord) {
    const instanceId = normalizeString(rawRecord.InstanceId || rawRecord.InstanceID || rawRecord.DeviceID || rawRecord.PNPDeviceID || rawRecord.instanceId);
    if (instanceId !== "") { return instanceId; }
    return [
        normalizeString(rawRecord.Name || rawRecord.FriendlyName || rawRecord.name),
        normalizeString(rawRecord.Class || rawRecord.PNPClass || rawRecord.class),
        normalizeString(rawRecord.Manufacturer || rawRecord.manufacturer)
    ].join("|");
}

function mergeRecord(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
        if (value == null || value === "") { continue; }
        if (target[key] == null || target[key] === "") {
            target[key] = value;
        }
    }
    return target;
}

function normalizePeripheralRecord(rawRecord, sourceMethods) {
    const serialMatch = normalizeString(rawRecord.DeviceID || rawRecord.Name || rawRecord.Caption).match(/COM\d+/i);
    const peripheral = {
        name: normalizeString(rawRecord.FriendlyName || rawRecord.Name || rawRecord.Caption || rawRecord.Description || rawRecord.name),
        class: normalizeString(rawRecord.Class || rawRecord.PNPClass || rawRecord.class),
        instanceId: normalizeString(rawRecord.InstanceId || rawRecord.InstanceID || rawRecord.DeviceID || rawRecord.PNPDeviceID || rawRecord.instanceId),
        manufacturer: normalizeString(rawRecord.Manufacturer || rawRecord.manufacturer),
        present: typeof rawRecord.Present === "boolean" ? rawRecord.Present : typeof rawRecord.Present === "string" ? coerceBoolean(rawRecord.Present) : true,
        status: normalizeString(rawRecord.Status || rawRecord.status || rawRecord.ConfigManagerErrorCode || rawRecord.configManagerErrorCode) || "Unknown",
        location: normalizeString(rawRecord.Location || rawRecord.LocationInfo || rawRecord.LocationInformation || rawRecord.location),
        serialPort: serialMatch ? serialMatch[0].toUpperCase() : "",
        sourceMethods: uniqueStrings(sourceMethods)
    };

    const builtInRoles = inferBuiltInRoles(peripheral);
    peripheral.matchedRoles = builtInRoles;
    peripheral.type = determinePeripheralType(peripheral);
    return peripheral;
}

function isMeaningfulPeripheral(peripheral) {
    const className = normalizeLower(peripheral.class);
    const name = normalizeLower(peripheral.name);
    const meaningfulClasses = new Set(["printer", "usb", "ports", "hidclass", "keyboard", "mouse", "monitor", "image", "camera", "bluetooth", "smartcardreader", "media", "display"]);

    if (meaningfulClasses.has(className)) { return true; }
    if ((peripheral.matchedRoles || []).length > 0) { return true; }
    return /(printer|scanner|barcode|payment|pin ?pad|terminal|speedpoint|display|monitor|touch|keyboard|mouse|usb|serial|com\d+)/.test(name);
}

function mergePeripheralSources(payload) {
    const merged = new Map();
    const sourceEntries = [
        { source: "Get-PnpDevice", records: ensureArray(payload.pnpDevices && payload.pnpDevices.items) },
        { source: "Win32_PnPEntity", records: ensureArray(payload.pnpEntities && payload.pnpEntities.items) },
        { source: "Win32_SerialPort", records: ensureArray(payload.serialPorts && payload.serialPorts.items) }
    ];

    for (const entry of sourceEntries) {
        for (const record of entry.records) {
            const key = buildPeripheralKey(record);
            if (!merged.has(key)) {
                merged.set(key, { raw: {}, sourceMethods: [] });
            }
            const target = merged.get(key);
            mergeRecord(target.raw, record);
            target.sourceMethods.push(entry.source);
        }
    }

    return Array.from(merged.values()).map((entry) => normalizePeripheralRecord(entry.raw, entry.sourceMethods));
}

function normalizeSystemSummary(rawSystem) {
    const system = rawSystem && typeof rawSystem === "object" ? rawSystem : {};
    const cpuItems = ensureArray(system.cpu);
    const operatingSystemItems = ensureArray(system.operatingSystem);
    const storageInfo = system.storage && typeof system.storage === "object" ? system.storage : {};
    const systemDisk = storageInfo.systemDisk && typeof storageInfo.systemDisk === "object" ? storageInfo.systemDisk : null;
    const networkInfo = system.network && typeof system.network === "object" ? system.network : {};

    if (cpuItems.length === 0 && operatingSystemItems.length === 0 && systemDisk == null && Object.keys(networkInfo).length === 0) {
        return null;
    }

    const cpuNames = uniqueStrings(cpuItems.map((item) => normalizeString(item.Name || item.name)));
    const cpuManufacturers = uniqueStrings(cpuItems.map((item) => normalizeString(item.Manufacturer || item.manufacturer)));
    const totalCores = cpuItems.reduce((sum, item) => sum + (toFiniteNumber(item.NumberOfCores || item.numberOfCores) || 0), 0);
    const totalLogicalProcessors = cpuItems.reduce((sum, item) => sum + (toFiniteNumber(item.NumberOfLogicalProcessors || item.numberOfLogicalProcessors) || 0), 0);
    const maxClockSpeedMHz = cpuItems.reduce((max, item) => {
        const value = toFiniteNumber(item.MaxClockSpeed || item.maxClockSpeed);
        return value != null && value > max ? value : max;
    }, 0) || null;

    const loadSamples = cpuItems
        .map((item) => toFiniteNumber(item.LoadPercentage || item.loadPercentage))
        .filter((value) => value != null);

    const operatingSystem = operatingSystemItems[0] || {};
    const totalMemoryBytes = bytesFromKib(operatingSystem.TotalVisibleMemorySize || operatingSystem.totalVisibleMemorySize);
    const freeMemoryBytes = bytesFromKib(operatingSystem.FreePhysicalMemory || operatingSystem.freePhysicalMemory);
    const usedMemoryBytes = (totalMemoryBytes != null && freeMemoryBytes != null)
        ? Math.max(0, totalMemoryBytes - freeMemoryBytes)
        : null;
    const memoryUsedPercent = (totalMemoryBytes && usedMemoryBytes != null)
        ? Math.round((usedMemoryBytes / totalMemoryBytes) * 100)
        : null;
    const totalVirtualMemoryBytes = bytesFromKib(operatingSystem.TotalVirtualMemorySize || operatingSystem.totalVirtualMemorySize);
    const freeVirtualMemoryBytes = bytesFromKib(operatingSystem.FreeVirtualMemory || operatingSystem.freeVirtualMemory);

    const storageTotalBytes = toFiniteNumber(systemDisk && (systemDisk.Size || systemDisk.size));
    const storageFreeBytes = toFiniteNumber(systemDisk && (systemDisk.FreeSpace || systemDisk.freeSpace));
    const storageUsedBytes = (storageTotalBytes != null && storageFreeBytes != null)
        ? Math.max(0, storageTotalBytes - storageFreeBytes)
        : null;
    const storageUsedPercent = (storageTotalBytes && storageUsedBytes != null)
        ? Math.round((storageUsedBytes / storageTotalBytes) * 100)
        : null;

    const gatewayPingMs = toFiniteNumber(networkInfo.gatewayPingMs);
    const internetPingMs = toFiniteNumber(networkInfo.internetPingMs);

    return {
        cpu: {
            model: cpuNames[0] || "",
            models: cpuNames,
            manufacturer: cpuManufacturers[0] || "",
            socketCount: cpuItems.length,
            totalCores: totalCores || null,
            totalLogicalProcessors: totalLogicalProcessors || null,
            maxClockSpeedMHz,
            loadPercent: loadSamples.length > 0
                ? Math.round(loadSamples.reduce((sum, value) => sum + value, 0) / loadSamples.length)
                : null
        },
        memory: {
            totalBytes: totalMemoryBytes,
            freeBytes: freeMemoryBytes,
            usedBytes: usedMemoryBytes,
            usedPercent: memoryUsedPercent,
            totalVirtualBytes: totalVirtualMemoryBytes,
            freeVirtualBytes: freeVirtualMemoryBytes
        },
        operatingSystem: {
            caption: normalizeString(operatingSystem.Caption || operatingSystem.caption),
            version: normalizeString(operatingSystem.Version || operatingSystem.version),
            computerName: normalizeString(operatingSystem.CSName || operatingSystem.csName),
            lastBootUpTime: normalizeDateTime(operatingSystem.LastBootUpTime || operatingSystem.lastBootUpTime)
        },
        storage: {
            systemDrive: normalizeString(storageInfo.systemDrive),
            totalBytes: storageTotalBytes,
            freeBytes: storageFreeBytes,
            usedBytes: storageUsedBytes,
            usedPercent: storageUsedPercent
        },
        network: {
            state: normalizeString(networkInfo.state || networkInfo.networkState).toLowerCase() || "",
            linkType: normalizeString(networkInfo.linkType || networkInfo.networkLinkType).toLowerCase() || "",
            ipAddress: normalizeString(networkInfo.ipAddress),
            wifiSsid: normalizeString(networkInfo.wifiSsid || networkInfo.ssid),
            wifiSignalPercent: toRoundedInteger(networkInfo.wifiSignalPercent || networkInfo.signalPercent),
            gatewayPingMs,
            internetPingMs
        }
    };
}

function normalizeNullableBoolean(value) {
    if (typeof value === "boolean") { return value; }
    if (typeof value === "number") { return value !== 0; }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "") { return null; }
        if (["true", "1", "yes", "y"].indexOf(normalized) >= 0) { return true; }
        if (["false", "0", "no", "n"].indexOf(normalized) >= 0) { return false; }
    }
    return null;
}

function compactHealthSignals(signals) {
    const compacted = {};
    if (signals == null || typeof signals !== "object") { return null; }
    for (const [key, value] of Object.entries(signals)) {
        if (value !== undefined) {
            compacted[key] = value;
        }
    }
    return Object.keys(compacted).length > 0 ? compacted : null;
}

function normalizeOfficeActivationStatusText(value) {
    const normalized = normalizeLower(value);
    if (normalized === "") { return "unknown"; }
    if (normalized.indexOf("unlicensed") >= 0) { return "unlicensed"; }
    if (normalized.indexOf("notification") >= 0 || normalized.indexOf("notifications") >= 0 || normalized.indexOf("grace") >= 0) {
        return "notification";
    }
    if (normalized.indexOf("licensed") >= 0) { return "licensed"; }
    return "unknown";
}

function isPrimaryOfficeProductName(value) {
    const normalized = normalizeLower(value);
    if (normalized === "") { return false; }
    if (/(visio|project|proof|language pack|mui|accessruntime|onenotefree|skypeforbusiness|sharepointdesigner)/.test(normalized)) {
        return false;
    }
    return /(microsoft 365|office|o365|proplus|standard|professional|homebusiness|home & business|enterprise|mondo)/.test(normalized);
}

function finalizeOfficeEntry(entry) {
    if (!entry) { return null; }
    const productName = normalizeString(entry.productName || entry.name || entry.licenseName);
    const statusText = normalizeString(entry.statusText || entry.state || entry.licenseState);
    const expiresAtRaw = normalizeString(
        entry.officeExpiresAt ||
        entry.expiresAt ||
        entry.notAfter ||
        entry.entitlementExpiration
    );
    if (productName === "" && statusText === "") { return null; }
    const finalized = {
        officeProductName: productName || null,
        officeActivationStatus: normalizeOfficeActivationStatusText(statusText)
    };
    if (expiresAtRaw !== "") {
        const normalizedExpiresAt = normalizeDateTime(expiresAtRaw);
        if (normalizedExpiresAt && normalizedExpiresAt !== expiresAtRaw) {
            finalized.officeExpiresAt = normalizedExpiresAt;
        } else if (!Number.isNaN(new Date(expiresAtRaw).getTime())) {
            finalized.officeExpiresAt = new Date(expiresAtRaw).toISOString();
        }
    }
    return finalized;
}

function parseOsppOfficeEntries(rawOutput) {
    const text = String(rawOutput || "");
    if (text.trim() === "") { return []; }

    const entries = [];
    let current = null;

    function pushCurrent() {
        const finalized = finalizeOfficeEntry(current);
        if (finalized) { entries.push(finalized); }
        current = null;
    }

    for (const rawLine of text.split(/\r?\n/)) {
        const line = String(rawLine || "");
        const productMatch = line.match(/^\s*LICENSE NAME:\s*(.+?)\s*$/i);
        if (productMatch) {
            pushCurrent();
            current = { productName: productMatch[1] };
            continue;
        }

        const statusMatch = line.match(/^\s*LICENSE STATUS:\s*(.+?)\s*$/i);
        if (statusMatch) {
            if (!current) { current = {}; }
            current.statusText = statusMatch[1].replace(/-+/g, " ").trim();
        }
    }

    pushCurrent();
    return entries;
}

function parseVnextOfficeEntries(rawOutput) {
    const text = String(rawOutput || "");
    if (text.trim() === "") { return []; }

    const entries = [];
    const dedupeKeys = new Set();
    let current = null;

    function pushCurrent() {
        const finalized = finalizeOfficeEntry(current);
        if (finalized) {
            const key = [
                finalized.officeProductName || "",
                finalized.officeActivationStatus || "",
                finalized.officeExpiresAt || ""
            ].join("|");
            if (!dedupeKeys.has(key)) {
                dedupeKeys.add(key);
                entries.push(finalized);
            }
        }
        current = null;
    }

    const objectMatches = text.match(/\{[\s\S]*?\}/g) || [];
    for (const block of objectMatches) {
        try {
            const parsed = JSON.parse(block);
            const finalized = finalizeOfficeEntry({
                productName: parsed.Name || parsed.Product || parsed.ProductReleaseId,
                statusText: parsed.State || parsed.LicenseState,
                expiresAt: parsed.NotAfter || parsed.EntitlementExpiration
            });
            if (finalized) {
                const key = [
                    finalized.officeProductName || "",
                    finalized.officeActivationStatus || "",
                    finalized.officeExpiresAt || ""
                ].join("|");
                if (!dedupeKeys.has(key)) {
                    dedupeKeys.add(key);
                    entries.push(finalized);
                }
            }
        } catch (_) {
            // Ignore non-JSON blocks and continue with the line-oriented fallback parser.
        }
    }

    for (const rawLine of text.split(/\r?\n/)) {
        const line = String(rawLine || "").trim();
        if (line === "") {
            pushCurrent();
            continue;
        }
        if (line === "{" || line === "}") {
            if (line === "}") { pushCurrent(); }
            continue;
        }

        let match = line.match(/^(?:Name|ProductReleaseId|Product)\s*:\s*(.+?)\s*$/i);
        if (match) {
            if (current && (current.productName || current.statusText)) { pushCurrent(); }
            current = current || {};
            current.productName = match[1];
            continue;
        }

        match = line.match(/^(?:State|LicenseState)\s*:\s*(.+?)\s*$/i);
        if (match) {
            current = current || {};
            current.statusText = match[1];
            continue;
        }

        match = line.match(/^(?:NotAfter|EntitlementExpiration)\s*:\s*(.+?)\s*$/i);
        if (match) {
            current = current || {};
            current.expiresAt = match[1];
        }
    }

    pushCurrent();
    return entries;
}

function chooseOfficeActivationEntry(entries) {
    const normalizedEntries = ensureArray(entries).filter(Boolean);
    if (normalizedEntries.length === 0) { return null; }

    const primaryEntries = normalizedEntries.filter((entry) => isPrimaryOfficeProductName(entry.officeProductName));
    const pool = primaryEntries.length > 0 ? primaryEntries : normalizedEntries;

    return pool.slice().sort((left, right) => {
        const statusDelta =
            (OFFICE_STATUS_PRIORITY[right.officeActivationStatus] || 0) -
            (OFFICE_STATUS_PRIORITY[left.officeActivationStatus] || 0);
        if (statusDelta !== 0) { return statusDelta; }
        const leftName = normalizeLower(left.officeProductName);
        const rightName = normalizeLower(right.officeProductName);
        return leftName.localeCompare(rightName);
    })[0] || null;
}

function normalizeOfficeActivation(rawOffice) {
    const office = rawOffice && typeof rawOffice === "object" ? rawOffice : {};
    const method = normalizeLower(office.method || office.source);
    const rawOutput = String(office.rawOutput || office.output || "");

    let entries = [];
    if (method === "ospp-vbs") {
        entries = parseOsppOfficeEntries(rawOutput);
    } else if (method === "vnextdiag") {
        entries = parseVnextOfficeEntries(rawOutput);
    } else {
        entries = parseOsppOfficeEntries(rawOutput);
        if (entries.length === 0) {
            entries = parseVnextOfficeEntries(rawOutput);
        }
    }

    const selected = chooseOfficeActivationEntry(entries);
    if (selected) { return selected; }

    return {
        officeActivationStatus: "unknown",
        officeProductName: null
    };
}

function normalizeDiskHealthStatus(rawDisk) {
    const disk = rawDisk && typeof rawDisk === "object" ? rawDisk : {};
    const items = ensureArray(disk.items);
    if (items.length === 0) { return "unknown"; }

    let worst = "unknown";

    for (const item of items) {
        const tokens = []
            .concat(ensureArray(item && item.OperationalStatus))
            .concat([
                item && item.HealthStatus,
                item && item.Status
            ])
            .map((value) => normalizeLower(value))
            .filter(Boolean)
            .join(" ");

        let current = "unknown";
        if (/(critical|unhealthy|fail|failed|failure|offline|lost communication|lostcommunication|unusable)/.test(tokens)) {
            current = "critical";
        } else if (/(warning|degraded|predictive|pred fail|stressed|rebuild|repair|in service)/.test(tokens)) {
            current = "warning";
        } else if (/(healthy|ok)/.test(tokens)) {
            current = "healthy";
        }

        if ((DISK_HEALTH_PRIORITY[current] || 0) > (DISK_HEALTH_PRIORITY[worst] || 0)) {
            worst = current;
        }
    }

    return worst;
}

function normalizeHealthSignals(rawHealthSignals) {
    const healthSignals = rawHealthSignals && typeof rawHealthSignals === "object" ? rawHealthSignals : {};
    const normalized = {};

    if (hasOwn(healthSignals, "pendingReboot")) {
        normalized.pendingReboot = normalizeNullableBoolean(healthSignals.pendingReboot);
    }

    if (hasOwn(healthSignals, "office")) {
        const office = normalizeOfficeActivation(healthSignals.office);
        normalized.officeActivationStatus = office.officeActivationStatus;
        normalized.officeProductName = office.officeProductName;
        if (hasOwn(office, "officeExpiresAt")) {
            normalized.officeExpiresAt = office.officeExpiresAt;
        }
    }

    if (hasOwn(healthSignals, "unexpectedShutdownCount7d")) {
        normalized.unexpectedShutdownCount7d = toNonNegativeInteger(healthSignals.unexpectedShutdownCount7d);
    }

    if (hasOwn(healthSignals, "disk")) {
        normalized.diskHealthStatus = normalizeDiskHealthStatus(healthSignals.disk);
    }

    return compactHealthSignals(normalized);
}

function mergeHealthSignals(statusSnapshot, fullSnapshot) {
    const statusHealth = statusSnapshot && statusSnapshot.healthSignals && typeof statusSnapshot.healthSignals === "object"
        ? statusSnapshot.healthSignals
        : null;
    const fullHealth = fullSnapshot && fullSnapshot.healthSignals && typeof fullSnapshot.healthSignals === "object"
        ? fullSnapshot.healthSignals
        : null;
    const merged = {};

    if (statusHealth && hasOwn(statusHealth, "pendingReboot") && statusHealth.pendingReboot != null) {
        merged.pendingReboot = statusHealth.pendingReboot;
    } else if (fullHealth && hasOwn(fullHealth, "pendingReboot")) {
        merged.pendingReboot = fullHealth.pendingReboot;
    }

    if (fullHealth && hasOwn(fullHealth, "officeActivationStatus")) {
        merged.officeActivationStatus = fullHealth.officeActivationStatus;
    }
    if (fullHealth && hasOwn(fullHealth, "officeProductName")) {
        merged.officeProductName = fullHealth.officeProductName;
    }
    if (fullHealth && hasOwn(fullHealth, "officeExpiresAt")) {
        merged.officeExpiresAt = fullHealth.officeExpiresAt;
    }
    if (fullHealth && hasOwn(fullHealth, "unexpectedShutdownCount7d")) {
        merged.unexpectedShutdownCount7d = fullHealth.unexpectedShutdownCount7d;
    }
    if (fullHealth && hasOwn(fullHealth, "diskHealthStatus")) {
        merged.diskHealthStatus = fullHealth.diskHealthStatus;
    }

    return compactHealthSignals(merged);
}

function sortPrinters(printers) {
    return sortBy(printers, (printer) => printer.name.toLowerCase());
}

function sortPeripherals(peripherals) {
    return sortBy(peripherals, (peripheral) => (peripheral.instanceId || peripheral.name).toLowerCase());
}

function normalizeStatusPayload(rawPayload, compiledMatching) {
    const payload = parseAgentPayload(rawPayload);
    const printers = sortPrinters(ensureArray(payload.printers && payload.printers.items)
        .map((record) => normalizePrinterRecord(record, payload.printers && payload.printers.method, compiledMatching.printers))
        .filter((printer) => printer.name !== ""));

    const peripherals = sortPeripherals(ensureArray(payload.pnpDevices && payload.pnpDevices.items)
        .map((record) => normalizePeripheralRecord(record, ["Get-PnpDevice"]))
        .filter(isMeaningfulPeripheral));

    const paymentTerminalCandidates = buildPaymentTerminalCandidates(peripherals, compiledMatching.paymentTerminals);
    paymentTerminalCandidates.forEach((candidate) => {
        const peripheral = peripherals.find((item) => (item.instanceId || item.name) === (candidate.instanceId || candidate.name));
        if (peripheral) {
            peripheral.matchedRoles = uniqueStrings(peripheral.matchedRoles.concat("payment-terminal-candidate"));
            peripheral.type = determinePeripheralType(peripheral);
        }
    });

    const snapshot = {
        printers,
        peripherals,
        paymentTerminalCandidates,
        systemSummary: normalizeSystemSummary(payload.system),
        healthSignals: normalizeHealthSignals(payload.healthSignals),
        warnings: ensureArray(payload.warnings)
    };

    snapshot.snapshotHash = buildSnapshotHash(snapshot);
    return snapshot;
}

function normalizeFullPayload(rawPayload, compiledMatching) {
    const payload = parseAgentPayload(rawPayload);
    const printers = sortPrinters(ensureArray(payload.printers && payload.printers.items)
        .map((record) => normalizePrinterRecord(record, payload.printers && payload.printers.method, compiledMatching.printers))
        .filter((printer) => printer.name !== ""));

    const peripherals = sortPeripherals(mergePeripheralSources(payload).filter(isMeaningfulPeripheral));
    const paymentTerminalCandidates = buildPaymentTerminalCandidates(peripherals, compiledMatching.paymentTerminals);
    paymentTerminalCandidates.forEach((candidate) => {
        const peripheral = peripherals.find((item) => (item.instanceId || item.name) === (candidate.instanceId || candidate.name));
        if (peripheral) {
            peripheral.matchedRoles = uniqueStrings(peripheral.matchedRoles.concat("payment-terminal-candidate"));
            peripheral.type = determinePeripheralType(peripheral);
        }
    });

    const snapshot = {
        printers,
        peripherals,
        paymentTerminalCandidates,
        systemSummary: normalizeSystemSummary(payload.system),
        healthSignals: normalizeHealthSignals(payload.healthSignals),
        warnings: ensureArray(payload.warnings)
    };

    snapshot.snapshotHash = buildSnapshotHash(snapshot);
    return snapshot;
}

module.exports = {
    mergeHealthSignals,
    normalizeHealthSignals,
    normalizeFullPayload,
    normalizeDateTime,
    normalizeOfficeActivation,
    normalizePrinterRecord,
    normalizeSystemSummary,
    normalizeStatusPayload
};
