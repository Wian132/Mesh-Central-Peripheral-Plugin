"use strict";

var mesh = null;
var activeScan = null;

function sendResult(args, status, payload, error, warnings) {
    mesh.SendCommand({
        action: "plugin",
        plugin: "centralreconperipherals",
        pluginaction: "scanResult",
        requestId: args.requestId,
        mode: args.mode,
        status: status,
        collectedAt: new Date().toISOString(),
        payload: payload || null,
        warnings: warnings || [],
        error: error || null
    });
}

function buildPowerShellScript(mode) {
    var statusOnly = (mode === "status");
    var lines = [
        "$ErrorActionPreference = 'Stop'",
        "$warnings = New-Object System.Collections.ArrayList",
        "function Add-Warning([string]$Message) { if ($Message) { [void]$warnings.Add($Message) } }",
        "function Get-PrinterItems {",
        "  try {",
        "    return @{ method = 'Get-Printer'; items = @(Get-Printer | Select-Object Name,PrinterStatus,WorkOffline,PortName,Status,ComputerName) }",
        "  } catch {",
        "    Add-Warning('Get-Printer failed: ' + $_.Exception.Message)",
        "    try {",
        "      return @{ method = 'Win32_Printer'; items = @(Get-CimInstance Win32_Printer | Select-Object Name,PrinterStatus,WorkOffline,PortName,Status,ExtendedPrinterStatus,ErrorInformation) }",
        "    } catch {",
        "      Add-Warning('Win32_Printer fallback failed: ' + $_.Exception.Message)",
        "      return @{ method = 'none'; items = @() }",
        "    }",
        "  }",
        "}",
        "function Select-StatusDevices([object[]]$Items) {",
        "  return @($Items | Where-Object {",
        "    $class = [string]$_.Class",
        "    $name = [string]$_.FriendlyName",
        "    $manufacturer = [string]$_.Manufacturer",
        "    $class -match '^(Printer|USB|Ports|HIDClass|Keyboard|Mouse|Monitor|Image|Camera|Bluetooth|SmartCardReader|MEDIA|Display)$' -or",
        "    $name -match '(scanner|barcode|payment|pin ?pad|terminal|speedpoint|display|monitor|touch|keyboard|mouse|usb|serial|com\\d+|printer)' -or",
        "    $manufacturer -match '(epson|star|bixolon|verifone|ingenico|pax|castles)'",
        "  } | Select-Object FriendlyName,Class,InstanceId,Manufacturer,Status,Present,Problem,Service,Location)",
        "}",
        "function Get-PnpItems([bool]$PresentOnly) {",
        "  try {",
        "    if ($PresentOnly) {",
        "      $items = @(Get-PnpDevice -PresentOnly | Select-Object FriendlyName,Class,InstanceId,Manufacturer,Status,Present,Problem,Service,Location)",
        "    } else {",
        "      $items = @(Get-PnpDevice | Select-Object FriendlyName,Class,InstanceId,Manufacturer,Status,Present,Problem,Service,Location)",
        "    }",
        "    return @{ method = 'Get-PnpDevice'; items = $items }",
        "  } catch {",
        "    Add-Warning('Get-PnpDevice failed: ' + $_.Exception.Message)",
        "    try {",
        "      return @{ method = 'Win32_PnPEntity'; items = @(Get-CimInstance Win32_PnPEntity | Select-Object Name,PNPClass,DeviceID,Manufacturer,Status,Present,Service,Description,LocationInformation) }",
        "    } catch {",
        "      Add-Warning('Win32_PnPEntity fallback failed: ' + $_.Exception.Message)",
        "      return @{ method = 'none'; items = @() }",
        "    }",
        "  }",
        "}",
        "function Get-PnpEntityItems {",
        "  try {",
        "    return @{ method = 'Win32_PnPEntity'; items = @(Get-CimInstance Win32_PnPEntity | Select-Object Name,PNPClass,DeviceID,Manufacturer,Status,Present,Service,Description,LocationInformation) }",
        "  } catch {",
        "    Add-Warning('Win32_PnPEntity failed: ' + $_.Exception.Message)",
        "    return @{ method = 'none'; items = @() }",
        "  }",
        "}",
        "function Get-SerialPortItems {",
        "  try {",
        "    return @{ method = 'Win32_SerialPort'; items = @(Get-CimInstance Win32_SerialPort | Select-Object Name,DeviceID,Description,PNPDeviceID,Status,Availability,MaxBaudRate) }",
        "  } catch {",
        "    Add-Warning('Win32_SerialPort failed: ' + $_.Exception.Message)",
        "    return @{ method = 'none'; items = @() }",
        "  }",
        "}",
        "$result = @{ platform = $env:OS; warnings = @() }",
        "$result.printers = Get-PrinterItems"
    ];

    if (statusOnly) {
        lines.push("$result.pnpDevices = Get-PnpItems $true");
        lines.push("if ($result.pnpDevices.method -eq 'Get-PnpDevice') { $result.pnpDevices.items = Select-StatusDevices $result.pnpDevices.items }");
    } else {
        lines.push("$result.pnpDevices = Get-PnpItems $false");
        lines.push("$result.pnpEntities = Get-PnpEntityItems");
        lines.push("$result.serialPorts = Get-SerialPortItems");
    }

    lines.push("$result.warnings = @($warnings)");
    lines.push("$result | ConvertTo-Json -Depth 8 -Compress");
    return lines.join("\r\n");
}

function runScan(args) {
    if (process.platform !== "win32") {
        sendResult(args, "unsupported", null, "Unsupported platform: " + process.platform, []);
        return;
    }

    if (activeScan != null) {
        sendResult(args, "error", null, "Collector is busy.", []);
        return;
    }

    var timeoutMs = Number(args.timeoutMs) || 45000;
    var stdout = "";
    var stderr = "";
    var completed = false;
    var child = require("child_process").execFile(
        process.env["windir"] + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        ["powershell", "-NoProfile", "-NoLogo", "-Command", "-"],
        {}
    );

    activeScan = {
        requestId: args.requestId,
        child: child
    };

    var timeout = setTimeout(function () {
        if (completed) { return; }
        completed = true;
        try { child.kill(); } catch (ex) { }
        activeScan = null;
        sendResult(args, "error", null, "PowerShell scan timed out after " + timeoutMs + "ms.", []);
    }, timeoutMs);

    child.stdout.on("data", function (chunk) {
        stdout += chunk.toString();
    });
    child.stderr.on("data", function (chunk) {
        stderr += chunk.toString();
    });
    child.on("exit", function (code) {
        if (completed) { return; }
        completed = true;
        clearTimeout(timeout);
        activeScan = null;

        if (stdout.trim() === "") {
            sendResult(args, "error", null, stderr.trim() || ("PowerShell exited with code " + code + "."), []);
            return;
        }

        try {
            var payload = JSON.parse(stdout.trim());
            var warnings = Array.isArray(payload.warnings) ? payload.warnings.slice() : [];
            if (stderr.trim() !== "") { warnings.push(stderr.trim()); }
            delete payload.warnings;
            sendResult(args, warnings.length > 0 ? "partial" : "ok", payload, null, warnings);
        } catch (error) {
            sendResult(args, "error", null, "Unable to parse PowerShell JSON output: " + error.message, stderr.trim() ? [stderr.trim()] : []);
        }
    });

    child.stdin.write(buildPowerShellScript(args.mode));
    child.stdin.write("\r\nexit\r\n");
    child.stdin.end();
}

function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;
    if (!args || args.pluginaction !== "scan") { return; }
    runScan(args);
}

module.exports = {
    consoleaction: consoleaction
};
