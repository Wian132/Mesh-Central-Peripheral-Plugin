"use strict";

var mesh = null;
var activeScan = null;
var activeShutdown = null;

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

function sendShutdownResult(args, status, error) {
    mesh.SendCommand({
        action: "plugin",
        plugin: "centralreconperipherals",
        pluginaction: "shutdownResult",
        requestId: args.requestId,
        slotKey: args.slotKey || null,
        nightKey: args.nightKey || null,
        status: status,
        collectedAt: new Date().toISOString(),
        error: error || null
    });
}

function getShutdownPath() {
    var winDir = process.env["WINDIR"] || process.env["windir"] || "C:\\Windows";
    return winDir + "\\System32\\shutdown.exe";
}

function normalizeExecText(value) {
    if (value == null) { return ""; }
    return String(value).replace(/\s+/g, " ").trim();
}

function formatExecFileError(prefix, error, stdout, stderr) {
    var details = [];
    var message = normalizeExecText(error && error.message ? error.message : error);
    var code = error && error.code != null ? String(error.code) : "";
    var signal = error && error.signal ? String(error.signal) : "";
    var stdoutText = normalizeExecText(stdout);
    var stderrText = normalizeExecText(stderr);

    if (message !== "" && message !== code) {
        details.push(message);
    }
    if (code !== "") {
        details.push("exit code " + code);
    }
    if (signal !== "") {
        details.push("signal " + signal);
    }
    if (stdoutText !== "") {
        details.push("stdout=" + stdoutText);
    }
    if (stderrText !== "") {
        details.push("stderr=" + stderrText);
    }

    return details.length > 0 ? (prefix + ": " + details.join(" | ")) : prefix;
}

function escapePowerShellSingleQuoted(value) {
    return String(value == null ? "" : value).replace(/'/g, "''");
}

function buildShutdownPowerShellCommand(countdownSec, comment, forceAppsClosed) {
    var args = [
        "'/s'",
        "'/t'",
        "'" + String(countdownSec) + "'",
        "'/c'",
        "'" + escapePowerShellSingleQuoted(comment) + "'"
    ];

    if (forceAppsClosed === true) {
        args.push("'/f'");
    }

    return [
        "$ErrorActionPreference = 'Stop'",
        "$shutdownPath = '" + escapePowerShellSingleQuoted(getShutdownPath()) + "'",
        "$arguments = @(" + args.join(", ") + ")",
        "$output = & $shutdownPath @arguments 2>&1 | Out-String",
        "$exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }",
        "$trimmed = $output.Trim()",
        "if ($trimmed.Length -gt 0) { [Console]::Out.Write($trimmed) }",
        "exit $exitCode"
    ].join("; ");
}

function runShutdown(args) {
    if (process.platform !== "win32") {
        sendShutdownResult(args, "error", "Unsupported platform: " + process.platform);
        return;
    }

    if (activeShutdown != null) {
        sendShutdownResult(args, "error", "Shutdown worker is busy.");
        return;
    }

    var countdownSec = Math.max(30, Number(args.countdownSec) || 300);
    var forceAppsClosed = args.forceAppsClosed === true;
    var shutdownAt = new Date(Date.now() + countdownSec * 1000).toLocaleTimeString();
    var comment = "Scheduled nightly POS shutdown at " + shutdownAt + ". Run 'shutdown /a' to cancel.";
    var child = null;
    activeShutdown = {
        requestId: args.requestId,
        slotKey: args.slotKey || null,
        timer: null
    };

    try {
        child = require("child_process").execFile(
            getPowerShellPath(),
            getPowerShellArgs().concat(["-Command", buildShutdownPowerShellCommand(countdownSec, comment, forceAppsClosed)]),
            function (error, stdout, stderr) {
                if (error) {
                    activeShutdown = null;
                    sendShutdownResult(
                        args,
                        "error",
                        formatExecFileError("Unable to start shutdown countdown", error, stdout, stderr)
                    );
                    return;
                }

                activeShutdown.timer = setTimeout(function () {
                    require("child_process").execFile(
                        getShutdownPath(),
                        ["/a"],
                        function (abortError) {
                            var current = activeShutdown;
                            activeShutdown = null;
                            if (current == null || current.requestId !== args.requestId) { return; }
                            if (!abortError) {
                                sendShutdownResult(args, "cancelled", null);
                            }
                        }
                    );
                }, (countdownSec * 1000) + 5000);
            }
        );
    } catch (error) {
        activeShutdown = null;
        sendShutdownResult(
            args,
            "error",
            "Unable to launch shutdown.exe: " + (error && error.message ? error.message : String(error))
        );
    }
}

function buildPowerShellScript(mode, outputPath) {
    if (mode === "fleet_inventory") { return buildFleetInventoryScript(outputPath); }
    if (mode === "fleet_health") { return buildFleetHealthScript(outputPath); }
    var statusOnly = (mode === "status");
    var lines = [
        "$ErrorActionPreference = 'Stop'",
        "$warnings = New-Object System.Collections.ArrayList",
        "function Add-Warning([string]$Message) { if ($Message) { [void]$warnings.Add($Message) } }",
        "function Get-CscriptPath {",
        "  $windir = $env:WINDIR",
        "  if (-not $windir) { $windir = 'C:\\Windows' }",
        "  $candidate = Join-Path $windir 'System32\\cscript.exe'",
        "  if (Test-Path $candidate) { return $candidate }",
        "  return 'cscript.exe'",
        "}",
        "function Get-ExistingPath([object[]]$Paths) {",
        "  foreach ($candidate in @($Paths)) {",
        "    if (-not $candidate) { continue }",
        "    try {",
        "      if (Test-Path $candidate) {",
        "        $resolved = Resolve-Path $candidate -ErrorAction Stop | Select-Object -First 1",
        "        if ($resolved) { return $resolved.Path }",
        "      }",
        "    } catch { }",
        "  }",
        "  return $null",
        "}",
        "function Invoke-CommandText([string]$FilePath, [object[]]$Arguments, [string]$Label) {",
        "  try {",
        "    return (& $FilePath @Arguments 2>&1 | Out-String).Trim()",
        "  } catch {",
        "    Add-Warning($Label + ' failed: ' + $_.Exception.Message)",
        "    return ''",
        "  }",
        "}",
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
        "function Test-PendingReboot {",
        "  try {",
        "    if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') { return $true }",
        "  } catch { }",
        "  try {",
        "    if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { return $true }",
        "  } catch { }",
        "  try {",
        "    $sessionManager = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name 'PendingFileRenameOperations' -ErrorAction SilentlyContinue",
        "    if ($sessionManager -and $sessionManager.PendingFileRenameOperations) { return $true }",
        "  } catch { }",
        "  return $false",
        "}",
        "function Get-OfficeActivationProbe {",
        "  $programRoots = @()",
        "  if ($env:ProgramFiles) { $programRoots += $env:ProgramFiles }",
        "  if (${env:ProgramFiles(x86)}) { $programRoots += ${env:ProgramFiles(x86)} }",
        "  $osppCandidates = @()",
        "  $vnextCandidates = @()",
        "  foreach ($root in $programRoots) {",
        "    $osppCandidates += (Join-Path $root 'Microsoft Office\\root\\Office16\\OSPP.VBS')",
        "    $osppCandidates += (Join-Path $root 'Microsoft Office\\Office16\\OSPP.VBS')",
        "    $osppCandidates += (Join-Path $root 'Microsoft Office\\root\\Office15\\OSPP.VBS')",
        "    $osppCandidates += (Join-Path $root 'Microsoft Office\\Office15\\OSPP.VBS')",
        "    $vnextCandidates += (Join-Path $root 'Microsoft Office\\root\\Office16\\vnextdiag.ps1')",
        "    $vnextCandidates += (Join-Path $root 'Microsoft Office\\Office16\\vnextdiag.ps1')",
        "  }",
        "  $vnextPath = Get-ExistingPath $vnextCandidates",
        "  if ($vnextPath) {",
        "    $vnextOutput = Invoke-CommandText $vnextPath @('-action', 'list') 'vnextdiag.ps1 -action list'",
        "    if ($vnextOutput -match 'LicenseState' -or $vnextOutput -match 'ProductReleaseId' -or $vnextOutput -match '\"Product\"') {",
        "      return @{ method = 'vnextdiag'; sourcePath = $vnextPath; rawOutput = $vnextOutput }",
        "    }",
        "  }",
        "  $osppPath = Get-ExistingPath $osppCandidates",
        "  $osppOutput = ''",
        "  if ($osppPath) {",
        "    $osppOutput = Invoke-CommandText (Get-CscriptPath) @('//Nologo', $osppPath, '/dstatus') 'OSPP.VBS /dstatus'",
        "    if ($osppOutput -match 'LICENSE NAME:' -or $osppOutput -match 'LICENSE STATUS:') {",
        "      return @{ method = 'ospp-vbs'; sourcePath = $osppPath; rawOutput = $osppOutput }",
        "    }",
        "  }",
        "  if ($osppPath) {",
        "    return @{ method = 'ospp-vbs'; sourcePath = $osppPath; rawOutput = $osppOutput }",
        "  }",
        "  return @{ method = 'none'; sourcePath = $null; rawOutput = '' }",
        "}",
        "function Get-UnexpectedShutdownCount7d {",
        "  try {",
        "    return [int]((Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 6008; StartTime = (Get-Date).AddDays(-7) } -ErrorAction Stop | Measure-Object).Count)",
        "  } catch {",
        "    Add-Warning('Unexpected shutdown probe failed: ' + $_.Exception.Message)",
        "    return $null",
        "  }",
        "}",
        "function Get-DiskHealthInfo {",
        "  try {",
        "    return @{ method = 'Get-PhysicalDisk'; items = @(Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus,OperationalStatus,MediaType,Size,SerialNumber) }",
        "  } catch {",
        "    Add-Warning('Get-PhysicalDisk failed: ' + $_.Exception.Message)",
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
        "$result.printers = Get-PrinterItems",
        "$result.healthSignals = @{ pendingReboot = Test-PendingReboot }"
    ];

    if (statusOnly) {
        lines.push("$result.pnpDevices = Get-PnpItems");
        lines.push("if ($result.pnpDevices.method -eq 'Get-PnpDevice') { $result.pnpDevices.items = Select-StatusDevices $result.pnpDevices.items }");
    } else {
        lines.push("$result.pnpDevices = Get-PnpItems");
        lines.push("$result.serialPorts = Get-SerialPortItems");
        lines.push("$result.healthSignals.office = Get-OfficeActivationProbe");
        lines.push("$result.healthSignals.unexpectedShutdownCount7d = Get-UnexpectedShutdownCount7d");
        lines.push("$result.healthSignals.disk = Get-DiskHealthInfo");
    }

    lines.push("$result.warnings = @($warnings)");
    lines.push("$result | ConvertTo-Json -Depth 8 -Compress | Set-Content -Path '" + String(outputPath).replace(/'/g, "''") + "' -Encoding UTF8");
    return lines.join("\r\n");
}

// Fleet inventory: static per-device hardware snapshot. Runs weekly.
// Every WMI/CIM call is wrapped so one failure cannot crash the whole collection.
// Keep PS 5.1 baseline (no Set-Printer*, no PS7-only cmdlets); prefer single-line
// control flow to survive interactive MeshCentral paste.
function buildFleetInventoryScript(outputPath) {
    var lines = [
        "$ErrorActionPreference = 'Stop'",
        "$warnings = New-Object System.Collections.ArrayList",
        "function Add-Warning([string]$Message) { if ($Message) { [void]$warnings.Add($Message) } }",
        "function Try-Cim([string]$Class, [string]$Label) {",
        "  try { return @(Get-CimInstance -ClassName $Class -ErrorAction Stop) }",
        "  catch { Add-Warning($Label + ' failed: ' + $_.Exception.Message); return @() }",
        "}",
        "function First-NonEmpty([object[]]$Values) {",
        "  foreach ($v in @($Values)) { $s = [string]$v; if ($s -and $s.Trim() -ne '') { return $s.Trim() } }",
        "  return $null",
        "}",
        "$result = @{ capturedAt = (Get-Date).ToUniversalTime().ToString('o'); hostname = $env:COMPUTERNAME; warnings = @() }",
        "$computerSystem = Try-Cim 'Win32_ComputerSystem' 'Win32_ComputerSystem'",
        "$cs = $computerSystem | Select-Object -First 1",
        "$result.manufacturer = if ($cs) { [string]$cs.Manufacturer } else { $null }",
        "$result.model = if ($cs) { [string]$cs.Model } else { $null }",
        "$biosList = Try-Cim 'Win32_BIOS' 'Win32_BIOS'",
        "$bios = $biosList | Select-Object -First 1",
        "$result.biosVersion = if ($bios) { [string]$bios.SMBIOSBIOSVersion } else { $null }",
        "$result.biosDate = $null",
        "if ($bios -and $bios.ReleaseDate) {",
        "  try { $result.biosDate = ([datetime]$bios.ReleaseDate).ToUniversalTime().ToString('o') }",
        "  catch { Add-Warning('BIOS release date parse failed: ' + $_.Exception.Message) }",
        "}",
        "$osList = Try-Cim 'Win32_OperatingSystem' 'Win32_OperatingSystem'",
        "$os = $osList | Select-Object -First 1",
        "$result.windowsEdition = if ($os) { [string]$os.Caption } else { $null }",
        "$result.windowsVersion = if ($os) { [string]$os.Version } else { $null }",
        "$result.windowsBuild = if ($os) { [string]$os.BuildNumber } else { $null }",
        "$result.windowsArchitecture = if ($os) { [string]$os.OSArchitecture } else { $null }",
        "$result.installDate = $null",
        "if ($os -and $os.InstallDate) {",
        "  try { $result.installDate = ([datetime]$os.InstallDate).ToUniversalTime().ToString('o') }",
        "  catch { Add-Warning('OS install date parse failed: ' + $_.Exception.Message) }",
        "}",
        "$cpus = Try-Cim 'Win32_Processor' 'Win32_Processor'",
        "$firstCpu = $cpus | Select-Object -First 1",
        "$result.cpuModel = if ($firstCpu) { [string]$firstCpu.Name } else { $null }",
        "$totalCores = 0",
        "foreach ($c in @($cpus)) { if ($c.NumberOfCores) { $totalCores += [int]$c.NumberOfCores } }",
        "$result.cpuCores = if ($totalCores -gt 0) { $totalCores } else { $null }",
        "$dimms = Try-Cim 'Win32_PhysicalMemory' 'Win32_PhysicalMemory'",
        "$dimmSizesGb = @()",
        "$totalRamBytes = 0",
        "foreach ($d in @($dimms)) {",
        "  if ($d.Capacity) {",
        "    $bytes = [double]$d.Capacity",
        "    $totalRamBytes += $bytes",
        "    $dimmSizesGb += [math]::Round(($bytes / 1GB), 2)",
        "  }",
        "}",
        "$result.dimmCount = @($dimms).Count",
        "$result.dimmSizesGb = @($dimmSizesGb)",
        "$result.totalRamGb = if ($totalRamBytes -gt 0) { [math]::Round(($totalRamBytes / 1GB), 2) } else { $null }",
        "$result.disks = @()",
        "try {",
        "  $physical = @(Get-PhysicalDisk -ErrorAction Stop | Select-Object FriendlyName,Model,MediaType,Size,SerialNumber,DeviceId)",
        "  $drives = @()",
        "  try { $drives = @(Get-CimInstance Win32_DiskDrive -ErrorAction Stop | Select-Object Model,SerialNumber,Index) }",
        "  catch { Add-Warning('Win32_DiskDrive failed: ' + $_.Exception.Message) }",
        "  foreach ($p in $physical) {",
        "    $serial = First-NonEmpty @($p.SerialNumber)",
        "    if (-not $serial) {",
        "      $match = $drives | Where-Object { ($_.Model -and $p.Model -and ($_.Model.Trim() -eq $p.Model.Trim())) } | Select-Object -First 1",
        "      if ($match) { $serial = First-NonEmpty @($match.SerialNumber) }",
        "    }",
        "    $sizeGb = if ($p.Size) { [math]::Round(([double]$p.Size / 1GB), 2) } else { $null }",
        "    $result.disks += @{",
        "      model      = [string]$p.Model",
        "      media_type = [string]$p.MediaType",
        "      size_gb    = $sizeGb",
        "      serial     = $serial",
        "    }",
        "  }",
        "} catch {",
        "  Add-Warning('Get-PhysicalDisk failed: ' + $_.Exception.Message)",
        "}",
        "$result.primaryNicMac = $null",
        "try {",
        "  $primary = Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop | Where-Object { $_.IPEnabled -eq $true -and $_.DefaultIPGateway } | Select-Object -First 1",
        "  if ($primary -and $primary.MACAddress) { $result.primaryNicMac = [string]$primary.MACAddress }",
        "} catch { Add-Warning('Primary NIC MAC probe failed: ' + $_.Exception.Message) }",
        "$result.warnings = @($warnings)",
        "$result | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path '" + String(outputPath).replace(/'/g, "''") + "' -Encoding UTF8"
    ];
    return lines.join("\r\n");
}

// Fleet health: nightly append-only snapshot. Insert-only on the hub; plugin
// never retries past the nightly window. Graceful degradation on every probe.
function buildFleetHealthScript(outputPath) {
    var lines = [
        "$ErrorActionPreference = 'Stop'",
        "$warnings = New-Object System.Collections.ArrayList",
        "function Add-Warning([string]$Message) { if ($Message) { [void]$warnings.Add($Message) } }",
        "function Count-Event([hashtable]$Filter, [string]$Label) {",
        "  try { return [int]((Get-WinEvent -FilterHashtable $Filter -ErrorAction Stop | Measure-Object).Count) }",
        "  catch { Add-Warning($Label + ' failed: ' + $_.Exception.Message); return $null }",
        "}",
        "$result = @{ capturedAt = (Get-Date).ToUniversalTime().ToString('o'); hostname = $env:COMPUTERNAME; warnings = @() }",
        "$result.uptimeHours = $null",
        "try {",
        "  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1",
        "  if ($os -and $os.LastBootUpTime) {",
        "    $boot = [datetime]$os.LastBootUpTime",
        "    $result.uptimeHours = [math]::Round((((Get-Date) - $boot).TotalHours), 2)",
        "  }",
        "} catch { Add-Warning('Uptime probe failed: ' + $_.Exception.Message) }",
        "$result.freeSpacePct = $null",
        "try {",
        "  $sys = [string]$env:SystemDrive",
        "  $vol = Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" -ErrorAction Stop | Where-Object { $_.DeviceID -eq $sys } | Select-Object -First 1",
        "  if ($vol -and $vol.Size -and [double]$vol.Size -gt 0) {",
        "    $result.freeSpacePct = [math]::Round((([double]$vol.FreeSpace / [double]$vol.Size) * 100), 2)",
        "  }",
        "} catch { Add-Warning('Free-space probe failed: ' + $_.Exception.Message) }",
        "$result.smartStatus = @()",
        "try {",
        "  $physical = @(Get-PhysicalDisk -ErrorAction Stop | Select-Object FriendlyName,HealthStatus,OperationalStatus,MediaType,DeviceId)",
        "  $predicts = @()",
        "  try { $predicts = @(Get-CimInstance -Namespace root\\WMI -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop) }",
        "  catch { Add-Warning('MSStorageDriver_FailurePredictStatus unavailable: ' + $_.Exception.Message) }",
        "  foreach ($p in $physical) {",
        "    $predict = $null",
        "    $reason = $null",
        "    if ($predicts -and $predicts.Count -gt 0) {",
        "      $match = $predicts | Where-Object { $_.InstanceName -and ($_.InstanceName -match [regex]::Escape([string]$p.FriendlyName)) } | Select-Object -First 1",
        "      if (-not $match) { $match = $predicts | Select-Object -First 1 }",
        "      if ($match) { $predict = [bool]$match.PredictFailure; $reason = [int]$match.Reason }",
        "    }",
        "    $op = @()",
        "    if ($p.OperationalStatus) { $op = @($p.OperationalStatus | ForEach-Object { [string]$_ }) }",
        "    $result.smartStatus += @{",
        "      friendly_name      = [string]$p.FriendlyName",
        "      health_status      = [string]$p.HealthStatus",
        "      operational_status = $op",
        "      media_type         = [string]$p.MediaType",
        "      predict_failure    = $predict",
        "      reason_code        = $reason",
        "    }",
        "  }",
        "} catch { Add-Warning('Get-PhysicalDisk failed: ' + $_.Exception.Message) }",
        "$result.bsods30d = @()",
        "try {",
        "  $events = @(Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='Microsoft-Windows-WER-SystemErrorReporting','BugCheck'; Id=1001; StartTime=(Get-Date).AddDays(-30) } -ErrorAction Stop)",
        "  foreach ($e in $events) {",
        "    $code = $null",
        "    if ($e.Properties -and $e.Properties.Count -ge 1) { $code = [string]$e.Properties[0].Value }",
        "    $result.bsods30d += @{",
        "      time_created  = $e.TimeCreated.ToUniversalTime().ToString('o')",
        "      bugcheck_code = $code",
        "      bugcheck_text = [string]$e.Message",
        "    }",
        "  }",
        "} catch {",
        "  try {",
        "    $events = @(Get-WinEvent -FilterHashtable @{ LogName='System'; Id=1001; StartTime=(Get-Date).AddDays(-30) } -ErrorAction Stop | Where-Object { $_.ProviderName -match 'BugCheck|SystemErrorReporting' })",
        "    foreach ($e in $events) {",
        "      $code = $null",
        "      if ($e.Properties -and $e.Properties.Count -ge 1) { $code = [string]$e.Properties[0].Value }",
        "      $result.bsods30d += @{ time_created = $e.TimeCreated.ToUniversalTime().ToString('o'); bugcheck_code = $code; bugcheck_text = [string]$e.Message }",
        "    }",
        "  } catch { Add-Warning('BSOD 30d probe failed: ' + $_.Exception.Message) }",
        "}",
        "$result.bsods90dCount = Count-Event @{ LogName='System'; Id=1001; StartTime=(Get-Date).AddDays(-90) } 'BSOD 90d count'",
        "$result.unexpectedShutdowns30dCount = Count-Event @{ LogName='System'; Id=6008; StartTime=(Get-Date).AddDays(-30) } 'Unexpected shutdown 30d count'",
        "$result.serviceCrashes7d = @()",
        "try {",
        "  $crashes = @(Get-WinEvent -FilterHashtable @{ LogName='Application'; ProviderName='Application Error'; Id=1000; StartTime=(Get-Date).AddDays(-7) } -ErrorAction Stop)",
        "  $groups = $crashes | ForEach-Object {",
        "    $name = $null",
        "    if ($_.Properties -and $_.Properties.Count -ge 1) { $name = [string]$_.Properties[0].Value }",
        "    if ($name) { [pscustomobject]@{ process = $name.ToLowerInvariant() } }",
        "  } | Group-Object process | Sort-Object Count -Descending | Select-Object -First 20",
        "  foreach ($g in $groups) { $result.serviceCrashes7d += @{ process = [string]$g.Name; count = [int]$g.Count } }",
        "} catch { Add-Warning('Service crash 7d probe failed: ' + $_.Exception.Message) }",
        "$result.warnings = @($warnings)",
        "$result | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path '" + String(outputPath).replace(/'/g, "''") + "' -Encoding UTF8"
    ];
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
    if (!args) { return; }
    if (args.pluginaction === "scan") {
        runScan(args);
        return;
    }
    if (args.pluginaction === "shutdown") {
        runShutdown(args);
    }
}

module.exports = {
    buildFleetHealthScript: buildFleetHealthScript,
    buildFleetInventoryScript: buildFleetInventoryScript,
    buildPowerShellScript: buildPowerShellScript,
    buildShutdownPowerShellCommand: buildShutdownPowerShellCommand,
    consoleaction: consoleaction,
    buildScanPaths: buildScanPaths,
    escapePowerShellSingleQuoted: escapePowerShellSingleQuoted,
    formatExecFileError: formatExecFileError,
    getPowerShellArgs: getPowerShellArgs,
    getPowerShellPath: getPowerShellPath,
    getShutdownPath: getShutdownPath
};
