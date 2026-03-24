"use strict";

var mesh = null;
var activeScan = null;

function getPowerShellPath() {
    var winDir = process.env["WINDIR"] || process.env["windir"] || "C:\\Windows";
    return winDir + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
}

function getPowerShellArgs() {
    return ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"];
}

function buildScanPaths() {
    var rand = Math.random().toString(32).replace("0.", "");
    return {
        scriptPath: "crp-" + rand + ".ps1",
        outputPath: "crp-" + rand + ".json"
    };
}

function cleanupFiles(paths) {
    var fs = require("fs");
    if (!paths) { return; }
    try { fs.unlinkSync(paths.scriptPath); } catch (ex) { }
    try { fs.unlinkSync(paths.outputPath); } catch (ex) { }
}

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

function buildPowerShellScript(mode, outputPath) {
    var statusOnly = (mode === "status");
    var lines = [
        "$ErrorActionPreference = 'Stop'",
        "$warnings = New-Object System.Collections.ArrayList",
        "function Add-Warning([string]$Message) { if ($Message) { [void]$warnings.Add($Message) } }",
        "function Quick-Ping([string]$Target, [int]$TimeoutMs) {",
        "  try {",
        "    $p = New-Object System.Net.NetworkInformation.Ping",
        "    $r = $p.Send($Target, $TimeoutMs)",
        "    if ($r.Status -eq 'Success') { return [double]$r.RoundtripTime }",
        "    return $null",
        "  } catch { return $null }",
        "  finally { if ($p) { $p.Dispose() } }",
        "}",
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
        "function Get-PnpItems {",
        "  try {",
        "    $items = @(Get-PnpDevice -PresentOnly | Select-Object FriendlyName,Class,InstanceId,Manufacturer,Status,Present,Problem,Service,Location)",
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
        "function Get-SerialPortItems {",
        "  try {",
        "    return @{ method = 'Win32_SerialPort'; items = @(Get-CimInstance Win32_SerialPort | Select-Object Name,DeviceID,Description,PNPDeviceID,Status,Availability,MaxBaudRate) }",
        "  } catch {",
        "    Add-Warning('Win32_SerialPort failed: ' + $_.Exception.Message)",
        "    return @{ method = 'none'; items = @() }",
        "  }",
        "}",
        "function Get-SystemInfo {",
        "  $cpuItems = @()",
        "  $osItems = @()",
        "  $storageInfo = @{ systemDrive = $env:SystemDrive; systemDisk = $null; disks = @() }",
        "  $networkInfo = @{ state = 'unknown'; linkType = 'unknown'; ipAddress = ''; wifiSsid = $null; wifiSignalPercent = $null; gatewayPingMs = $null; internetPingMs = $null }",
        "  try {",
        "    $cpuItems = @(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,LoadPercentage,Manufacturer)",
        "  } catch {",
        "    Add-Warning('Win32_Processor failed: ' + $_.Exception.Message)",
        "  }",
        "  try {",
        "    $osItems = @(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,CSName,LastBootUpTime,TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory)",
        "  } catch {",
        "    Add-Warning('Win32_OperatingSystem failed: ' + $_.Exception.Message)",
        "  }",
        "  try {",
        "    $diskItems = @(Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,VolumeName,Size,FreeSpace)",
        "    $storageInfo.disks = $diskItems",
        "    $preferredDrive = [string]($env:SystemDrive)",
        "    if ($preferredDrive) {",
        "      $storageInfo.systemDisk = $diskItems | Where-Object { $_.DeviceID -eq $preferredDrive } | Select-Object -First 1",
        "    }",
        "    if (-not $storageInfo.systemDisk) { $storageInfo.systemDisk = $diskItems | Select-Object -First 1 }",
        "  } catch {",
        "    Add-Warning('Win32_LogicalDisk failed: ' + $_.Exception.Message)",
        "  }",
        "  try {",
        "    $ipConfigs = @(Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true })",
        "    $primaryConfig = $ipConfigs | Where-Object { $_.DefaultIPGateway } | Select-Object -First 1",
        "    if (-not $primaryConfig) { $primaryConfig = $ipConfigs | Select-Object -First 1 }",
        "    if ($primaryConfig) {",
        "      $ipv4 = @($primaryConfig.IPAddress | Where-Object { $_ -match '^\\d{1,3}(\\.\\d{1,3}){3}$' }) | Select-Object -First 1",
        "      if ($ipv4) { $networkInfo.ipAddress = [string]$ipv4 }",
        "      $gateway = @($primaryConfig.DefaultIPGateway | Where-Object { $_ -match '^\\d{1,3}(\\.\\d{1,3}){3}$' }) | Select-Object -First 1",
        "      if ($gateway) { $networkInfo.gatewayPingMs = Quick-Ping $gateway 2000 }",
        "    }",
        "    try {",
        "      $adapter = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1",
        "      if ($adapter) {",
        "        $adapterDescriptor = ([string]$adapter.InterfaceDescription + ' ' + [string]$adapter.Name).ToLowerInvariant()",
        "        if ($adapterDescriptor -match 'wi-?fi|wireless|wlan') { $networkInfo.linkType = 'wifi' } else { $networkInfo.linkType = 'ethernet' }",
        "      }",
        "    } catch {",
        "      Add-Warning('Get-NetAdapter failed: ' + $_.Exception.Message)",
        "    }",
        "    $networkInfo.internetPingMs = Quick-Ping '1.1.1.1' 2000",
        "    if ($networkInfo.linkType -eq 'wifi') {",
        "      try {",
        "        $wlanLines = @(netsh wlan show interfaces 2>$null)",
        "        foreach ($line in $wlanLines) {",
        "          if ($line -match '^\\s*SSID\\s*:\\s*(.+)$' -and -not ($line -match 'BSSID')) { $networkInfo.wifiSsid = $Matches[1].Trim() }",
        "          if ($line -match '^\\s*Signal\\s*:\\s*(\\d+)%') { $networkInfo.wifiSignalPercent = [int]$Matches[1] }",
        "        }",
        "      } catch { }",
        "    }",
        "    if ($networkInfo.internetPingMs -ne $null) {",
        "      $networkInfo.state = 'online'",
        "    } elseif ($networkInfo.gatewayPingMs -ne $null -or $networkInfo.ipAddress) {",
        "      $networkInfo.state = 'lan_only'",
        "    }",
        "  } catch {",
        "    Add-Warning('Network inspection failed: ' + $_.Exception.Message)",
        "  }",
        "  return @{ cpu = $cpuItems; operatingSystem = $osItems; storage = $storageInfo; network = $networkInfo }",
        "}",
        "$result = @{ platform = $env:OS; warnings = @() }",
        "$result.system = Get-SystemInfo",
        "$result.printers = Get-PrinterItems"
    ];

    if (statusOnly) {
        lines.push("$result.pnpDevices = Get-PnpItems");
        lines.push("if ($result.pnpDevices.method -eq 'Get-PnpDevice') { $result.pnpDevices.items = Select-StatusDevices $result.pnpDevices.items }");
    } else {
        lines.push("$result.pnpDevices = Get-PnpItems");
        lines.push("$result.serialPorts = Get-SerialPortItems");
    }

    lines.push("$result.warnings = @($warnings)");
    lines.push("$result | ConvertTo-Json -Depth 8 -Compress | Set-Content -Path '" + String(outputPath).replace(/'/g, "''") + "' -Encoding UTF8");
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
    var fs = require("fs");
    var stderr = "";
    var completed = false;
    var paths = buildScanPaths();
    var child = null;

    try {
        fs.writeFileSync(paths.scriptPath, buildPowerShellScript(args.mode, paths.outputPath) + "\r\n");
        child = require("child_process").execFile(
            getPowerShellPath(),
            getPowerShellArgs().concat(["-File", paths.scriptPath])
        );
    } catch (error) {
        cleanupFiles(paths);
        sendResult(args, "error", null, "Unable to start PowerShell scan: " + (error && error.message ? error.message : String(error)), []);
        return;
    }

    activeScan = {
        requestId: args.requestId,
        child: child,
        paths: paths
    };

    var timeout = setTimeout(function () {
        if (completed) { return; }
        completed = true;
        try { child.kill(); } catch (ex) { }
        activeScan = null;
        cleanupFiles(paths);
        sendResult(args, "error", null, "PowerShell scan timed out after " + timeoutMs + "ms.", []);
    }, timeoutMs);

    child.stderr.on("data", function (chunk) {
        stderr += chunk.toString();
    });
    child.on("error", function (error) {
        if (completed) { return; }
        completed = true;
        clearTimeout(timeout);
        activeScan = null;
        cleanupFiles(paths);
        sendResult(args, "error", null, "Unable to start PowerShell: " + (error && error.message ? error.message : String(error)), []);
    });
    child.on("exit", function (code) {
        if (completed) { return; }
        completed = true;
        clearTimeout(timeout);
        activeScan = null;

        var output = "";
        try {
            output = fs.readFileSync(paths.outputPath).toString().trim();
        } catch (error) { }
        cleanupFiles(paths);

        if (output === "") {
            sendResult(
                args,
                "error",
                null,
                stderr.trim() || ("PowerShell returned no JSON file output (exit code " + code + ")."),
                []
            );
            return;
        }

        try {
            var payload = JSON.parse(output);
            var warnings = Array.isArray(payload.warnings) ? payload.warnings.slice() : [];
            if (stderr.trim() !== "") { warnings.push(stderr.trim()); }
            delete payload.warnings;
            sendResult(args, warnings.length > 0 ? "partial" : "ok", payload, null, warnings);
        } catch (error) {
            sendResult(args, "error", null, "Unable to parse PowerShell JSON file output: " + error.message, stderr.trim() ? [stderr.trim()] : []);
        }
    });

}

function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;
    if (!args || args.pluginaction !== "scan") { return; }
    runScan(args);
}

module.exports = {
    consoleaction: consoleaction,
    buildScanPaths: buildScanPaths,
    getPowerShellArgs: getPowerShellArgs,
    getPowerShellPath: getPowerShellPath
};
