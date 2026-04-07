"use strict";

const path = require("path");
const pluginMetadata = require("./config.json");

const {
    SHORT_NAME,
    cloneDefaultConfig,
    sanitizeConfig
} = require("./lib/config");
const { buildFullDiff } = require("./lib/diff");
const { createHashHex } = require("./lib/hash");
const { compileRules } = require("./lib/matching");
const { mergeHealthSignals, normalizeFullPayload, normalizeStatusPayload } = require("./lib/normalize");
const { Persistence } = require("./lib/persistence");
const {
    applyCompletionSchedule,
    determineDueMode,
    ensureScheduleState,
    shouldQueueFullAfterStatusChange
} = require("./lib/scheduler");
const { renderAdminPage, renderDevicePage } = require("./lib/ui");
const {
    buildExportAttemptLogLine,
    fetchFleetDeviceConfig,
    buildTelemetryPayload,
    sendTelemetry,
    sendTelemetryToSupabase,
    truncateForLog
} = require("./lib/famous-recon");
const { safeJsonParse, uniqueStrings } = require("./lib/utils");

const SITERIGHT_ADMIN = 0xFFFFFFFF;
const MESHRIGHT_REMOTECOMMAND = 0x00020000;
const DISPLAY_NAME = "CentralRecon Peripherals";
const SHUTDOWN_CONTROL_REFRESH_MS = 60 * 1000;
const SHUTDOWN_ACTIVE_GRACE_MS = 90 * 1000;

module.exports[SHORT_NAME] = function (pluginHandler) {
    const obj = {};
    obj.parent = pluginHandler;
    obj.meshServer = pluginHandler.parent;
    obj.persistence = new Persistence(path.join(obj.meshServer.datapath, SHORT_NAME));
    obj.exports = ["onDeviceRefreshEnd"];

    obj.runtime = {
        config: cloneDefaultConfig(),
        compiledMatching: {
            printers: compileRules(cloneDefaultConfig().matching.printers),
            paymentTerminals: compileRules(cloneDefaultConfig().matching.paymentTerminals)
        },
        activeRequests: new Map(),
        activeShutdowns: new Map(),
        shutdownControlCache: new Map(),
        schedulerTimer: null,
        evaluating: false
    };

    function nowMs() {
        return Date.now();
    }

    function parseDomainIdFromNodeId(nodeId) {
        const parts = String(nodeId || "").split("/");
        return parts.length >= 3 ? parts[1] : "";
    }

    function createEmptyState(nodeId, meshId) {
        return {
            schemaVersion: 1,
            nodeId,
            meshId: meshId || null,
            domainId: parseDomainIdFromNodeId(nodeId),
            lastPluginVersionApplied: null,
            statusSnapshot: null,
            statusHash: null,
            lastStatusScanAt: null,
            lastFullScanAt: null,
            lastStatusResult: null,
            lastFullResult: null,
            fullSnapshot: null,
            previousFullSnapshot: null,
            rawFullPayload: null,
            previousRawFullPayload: null,
            diff: null,
            changedSincePrevious: false,
            lastError: null,
            lastExportedStatusHash: null,
            lastExportedFullHash: null,
            lastExportedAt: null,
            scheduler: {
                queuedFull: false,
                queuedFullReason: null,
                runningMode: null,
                runningSince: null,
                nextStatusScanAt: null,
                nextFullScanAt: null,
                unsupportedUntil: null
            },
            events: {
                lastFailureEventAt: null,
                lastFailureEventKey: null
            },
            shutdown: {
                lastAttemptedSlotKey: null,
                declinedDate: null,
                lastResultStatus: null,
                lastResultAt: null,
                lastError: null,
                activeRequestId: null,
                activeSince: null,
                activeUntil: null
            }
        };
    }

    function loadState(nodeId, meshId) {
        const state = obj.persistence.loadState(nodeId, () => createEmptyState(nodeId, meshId));
        if (meshId && !state.meshId) { state.meshId = meshId; }
        if (!state.domainId) { state.domainId = parseDomainIdFromNodeId(nodeId); }
        if (!state.scheduler) { state.scheduler = createEmptyState(nodeId, meshId).scheduler; }
        if (!state.events) { state.events = createEmptyState(nodeId, meshId).events; }
        if (!state.shutdown) { state.shutdown = createEmptyState(nodeId, meshId).shutdown; }
        if (!Object.prototype.hasOwnProperty.call(state.shutdown, "activeUntil")) {
            state.shutdown.activeUntil = null;
        }
        return state;
    }

    function saveState(nodeId, state) {
        obj.persistence.saveState(nodeId, state);
    }

    function randomJitter(maxSeconds) {
        return Math.floor(Math.random() * ((maxSeconds || 0) + 1)) * 1000;
    }

    function isFullSiteAdmin(user) {
        return user && user.siteadmin === SITERIGHT_ADMIN;
    }

    function getWebServer() {
        return obj.meshServer ? obj.meshServer.webserver : null;
    }

    function getDomainObjectForUser(user) {
        const domainId = user && user.domain ? user.domain : "";
        return obj.meshServer.config.domains[domainId] || obj.meshServer.config.domains[""];
    }

    function getNodeAccess(user, nodeId) {
        return new Promise((resolve) => {
            const webserver = getWebServer();
            if (webserver == null || typeof webserver.GetNodeWithRights !== "function") {
                resolve(null);
                return;
            }
            const domain = getDomainObjectForUser(user);
            webserver.GetNodeWithRights(domain, user, nodeId, (node, rights, visible) => {
                if (node == null || visible === false) {
                    resolve(null);
                    return;
                }
                resolve({ domain, node, rights });
            });
        });
    }

    function reloadRuntimeConfig() {
        obj.persistence.ensureStructure();
        const loaded = obj.persistence.loadConfig(cloneDefaultConfig());
        const result = sanitizeConfig(loaded);
        obj.runtime.config = result.config;
        obj.runtime.compiledMatching = {
            printers: compileRules(obj.runtime.config.matching.printers),
            paymentTerminals: compileRules(obj.runtime.config.matching.paymentTerminals)
        };
        if (result.errors.length > 0) {
            obj.meshServer.debug("plugin", SHORT_NAME + ": config validation warnings: " + result.errors.join("; "));
        }
        obj.persistence.saveConfig(obj.runtime.config);
    }

    function getMeshesForAdmin(user) {
        const domainId = user && user.domain ? user.domain : "";
        const webserver = getWebServer();
        if (webserver == null || webserver.meshes == null) { return []; }
        return Object.values(webserver.meshes)
            .filter((mesh) => mesh && mesh.deleted == null && mesh.domain === domainId)
            .map((mesh) => ({
                _id: mesh._id,
                name: mesh.name,
                desc: mesh.desc || ""
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    function isNodeInScope(nodeId, meshId) {
        const scope = obj.runtime.config.scope;
        return scope.nodeIds.indexOf(nodeId) >= 0 || scope.meshIds.indexOf(meshId) >= 0;
    }

    function isLikelyWindowsAgent(agent) {
        if (agent == null || agent.agentInfo == null) { return false; }
        const agentId = Number(agent.agentInfo.agentId);
        return ((agentId > 0 && agentId < 5) || (agentId > 41 && agentId < 44));
    }

    function getCurrentPluginVersion() {
        return String(pluginMetadata.version || "");
    }

    function logStartupSummary() {
        const famousRecon = obj.runtime.config.integrations && obj.runtime.config.integrations.famousRecon
            ? obj.runtime.config.integrations.famousRecon
            : {};
        const scope = obj.runtime.config.scope || {};
        const scopedMeshes = Array.isArray(scope.meshIds) ? scope.meshIds.length : 0;
        const scopedNodes = Array.isArray(scope.nodeIds) ? scope.nodeIds.length : 0;
        console.log(
            SHORT_NAME +
            ": startup" +
            " version=" + getCurrentPluginVersion() +
            " famousRecon=" + (famousRecon.enabled === true ? "enabled" : "disabled") +
            " supabase=" + (String(famousRecon.supabaseUrl || "").trim() ? "set" : "missing") +
            " endpoint=" + (String(famousRecon.endpointUrl || "").trim() ? "set" : "missing") +
            " shutdownForceClose=" + (famousRecon.forceShutdownAppsClosed === true ? "enabled" : "disabled") +
            " scopedMeshes=" + scopedMeshes +
            " scopedNodes=" + scopedNodes
        );
    }

    function needsPluginUpgradeFullScan(state) {
        return String(state && state.lastPluginVersionApplied || "") !== getCurrentPluginVersion();
    }

    function getEligibleOnlineAgents() {
        const webserver = getWebServer();
        if (webserver == null || webserver.wsagents == null) { return []; }
        return Object.values(webserver.wsagents)
            .filter((agent) => agent && agent.dbNodeKey && agent.dbMeshKey && isNodeInScope(agent.dbNodeKey, agent.dbMeshKey));
    }

    function queueFullScan(state, reason) {
        state.scheduler.queuedFull = true;
        state.scheduler.queuedFullReason = reason || "schedule";
    }

    function queuePluginUpgradeFullScansForOnlineAgents() {
        const eligibleAgents = getEligibleOnlineAgents()
            .filter((agent) => isLikelyWindowsAgent(agent));

        for (const agent of eligibleAgents) {
            const state = loadState(agent.dbNodeKey, agent.dbMeshKey);
            if (!needsPluginUpgradeFullScan(state)) { continue; }
            if (state.scheduler && state.scheduler.runningMode === "full") { continue; }
            queueFullScan(state, "plugin-upgrade:" + getCurrentPluginVersion());
            saveState(agent.dbNodeKey, state);
        }
    }

    function emitNodeEvent(nodeId, meshId, message, action, extra) {
        if (!meshId) { return; }
        const webserver = getWebServer();
        if (webserver == null || typeof webserver.CreateNodeDispatchTargets !== "function") { return; }
        const event = Object.assign({
            etype: "node",
            action: action || SHORT_NAME,
            nodeid: nodeId,
            domain: parseDomainIdFromNodeId(nodeId),
            userid: SHORT_NAME,
            username: DISPLAY_NAME,
            msg: message
        }, extra || {});
        const targets = webserver.CreateNodeDispatchTargets(meshId, nodeId, ["server-users"]);
        obj.meshServer.DispatchEvent(targets, obj, event);
    }

    function emitFailureEventIfNeeded(state, mode, message) {
        const now = nowMs();
        const eventKey = mode + ":" + message;
        const cooldownMs = obj.runtime.config.logging.failureEventCooldownMinutes * 60000;
        const lastAt = state.events.lastFailureEventAt || 0;
        if (state.events.lastFailureEventKey === eventKey && (now - lastAt) < cooldownMs) { return; }

        state.events.lastFailureEventAt = now;
        state.events.lastFailureEventKey = eventKey;
        emitNodeEvent(state.nodeId, state.meshId, mode + " scan failed: " + message, SHORT_NAME + "-scanerror");
    }

    function getManualRefreshAllowed(user, rights) {
        return isFullSiteAdmin(user) || ((rights & MESHRIGHT_REMOTECOMMAND) !== 0);
    }

    function setNoCacheHeaders(res) {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
    }

    function buildViewState(state) {
        const warnings = uniqueStrings([
            ...(state.statusSnapshot && state.statusSnapshot.warnings ? state.statusSnapshot.warnings : []),
            ...(state.fullSnapshot && state.fullSnapshot.warnings ? state.fullSnapshot.warnings : [])
        ]);
        const statusSystemSummary = state.statusSnapshot ? state.statusSnapshot.systemSummary : null;
        const fullSystemSummary = state.fullSnapshot ? state.fullSnapshot.systemSummary : null;
        const printers = state.statusSnapshot && state.statusSnapshot.printers && state.statusSnapshot.printers.length > 0
            ? state.statusSnapshot.printers
            : (state.fullSnapshot ? state.fullSnapshot.printers : []);
        const paymentTerminalCandidates = state.fullSnapshot && state.fullSnapshot.paymentTerminalCandidates && state.fullSnapshot.paymentTerminalCandidates.length > 0
            ? state.fullSnapshot.paymentTerminalCandidates
            : (state.statusSnapshot ? state.statusSnapshot.paymentTerminalCandidates : []);
        const nextStatusScanAt = state.scheduler && state.scheduler.nextStatusScanAt ? state.scheduler.nextStatusScanAt : null;
        const nextFullScanAt = state.scheduler && state.scheduler.nextFullScanAt ? state.scheduler.nextFullScanAt : null;
        const nextDueAt = [nextStatusScanAt, nextFullScanAt].filter(Boolean).sort()[0] || null;
        const systemSummary = (state.lastStatusScanAt || 0) >= (state.lastFullScanAt || 0)
            ? (statusSystemSummary || fullSystemSummary)
            : (fullSystemSummary || statusSystemSummary);
        const healthSignals = mergeHealthSignals(state.statusSnapshot, state.fullSnapshot);

        return {
            nodeId: state.nodeId,
            meshId: state.meshId,
            scanHealth: state.lastError ? "warning" : "ok",
            lastStatusScanAt: state.lastStatusScanAt,
            lastFullScanAt: state.lastFullScanAt,
            hasPreviousFullSnapshot: Boolean(state.previousFullSnapshot),
            statusHash: state.statusHash,
            inventoryHash: state.fullSnapshot ? state.fullSnapshot.snapshotHash : null,
            changedSincePrevious: state.changedSincePrevious,
            runningMode: state.scheduler.runningMode,
            queuedFull: state.scheduler.queuedFull,
            nextStatusScanAt,
            nextFullScanAt,
            nextDueAt,
            systemSummary,
            healthSignals,
            printers,
            peripherals: state.fullSnapshot ? state.fullSnapshot.peripherals : [],
            paymentTerminalCandidates,
            warnings,
            lastError: state.lastError,
            diffSummary: state.diff || {
                printers: { added: [], removed: [], changed: [] },
                peripherals: { added: [], removed: [], changed: [] },
                paymentTerminalCandidates: { added: [], removed: [], changed: [] }
            }
        };
    }

    function markScanError(state, mode, error, resultStatus) {
        state.lastError = {
            at: nowMs(),
            mode,
            error: error,
            message: error
        };
        if (mode === "status") { state.lastStatusResult = resultStatus || "error"; }
        if (mode === "full") { state.lastFullResult = resultStatus || "error"; }
        emitFailureEventIfNeeded(state, mode, error);
    }

    function getFamousReconIdentityForState(state) {
        const viewState = buildViewState(state);
        const operatingSystem = viewState && viewState.systemSummary && viewState.systemSummary.operatingSystem
            ? viewState.systemSummary.operatingSystem
            : {};
        const deviceId = String(operatingSystem.computerName || "").trim();
        if (deviceId === "" || !state.nodeId) { return null; }
        return {
            nodeId: state.nodeId,
            deviceId,
            deviceType:
                obj.runtime.config &&
                obj.runtime.config.integrations &&
                obj.runtime.config.integrations.famousRecon &&
                obj.runtime.config.integrations.famousRecon.deviceType
                    ? obj.runtime.config.integrations.famousRecon.deviceType
                    : ""
        };
    }

    function resetShutdownNightState(state, nightKey) {
        if (!state.shutdown) { return; }
        if (state.shutdown.declinedDate && state.shutdown.declinedDate !== nightKey) {
            state.shutdown.declinedDate = null;
        }
        if (
            state.shutdown.lastAttemptedSlotKey &&
            String(state.shutdown.lastAttemptedSlotKey).indexOf(nightKey + ":") !== 0
        ) {
            state.shutdown.lastAttemptedSlotKey = null;
        }
    }

    function markShutdownState(state, status, error) {
        if (!state.shutdown) { return; }
        state.shutdown.lastResultStatus = status || null;
        state.shutdown.lastResultAt = nowMs();
        state.shutdown.lastError = error || null;
    }

    function dispatchShutdown(nodeId, meshId, options) {
        const state = loadState(nodeId, meshId);
        const webserver = getWebServer();
        const now = nowMs();
        const integration = obj.runtime.config.integrations && obj.runtime.config.integrations.famousRecon
            ? obj.runtime.config.integrations.famousRecon
            : {};

        if (!options || !options.slotKey) {
            return { ok: false, message: "Missing shutdown slot key." };
        }
        if (obj.runtime.activeShutdowns.has(nodeId)) {
            return { ok: false, message: "A shutdown attempt is already active for this device." };
        }
        if (webserver == null || webserver.wsagents == null) {
            return { ok: false, message: "MeshCentral webserver is not ready yet." };
        }

        const agent = webserver.wsagents[nodeId];
        if (agent == null) {
            return { ok: false, message: "The device agent is not connected." };
        }

        const countdownSec = Math.max(30, Number(options.countdownSec) || 300);
        const forceAppsClosed = integration.forceShutdownAppsClosed === true;
        const requestId = createHashHex([nodeId, meshId, "shutdown", options.slotKey, now]).slice(0, 24);

        state.shutdown.activeRequestId = requestId;
        state.shutdown.activeSince = now;
        state.shutdown.activeUntil = now + (countdownSec * 1000) + SHUTDOWN_ACTIVE_GRACE_MS;
        state.shutdown.lastAttemptedSlotKey = options.slotKey;
        markShutdownState(state, "dispatched", null);
        saveState(nodeId, state);

        obj.runtime.activeShutdowns.set(nodeId, {
            requestId,
            nodeId,
            meshId,
            slotKey: options.slotKey,
            nightKey: options.nightKey || null,
            countdownSec,
            startedAt: now,
            timeoutAt: now + (countdownSec * 1000) + SHUTDOWN_ACTIVE_GRACE_MS
        });

        try {
            agent.send(JSON.stringify({
                action: "plugin",
                plugin: SHORT_NAME,
                pluginaction: "shutdown",
                requestId,
                slotKey: options.slotKey,
                nightKey: options.nightKey || null,
                countdownSec,
                forceAppsClosed
            }));
            emitNodeEvent(
                nodeId,
                meshId,
                "Nightly POS shutdown countdown dispatched (" + countdownSec + "s" + (forceAppsClosed ? ", force-close apps" : "") + ").",
                SHORT_NAME + "-shutdown"
            );
            return { ok: true, message: "Nightly POS shutdown dispatched." };
        } catch (error) {
            obj.runtime.activeShutdowns.delete(nodeId);
            state.shutdown.activeRequestId = null;
            state.shutdown.activeSince = null;
            state.shutdown.activeUntil = null;
            markShutdownState(
                state,
                "dispatch_error",
                error && error.message ? error.message : String(error)
            );
            saveState(nodeId, state);
            return { ok: false, message: "Unable to send shutdown request to the agent." };
        }
    }

    function reapTimedOutShutdowns() {
        const now = nowMs();
        for (const active of obj.runtime.activeShutdowns.values()) {
            if (now <= active.timeoutAt) { continue; }
            obj.runtime.activeShutdowns.delete(active.nodeId);
            const state = loadState(active.nodeId, active.meshId);
            state.shutdown.activeRequestId = null;
            state.shutdown.activeSince = null;
            state.shutdown.activeUntil = null;
            if (state.shutdown.lastResultStatus === "dispatched") {
                markShutdownState(state, "awaiting_offline", null);
            }
            saveState(active.nodeId, state);
        }
    }

    function updatePrinterStatusEvents(state, previousSnapshot, nextSnapshot) {
        if (!obj.runtime.config.logging.changeEvents) { return; }
        const previousMap = new Map((previousSnapshot && previousSnapshot.printers ? previousSnapshot.printers : []).map((printer) => [printer.name, printer]));
        for (const printer of nextSnapshot.printers || []) {
            const previous = previousMap.get(printer.name);
            if (previous == null) { continue; }
            const previousKey = [previous.status, previous.isOffline, previous.isError].join("|");
            const nextKey = [printer.status, printer.isOffline, printer.isError].join("|");
            if (previousKey !== nextKey) {
                emitNodeEvent(state.nodeId, state.meshId, 'Printer "' + printer.name + '" changed to ' + printer.status + ".", SHORT_NAME + "-printerstatus");
            }
        }
    }

    function emitFullInventoryEvents(state, diff) {
        if (!obj.runtime.config.logging.changeEvents || !diff.changed) { return; }
        emitNodeEvent(
            state.nodeId,
            state.meshId,
            "Peripheral inventory changed (" +
                "printers +" + diff.printers.added.length + "/-" + diff.printers.removed.length + "/~" + diff.printers.changed.length +
                ", peripherals +" + diff.peripherals.added.length + "/-" + diff.peripherals.removed.length + "/~" + diff.peripherals.changed.length +
                ").",
            SHORT_NAME + "-inventory"
        );

        for (const candidate of diff.paymentTerminalCandidates.added || []) {
            emitNodeEvent(state.nodeId, state.meshId, 'Payment terminal candidate appeared: "' + (candidate.name || candidate.instanceId) + '".', SHORT_NAME + "-paymentcandidate");
        }
        for (const candidate of diff.paymentTerminalCandidates.removed || []) {
            emitNodeEvent(state.nodeId, state.meshId, 'Payment terminal candidate disappeared: "' + (candidate.name || candidate.instanceId) + '".', SHORT_NAME + "-paymentcandidate");
        }
    }

    function dispatchScan(nodeId, meshId, mode, initiatedBy) {
        const state = loadState(nodeId, meshId);
        const now = nowMs();
        const timeoutMs = obj.runtime.config.execution.powershellTimeoutMs;
        const webserver = getWebServer();

        if (obj.runtime.activeRequests.has(nodeId)) {
            if (mode === "full") {
                queueFullScan(state, initiatedBy);
                saveState(nodeId, state);
                return { ok: true, queued: true, message: "A full scan is already in progress; queued one follow-up full scan." };
            }
            return { ok: false, queued: false, message: "A scan is already in progress for this device." };
        }

        if (webserver == null || webserver.wsagents == null) {
            return { ok: false, queued: false, message: "MeshCentral webserver is not ready yet." };
        }

        const agent = webserver.wsagents[nodeId];
        if (agent == null) {
            return { ok: false, queued: false, message: "The device agent is not connected." };
        }

        const requestId = createHashHex([nodeId, meshId, mode, initiatedBy, now]).slice(0, 24);
        state.scheduler.runningMode = mode;
        state.scheduler.runningSince = now;
        if (mode === "full") {
            state.scheduler.queuedFull = false;
            state.scheduler.queuedFullReason = null;
        }
        saveState(nodeId, state);

        obj.runtime.activeRequests.set(nodeId, {
            requestId,
            nodeId,
            meshId,
            mode,
            initiatedBy,
            startedAt: now,
            timeoutMs
        });

        try {
            agent.send(JSON.stringify({
                action: "plugin",
                plugin: SHORT_NAME,
                pluginaction: "scan",
                requestId,
                mode,
                timeoutMs,
                initiatedBy
            }));
            return { ok: true, queued: false, message: mode === "full" ? "Full scan dispatched." : "Status scan dispatched." };
        } catch (error) {
            obj.runtime.activeRequests.delete(nodeId);
            state.scheduler.runningMode = null;
            state.scheduler.runningSince = null;
            markScanError(state, mode, error.message || String(error), "error");
            saveState(nodeId, state);
            return { ok: false, queued: false, message: "Unable to send scan request to the agent." };
        }
    }

    function reapTimedOutRequests() {
        const now = nowMs();
        for (const active of obj.runtime.activeRequests.values()) {
            if ((now - active.startedAt) <= (active.timeoutMs + 5000)) { continue; }
            obj.runtime.activeRequests.delete(active.nodeId);
            const state = loadState(active.nodeId, active.meshId);
            state.scheduler.runningMode = null;
            state.scheduler.runningSince = null;
            markScanError(state, active.mode, "Timed out waiting for the agent scan response.", "error");
            saveState(active.nodeId, state);
        }
    }

    async function evaluateShutdownWaterfall(eligibleAgents) {
        const integration = obj.runtime.config.integrations && obj.runtime.config.integrations.famousRecon
            ? obj.runtime.config.integrations.famousRecon
            : null;

        reapTimedOutShutdowns();
        if (integration == null || integration.enabled !== true) { return; }

        const now = nowMs();

        for (const agent of eligibleAgents) {
            const state = loadState(agent.dbNodeKey, agent.dbMeshKey);
            if (!state.shutdown) { state.shutdown = createEmptyState(agent.dbNodeKey, agent.dbMeshKey).shutdown; }

            if (obj.runtime.activeShutdowns.has(agent.dbNodeKey)) {
                saveState(agent.dbNodeKey, state);
                continue;
            }
            if (state.shutdown.activeUntil && now < state.shutdown.activeUntil) {
                saveState(agent.dbNodeKey, state);
                continue;
            }
            if (state.shutdown.activeUntil && now >= state.shutdown.activeUntil) {
                state.shutdown.activeRequestId = null;
                state.shutdown.activeSince = null;
                state.shutdown.activeUntil = null;
            }

            const identity = getFamousReconIdentityForState(state);
            if (!identity) {
                saveState(agent.dbNodeKey, state);
                continue;
            }

            const cached = obj.runtime.shutdownControlCache.get(agent.dbNodeKey);
            let control = cached;
            if (!control || (now - control.fetchedAt) >= SHUTDOWN_CONTROL_REFRESH_MS) {
                const response = await fetchFleetDeviceConfig(integration, identity);
                control = {
                    fetchedAt: nowMs(),
                    response
                };
                obj.runtime.shutdownControlCache.set(agent.dbNodeKey, control);
            }

            if (!control.response || control.response.ok !== true || control.response.skipped) {
                if (control.response && control.response.ok === false && control.response.error) {
                    markShutdownState(state, "control_error", control.response.error);
                }
                saveState(agent.dbNodeKey, state);
                continue;
            }

            const responseData = control.response.data || {};
            const shutdownState = responseData.shutdown_state || null;
            if (!shutdownState) {
                saveState(agent.dbNodeKey, state);
                continue;
            }

            const nightKey = String(shutdownState.current_date_local || "");
            if (nightKey) { resetShutdownNightState(state, nightKey); }
            if (state.shutdown.declinedDate && state.shutdown.declinedDate === nightKey) {
                saveState(agent.dbNodeKey, state);
                continue;
            }
            if (!shutdownState.participates_in_waterfall) {
                saveState(agent.dbNodeKey, state);
                continue;
            }
            if (!shutdownState.slot_due_now || !shutdownState.current_slot_key) {
                saveState(agent.dbNodeKey, state);
                continue;
            }
            if (state.shutdown.lastAttemptedSlotKey === shutdownState.current_slot_key) {
                saveState(agent.dbNodeKey, state);
                continue;
            }

            state.shutdown.lastAttemptedSlotKey = shutdownState.current_slot_key;

            if (shutdownState.shutdown_allowed !== true) {
                markShutdownState(
                    state,
                    "blocked",
                    Array.isArray(shutdownState.blocking_reasons) && shutdownState.blocking_reasons.length > 0
                        ? shutdownState.blocking_reasons.join(" | ")
                        : String(shutdownState.summary || "backend_blocked")
                );
                saveState(agent.dbNodeKey, state);
                continue;
            }

            const countdownSec = Math.max(
                30,
                Number(
                    responseData.config && responseData.config.shutdown_countdown_sec != null
                        ? responseData.config.shutdown_countdown_sec
                        : 300
                )
            );
            const dispatchResult = dispatchShutdown(agent.dbNodeKey, agent.dbMeshKey, {
                slotKey: shutdownState.current_slot_key,
                nightKey: nightKey || null,
                countdownSec
            });
            if (!dispatchResult.ok) {
                markShutdownState(state, "dispatch_error", dispatchResult.message || "dispatch_failed");
                saveState(agent.dbNodeKey, state);
            }
        }
    }

    async function evaluateSchedule() {
        if (obj.runtime.evaluating) { return; }
        obj.runtime.evaluating = true;

        try {
            reapTimedOutRequests();
            const config = obj.runtime.config;

            const eligibleAgents = getEligibleOnlineAgents()
                .filter((agent) => isLikelyWindowsAgent(agent));

            const candidates = [];
            const now = nowMs();

            for (const agent of eligibleAgents) {
                const state = loadState(agent.dbNodeKey, agent.dbMeshKey);
                if (config.schedule.enabled) {
                    ensureScheduleState(state, now, config, Math.random);
                }
                if (state.scheduler.runningMode) {
                    saveState(agent.dbNodeKey, state);
                    continue;
                }
                if (state.scheduler.unsupportedUntil && now < state.scheduler.unsupportedUntil) {
                    saveState(agent.dbNodeKey, state);
                    continue;
                }

                let dueMode = null;
                if (state.scheduler.queuedFull) {
                    dueMode = "full";
                } else if (config.schedule.enabled) {
                    dueMode = determineDueMode(state, now);
                }
                if (dueMode) {
                    const dueAt = dueMode === "full" ? (state.scheduler.nextFullScanAt || now) : (state.scheduler.nextStatusScanAt || now);
                    candidates.push({
                        nodeId: agent.dbNodeKey,
                        meshId: agent.dbMeshKey,
                        mode: dueMode,
                        dueAt,
                        initiatedBy: dueMode === "full" && state.scheduler.queuedFull ? (state.scheduler.queuedFullReason || "status-change") : "schedule"
                    });
                }
                saveState(agent.dbNodeKey, state);
            }

            candidates.sort((left, right) => {
                if (left.mode !== right.mode) { return left.mode === "full" ? -1 : 1; }
                return left.dueAt - right.dueAt;
            });

            for (const candidate of candidates) {
                if (obj.runtime.activeRequests.size >= config.execution.maxConcurrentScans) { break; }
                dispatchScan(candidate.nodeId, candidate.meshId, candidate.mode, candidate.initiatedBy);
            }
            await evaluateShutdownWaterfall(eligibleAgents);
        } finally {
            obj.runtime.evaluating = false;
        }
    }

    function requestScheduleEvaluation() {
        evaluateSchedule().catch((error) => {
            obj.meshServer.debug(
                "plugin",
                SHORT_NAME + ": scheduler crashed: " + (error && error.message ? error.message : String(error))
            );
        });
    }

    function scheduleEvaluator() {
        if (obj.runtime.schedulerTimer) {
            clearInterval(obj.runtime.schedulerTimer);
        }
        obj.runtime.schedulerTimer = setInterval(function () {
            requestScheduleEvaluation();
        }, obj.runtime.config.schedule.evaluationIntervalSeconds * 1000);
    }

    function processStatusResult(state, payload) {
        const previousStatus = state.statusSnapshot;
        const nextStatus = normalizeStatusPayload(payload, obj.runtime.compiledMatching);
        state.statusSnapshot = nextStatus;
        state.statusHash = nextStatus.snapshotHash;
        state.lastStatusScanAt = nowMs();
        state.lastStatusResult = "ok";
        state.lastError = null;

        updatePrinterStatusEvents(state, previousStatus, nextStatus);
        if (previousStatus && previousStatus.snapshotHash !== nextStatus.snapshotHash && obj.runtime.config.schedule.fullOnDetectedChange) {
            if (shouldQueueFullAfterStatusChange(state, nowMs(), obj.runtime.config.execution.fullScanCooldownSeconds)) {
                queueFullScan(state, "status-change");
            }
        }
    }

    function processFullResult(state, payload) {
        const previousFull = state.fullSnapshot;
        const nextFull = normalizeFullPayload(payload, obj.runtime.compiledMatching);
        const diff = buildFullDiff(previousFull, nextFull);

        state.previousFullSnapshot = previousFull;
        state.fullSnapshot = nextFull;
        state.previousRawFullPayload = state.rawFullPayload;
        state.rawFullPayload = payload;
        state.diff = diff;
        state.changedSincePrevious = diff.changed;
        state.lastFullScanAt = nowMs();
        state.lastFullResult = "ok";
        state.lastPluginVersionApplied = getCurrentPluginVersion();
        state.lastError = null;

        emitFullInventoryEvents(state, diff);
    }

    function logFamousReconDebug(message) {
        obj.meshServer.debug("plugin", SHORT_NAME + ": " + message);
    }

    function getCurrentExportHash(state, mode) {
        if (mode === "status") { return state.statusHash || null; }
        return state.fullSnapshot && state.fullSnapshot.snapshotHash ? state.fullSnapshot.snapshotHash : null;
    }

    function getLastExportedHash(state, mode) {
        return mode === "status" ? (state.lastExportedStatusHash || null) : (state.lastExportedFullHash || null);
    }

    const DEDUP_FORCE_EXPORT_MS = 15 * 60 * 1000;

    function markExportedHash(state, mode, hash) {
        if (mode === "status") { state.lastExportedStatusHash = hash; }
        else { state.lastExportedFullHash = hash; }
        state.lastExportedAt = nowMs();
    }

    function isForceExportDue(state) {
        if (typeof state.lastExportedAt !== "number") { return true; }
        return (nowMs() - state.lastExportedAt) >= DEDUP_FORCE_EXPORT_MS;
    }

    async function exportTelemetryIfConfigured(state, mode) {
        const integration = obj.runtime.config.integrations && obj.runtime.config.integrations.famousRecon
            ? obj.runtime.config.integrations.famousRecon
            : null;

        if (integration == null || integration.enabled !== true) {
            return;
        }
        if (mode === "status" && integration.exportOnStatusScans !== true) {
            logFamousReconDebug("Famous Recon export skipped: exportOnStatusScans is false (scan mode=status).");
            return;
        }
        if (mode === "full" && integration.exportOnFullScans !== true) {
            logFamousReconDebug("Famous Recon export skipped: exportOnFullScans is false (scan mode=full).");
            return;
        }

        const currentHash = getCurrentExportHash(state, mode);
        const lastHash = getLastExportedHash(state, mode);
        if (currentHash && lastHash && currentHash === lastHash && !isForceExportDue(state)) {
            logFamousReconDebug("Famous Recon export skipped: " + mode + " hash unchanged (" + currentHash.slice(0, 12) + "…).");
            return;
        }

        const viewState = buildViewState(state);
        const systemSummary = viewState.systemSummary || {};
        const operatingSystem = systemSummary.operatingSystem || {};
        const deviceId = String(operatingSystem.computerName || "").trim();

        if (deviceId === "" || !viewState.nodeId) {
            logFamousReconDebug(
                "Famous Recon export skipped: missing Windows computer name (CSName) or nodeId. nodeId=" +
                String(viewState.nodeId || "") +
                " computerName=" +
                (deviceId === "" ? "(empty)" : deviceId)
            );
            return;
        }

        const payload = buildTelemetryPayload(viewState, {
            scanMode: mode,
            pluginVersion: String(pluginMetadata.version || ""),
            deviceId,
            deviceType: integration.deviceType || "",
            inventoryChanged: mode === "full" ? Boolean(state.changedSincePrevious) : false
        });

        const useSupabase = String(integration.supabaseUrl || "").trim() !== "";

        if (useSupabase) {
            logFamousReconDebug("Supabase export attempt: scanMode=" + mode + " nodeId=" + String(viewState.nodeId || "") + " deviceId=" + deviceId);
            const result = await sendTelemetryToSupabase(integration, payload);
            if (result.skipped) {
                logFamousReconDebug("Supabase export skipped: " + String(result.reason || "internal skip"));
                return;
            }
            if (result.ok) {
                if (currentHash) { markExportedHash(state, mode, currentHash); saveState(state.nodeId, state); }
                logFamousReconDebug("Supabase export ok: deviceId=" + deviceId + " serverId=" + (result.serverId || "n/a") + " httpStatus=" + (result.status != null ? result.status : "n/a"));
                return;
            }
            const statusPart = result.status != null ? (" httpStatus=" + result.status) : "";
            logFamousReconDebug("Supabase export failed: deviceId=" + deviceId + statusPart + " — " + truncateForLog(result.error || "unknown error", 500));
            return;
        }

        logFamousReconDebug("Famous Recon export attempt: scanMode=" + mode + " | " + buildExportAttemptLogLine(integration, payload));
        const result = await sendTelemetry(integration, payload);
        if (result.skipped) {
            logFamousReconDebug("Famous Recon export skipped: " + String(result.reason || "sendTelemetry internal skip"));
            return;
        }
        if (result.ok) {
            if (currentHash) { markExportedHash(state, mode, currentHash); saveState(state.nodeId, state); }
            logFamousReconDebug("Famous Recon export ok: deviceId=" + deviceId + " httpStatus=" + (result.status != null ? result.status : "n/a"));
            return;
        }
        const statusPart = result.status != null ? (" httpStatus=" + result.status) : "";
        logFamousReconDebug(
            "Famous Recon export failed: deviceId=" + deviceId + statusPart + " — " + truncateForLog(result.error || "unknown error", 500)
        );
    }

    function handleScanResult(command, sourceAgent) {
        const nodeId = sourceAgent && sourceAgent.dbNodeKey ? sourceAgent.dbNodeKey : command.nodeId;
        const meshId = sourceAgent && sourceAgent.dbMeshKey ? sourceAgent.dbMeshKey : null;
        if (!nodeId) { return; }

        const active = obj.runtime.activeRequests.get(nodeId);
        const state = loadState(nodeId, meshId);
        const mode = command.mode || (active ? active.mode : "status");
        const status = command.status || "error";

        obj.runtime.activeRequests.delete(nodeId);

        if (status === "unsupported") {
            state.scheduler.runningMode = null;
            state.scheduler.runningSince = null;
            state.scheduler.unsupportedUntil = nowMs() + (6 * 60 * 60 * 1000);
            markScanError(state, mode, command.error || "Unsupported platform.", "unsupported");
            saveState(nodeId, state);
            return;
        }

        if (status === "error") {
            state.scheduler.runningMode = null;
            state.scheduler.runningSince = null;
            applyCompletionSchedule(state, mode, nowMs(), obj.runtime.config, Math.random);
            markScanError(state, mode, command.error || "Unknown scan error.", "error");
            saveState(nodeId, state);
            return;
        }

        if (mode === "status") {
            processStatusResult(state, command.payload || {});
        } else {
            processFullResult(state, command.payload || {});
        }

        applyCompletionSchedule(state, mode, nowMs(), obj.runtime.config, Math.random);
        saveState(nodeId, state);
        exportTelemetryIfConfigured(state, mode).catch((error) => {
            obj.meshServer.debug("plugin", SHORT_NAME + ": Famous Recon export crashed: " + (error && error.message ? error.message : String(error)));
        });
        requestScheduleEvaluation();
    }

    obj.onDeviceRefreshEnd = function () {
        pluginHandler.registerPluginTab({
            tabTitle: "CentralRecon",
            tabId: "pluginCentralReconPeripherals"
        });

        const nodeId = (typeof currentNode === "object" && currentNode != null && currentNode._id) ? encodeURIComponent(currentNode._id) : "";
        QH("pluginCentralReconPeripherals", '<iframe id="centralReconPeripheralsFrame" style="width:100%;height:920px;border:0;background:#fff;border-radius:14px;" src="/pluginadmin.ashx?pin=centralreconperipherals&user=1&view=device&nodeid=' + nodeId + '"></iframe>');
    };

    obj.server_startup = function () {
        reloadRuntimeConfig();
        logStartupSummary();
        queuePluginUpgradeFullScansForOnlineAgents();
        scheduleEvaluator();
        requestScheduleEvaluation();
    };

    obj.hook_setupHttpHandlers = function () {
        // All admin and device routes are served through pluginadmin.ashx.
    };

    obj.hook_agentCoreIsStable = function (agent) {
        const state = loadState(agent.dbNodeKey, agent.dbMeshKey);
        state.scheduler.unsupportedUntil = null;
        saveState(agent.dbNodeKey, state);
        if (isNodeInScope(agent.dbNodeKey, agent.dbMeshKey) && isLikelyWindowsAgent(agent) && needsPluginUpgradeFullScan(state)) {
            queueFullScan(state, "plugin-upgrade:" + getCurrentPluginVersion());
            saveState(agent.dbNodeKey, state);
            requestScheduleEvaluation();
            return;
        }
        if (obj.runtime.config.schedule.enabled && obj.runtime.config.schedule.fullOnReconnect && isNodeInScope(agent.dbNodeKey, agent.dbMeshKey) && isLikelyWindowsAgent(agent)) {
            dispatchScan(agent.dbNodeKey, agent.dbMeshKey, "full", "reconnect");
        }
    };

    obj.serveraction = function (command, sourceObject) {
        if (command.pluginaction === "scanResult") {
            handleScanResult(command, sourceObject);
            return;
        }
        if (command.pluginaction === "shutdownResult") {
            const nodeId = sourceObject && sourceObject.dbNodeKey ? sourceObject.dbNodeKey : command.nodeId;
            const meshId = sourceObject && sourceObject.dbMeshKey ? sourceObject.dbMeshKey : null;
            if (!nodeId) { return; }
            obj.runtime.activeShutdowns.delete(nodeId);
            const state = loadState(nodeId, meshId);
            state.shutdown.activeRequestId = null;
            state.shutdown.activeSince = null;
            state.shutdown.activeUntil = null;
            if (command.status === "cancelled") {
                state.shutdown.declinedDate = command.nightKey || state.shutdown.declinedDate;
                markShutdownState(state, "cancelled", null);
                emitNodeEvent(nodeId, meshId, "Nightly POS shutdown was cancelled on the device.", SHORT_NAME + "-shutdown");
            } else {
                markShutdownState(
                    state,
                    command.status || "error",
                    command.error || null
                );
            }
            saveState(nodeId, state);
        }
    };

    obj.handleAdminReq = async function (req, res, user) {
        if (req.query.api === "admin-state") {
            if (!isFullSiteAdmin(user)) { res.sendStatus(401); return; }
            setNoCacheHeaders(res);
            res.json({
                config: obj.runtime.config,
                meshes: getMeshesForAdmin(user)
            });
            return;
        }

        if (req.query.api === "shutdown-debug") {
            if (!isFullSiteAdmin(user)) { res.sendStatus(401); return; }
            setNoCacheHeaders(res);
            const allStates = obj.persistence.listAllStates();
            const devices = [];
            for (const entry of allStates) {
                const s = entry.state;
                const os = s.fullSnapshot && s.fullSnapshot.systemSummary && s.fullSnapshot.systemSummary.operatingSystem
                    ? s.fullSnapshot.systemSummary.operatingSystem : {};
                const sh = s.shutdown || {};
                const cached = obj.runtime.shutdownControlCache.get(entry.nodeId);
                devices.push({
                    computerName: os.computerName || null,
                    nodeId: entry.nodeId,
                    meshId: s.meshId || null,
                    lastStatusScanAt: s.lastStatusScanAt || null,
                    lastFullScanAt: s.lastFullScanAt || null,
                    shutdown: {
                        lastAttemptedSlotKey: sh.lastAttemptedSlotKey || null,
                        declinedDate: sh.declinedDate || null,
                        lastResultStatus: sh.lastResultStatus || null,
                        lastResultAt: sh.lastResultAt || null,
                        lastError: sh.lastError || null,
                        activeRequestId: sh.activeRequestId || null
                    },
                    hasCachedControl: Boolean(cached),
                    cachedControlAge: cached ? nowMs() - cached.fetchedAt : null
                });
            }
            devices.sort((a, b) => String(a.computerName || "").localeCompare(String(b.computerName || "")));
            const fr = obj.runtime.config.integrations && obj.runtime.config.integrations.famousRecon
                ? obj.runtime.config.integrations.famousRecon : {};
            res.json({
                configHealth: {
                    enabled: fr.enabled === true,
                    hasEndpointUrl: Boolean(String(fr.endpointUrl || "").trim()),
                    hasApiKey: Boolean(String(fr.apiKey || "").trim()),
                    hasSupabaseUrl: Boolean(String(fr.supabaseUrl || "").trim())
                },
                devices
            });
            return;
        }

        if (req.query.api === "device-state") {
            const access = await getNodeAccess(user, req.query.nodeid);
            if (!access) { res.sendStatus(401); return; }
            const state = loadState(access.node._id, access.node.meshid);
            setNoCacheHeaders(res);
            res.json(buildViewState(state));
            return;
        }

        if (req.query.view === "device") {
            const access = await getNodeAccess(user, req.query.nodeid);
            if (!access) { res.sendStatus(401); return; }
            const state = loadState(access.node._id, access.node.meshid);
            const apiBase = "/pluginadmin.ashx?pin=" + SHORT_NAME + "&user=1&view=device";
            setNoCacheHeaders(res);
            res.set("Content-Type", "text/html; charset=utf-8");
            res.send(renderDevicePage({
                title: DISPLAY_NAME,
                nodeId: access.node._id,
                canRefresh: getManualRefreshAllowed(user, access.rights),
                apiBase
            }));
            saveState(access.node._id, state);
            return;
        }

        if (!isFullSiteAdmin(user)) { res.sendStatus(401); return; }
        setNoCacheHeaders(res);
        res.set("Content-Type", "text/html; charset=utf-8");
        res.send(renderAdminPage({
            title: DISPLAY_NAME + " Settings",
            apiBase: "/pluginadmin.ashx?pin=" + SHORT_NAME
        }));
    };

    obj.handleAdminPostReq = async function (req, res, user) {
        if (req.body.action === "saveConfig") {
            if (!isFullSiteAdmin(user)) { res.status(401).json({ ok: false, message: "Unauthorized." }); return; }

            const payload = safeJsonParse(req.body.payload, null);
            if (payload == null) { res.status(400).json({ ok: false, message: "Invalid configuration payload." }); return; }

            const result = sanitizeConfig(payload);
            if (result.errors.length > 0) {
                res.status(400).json({ ok: false, message: result.errors.join(" ") });
                return;
            }

            obj.runtime.config = result.config;
            obj.runtime.compiledMatching = {
                printers: compileRules(obj.runtime.config.matching.printers),
                paymentTerminals: compileRules(obj.runtime.config.matching.paymentTerminals)
            };
            obj.persistence.saveConfig(obj.runtime.config);
            scheduleEvaluator();
            requestScheduleEvaluation();
            res.json({ ok: true, message: "Configuration saved." });
            return;
        }

        if (req.body.action === "manualScan") {
            const access = await getNodeAccess(user, req.body.nodeid);
            if (!access) { res.status(401).json({ ok: false, message: "Unauthorized." }); return; }
            if (!getManualRefreshAllowed(user, access.rights)) {
                res.status(403).json({ ok: false, message: "Remote Command rights are required for manual refresh." });
                return;
            }

            const result = dispatchScan(access.node._id, access.node.meshid, "full", "manual");
            res.status(result.ok ? 200 : 400).json(result);
            return;
        }

        res.status(400).json({ ok: false, message: "Unsupported action." });
    };

    return obj;
};
