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

function buildHealthSignalsForPayload(rawHealthSignals) {
    const healthSignals = rawHealthSignals && typeof rawHealthSignals === "object" ? rawHealthSignals : null;
    if (healthSignals == null) { return null; }

    const normalized = {};
    if (typeof healthSignals.pendingReboot === "boolean" || healthSignals.pendingReboot === null) {
        normalized.pendingReboot = healthSignals.pendingReboot;
    }
    if (Number.isInteger(healthSignals.unexpectedShutdownCount7d) || healthSignals.unexpectedShutdownCount7d === null) {
        normalized.unexpectedShutdownCount7d = healthSignals.unexpectedShutdownCount7d;
    }
    if (["healthy", "warning", "critical", "unknown"].indexOf(String(healthSignals.diskHealthStatus || "")) >= 0 || healthSignals.diskHealthStatus === null) {
        normalized.diskHealthStatus = healthSignals.diskHealthStatus == null ? null : String(healthSignals.diskHealthStatus);
    }

    if (["licensed", "unlicensed", "notification", "unknown"].indexOf(String(healthSignals.officeActivationStatus || "")) >= 0 || healthSignals.officeActivationStatus === null) {
        normalized.officeActivationStatus = healthSignals.officeActivationStatus == null ? null : String(healthSignals.officeActivationStatus);
    }
    if (typeof healthSignals.officeProductName === "string" || healthSignals.officeProductName === null) {
        normalized.officeProductName = healthSignals.officeProductName == null ? null : String(healthSignals.officeProductName || "").trim() || null;
    }
    if (typeof healthSignals.officeExpiresAt === "string" || healthSignals.officeExpiresAt === null) {
        normalized.officeExpiresAt = healthSignals.officeExpiresAt == null ? null : String(healthSignals.officeExpiresAt || "").trim() || null;
    }
    if (typeof healthSignals.officeLicenseDescription === "string" || healthSignals.officeLicenseDescription === null) {
        normalized.officeLicenseDescription = healthSignals.officeLicenseDescription == null ? null : String(healthSignals.officeLicenseDescription || "").trim() || null;
    }
    if (typeof healthSignals.officeErrorCode === "string" || healthSignals.officeErrorCode === null) {
        normalized.officeErrorCode = healthSignals.officeErrorCode == null ? null : String(healthSignals.officeErrorCode || "").trim() || null;
    }
    if (typeof healthSignals.officeErrorDescription === "string" || healthSignals.officeErrorDescription === null) {
        normalized.officeErrorDescription = healthSignals.officeErrorDescription == null ? null : String(healthSignals.officeErrorDescription || "").trim() || null;
    }

    const hasConcreteValue = Object.values(normalized).some((value) => value !== undefined && value !== null && value !== "");
    return hasConcreteValue ? normalized : null;
}

function clonePayloadWithoutHealthSignals(payload) {
    const clone = Object.assign({}, payload || {});
    delete clone.healthSignals;
    return clone;
}

function shouldRetryWithoutHealthSignals(status, responseText) {
    const normalized = String(responseText || "").toLowerCase();
    if (normalized.indexOf("healthsignals") < 0 || status < 400) { return false; }
    return (
        normalized.indexOf("unknown") >= 0 ||
        normalized.indexOf("unrecognized") >= 0 ||
        normalized.indexOf("unexpected") >= 0 ||
        normalized.indexOf("validation") >= 0 ||
        normalized.indexOf("property") >= 0 ||
        normalized.indexOf("field") >= 0 ||
        normalized.indexOf("schema") >= 0
    );
}

function getRetryableSupabaseColumns(responseText) {
    const normalized = String(responseText || "").toLowerCase();
    const columns = [
        "collector_kind",
        "payment_terminal_candidates",
        "pending_reboot",
        "office_activation_status",
        "office_product_name",
        "office_expires_at",
        "office_license_description",
        "office_error_code",
        "office_error_description",
        "unexpected_shutdown_count_7d",
        "disk_health_status"
    ];

    return columns.some((column) => normalized.indexOf(column.toLowerCase()) >= 0) ? columns : [];
}

function cloneSupabaseRowWithoutColumns(row, columns) {
    const clone = Object.assign({}, row || {});
    for (const column of uniqueStrings(columns)) {
        delete clone[column];
    }
    return clone;
}

async function postLegacyTelemetry(endpointUrl, apiKey, payload, timeoutMs) {
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

        return {
            ok: response.ok,
            status: response.status,
            responseText: response.ok ? "" : await response.text()
        };
    } finally {
        clearTimeout(timeout);
    }
}

function buildFleetIdentityHeaders(apiKey, identity) {
    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "x-device-id": identity.deviceId,
        "x-mesh-node-id": identity.nodeId
    };
    if (identity.deviceType) {
        headers["x-device-type"] = identity.deviceType;
    }
    return headers;
}

function deriveAgentConfigUrl(endpointUrl) {
    const raw = String(endpointUrl || "").trim();
    if (raw === "") { return ""; }
    try {
        const parsed = new URL(raw);
        if (/\/api\/fleet\/mesh-plugin-telemetry\/?$/i.test(parsed.pathname)) {
            parsed.pathname = parsed.pathname.replace(/\/api\/fleet\/mesh-plugin-telemetry\/?$/i, "/api/fleet/agent-config");
        } else if (/\/api\/fleet\/heartbeat\/?$/i.test(parsed.pathname)) {
            parsed.pathname = parsed.pathname.replace(/\/api\/fleet\/heartbeat\/?$/i, "/api/fleet/agent-config");
        } else {
            parsed.pathname = "/api/fleet/agent-config";
        }
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
    } catch (error) {
        return "";
    }
}

async function fetchFleetDeviceConfig(config, identity) {
    if (!config || config.enabled !== true) {
        return { ok: true, skipped: true, reason: "config disabled or missing" };
    }

    const endpointUrl = deriveAgentConfigUrl(config.endpointUrl);
    const apiKey = String(config.apiKey || "").trim();
    if (endpointUrl === "" || apiKey === "") {
        return { ok: false, skipped: false, error: "Famous Recon control requires endpointUrl and apiKey." };
    }
    if (!identity || !identity.nodeId || !identity.deviceId) {
        return { ok: false, skipped: false, error: "Famous Recon control requires nodeId and deviceId." };
    }

    const timeoutMs = Number(config.requestTimeoutMs) || 10000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(endpointUrl, {
            method: "GET",
            headers: buildFleetIdentityHeaders(apiKey, identity),
            signal: controller.signal
        });
        if (!response.ok) {
            const text = await response.text();
            return {
                ok: false,
                skipped: false,
                status: response.status,
                error: text || ("Famous Recon control failed with HTTP " + response.status + ".")
            };
        }
        return {
            ok: true,
            skipped: false,
            status: response.status,
            data: await response.json()
        };
    } catch (error) {
        const message = error && error.name === "AbortError"
            ? "Famous Recon control timed out after " + timeoutMs + "ms."
            : (error && error.message ? error.message : String(error));
        return { ok: false, skipped: false, error: message };
    } finally {
        clearTimeout(timeout);
    }
}

async function postSupabaseTelemetry(insertUrl, supabaseAnonKey, row, timeoutMs) {
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
        return {
            ok: response.ok,
            status: response.status,
            responseText: response.ok ? "" : await response.text()
        };
    } finally {
        clearTimeout(timeout);
    }
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

    const payload = {
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

    const healthSignals = buildHealthSignalsForPayload(viewState && viewState.healthSignals);
    if (healthSignals) {
        payload.healthSignals = healthSignals;
    }

    return payload;
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

    try {
        let result = await postLegacyTelemetry(endpointUrl, apiKey, payload, timeoutMs);

        if (!result.ok && payload.healthSignals && shouldRetryWithoutHealthSignals(result.status, result.responseText)) {
            result = await postLegacyTelemetry(endpointUrl, apiKey, clonePayloadWithoutHealthSignals(payload), timeoutMs);
        }

        if (!result.ok) {
            return {
                ok: false,
                skipped: false,
                status: result.status,
                error: result.responseText || ("Famous Recon export failed with HTTP " + result.status + ".")
            };
        }

        return { ok: true, skipped: false, status: result.status };
    } catch (error) {
        const message = error && error.name === "AbortError"
            ? "Famous Recon export timed out after " + timeoutMs + "ms."
            : (error && error.message ? error.message : String(error));
        return { ok: false, skipped: false, error: message };
    }
}

function buildSupabaseRow(payload, serverId) {
    const m = payload && payload.metrics ? payload.metrics : {};
    const healthSignals = payload && payload.healthSignals ? payload.healthSignals : {};
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
        pending_reboot: typeof healthSignals.pendingReboot === "boolean" ? healthSignals.pendingReboot : null,
        office_activation_status: healthSignals.officeActivationStatus || null,
        office_product_name: healthSignals.officeProductName || null,
        office_expires_at: healthSignals.officeExpiresAt || null,
        office_license_description: healthSignals.officeLicenseDescription || null,
        office_error_code: healthSignals.officeErrorCode || null,
        office_error_description: healthSignals.officeErrorDescription || null,
        unexpected_shutdown_count_7d: Number.isInteger(healthSignals.unexpectedShutdownCount7d) ? healthSignals.unexpectedShutdownCount7d : null,
        disk_health_status: healthSignals.diskHealthStatus || null,
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
    try {
        let result = await postSupabaseTelemetry(insertUrl, supabaseAnonKey, row, timeoutMs);

        if (!result.ok) {
            const retryColumns = getRetryableSupabaseColumns(result.responseText);
            if (retryColumns.length > 0) {
                result = await postSupabaseTelemetry(
                    insertUrl,
                    supabaseAnonKey,
                    cloneSupabaseRowWithoutColumns(row, retryColumns),
                    timeoutMs
                );
            }
        }

        if (!result.ok) {
            return {
                ok: false,
                skipped: false,
                status: result.status,
                error: "Supabase insert failed: HTTP " + result.status + " " + truncateForLog(result.responseText, 300)
            };
        }
        return { ok: true, skipped: false, status: result.status, serverId: lookup.serverId };
    } catch (error) {
        const msg = error && error.name === "AbortError" ? "Supabase insert timed out after " + timeoutMs + "ms." : (error && error.message ? error.message : String(error));
        return { ok: false, skipped: false, error: msg };
    }
}

module.exports = {
    buildFleetIdentityHeaders,
    deriveAgentConfigUrl,
    buildSupabaseRow,
    buildTelemetryPayload,
    buildExportAttemptLogLine,
    fetchFleetDeviceConfig,
    maskApiKeyForLog,
    resolveServerId,
    sendTelemetry,
    sendTelemetryToSupabase,
    truncateForLog
};
