const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn, spawnSync } = require("child_process");
const {
    openMmfLoginWindow,
    closeMmfLoginWindow,
    captureMmfSession,
    clearMmfBrowserSession,
    probeMmfSessionCookies
} = require("./mmf-auth");
const { resolveOwnCatalog } = require("./mmf-catalog");

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const APP_STORAGE_DIR = "MyMiniFactoryBulkDownloader";

let mainWindow = null;
let activeRun = null;
let runCounter = 0;

function configureStoragePaths() {
    try {
        const appDataRoot = app.getPath("appData");
        const userDataPath = path.join(appDataRoot, APP_STORAGE_DIR);
        const cachePath = path.join(userDataPath, "Cache");
        const sessionDataPath = path.join(userDataPath, "SessionData");

        fs.mkdirSync(userDataPath, { recursive: true });
        fs.mkdirSync(cachePath, { recursive: true });
        fs.mkdirSync(sessionDataPath, { recursive: true });

        app.setPath("userData", userDataPath);
        app.setPath("cache", cachePath);
        app.setPath("sessionData", sessionDataPath);
        app.commandLine.appendSwitch("disk-cache-dir", cachePath);
    } catch (_error) {
        // Ignore path override failures and let Electron use defaults.
    }
}

configureStoragePaths();

const SETTINGS_FILE_NAME = "desktop-settings.json";
const SECRET_SETTING_KEYS = ["cookie", "medusaJwt", "medusaPublishableKey"];
const RATE_LIMITS = {
    metadataDelaySec: 6,
    stlFileDelaySec: 5,
    imageDelaySec: 3,
    medusaApiDelayMs: 2000,
    catalogPageDelayMs: 1000,
    catalogBatchSize: 25
};

const DEFAULT_SETTINGS = {
    cookie: "",
    medusaJwt: "",
    medusaPublishableKey: "",
    modelIdsText: "",
    modelIdCatalog: [],
    mmfUsername: "",
    sessionCapturedAt: "",
    downloadRoot: "",
    testModeCheck: true,
    basePath: "",
    extractInPlace: true,
    jsonPath: "",
    foldersPath: "",
    namingFormat: "ID_NAME",
    maxNameLength: 80
};

function getScriptRoot() {
    if (!app.isPackaged) {
        return path.join(__dirname, "..");
    }

    const unpackedPath = path.join(process.resourcesPath, "app.asar.unpacked");
    if (fs.existsSync(unpackedPath)) {
        return unpackedPath;
    }

    return process.resourcesPath;
}

function getIconPath() {
    const scriptRoot = getScriptRoot();
    const iconCandidates = isWindows
        ? ["icon.ico", "icon.png"]
        : isMac
            ? ["icon.icns", "icon.png"]
            : ["icon.png", "icon.ico"];

    for (const iconName of iconCandidates) {
        const iconPath = path.join(scriptRoot, "build", iconName);
        if (fs.existsSync(iconPath)) {
            return iconPath;
        }
    }

    return undefined;
}

function getSettingsFilePath() {
    return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function sanitizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};

    const maxNameLengthParsed = Number.parseInt(source.maxNameLength, 10);
    const maxNameLength = Number.isNaN(maxNameLengthParsed)
        ? DEFAULT_SETTINGS.maxNameLength
        : Math.max(10, Math.min(160, maxNameLengthParsed));

    return {
        cookie: typeof source.cookie === "string" ? source.cookie.trim() : DEFAULT_SETTINGS.cookie,
        medusaJwt: typeof source.medusaJwt === "string" ? source.medusaJwt.trim() : DEFAULT_SETTINGS.medusaJwt,
        medusaPublishableKey: typeof source.medusaPublishableKey === "string"
            ? source.medusaPublishableKey.trim()
            : DEFAULT_SETTINGS.medusaPublishableKey,
        modelIdsText: typeof source.modelIdsText === "string" ? source.modelIdsText : DEFAULT_SETTINGS.modelIdsText,
        modelIdCatalog: sanitizeModelIdCatalog(source.modelIdCatalog),
        mmfUsername: typeof source.mmfUsername === "string" ? source.mmfUsername.trim() : DEFAULT_SETTINGS.mmfUsername,
        sessionCapturedAt: typeof source.sessionCapturedAt === "string"
            ? source.sessionCapturedAt.trim()
            : DEFAULT_SETTINGS.sessionCapturedAt,
        downloadRoot: typeof source.downloadRoot === "string" ? cleanInputPath(source.downloadRoot) : DEFAULT_SETTINGS.downloadRoot,
        testModeCheck: typeof source.testModeCheck === "boolean" ? source.testModeCheck : DEFAULT_SETTINGS.testModeCheck,
        basePath: typeof source.basePath === "string" ? source.basePath : DEFAULT_SETTINGS.basePath,
        extractInPlace: typeof source.extractInPlace === "boolean" ? source.extractInPlace : DEFAULT_SETTINGS.extractInPlace,
        jsonPath: typeof source.jsonPath === "string" ? source.jsonPath : DEFAULT_SETTINGS.jsonPath,
        foldersPath: typeof source.foldersPath === "string" ? source.foldersPath : DEFAULT_SETTINGS.foldersPath,
        namingFormat: source.namingFormat === "NAME_ONLY" ? "NAME_ONLY" : "ID_NAME",
        maxNameLength
    };
}

function sanitizeModelIdCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) {
        return [];
    }

    const seen = new Set();
    const catalog = [];

    rawCatalog.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
            return;
        }

        const id = String(entry.id || "").trim();
        if (!/^\d+$/.test(id) || seen.has(id)) {
            return;
        }

        seen.add(id);
        catalog.push({
            id,
            name: typeof entry.name === "string" ? entry.name.trim() : ""
        });
    });

    return catalog;
}

function isSecretEncryptionAvailable() {
    try {
        return safeStorage.isEncryptionAvailable();
    } catch (_error) {
        return false;
    }
}

function encryptSecretValue(plainText) {
    if (!plainText || !isSecretEncryptionAvailable()) {
        return plainText;
    }

    const encrypted = safeStorage.encryptString(plainText);
    return `enc:${encrypted.toString("base64")}`;
}

function decryptSecretValue(storedValue) {
    if (typeof storedValue !== "string" || !storedValue) {
        return "";
    }

    if (!storedValue.startsWith("enc:")) {
        return storedValue;
    }

    if (!isSecretEncryptionAvailable()) {
        return "";
    }

    try {
        const encryptedBuffer = Buffer.from(storedValue.slice(4), "base64");
        return safeStorage.decryptString(encryptedBuffer);
    } catch (_error) {
        return "";
    }
}

function decryptSettingsFromDisk(rawSettings) {
    const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const decrypted = { ...source };

    SECRET_SETTING_KEYS.forEach((key) => {
        if (typeof decrypted[key] === "string") {
            decrypted[key] = decryptSecretValue(decrypted[key]);
        }
    });

    return decrypted;
}

function encryptSettingsForDisk(settings) {
    const encrypted = {
        ...settings,
        secretsEncrypted: isSecretEncryptionAvailable()
    };

    SECRET_SETTING_KEYS.forEach((key) => {
        if (typeof encrypted[key] === "string" && encrypted[key]) {
            encrypted[key] = encryptSecretValue(encrypted[key]);
        }
    });

    return encrypted;
}

function restrictSettingsFilePermissions() {
    try {
        fs.chmodSync(getSettingsFilePath(), 0o600);
    } catch (_error) {
        // Best-effort on platforms that support chmod.
    }
}

function migratePlaintextSecretsIfNeeded() {
    if (!isSecretEncryptionAvailable()) {
        return;
    }

    try {
        const settingsFilePath = getSettingsFilePath();
        if (!fs.existsSync(settingsFilePath)) {
            return;
        }

        const parsed = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
        const needsMigration = SECRET_SETTING_KEYS.some((key) => {
            const value = parsed && parsed[key];
            return typeof value === "string" && value && !value.startsWith("enc:");
        });

        if (!needsMigration) {
            return;
        }

        const merged = sanitizeSettings(decryptSettingsFromDisk(parsed));
        fs.writeFileSync(
            settingsFilePath,
            JSON.stringify(encryptSettingsForDisk(merged), null, 2),
            "utf8"
        );
        restrictSettingsFilePermissions();
    } catch (_error) {
        // Ignore migration failures; user can re-enter secrets.
    }
}

function loadSettingsFromDisk() {
    try {
        const settingsFilePath = getSettingsFilePath();
        if (!fs.existsSync(settingsFilePath)) {
            return { ...DEFAULT_SETTINGS };
        }

        const fileContent = fs.readFileSync(settingsFilePath, "utf8");
        const parsed = JSON.parse(fileContent);
        return {
            ...DEFAULT_SETTINGS,
            ...sanitizeSettings(decryptSettingsFromDisk(parsed))
        };
    } catch (_error) {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettingsToDisk(partialSettings) {
    const current = loadSettingsFromDisk();
    const merged = sanitizeSettings({
        ...current,
        ...(partialSettings && typeof partialSettings === "object" ? partialSettings : {})
    });

    const settingsFilePath = getSettingsFilePath();
    fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(encryptSettingsForDisk(merged), null, 2),
        "utf8"
    );
    restrictSettingsFilePermissions();

    return merged;
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function getRateLimitEnv() {
    return {
        MMF_METADATA_DELAY_SEC: String(RATE_LIMITS.metadataDelaySec),
        MMF_STL_FILE_DELAY_SEC: String(RATE_LIMITS.stlFileDelaySec),
        MMF_IMAGE_DELAY_SEC: String(RATE_LIMITS.imageDelaySec)
    };
}

function clearSavedMmfSession() {
    const current = loadSettingsFromDisk();
    const hadSession = Boolean(
        current.cookie
        || current.medusaJwt
        || current.medusaPublishableKey
        || current.mmfUsername
    );

    if (!hadSession) {
        return false;
    }

    saveSettingsToDisk({
        cookie: "",
        medusaJwt: "",
        medusaPublishableKey: "",
        mmfUsername: "",
        sessionCapturedAt: ""
    });

    clearMmfBrowserSession().catch(() => {
        // Best-effort; settings were already cleared.
    });

    return true;
}

function clearSavedCookie() {
    return clearSavedMmfSession();
}

function looksLikeCookieExpiration(text) {
    if (!text) {
        return false;
    }

    const normalized = text.toLowerCase();
    const patterns = [
        "enable javascript",
        "all downloads redirect to login",
        "cookie expired",
        "missing cf_clearance",
        "session logged out",
        "cloudflare",
        "http 401",
        "http 403",
        "unauthorized",
        "invalid token",
        "authentication required",
        "please log in",
        "please login",
        "access denied"
    ];

    return patterns.some((pattern) => normalized.includes(pattern));
}

async function validateStoredMmfSession() {
    const saved = loadSettingsFromDisk();
    const cookie = normalizeCookie(saved.cookie || "");
    const medusaJwt = normalizeMedusaJwt(saved.medusaJwt || "");
    const medusaPublishableKey = normalizePublishableKey(saved.medusaPublishableKey || "");

    if (!cookie) {
        return {
            ok: true,
            valid: false,
            reason: "missing",
            message: "No MMF session saved."
        };
    }

    const cookieProbe = await probeMmfSessionCookies();
    if (!cookieProbe.valid) {
        return {
            ok: true,
            valid: false,
            reason: "browser-session-empty",
            message: "Browser session is empty. Use Sign in and Capture session again.",
            cookieNames: cookieProbe.cookieNames
        };
    }

    if (!medusaJwt || !medusaPublishableKey) {
        return {
            ok: true,
            valid: true,
            partial: true,
            reason: "partial",
            message: "Cookie OK. JWT or publishable key still missing for auto-load.",
            sessionCapturedAt: saved.sessionCapturedAt || ""
        };
    }

    try {
        const meResponse = await requestJson("https://api-shop-manager.myminifactory.com/store/customers/me", {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0",
                Accept: "application/json",
                Authorization: `Bearer ${medusaJwt}`,
                "x-publishable-api-key": medusaPublishableKey,
                Cookie: cookie
            },
            timeoutMs: 15000
        });

        if (meResponse.statusCode === 401 || meResponse.statusCode === 403) {
            clearSavedMmfSession();
            return {
                ok: true,
                valid: false,
                expired: true,
                reason: "api-rejected",
                message: `MMF session expired (HTTP ${meResponse.statusCode}). Sign in and capture again.`
            };
        }

        if (meResponse.statusCode !== 200) {
            return {
                ok: true,
                valid: true,
                partial: true,
                reason: "api-unreachable",
                message: `Could not verify session online (HTTP ${meResponse.statusCode}). Local cookie still present.`,
                sessionCapturedAt: saved.sessionCapturedAt || ""
            };
        }

        return {
            ok: true,
            valid: true,
            reason: "ok",
            message: "MMF session looks valid.",
            sessionCapturedAt: saved.sessionCapturedAt || ""
        };
    } catch (error) {
        return {
            ok: true,
            valid: true,
            partial: true,
            reason: "offline",
            message: `Offline check only (API error: ${String(error.message || error)}).`,
            sessionCapturedAt: saved.sessionCapturedAt || ""
        };
    }
}

function runCommand(executable, args, timeoutMs = 20000) {
    try {
        const result = spawnSync(executable, args, {
            encoding: "utf8",
            windowsHide: true,
            timeout: timeoutMs
        });

        const stdout = (result.stdout || "").trim();
        const stderr = (result.stderr || "").trim();

        return {
            ok: result.status === 0,
            status: result.status,
            stdout,
            stderr,
            error: result.error ? String(result.error.message || result.error) : ""
        };
    } catch (error) {
        return {
            ok: false,
            status: -1,
            stdout: "",
            stderr: "",
            error: String(error.message || error)
        };
    }
}

function firstLine(text) {
    if (!text) {
        return "";
    }

    return text.split(/\r?\n/)[0].trim();
}

function isExecutableFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return false;
    }

    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            return false;
        }

        if (isWindows) {
            return /\.(exe|cmd|bat|com)$/i.test(filePath);
        }

        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch (_error) {
        return false;
    }
}

function findUnixCommandFallback(command) {
    if (isWindows || !command) {
        return "";
    }

    const commonRoots = isMac
        ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        : ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

    for (const root of commonRoots) {
        const candidate = path.join(root, command);
        if (isExecutableFile(candidate)) {
            return candidate;
        }
    }

    return "";
}

function whereCommand(command) {
    if (!isWindows) {
        const result = runCommand("which", [command]);
        const resolved = result.ok ? firstLine(result.stdout) : "";
        if (resolved) {
            return resolved;
        }

        return findUnixCommandFallback(command);
    }

    const result = runCommand("where.exe", [command]);
    return result.ok ? firstLine(result.stdout) : "";
}

function isWindowsAppsBashPath(commandPath) {
    if (!commandPath) {
        return false;
    }

    return commandPath.toLowerCase().includes("\\microsoft\\windowsapps\\bash.exe");
}

function toBashScriptPath(scriptPath) {
    if (!isWindows || typeof scriptPath !== "string") {
        return scriptPath;
    }

    return scriptPath.replace(/\\/g, "/");
}

function findGitBashPath() {
    const commonPaths = [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe"
    ];

    if (process.env.LOCALAPPDATA) {
        commonPaths.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"));
        commonPaths.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git", "usr", "bin", "bash.exe"));
    }

    const gitPath = whereCommand("git");
    if (gitPath) {
        const gitRoot = path.resolve(path.dirname(gitPath), "..");
        commonPaths.push(path.join(gitRoot, "bin", "bash.exe"));
        commonPaths.push(path.join(gitRoot, "usr", "bin", "bash.exe"));
    }

    for (const candidate of commonPaths) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return "";
}

function checkBash() {
    const commandPath = whereCommand("bash");
    const gitBashPath = findGitBashPath();

    const fallbackPath = isWindows
        ? (gitBashPath || (isWindowsAppsBashPath(commandPath) ? "" : commandPath))
        : (commandPath || gitBashPath);

    if (!fallbackPath) {
        return {
            installed: false,
            version: "",
            path: ""
        };
    }

    const versionResult = runCommand(fallbackPath, ["--version"]);

    return {
        installed: versionResult.ok,
        version: firstLine(versionResult.stdout),
        path: fallbackPath
    };
}

function checkSimpleCommand(command, versionArgs) {
    const commandPath = whereCommand(command);
    if (!commandPath) {
        return {
            installed: false,
            version: "",
            path: ""
        };
    }

    const versionResult = runCommand(commandPath, versionArgs);

    return {
        installed: versionResult.ok,
        version: firstLine(versionResult.stdout),
        path: commandPath
    };
}

function appendPathEntry(currentPath, entryToAdd) {
    if (!entryToAdd) {
        return currentPath || "";
    }

    const entries = (currentPath || "")
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => Boolean(entry));

    const exists = entries.some((entry) => {
        if (isWindows) {
            return entry.toLowerCase() === entryToAdd.toLowerCase();
        }

        return entry === entryToAdd;
    });

    if (exists) {
        return entries.join(path.delimiter);
    }

    return [...entries, entryToAdd].join(path.delimiter);
}

function findFileRecursive(rootDir, fileName, depthRemaining = 4) {
    if (!rootDir || depthRemaining < 0 || !fs.existsSync(rootDir)) {
        return "";
    }

    let entries = [];
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch (_error) {
        return "";
    }

    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }

        if (entry.name.toLowerCase() === fileName.toLowerCase()) {
            return path.join(rootDir, entry.name);
        }
    }

    if (depthRemaining === 0) {
        return "";
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const nested = findFileRecursive(path.join(rootDir, entry.name), fileName, depthRemaining - 1);
        if (nested) {
            return nested;
        }
    }

    return "";
}

function findWindowsWingetPackageBinary(packagePrefix, binaryName) {
    if (!isWindows) {
        return "";
    }

    const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
    const linksPath = path.join(localAppData, "Microsoft", "WinGet", "Links", binaryName);
    if (fs.existsSync(linksPath)) {
        return linksPath;
    }

    const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
    if (!fs.existsSync(packagesRoot)) {
        return "";
    }

    try {
        const packageDirs = fs.readdirSync(packagesRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(packagePrefix.toLowerCase()))
            .map((entry) => path.join(packagesRoot, entry.name));

        for (const packageDir of packageDirs) {
            const match = findFileRecursive(packageDir, binaryName, 4);
            if (match) {
                return match;
            }
        }
    } catch (_error) {
        return "";
    }

    return "";
}

function checkJq() {
    const jqFromPath = checkSimpleCommand("jq", ["--version"]);
    if (jqFromPath.installed) {
        return {
            ...jqFromPath,
            pathInjected: false,
            detection: "path"
        };
    }

    if (!isWindows) {
        return {
            installed: false,
            version: "",
            path: "",
            pathInjected: false,
            detection: "missing"
        };
    }

    const jqFallbackPath = findWindowsWingetPackageBinary("jqlang.jq", "jq.exe");
    if (!jqFallbackPath) {
        return {
            installed: false,
            version: "",
            path: "",
            pathInjected: false,
            detection: "missing"
        };
    }

    const versionResult = runCommand(jqFallbackPath, ["--version"]);
    return {
        installed: versionResult.ok,
        version: firstLine(versionResult.stdout),
        path: jqFallbackPath,
        pathInjected: true,
        detection: "winget-package"
    };
}

function buildProcessPathWithResolvedJq() {
    const basePath = process.env.PATH || "";
    const jqInfo = checkJq();

    if (!jqInfo.installed || !jqInfo.path) {
        return basePath;
    }

    return appendPathEntry(basePath, path.dirname(jqInfo.path));
}

function checkPowerShell() {
    const commandName = isWindows ? "powershell" : "pwsh";
    const commandPath = whereCommand(commandName);
    if (!commandPath) {
        return {
            installed: false,
            version: "",
            path: "",
            commandName
        };
    }

    const versionArgs = isWindows
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "$PSVersionTable.PSVersion.ToString()"]
        : ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"];
    const versionResult = runCommand(commandPath, versionArgs);

    return {
        installed: versionResult.ok,
        version: firstLine(versionResult.stdout),
        path: commandPath,
        commandName
    };
}

function getDependencySummary() {
    const bash = checkBash();
    const curl = checkSimpleCommand("curl", ["--version"]);
    const jq = checkJq();
    const powerShell = checkPowerShell();
    const winget = isWindows ? checkSimpleCommand("winget", ["--version"]) : { installed: false, version: "", path: "" };
    const brew = isMac ? checkSimpleCommand("brew", ["--version"]) : { installed: false, version: "", path: "" };

    const installMethod = isWindows ? "winget" : isMac ? "brew" : "manual";
    const canInstall = isWindows ? winget.installed : isMac ? brew.installed : false;

    const dependencies = [
        {
            key: "bash",
            displayName: isWindows ? "Bash (Git Bash)" : "Bash",
            required: true,
            installed: bash.installed,
            version: bash.version,
            path: bash.path,
            packageId: isWindows ? "Git.Git" : "bash"
        },
        {
            key: "curl",
            displayName: "curl",
            required: true,
            installed: curl.installed,
            version: curl.version,
            path: curl.path,
            packageId: isWindows ? "cURL.cURL" : "curl"
        },
        {
            key: "jq",
            displayName: "jq",
            required: true,
            installed: jq.installed,
            version: jq.version,
            path: jq.path,
            packageId: isWindows ? "jqlang.jq" : "jq",
            note: jq.pathInjected
                ? "Detected from WinGet package path and available for app runs."
                : ""
        },
        {
            key: "powershell",
            displayName: isWindows ? "Windows PowerShell" : "PowerShell (pwsh)",
            required: false,
            installed: powerShell.installed,
            version: powerShell.version,
            path: powerShell.path,
            packageId: isWindows ? "Microsoft.PowerShell" : "powershell"
        },
        ...(isWindows
            ? [{
                key: "winget",
                displayName: "winget",
                required: false,
                installed: winget.installed,
                version: winget.version,
                path: winget.path,
                packageId: ""
            }]
            : []),
        ...(isMac
            ? [{
                key: "brew",
                displayName: "Homebrew",
                required: false,
                installed: brew.installed,
                version: brew.version,
                path: brew.path,
                packageId: ""
            }]
            : [])
    ];

    const missingRequired = dependencies
        .filter((dep) => dep.required && !dep.installed)
        .map((dep) => dep.key);

    return {
        isWindows,
        isMac,
        canInstall,
        installMethod,
        dependencies,
        missingRequired
    };
}

function installDependencyViaWinget(packageId, wingetExecutable = "winget") {
    return runCommand(
        wingetExecutable,
        [
            "install",
            "--id",
            packageId,
            "-e",
            "--accept-source-agreements",
            "--accept-package-agreements"
        ],
        15 * 60 * 1000
    );
}

function installDependencyViaBrew(packageName, brewExecutable = "brew") {
    return runCommand(
        brewExecutable,
        ["install", packageName],
        15 * 60 * 1000
    );
}

function installMissingDependencies() {
    const summaryBefore = getDependencySummary();

    if (!summaryBefore.canInstall) {
        const installerHint = summaryBefore.installMethod === "winget"
            ? "winget is not installed. Install App Installer from Microsoft Store, then retry."
            : summaryBefore.installMethod === "brew"
                ? "Homebrew is not installed. Install brew from https://brew.sh and retry."
                : "Automatic dependency install is not supported on this platform.";

        return {
            success: false,
            log: installerHint,
            summary: summaryBefore
        };
    }

    const missingInstallable = summaryBefore.dependencies.filter(
        (dep) => dep.required && !dep.installed && dep.packageId
    );

    if (missingInstallable.length === 0) {
        return {
            success: true,
            log: "No missing required dependencies.",
            summary: summaryBefore
        };
    }

    const logLines = [];
    let allSucceeded = true;
    const installerName = summaryBefore.installMethod;
    const installerDependency = summaryBefore.dependencies.find((dep) => dep.key === installerName);
    const installerExecutable = installerDependency && installerDependency.path
        ? installerDependency.path
        : installerName;

    for (const dep of missingInstallable) {
        logLines.push(`Installing ${dep.displayName} using ${installerName} package ${dep.packageId}...`);
        const result = installerName === "winget"
            ? installDependencyViaWinget(dep.packageId, installerExecutable)
            : installDependencyViaBrew(dep.packageId, installerExecutable);

        if (result.ok) {
            logLines.push(`SUCCESS: ${dep.displayName}`);
        } else {
            allSucceeded = false;
            logLines.push(`FAILED: ${dep.displayName}`);
            if (result.stderr) {
                logLines.push(result.stderr);
            }
            if (result.stdout) {
                logLines.push(result.stdout);
            }
            if (result.error) {
                logLines.push(result.error);
            }
        }

        logLines.push("");
    }

    const summaryAfter = getDependencySummary();
    if (summaryAfter.missingRequired.length > 0) {
        allSucceeded = false;
        logLines.push(`Still missing required dependencies: ${summaryAfter.missingRequired.join(", ")}`);
        logLines.push("Close and reopen the app after install if PATH updates are pending.");
    }

    return {
        success: allSucceeded,
        log: logLines.join("\n").trim(),
        summary: summaryAfter
    };
}

function getDefaultDownloadsPath() {
    try {
        const downloadsPath = app.getPath("downloads");
        if (downloadsPath && downloadsPath.trim()) {
            return downloadsPath;
        }
    } catch (_error) {
        // Ignore and use fallback below.
    }

    return path.join(app.getPath("home"), "Downloads");
}

function resolveWorkflowPaths(rawConfig) {
    const scriptRoot = getScriptRoot();
    const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    const saved = loadSettingsFromDisk();

    const requestedDownloadRoot = config.downloadRoot !== undefined
        ? config.downloadRoot
        : saved.downloadRoot;

    const customDownloadRoot = cleanInputPath(typeof requestedDownloadRoot === "string" ? requestedDownloadRoot : "");
    const downloadsPath = customDownloadRoot || getDefaultDownloadsPath();
    const stlFilesPath = path.join(downloadsPath, "stl_files");

    return {
        scriptRoot,
        downloadsPath,
        stlFilesPath,
        customDownloadRoot
    };
}

function getRuntimeInfo(rawConfig) {
    const resolved = resolveWorkflowPaths(rawConfig);

    return {
        scriptRoot: resolved.scriptRoot,
        downloadsPath: resolved.downloadsPath,
        stlFilesPath: resolved.stlFilesPath,
        downloadRoot: resolved.customDownloadRoot,
        usingDefaultDownloadRoot: !resolved.customDownloadRoot,
        isPackaged: app.isPackaged,
        platform: process.platform
    };
}

function getAllowedOpenPathRoots(rawConfig) {
    const runtime = getRuntimeInfo(rawConfig);
    const saved = loadSettingsFromDisk();
    const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

    const candidatePaths = [
        runtime.downloadsPath,
        runtime.stlFilesPath,
        cleanInputPath(config.downloadRoot || saved.downloadRoot),
        cleanInputPath(config.basePath || saved.basePath),
        cleanInputPath(config.jsonPath || saved.jsonPath),
        cleanInputPath(config.foldersPath || saved.foldersPath)
    ].filter(Boolean);

    return [...new Set(candidatePaths.map((entry) => path.resolve(entry)))];
}

function isPathWithinAllowedRoots(targetPath, rawConfig) {
    const resolvedTarget = path.resolve(targetPath);
    const allowedRoots = getAllowedOpenPathRoots(rawConfig);

    return allowedRoots.some((rootPath) => {
        if (resolvedTarget === rootPath) {
            return true;
        }

        return resolvedTarget.startsWith(`${rootPath}${path.sep}`);
    });
}

async function openPathInShell(payload) {
    const options = payload && typeof payload === "object" ? payload : {};
    const targetPath = cleanInputPath(typeof options.path === "string" ? options.path : "");
    const rawConfig = options.config && typeof options.config === "object" ? options.config : {};

    if (!targetPath) {
        return {
            ok: false,
            message: "Path is empty."
        };
    }

    if (!fs.existsSync(targetPath)) {
        return {
            ok: false,
            message: `Path does not exist: ${targetPath}`
        };
    }

    const resolvedTarget = path.resolve(targetPath);
    if (!isPathWithinAllowedRoots(resolvedTarget, rawConfig)) {
        return {
            ok: false,
            message: "Path is outside the allowed download workspace."
        };
    }

    const openResult = await shell.openPath(resolvedTarget);
    if (openResult) {
        return {
            ok: false,
            message: openResult
        };
    }

    return {
        ok: true,
        path: resolvedTarget
    };
}

function listModelJsonFiles(rawConfig) {
    const runtime = getRuntimeInfo(rawConfig);
    const downloadsPath = runtime.downloadsPath;

    if (!downloadsPath || !fs.existsSync(downloadsPath)) {
        return {
            downloadsPath,
            files: []
        };
    }

    const entries = fs.readdirSync(downloadsPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^model_\d+\.json$/i.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((entry) => {
            const fullPath = path.join(downloadsPath, entry.name);
            const stat = fs.statSync(fullPath);
            return {
                name: entry.name,
                id: entry.name.replace(/^model_(\d+)\.json$/i, "$1"),
                path: fullPath,
                size: stat.size,
                modifiedAt: stat.mtime.toISOString()
            };
        });

    return {
        downloadsPath,
        files: entries
    };
}

function readModelJsonFile(payload) {
    const options = payload && typeof payload === "object" ? payload : {};
    const fileName = path.basename(typeof options.fileName === "string" ? options.fileName : "");

    if (!/^model_\d+\.json$/i.test(fileName)) {
        return {
            ok: false,
            message: "Invalid model JSON filename."
        };
    }

    const runtime = getRuntimeInfo(options);
    const filePath = path.join(runtime.downloadsPath, fileName);

    if (!fs.existsSync(filePath)) {
        return {
            ok: false,
            message: `JSON file not found: ${filePath}`
        };
    }

    const rawText = fs.readFileSync(filePath, "utf8");
    try {
        const parsed = JSON.parse(rawText);
        return {
            ok: true,
            fileName,
            filePath,
            downloadsPath: runtime.downloadsPath,
            validJson: true,
            prettyJson: JSON.stringify(parsed, null, 2)
        };
    } catch (_error) {
        return {
            ok: true,
            fileName,
            filePath,
            downloadsPath: runtime.downloadsPath,
            validJson: false,
            prettyJson: rawText
        };
    }
}

async function pickDirectory(payload) {
    const options = payload && typeof payload === "object" ? payload : {};
    const title = typeof options.title === "string" && options.title.trim()
        ? options.title.trim()
        : "Select folder";

    const requestedPath = cleanInputPath(typeof options.defaultPath === "string" ? options.defaultPath : "");
    let defaultPath = "";

    if (requestedPath && fs.existsSync(requestedPath)) {
        defaultPath = requestedPath;
    } else if (requestedPath) {
        const parent = path.dirname(requestedPath);
        if (parent && fs.existsSync(parent)) {
            defaultPath = parent;
        }
    }

    if (!defaultPath) {
        defaultPath = getRuntimeInfo().scriptRoot;
    }

    const result = await dialog.showOpenDialog(mainWindow || undefined, {
        title,
        defaultPath,
        properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
        buttonLabel: "Select"
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
        return {
            canceled: true,
            path: ""
        };
    }

    return {
        canceled: false,
        path: result.filePaths[0]
    };
}

function cleanInputPath(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim().replace(/^"(.*)"$/, "$1");
}

function normalizeModelIdsText(text) {
    if (typeof text !== "string") {
        return "";
    }

    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => Boolean(line))
        .join("\n");
}

function normalizeCookie(cookie) {
    if (typeof cookie !== "string") {
        return "";
    }

    return cookie.trim().replace(/^cookie\s*:\s*/i, "");
}

function normalizeMedusaJwt(jwt) {
    if (typeof jwt !== "string") {
        return "";
    }

    return jwt.trim().replace(/^bearer\s+/i, "");
}

function normalizePublishableKey(publishableKey) {
    if (typeof publishableKey !== "string") {
        return "";
    }

    return publishableKey.trim().replace(/^x-publishable-api-key\s*:\s*/i, "");
}

function parseBoolean(value, fallback = false) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "string") {
        return /^(true|1|yes)$/i.test(value.trim());
    }

    return fallback;
}

function compactPreview(value, maxLength = 220) {
    if (typeof value !== "string") {
        return "";
    }

    const singleLine = value.replace(/\s+/g, " ").trim();
    if (singleLine.length <= maxLength) {
        return singleLine;
    }

    return `${singleLine.slice(0, maxLength)}...`;
}

function requestJson(url, options = {}) {
    const headers = options.headers && typeof options.headers === "object"
        ? options.headers
        : {};
    const method = typeof options.method === "string" ? options.method : "GET";
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 25000;

    return new Promise((resolve, reject) => {
        const req = https.request(url, { method, headers }, (res) => {
            let raw = "";

            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                raw += chunk;
                if (raw.length > 2_000_000) {
                    raw = raw.slice(-2_000_000);
                }
            });

            res.on("end", () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(raw);
                } catch (_error) {
                    parsed = null;
                }

                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers || {},
                    text: raw,
                    json: parsed
                });
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
        });

        req.on("error", (error) => {
            reject(error);
        });

        req.end();
    });
}

async function resolveOwnModelIds(rawConfig) {
    const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    const saved = loadSettingsFromDisk();

    const cookie = normalizeCookie(config.cookie || saved.cookie || "");
    const medusaJwt = normalizeMedusaJwt(config.medusaJwt || saved.medusaJwt || "");
    const medusaPublishableKey = normalizePublishableKey(
        config.medusaPublishableKey || saved.medusaPublishableKey || ""
    );

    if (!cookie) {
        return {
            ok: false,
            message: "Cookie is required. Sign in to MMF or paste PHPSESSID and cf_clearance first."
        };
    }

    if (!medusaJwt) {
        return {
            ok: false,
            message: "Medusa JWT is required. Sign in to MMF or paste medusa_auth_token first."
        };
    }

    if (!medusaPublishableKey) {
        return {
            ok: false,
            message: "x-publishable-api-key is required. Open your MMF profile once after sign-in, or paste the pk_ key."
        };
    }

    try {
        const result = await resolveOwnCatalog({
            requestJson,
            sleep,
            cookie,
            medusaJwt,
            medusaPublishableKey,
            rateLimits: RATE_LIMITS,
            onProgress: (payload) => emitRendererEvent("catalog:progress", payload)
        });

        if (!result.ok) {
            return {
                ok: false,
                message: result.message || "Failed to resolve owned model IDs."
            };
        }

        return result;
    } catch (error) {
        return {
            ok: false,
            message: `Failed to resolve owned model IDs: ${String(error.message || error)}`
        };
    }
}

function emitRendererEvent(channel, payload) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send(channel, payload);
}

function emitWorkflowLog(runId, stream, text) {
    emitRendererEvent("workflow:log", {
        runId,
        stream,
        text
    });
}

function emitWorkflowState(payload) {
    emitRendererEvent("workflow:state", payload);
}

function getBashExecutablePath() {
    const info = checkBash();
    return info.installed ? info.path : "";
}

function getPowerShellExecutablePath() {
    const info = checkPowerShell();
    return info.installed ? info.path : "";
}

function getPowerShellFileArgs(scriptPath) {
    return isWindows
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
        : ["-NoProfile", "-File", scriptPath];
}

function ensureFileExists(filePath) {
    return fs.existsSync(filePath);
}

function startProcessRun(plan) {
    if (activeRun) {
        return {
            accepted: false,
            message: "Another workflow step is already running."
        };
    }

    const runId = `run_${Date.now()}_${++runCounter}`;
    const child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: {
            ...process.env,
            ...plan.env
        },
        windowsHide: true,
        shell: false
    });

    const runRecord = {
        runId,
        child,
        stopRequested: false,
        label: plan.label,
        commandLine: [plan.command, ...plan.args].join(" "),
        cwd: plan.cwd,
        stepKey: plan.stepKey,
        cookieInUse: Boolean(plan.env && plan.env.MMF_COOKIE),
        cookieExpiredNotified: false,
        outputTail: ""
    };

    activeRun = runRecord;

    emitWorkflowState({
        type: "started",
        runId,
        label: runRecord.label,
        commandLine: runRecord.commandLine,
        cwd: runRecord.cwd,
        warnings: plan.warnings || []
    });

    const handleOutput = (stream, chunk) => {
        const text = chunk.toString("utf8");
        emitWorkflowLog(runId, stream, text);

        runRecord.outputTail = `${runRecord.outputTail}${text}`.slice(-3000);

        const cookieSensitiveStep = runRecord.stepKey === "step1"
            || runRecord.stepKey === "step2-test"
            || runRecord.stepKey === "step2-full";

        if (
            runRecord.cookieInUse
            && cookieSensitiveStep
            && !runRecord.cookieExpiredNotified
            && looksLikeCookieExpiration(runRecord.outputTail)
        ) {
            runRecord.cookieExpiredNotified = true;
            clearSavedMmfSession();
            emitWorkflowState({
                type: "cookie-expired",
                runId,
                message: "MMF session expired during the run. Sign in and capture a fresh session."
            });
        }
    };

    child.stdout.on("data", (chunk) => {
        handleOutput("stdout", chunk);
    });

    child.stderr.on("data", (chunk) => {
        handleOutput("stderr", chunk);
    });

    child.on("error", (error) => {
        emitWorkflowState({
            type: "error",
            runId,
            message: String(error.message || error)
        });
    });

    child.on("close", (code, signal) => {
        const wasStopped = runRecord.stopRequested;
        if (activeRun && activeRun.runId === runId) {
            activeRun = null;
        }

        if (wasStopped) {
            emitWorkflowState({
                type: "stopped",
                runId,
                code,
                signal
            });
            return;
        }

        emitWorkflowState({
            type: "completed",
            runId,
            code,
            signal,
            success: code === 0
        });
    });

    return {
        accepted: true,
        runId,
        label: runRecord.label,
        commandLine: runRecord.commandLine,
        cwd: runRecord.cwd,
        warnings: plan.warnings || []
    };
}

function buildStepPlan(stepKey, rawConfig) {
    const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    const runtime = resolveWorkflowPaths(config);
    const scriptRoot = runtime.scriptRoot;
    const downloadsPath = runtime.downloadsPath;
    const stlFilesPath = runtime.stlFilesPath;

    const saved = loadSettingsFromDisk();
    const cookie = normalizeCookie(config.cookie || saved.cookie || "");
    const medusaJwt = normalizeMedusaJwt(config.medusaJwt || saved.medusaJwt || "");
    const medusaPublishableKey = normalizePublishableKey(
        config.medusaPublishableKey || saved.medusaPublishableKey || ""
    );
    const modelIdsText = normalizeModelIdsText(config.modelIdsText || saved.modelIdsText || "");
    const warnings = [];

    const bashPath = getBashExecutablePath();
    const powerShellPath = getPowerShellExecutablePath();
    const processPathWithResolvedJq = buildProcessPathWithResolvedJq();
    const jqInfo = checkJq();

    if (stepKey === "step1") {
        if (!bashPath) {
            return {
                accepted: false,
                message: isWindows ? "Bash was not found. Install Git Bash first." : "Bash was not found."
            };
        }

        if (!cookie) {
            return {
                accepted: false,
                message: "Session cookie is required for Step 1."
            };
        }

        if (!modelIdsText) {
            return {
                accepted: false,
                message: "At least one model ID is required for Step 1."
            };
        }

        if (cookie && !/(^|;\s*)PHPSESSID=/i.test(cookie)) {
            warnings.push("Cookie is missing PHPSESSID.");
        }
        if (cookie && !/(^|;\s*)cf_clearance=/i.test(cookie)) {
            warnings.push("Cookie is missing cf_clearance.");
        }
        if (isWindows && jqInfo.installed && jqInfo.pathInjected) {
            warnings.push("jq was detected in the WinGet package folder and injected into PATH for this run.");
        }

        fs.writeFileSync(path.join(scriptRoot, "model_ids.txt"), `${modelIdsText}\n`, "utf8");

        const scriptPath = path.join(scriptRoot, "1_mmf_download_metadata.sh");
        if (!ensureFileExists(scriptPath)) {
            return {
                accepted: false,
                message: `Script not found: ${scriptPath}`
            };
        }

        return {
            accepted: true,
            stepKey,
            label: "Step 1 - Download metadata",
            command: bashPath,
            args: [toBashScriptPath(scriptPath)],
            cwd: scriptRoot,
            env: {
                MMF_COOKIE: cookie,
                ...(medusaJwt ? { MMF_MEDUSA_JWT: medusaJwt } : {}),
                ...(medusaPublishableKey ? { MMF_PUBLISHABLE_KEY: medusaPublishableKey } : {}),
                MMF_DOWNLOAD_ROOT: downloadsPath,
                MMF_MODEL_IDS_PATH: path.join(scriptRoot, "model_ids.txt"),
                PATH: processPathWithResolvedJq,
                ...getRateLimitEnv()
            },
            warnings
        };
    }

    if (stepKey === "step2-test" || stepKey === "step2-full") {
        if (!bashPath) {
            return {
                accepted: false,
                message: isWindows ? "Bash was not found. Install Git Bash first." : "Bash was not found."
            };
        }

        if (!cookie) {
            return {
                accepted: false,
                message: "Session cookie is required for Step 2."
            };
        }

        if (!fs.existsSync(downloadsPath)) {
            return {
                accepted: false,
                message: `Download folder was not found: ${downloadsPath}. Run Step 1 first.`
            };
        }

        if (cookie && !/(^|;\s*)PHPSESSID=/i.test(cookie)) {
            warnings.push("Cookie is missing PHPSESSID.");
        }
        if (cookie && !/(^|;\s*)cf_clearance=/i.test(cookie)) {
            warnings.push("Cookie is missing cf_clearance.");
        }
        if (isWindows && jqInfo.installed && jqInfo.pathInjected) {
            warnings.push("jq was detected in the WinGet package folder and injected into PATH for this run.");
        }

        const scriptPath = path.join(scriptRoot, "mmf_download_stl_files_enhanced.sh");
        if (!ensureFileExists(scriptPath)) {
            return {
                accepted: false,
                message: `Script not found: ${scriptPath}`
            };
        }

        const args = [scriptPath];
        if (stepKey === "step2-test") {
            args.push("--test");
        }

        return {
            accepted: true,
            stepKey,
            label: stepKey === "step2-test" ? "Step 2 - Test mode" : "Step 2 - Full download",
            command: bashPath,
            args: args.map((value, index) => (index === 0 ? toBashScriptPath(value) : value)),
            cwd: downloadsPath,
            env: {
                MMF_COOKIE: cookie,
                ...(medusaJwt ? { MMF_MEDUSA_JWT: medusaJwt } : {}),
                ...(medusaPublishableKey ? { MMF_PUBLISHABLE_KEY: medusaPublishableKey } : {}),
                PATH: processPathWithResolvedJq,
                ...getRateLimitEnv()
            },
            warnings
        };
    }

    if (stepKey === "step3") {
        const basePath = cleanInputPath(config.basePath || saved.basePath) || stlFilesPath;
        const extractInPlace = parseBoolean(
            config.extractInPlace !== undefined ? config.extractInPlace : saved.extractInPlace,
            true
        );

        if (isWindows) {
            if (!powerShellPath) {
                return {
                    accepted: false,
                    message: "PowerShell was not found."
                };
            }

            const scriptPath = path.join(scriptRoot, "3_extract_all_zips.ps1");
            if (!ensureFileExists(scriptPath)) {
                return {
                    accepted: false,
                    message: `Script not found: ${scriptPath}`
                };
            }

            return {
                accepted: true,
                stepKey,
                label: "Step 3 - Extract ZIP files",
                command: powerShellPath,
                args: getPowerShellFileArgs(scriptPath),
                cwd: scriptRoot,
                env: {
                    MMF_BASE_PATH: basePath,
                    MMF_EXTRACT_IN_PLACE: extractInPlace ? "true" : "false"
                },
                warnings
            };
        }

        if (!bashPath) {
            return {
                accepted: false,
                message: "Bash was not found."
            };
        }

        const scriptPath = path.join(scriptRoot, "3_extract_all_zips.sh");
        if (!ensureFileExists(scriptPath)) {
            return {
                accepted: false,
                message: `Script not found: ${scriptPath}`
            };
        }

        return {
            accepted: true,
            stepKey,
            label: "Step 3 - Extract ZIP files",
            command: bashPath,
            args: [toBashScriptPath(scriptPath)],
            cwd: scriptRoot,
            env: {
                MMF_BASE_PATH: basePath,
                MMF_EXTRACT_IN_PLACE: extractInPlace ? "true" : "false",
                PATH: processPathWithResolvedJq
            },
            warnings
        };
    }

    if (stepKey === "step4") {
        const jsonPath = cleanInputPath(config.jsonPath || saved.jsonPath) || downloadsPath;
        const foldersPath = cleanInputPath(config.foldersPath || saved.foldersPath) || stlFilesPath;
        const namingFormatSource = config.namingFormat || saved.namingFormat;
        const namingFormat = namingFormatSource === "NAME_ONLY" ? "NAME_ONLY" : "ID_NAME";
        const maxNameLengthInput = Number.parseInt(
            config.maxNameLength !== undefined ? config.maxNameLength : saved.maxNameLength,
            10
        );
        const maxNameLength = Number.isNaN(maxNameLengthInput)
            ? 80
            : Math.max(10, Math.min(160, maxNameLengthInput));

        if (isWindows) {
            if (!powerShellPath) {
                return {
                    accepted: false,
                    message: "PowerShell was not found."
                };
            }

            const scriptPath = path.join(scriptRoot, "4_rename_folders_from_json.ps1");
            if (!ensureFileExists(scriptPath)) {
                return {
                    accepted: false,
                    message: `Script not found: ${scriptPath}`
                };
            }

            return {
                accepted: true,
                stepKey,
                label: "Step 4 - Rename folders from JSON",
                command: powerShellPath,
                args: getPowerShellFileArgs(scriptPath),
                cwd: scriptRoot,
                env: {
                    MMF_JSON_PATH: jsonPath,
                    MMF_FOLDERS_PATH: foldersPath,
                    MMF_NAMING_FORMAT: namingFormat,
                    MMF_MAX_NAME_LENGTH: String(maxNameLength)
                },
                warnings
            };
        }

        if (!bashPath) {
            return {
                accepted: false,
                message: "Bash was not found."
            };
        }

        const scriptPath = path.join(scriptRoot, "4_rename_folders_from_json.sh");
        if (!ensureFileExists(scriptPath)) {
            return {
                accepted: false,
                message: `Script not found: ${scriptPath}`
            };
        }

        return {
            accepted: true,
            stepKey,
            label: "Step 4 - Rename folders from JSON",
            command: bashPath,
            args: [toBashScriptPath(scriptPath)],
            cwd: scriptRoot,
            env: {
                MMF_JSON_PATH: jsonPath,
                MMF_FOLDERS_PATH: foldersPath,
                MMF_NAMING_FORMAT: namingFormat,
                MMF_MAX_NAME_LENGTH: String(maxNameLength),
                PATH: processPathWithResolvedJq
            },
            warnings
        };
    }

    return {
        accepted: false,
        message: "Unknown workflow step."
    };
}

function stopActiveRun() {
    if (!activeRun) {
        return {
            stopped: false,
            message: "No workflow step is currently running."
        };
    }

    activeRun.stopRequested = true;
    const runId = activeRun.runId;

    if (isWindows) {
        const killResult = runCommand("taskkill", ["/PID", String(activeRun.child.pid), "/T", "/F"], 10000);
        if (!killResult.ok) {
            try {
                activeRun.child.kill();
            } catch (_error) {
                return {
                    stopped: false,
                    message: "Failed to stop running process."
                };
            }
        }
    } else {
        try {
            activeRun.child.kill("SIGTERM");
        } catch (_error) {
            return {
                stopped: false,
                message: "Failed to stop running process."
            };
        }
    }

    emitWorkflowState({
        type: "stop-requested",
        runId
    });

    return {
        stopped: true,
        runId
    };
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 1080,
        minHeight: 760,
        show: false,
        title: "Bulk Downloader",
        icon: getIconPath(),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    mainWindow.loadFile(path.join(__dirname, "..", "gui", "index.html"));
}

ipcMain.handle("desktop:check-dependencies", async () => {
    return getDependencySummary();
});

ipcMain.handle("desktop:install-missing-dependencies", async () => {
    return installMissingDependencies();
});

ipcMain.handle("desktop:get-runtime-info", async (_event, payload) => {
    return getRuntimeInfo(payload);
});

ipcMain.handle("desktop:pick-directory", async (_event, payload) => {
    return pickDirectory(payload);
});

ipcMain.handle("desktop:open-path", async (_event, payload) => {
    return openPathInShell(payload);
});

ipcMain.handle("desktop:list-model-json-files", async (_event, payload) => {
    return listModelJsonFiles(payload);
});

ipcMain.handle("desktop:read-model-json-file", async (_event, payload) => {
    return readModelJsonFile(payload);
});

ipcMain.handle("desktop:load-settings", async () => {
    return loadSettingsFromDisk();
});

ipcMain.handle("desktop:save-settings", async (_event, payload) => {
    return saveSettingsToDisk(payload);
});

ipcMain.handle("desktop:resolve-own-model-ids", async (_event, payload) => {
    return resolveOwnModelIds(payload);
});

ipcMain.handle("desktop:open-mmf-login", async () => {
    try {
        const saved = loadSettingsFromDisk();
        const hasSavedSession = Boolean(
            saved.cookie || saved.medusaJwt || saved.medusaPublishableKey
        );

        return await openMmfLoginWindow(saved.mmfUsername || "", {
            forceLogin: !hasSavedSession
        });
    } catch (error) {
        return {
            ok: false,
            message: `Failed to open MyMiniFactory window: ${String(error.message || error)}`
        };
    }
});

ipcMain.handle("desktop:clear-mmf-browser-session", async () => {
    try {
        return await clearMmfBrowserSession();
    } catch (error) {
        return {
            ok: false,
            message: String(error.message || error)
        };
    }
});

ipcMain.handle("desktop:capture-mmf-session", async () => {
    const captured = await captureMmfSession();
    if (captured && captured.ok) {
        saveSettingsToDisk({
            cookie: captured.cookie,
            medusaJwt: captured.medusaJwt || "",
            medusaPublishableKey: captured.medusaPublishableKey || "",
            mmfUsername: captured.mmfUsername || "",
            sessionCapturedAt: captured.capturedAt || new Date().toISOString()
        });
    }

    return captured;
});

ipcMain.handle("desktop:validate-mmf-session", async () => {
    return validateStoredMmfSession();
});

ipcMain.handle("desktop:close-mmf-login", async () => {
    closeMmfLoginWindow();
    return { ok: true };
});

ipcMain.handle("desktop:start-workflow-step", async (_event, payload) => {
    const stepKey = payload && typeof payload.stepKey === "string" ? payload.stepKey : "";
    const plan = buildStepPlan(stepKey, payload ? payload.config : null);
    if (!plan.accepted) {
        return {
            accepted: false,
            message: plan.message || "Unable to prepare workflow step."
        };
    }

    return startProcessRun(plan);
});

ipcMain.handle("desktop:stop-workflow-step", async () => {
    return stopActiveRun();
});

app.whenReady().then(() => {
    migratePlaintextSecretsIfNeeded();
    createMainWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
