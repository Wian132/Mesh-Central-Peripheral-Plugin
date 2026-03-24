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
        warnings: ensureArray(payload.warnings)
    };

    snapshot.snapshotHash = buildSnapshotHash(snapshot);
    return snapshot;
}

module.exports = {
    normalizeFullPayload,
    normalizeDateTime,
    normalizePrinterRecord,
    normalizeSystemSummary,
    normalizeStatusPayload
};
