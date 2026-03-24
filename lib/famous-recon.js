"use strict";

function roundNumber(value, digits) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) { return null; }
    const precision = Number.isInteger(digits) ? digits : 2;
    const factor = Math.pow(10, precision);
    return Math.round(numeric * factor) / factor;
}

function bytesToGiB(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) { return null; }
    return roundNumber(numeric / (1024 * 1024 * 1024), 2);
}

function toIsoString(value) {
    if (!value) { return null; }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildOsVersion(operatingSystem) {
    const parts = [operatingSystem.caption, operatingSystem.version]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    return parts.join(" | ") || null;
}

function computeUptimeHours(lastBootUpTime, reportedAt) {
    const boot = toIsoString(lastBootUpTime);
    const reported = toIsoString(reportedAt) || new Date().toISOString();
    if (!boot || !reported) { return null; }
    const bootMs = Date.parse(boot);
    const reportedMs = Date.parse(reported);
    if (!Number.isFinite(bootMs) || !Number.isFinite(reportedMs) || reportedMs < bootMs) { return null; }
    return roundNumber((reportedMs - bootMs) / (60 * 60 * 1000), 2);
}

function normalizePrinter(printer) {
    return {
        name: String(printer && printer.name || ""),
        status: String(printer && printer.status || "unknown"),
        port_name: String(printer && printer.portName || ""),
        is_offline: Boolean(printer && printer.isOffline),
        is_error: Boolean(printer && printer.isError),
        matched_roles: Array.isArray(printer && printer.matchedRoles) ? printer.matchedRoles.slice() : []
    };
}

function normalizePeripheral(peripheral) {
    return {
        type: String(peripheral && peripheral.type || ""),
        name: String(peripheral && peripheral.name || ""),
        id: String(peripheral && (peripheral.instanceId || peripheral.id || "") || ""),
        status: String(peripheral && peripheral.status || ""),
        manufacturer: String(peripheral && peripheral.manufacturer || ""),
        class: String(peripheral && peripheral.class || ""),
        serial_port: String(peripheral && peripheral.serialPort || ""),
        matchedRoles: Array.isArray(peripheral && peripheral.matchedRoles) ? peripheral.matchedRoles.slice() : [],
        present: peripheral && typeof peripheral.present === "boolean" ? peripheral.present : null,
        location: String(peripheral && peripheral.location || "")
    };
}

function uniqueStrings(values) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function buildTelemetryPayload(viewState, options) {
    const exportedAt = new Date().toISOString();
    const systemSummary = viewState && viewState.systemSummary ? viewState.systemSummary : {};
    const cpu = systemSummary.cpu || {};
    const memory = systemSummary.memory || {};
    const operatingSystem = systemSummary.operatingSystem || {};
    const storage = systemSummary.storage || {};
    const network = systemSummary.network || {};
    const warnings = uniqueStrings((viewState && viewState.warnings) || []);

    if (viewState && viewState.lastError) {
        warnings.push(String(viewState.lastError.message || viewState.lastError.error || viewState.lastError));
    }

    return {
        source: "meshcentral-plugin",
        pluginVersion: options && options.pluginVersion ? String(options.pluginVersion) : "",
        reportedAt: exportedAt,
        scanMode: options && options.scanMode ? String(options.scanMode) : "full",
        nodeId: String(viewState && viewState.nodeId || ""),
        deviceId: String(options && options.deviceId || ""),
        deviceType: String(options && options.deviceType || ""),
        lastStatusScanAt: viewState && viewState.lastStatusScanAt || null,
        lastFullScanAt: viewState && viewState.lastFullScanAt || null,
        inventoryHash: viewState && viewState.inventoryHash || null,
        inventoryChanged: options && typeof options.inventoryChanged === "boolean" ? options.inventoryChanged : false,
        systemSummary: {
            cpu: {
                model: String(cpu.model || ""),
                totalCores: roundNumber(cpu.totalCores, 0),
                totalLogicalProcessors: roundNumber(cpu.totalLogicalProcessors, 0),
                maxClockSpeedMHz: roundNumber(cpu.maxClockSpeedMHz, 0),
                loadPercent: roundNumber(cpu.loadPercent, 2)
            },
            memory: {
                totalBytes: roundNumber(memory.totalBytes, 0),
                freeBytes: roundNumber(memory.freeBytes, 0),
                usedBytes: roundNumber(memory.usedBytes, 0),
                usedPercent: roundNumber(memory.usedPercent, 2)
            },
            operatingSystem: {
                computerName: String(operatingSystem.computerName || ""),
                caption: String(operatingSystem.caption || ""),
                version: String(operatingSystem.version || ""),
                lastBootUpTime: toIsoString(operatingSystem.lastBootUpTime)
            },
            storage: {
                systemDrive: String(storage.systemDrive || ""),
                totalBytes: roundNumber(storage.totalBytes, 0),
                freeBytes: roundNumber(storage.freeBytes, 0),
                usedBytes: roundNumber(storage.usedBytes, 0),
                usedPercent: roundNumber(storage.usedPercent, 2)
            },
            network: {
                state: String(network.state || ""),
                linkType: String(network.linkType || ""),
                ipAddress: String(network.ipAddress || ""),
                wifiSsid: String(network.wifiSsid || ""),
                wifiSignalPercent: roundNumber(network.wifiSignalPercent, 2),
                gatewayPingMs: roundNumber(network.gatewayPingMs, 2),
                internetPingMs: roundNumber(network.internetPingMs, 2)
            }
        },
        metrics: {
            cpuPercent: roundNumber(cpu.loadPercent, 2),
            memoryPercent: roundNumber(memory.usedPercent, 2),
            memoryTotalGb: bytesToGiB(memory.totalBytes),
            memoryAvailableGb: bytesToGiB(memory.freeBytes),
            diskPercent: roundNumber(storage.usedPercent, 2),
            diskFreeGb: bytesToGiB(storage.freeBytes),
            uptimeHours: computeUptimeHours(operatingSystem.lastBootUpTime, exportedAt),
            osVersion: buildOsVersion(operatingSystem),
            ipAddress: String(network.ipAddress || "") || null,
            networkState: String(network.state || "") || null,
            networkLinkType: String(network.linkType || "") || null,
            wifiSsid: String(network.wifiSsid || "") || null,
            wifiSignalPercent: roundNumber(network.wifiSignalPercent, 2),
            gatewayPingMs: roundNumber(network.gatewayPingMs, 2),
            internetPingMs: roundNumber(network.internetPingMs, 2)
        },
        printers: Array.isArray(viewState && viewState.printers) ? viewState.printers.map(normalizePrinter) : [],
        peripherals: Array.isArray(viewState && viewState.peripherals) ? viewState.peripherals.map(normalizePeripheral) : [],
        paymentTerminalCandidates: Array.isArray(viewState && viewState.paymentTerminalCandidates)
            ? viewState.paymentTerminalCandidates.map(normalizePeripheral)
            : [],
        warnings
    };
}

function maskApiKeyForLog(apiKey) {
    const s = String(apiKey || "");
    if (s.length <= 8) { return "***"; }
    return s.slice(0, 4) + "…" + s.slice(-4);
}

function truncateForLog(text, maxLen) {
    const limit = Number.isInteger(maxLen) ? maxLen : 500;
    const s = String(text || "");
    if (s.length <= limit) { return s; }
    return s.slice(0, limit) + "…";
}

/**
 * Single-line summary for MeshCentral plugin debug logs (secrets masked).
 */
function buildExportAttemptLogLine(integration, payload) {
    const url = String(integration && integration.endpointUrl || "").trim();
    let hostPath = url;
    try {
        const parsed = new URL(url);
        hostPath = parsed.host + parsed.pathname;
    } catch (_) {
        /* keep raw if not a valid URL */
    }
    const masked = maskApiKeyForLog(integration && integration.apiKey);
    const parts = [
        "POST " + hostPath,
        "headers[Content-Type, x-api-key=" + masked + ", x-device-id, x-mesh-node-id" + (payload && payload.deviceType ? ", x-device-type" : "") + "]",
        "deviceId=" + String(payload && payload.deviceId || ""),
        "nodeId=" + String(payload && payload.nodeId || "")
    ];
    const body = JSON.stringify(payload || {});
    parts.push("payloadBytes~" + Buffer.byteLength(body, "utf8"));
    const m = payload && payload.metrics ? payload.metrics : {};
    parts.push("metrics.cpuPercent=" + m.cpuPercent + " memoryPercent=" + m.memoryPercent + " memoryTotalGb=" + m.memoryTotalGb + " memoryAvailableGb=" + m.memoryAvailableGb);
    return parts.join(" | ");
}

async function sendTelemetry(config, payload) {
    if (!config || config.enabled !== true) {
        return { ok: true, skipped: true, reason: "config disabled or missing" };
    }

    const endpointUrl = String(config.endpointUrl || "").trim();
    const apiKey = String(config.apiKey || "").trim();
    if (endpointUrl === "" || apiKey === "") {
        return { ok: false, skipped: false, error: "Famous Recon export is enabled but endpoint URL or API key is missing." };
    }
    if (!payload || !payload.nodeId || !payload.deviceId) {
        return { ok: false, skipped: false, error: "Famous Recon export requires both nodeId and deviceId." };
    }

    const timeoutMs = Number(config.requestTimeoutMs) || 10000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers = {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "x-device-id": payload.deviceId,
            "x-mesh-node-id": payload.nodeId
        };
        if (payload.deviceType) {
            headers["x-device-type"] = payload.deviceType;
        }

        const response = await fetch(endpointUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        const status = response.status;

        if (!response.ok) {
            const responseText = await response.text();
            return {
                ok: false,
                skipped: false,
                status,
                error: responseText || ("Famous Recon export failed with HTTP " + status + ".")
            };
        }

        return { ok: true, skipped: false, status };
    } catch (error) {
        const message = error && error.name === "AbortError"
            ? "Famous Recon export timed out after " + timeoutMs + "ms."
            : (error && error.message ? error.message : String(error));
        return { ok: false, skipped: false, error: message };
    } finally {
        clearTimeout(timeout);
    }
}

function buildSupabaseRow(payload, serverId) {
    const m = payload && payload.metrics ? payload.metrics : {};
    return {
        server_id: serverId,
        reported_at: payload.reportedAt || new Date().toISOString(),
        cpu_percent: m.cpuPercent != null ? m.cpuPercent : null,
        memory_percent: m.memoryPercent != null ? m.memoryPercent : null,
        memory_total_gb: m.memoryTotalGb != null ? m.memoryTotalGb : null,
        memory_available_gb: m.memoryAvailableGb != null ? m.memoryAvailableGb : null,
        disk_percent: m.diskPercent != null ? m.diskPercent : null,
        disk_free_gb: m.diskFreeGb != null ? m.diskFreeGb : null,
        uptime_hours: m.uptimeHours != null ? m.uptimeHours : null,
        os_version: m.osVersion || null,
        ip_address: m.ipAddress || null,
        network_state: m.networkState || null,
        network_link_type: m.networkLinkType || null,
        wifi_ssid: m.wifiSsid || null,
        wifi_signal_percent: m.wifiSignalPercent != null ? m.wifiSignalPercent : null,
        gateway_ping_ms: m.gatewayPingMs != null ? m.gatewayPingMs : null,
        internet_ping_ms: m.internetPingMs != null ? m.internetPingMs : null,
        printers: Array.isArray(payload.printers) ? payload.printers : [],
        peripherals: Array.isArray(payload.peripherals) ? payload.peripherals : [],
        payment_terminal_candidates: Array.isArray(payload.paymentTerminalCandidates) ? payload.paymentTerminalCandidates : [],
        peripherals_hash: payload.inventoryHash || null,
        peripherals_changed: typeof payload.inventoryChanged === "boolean" ? payload.inventoryChanged : null,
        telemetry_source: "agent",
        collector_kind: "meshcentral_plugin",
        agent_version: payload.pluginVersion || null,
        is_online: true,
        power_state: "on"
    };
}

async function resolveServerId(supabaseUrl, supabaseAnonKey, meshNodeId, timeoutMs) {
    const url = supabaseUrl.replace(/\/+$/, "") + "/rest/v1/fleet_servers?mesh_node_id=eq." + encodeURIComponent(meshNodeId) + "&select=id&limit=1";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 10000);
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "apikey": supabaseAnonKey,
                "Authorization": "Bearer " + supabaseAnonKey,
                "Accept": "application/json"
            },
            signal: controller.signal
        });
        if (!response.ok) {
            const text = await response.text();
            return { ok: false, error: "fleet_servers lookup failed: HTTP " + response.status + " " + truncateForLog(text, 200) };
        }
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            return { ok: false, error: "No fleet_servers row found for mesh_node_id: " + meshNodeId };
        }
        return { ok: true, serverId: rows[0].id };
    } catch (error) {
        const msg = error && error.name === "AbortError" ? "fleet_servers lookup timed out." : (error && error.message ? error.message : String(error));
        return { ok: false, error: msg };
    } finally {
        clearTimeout(timeout);
    }
}

async function sendTelemetryToSupabase(config, payload) {
    if (!config || config.enabled !== true) {
        return { ok: true, skipped: true, reason: "config disabled or missing" };
    }
    const supabaseUrl = String(config.supabaseUrl || "").trim();
    const supabaseAnonKey = String(config.supabaseAnonKey || "").trim();
    if (supabaseUrl === "" || supabaseAnonKey === "") {
        return { ok: false, skipped: false, error: "Supabase export is enabled but supabaseUrl or supabaseAnonKey is missing." };
    }
    if (!payload || !payload.nodeId) {
        return { ok: false, skipped: false, error: "Supabase export requires nodeId." };
    }

    const timeoutMs = Number(config.requestTimeoutMs) || 10000;

    const lookup = await resolveServerId(supabaseUrl, supabaseAnonKey, payload.nodeId, timeoutMs);
    if (!lookup.ok) {
        return { ok: false, skipped: false, error: lookup.error };
    }

    const row = buildSupabaseRow(payload, lookup.serverId);
    const insertUrl = supabaseUrl.replace(/\/+$/, "") + "/rest/v1/server_telemetry";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(insertUrl, {
            method: "POST",
            headers: {
                "apikey": supabaseAnonKey,
                "Authorization": "Bearer " + supabaseAnonKey,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            body: JSON.stringify(row),
            signal: controller.signal
        });
        if (!response.ok) {
            const text = await response.text();
            return { ok: false, skipped: false, status: response.status, error: "Supabase insert failed: HTTP " + response.status + " " + truncateForLog(text, 300) };
        }
        return { ok: true, skipped: false, status: response.status, serverId: lookup.serverId };
    } catch (error) {
        const msg = error && error.name === "AbortError" ? "Supabase insert timed out after " + timeoutMs + "ms." : (error && error.message ? error.message : String(error));
        return { ok: false, skipped: false, error: msg };
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    buildSupabaseRow,
    buildTelemetryPayload,
    buildExportAttemptLogLine,
    maskApiKeyForLog,
    resolveServerId,
    sendTelemetry,
    sendTelemetryToSupabase,
    truncateForLog
};
