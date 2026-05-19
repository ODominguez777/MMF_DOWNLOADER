(() => {
    if (window.__MMF_APP_BOOTSTRAPPED__) {
        console.warn("app.js was loaded more than once. Duplicate initialization was skipped.");
        return;
    }

    window.__MMF_APP_BOOTSTRAPPED__ = true;

const elements = {
    phpSessidInput: document.getElementById("phpSessidInput"),
    cfClearanceInput: document.getElementById("cfClearanceInput"),
    jwtInput: document.getElementById("jwtInput"),
    publishableKeyInput: document.getElementById("publishableKeyInput"),
    idsChipEditor: document.getElementById("idsChipEditor"),
    idsChipList: document.getElementById("idsChipList"),
    idsChipInput: document.getElementById("idsChipInput"),
    idsInput: document.getElementById("idsInput"),
    downloadRootInput: document.getElementById("downloadRootInput"),
    browseDownloadRootBtn: document.getElementById("browseDownloadRootBtn"),
    openDownloadRootBtn: document.getElementById("openDownloadRootBtn"),
    testModeCheck: document.getElementById("testModeCheck"),
    loadSampleBtn: document.getElementById("loadSampleBtn"),
    autoLoadMyIdsBtn: document.getElementById("autoLoadMyIdsBtn"),
    clearBtn: document.getElementById("clearBtn"),
    validateBtn: document.getElementById("validateBtn"),
    downloadIdsBtn: document.getElementById("downloadIdsBtn"),
    copyCommandsBtn: document.getElementById("copyCommandsBtn"),
    generatePsBtn: document.getElementById("generatePsBtn"),
    copyPsBtn: document.getElementById("copyPsBtn"),
    statusMessage: document.getElementById("statusMessage"),
    requirementsList: document.getElementById("requirementsList"),
    readinessBar: document.getElementById("readinessBar"),
    readinessText: document.getElementById("readinessText"),
    idsPreview: document.getElementById("idsPreview"),
    validIdCount: document.getElementById("validIdCount"),
    invalidLineCount: document.getElementById("invalidLineCount"),
    requiredPassCount: document.getElementById("requiredPassCount"),
    readinessPct: document.getElementById("readinessPct"),
    connectionBadge: document.getElementById("connectionBadge"),
    basePathInput: document.getElementById("basePathInput"),
    browseBasePathBtn: document.getElementById("browseBasePathBtn"),
    extractModeSelect: document.getElementById("extractModeSelect"),
    jsonPathInput: document.getElementById("jsonPathInput"),
    browseJsonPathBtn: document.getElementById("browseJsonPathBtn"),
    foldersPathInput: document.getElementById("foldersPathInput"),
    browseFoldersPathBtn: document.getElementById("browseFoldersPathBtn"),
    namingFormatSelect: document.getElementById("namingFormatSelect"),
    maxLengthInput: document.getElementById("maxLengthInput"),
    useRecommendedPathsBtn: document.getElementById("useRecommendedPathsBtn"),
    runPostProcessBtn: document.getElementById("runPostProcessBtn"),
    pathHelperHint: document.getElementById("pathHelperHint"),
    psSnippet: document.getElementById("psSnippet"),
    desktopGate: document.getElementById("desktopGate"),
    depSummary: document.getElementById("depSummary"),
    depList: document.getElementById("depList"),
    depLog: document.getElementById("depLog"),
    depRefreshBtn: document.getElementById("depRefreshBtn"),
    depInstallBtn: document.getElementById("depInstallBtn"),
    depSkipBtn: document.getElementById("depSkipBtn"),
    runtimePath: document.getElementById("runtimePath"),
    runExecuteBtn: document.getElementById("runExecuteBtn"),
    runStep1Btn: document.getElementById("runStep1Btn"),
    runStep2TestBtn: document.getElementById("runStep2TestBtn"),
    runStep2FullBtn: document.getElementById("runStep2FullBtn"),
    runStep3Btn: document.getElementById("runStep3Btn"),
    runStep4Btn: document.getElementById("runStep4Btn"),
    stopRunBtn: document.getElementById("stopRunBtn"),
    clearLogBtn: document.getElementById("clearLogBtn"),
    openFilesFolderBtn: document.getElementById("openFilesFolderBtn"),
    runStatus: document.getElementById("runStatus"),
    runLog: document.getElementById("runLog"),
    jsonFileSelect: document.getElementById("jsonFileSelect"),
    refreshJsonListBtn: document.getElementById("refreshJsonListBtn"),
    openJsonFolderBtn: document.getElementById("openJsonFolderBtn"),
    jsonViewer: document.getElementById("jsonViewer")
};

const SAMPLE_IDS = ["409352", "409348", "496377"];
const mmfDesktopApi = window.desktopApi || null;

let lastDependencySummary = null;
let activeRunId = null;
let latestRunId = null;
let runtimePlatform = "unknown";
let settingsSaveTimer = null;
let settingsApplyInProgress = false;
let pipelineRunning = false;
let runtimeInfoCache = null;
let modelIdEntries = [];

const pendingRunResolvers = new Map();

function parseModelIds(inputText) {
    const lines = inputText.split(/\r?\n/);
    const validIds = [];
    const invalidLines = [];
    const duplicateIds = [];
    const seen = new Set();

    lines.forEach((line, idx) => {
        const value = line.trim();
        if (!value) {
            return;
        }

        if (!/^\d+$/.test(value)) {
            invalidLines.push({ line: idx + 1, value });
            return;
        }

        if (seen.has(value)) {
            duplicateIds.push(value);
            return;
        }

        seen.add(value);
        validIds.push(value);
    });

    return {
        validIds,
        invalidLines,
        duplicateIds: [...new Set(duplicateIds)]
    };
}

function parseModelIdTokens(inputText) {
    return String(inputText || "")
        .split(/[\s,;]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

function syncIdsTextareaFromEntries() {
    if (!elements.idsInput) {
        return;
    }

    elements.idsInput.value = modelIdEntries.join("\n");
}

function renderModelIdChips() {
    if (!elements.idsChipList) {
        return;
    }

    elements.idsChipList.innerHTML = "";

    const countByValue = new Map();
    modelIdEntries.forEach((entry) => {
        countByValue.set(entry, (countByValue.get(entry) || 0) + 1);
    });

    modelIdEntries.forEach((entry, index) => {
        const chip = document.createElement("span");
        chip.classList.add("id-chip");

        const isNumeric = /^\d+$/.test(entry);
        const isDuplicate = (countByValue.get(entry) || 0) > 1;

        if (!isNumeric) {
            chip.classList.add("id-chip-invalid");
        } else if (isDuplicate) {
            chip.classList.add("id-chip-duplicate");
        }

        const valueSpan = document.createElement("span");
        valueSpan.textContent = entry;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "id-chip-remove";
        removeBtn.textContent = "x";
        removeBtn.dataset.chipIndex = String(index);
        removeBtn.setAttribute("aria-label", `Remove model ID ${entry}`);

        chip.appendChild(valueSpan);
        chip.appendChild(removeBtn);
        elements.idsChipList.appendChild(chip);
    });
}

function setModelIdEntriesFromText(inputText) {
    modelIdEntries = parseModelIdTokens(inputText);
    syncIdsTextareaFromEntries();
    renderModelIdChips();
}

function addModelIdEntriesFromText(inputText) {
    const tokens = parseModelIdTokens(inputText);
    if (tokens.length === 0) {
        return false;
    }

    modelIdEntries.push(...tokens);
    syncIdsTextareaFromEntries();
    renderModelIdChips();
    return true;
}

function setupModelIdChipEditor() {
    if (!elements.idsChipInput || !elements.idsChipList || !elements.idsInput) {
        return;
    }

    const commitChipInput = () => {
        const raw = elements.idsChipInput.value;
        if (!raw || !raw.trim()) {
            return false;
        }

        const added = addModelIdEntriesFromText(raw);
        elements.idsChipInput.value = "";
        return added;
    };

    elements.idsChipInput.addEventListener("keydown", (event) => {
        const shouldCommit = event.key === "Enter"
            || event.key === ","
            || event.key === ";"
            || (event.key === " " && elements.idsChipInput.value.trim().length > 0);

        if (shouldCommit) {
            event.preventDefault();
            if (commitChipInput()) {
                refreshDashboard();
                scheduleSettingsSave();
            }
            return;
        }

        if (event.key === "Backspace" && !elements.idsChipInput.value && modelIdEntries.length > 0) {
            event.preventDefault();
            modelIdEntries.pop();
            syncIdsTextareaFromEntries();
            renderModelIdChips();
            refreshDashboard();
            scheduleSettingsSave();
        }
    });

    elements.idsChipInput.addEventListener("input", () => {
        if (!/[\n\r,;\t]/.test(elements.idsChipInput.value)) {
            return;
        }

        if (commitChipInput()) {
            refreshDashboard();
            scheduleSettingsSave();
        }
    });

    elements.idsChipInput.addEventListener("paste", (event) => {
        const pastedText = event.clipboardData ? event.clipboardData.getData("text") : "";
        if (!pastedText || !/[\s,;]+/.test(pastedText)) {
            return;
        }

        event.preventDefault();
        if (addModelIdEntriesFromText(pastedText)) {
            elements.idsChipInput.value = "";
            refreshDashboard();
            scheduleSettingsSave();
        }
    });

    elements.idsChipInput.addEventListener("blur", () => {
        if (commitChipInput()) {
            refreshDashboard();
            scheduleSettingsSave();
        }
    });

    elements.idsChipList.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const removeBtn = target.closest("button[data-chip-index]");
        if (!removeBtn) {
            return;
        }

        const index = Number.parseInt(removeBtn.dataset.chipIndex || "", 10);
        if (Number.isNaN(index) || index < 0 || index >= modelIdEntries.length) {
            return;
        }

        modelIdEntries.splice(index, 1);
        syncIdsTextareaFromEntries();
        renderModelIdChips();
        refreshDashboard();
        scheduleSettingsSave();
        elements.idsChipInput.focus();
    });

    if (elements.idsChipEditor) {
        elements.idsChipEditor.addEventListener("click", () => {
            elements.idsChipInput.focus();
        });
    }
}

function normalizeCookieFieldValue(value, cookieName) {
    let normalized = typeof value === "string" ? value.trim() : "";
    normalized = normalized.replace(/^cookie\s*:\s*/i, "");

    if (cookieName) {
        const prefix = new RegExp(`^${cookieName}\\s*=\\s*`, "i");
        normalized = normalized.replace(prefix, "").trim();
    }

    return normalized;
}

function parseLegacyCookie(cookieHeader) {
    const normalized = typeof cookieHeader === "string"
        ? cookieHeader.trim().replace(/^cookie\s*:\s*/i, "")
        : "";

    const phpMatch = normalized.match(/(?:^|;\s*)PHPSESSID=([^;]+)/i);
    const cfMatch = normalized.match(/(?:^|;\s*)cf_clearance=([^;]+)/i);

    return {
        phpSessid: phpMatch ? phpMatch[1].trim() : "",
        cfClearance: cfMatch ? cfMatch[1].trim() : ""
    };
}

function buildCookieFromInputs() {
    const phpSessid = normalizeCookieFieldValue(elements.phpSessidInput.value, "PHPSESSID");
    const cfClearance = normalizeCookieFieldValue(elements.cfClearanceInput.value, "cf_clearance");

    const parts = [];
    if (phpSessid) {
        parts.push(`PHPSESSID=${phpSessid}`);
    }
    if (cfClearance) {
        parts.push(`cf_clearance=${cfClearance}`);
    }

    return parts.join("; ");
}

function analyzeCookie() {
    const phpSessid = normalizeCookieFieldValue(elements.phpSessidInput.value, "PHPSESSID");
    const cfClearance = normalizeCookieFieldValue(elements.cfClearanceInput.value, "cf_clearance");
    const normalized = buildCookieFromInputs();

    return {
        normalized,
        hasCookie: normalized.length > 0,
        hasPhpSession: Boolean(phpSessid),
        hasCfClearance: Boolean(cfClearance)
    };
}

function normalizeJwtValue(value) {
    return typeof value === "string"
        ? value.trim().replace(/^bearer\s+/i, "")
        : "";
}

function normalizePublishableKeyValue(value) {
    return typeof value === "string"
        ? value.trim().replace(/^x-publishable-api-key\s*:\s*/i, "")
        : "";
}

function analyzeMedusaAuth() {
    const medusaJwt = normalizeJwtValue(elements.jwtInput.value);
    const medusaPublishableKey = normalizePublishableKeyValue(elements.publishableKeyInput.value);

    return {
        medusaJwt,
        medusaPublishableKey,
        hasMedusaJwt: Boolean(medusaJwt),
        hasMedusaPublishableKey: Boolean(medusaPublishableKey)
    };
}

function buildRequirementState() {
    const idState = parseModelIds(elements.idsInput.value);
    const cookieState = analyzeCookie();
    const medusaAuthState = analyzeMedusaAuth();

    const requirements = [
        {
            label: "Cookie parts are provided",
            pass: cookieState.hasCookie,
            required: true,
            help: "Fill PHPSESSID and cf_clearance from a download request Cookie header."
        },
        {
            label: "Cookie includes PHPSESSID",
            pass: cookieState.hasPhpSession,
            required: true,
            help: "Needed for authenticated API and download requests."
        },
        {
            label: "Cookie includes cf_clearance",
            pass: cookieState.hasCfClearance,
            required: true,
            help: "Required to avoid Cloudflare HTML error pages."
        },
        {
            label: "Medusa JWT is provided",
            pass: medusaAuthState.hasMedusaJwt,
            required: false,
            help: "Needed for automatic own-catalog lookup (medusa_auth_token from Local Storage)."
        },
        {
            label: "x-publishable-api-key is provided",
            pass: medusaAuthState.hasMedusaPublishableKey,
            required: false,
            help: "Needed with JWT to call /store/customers/me and resolve your mmf_id automatically."
        },
        {
            label: "At least one model ID is present",
            pass: idState.validIds.length > 0,
            required: true,
            help: "Add at least one numeric model ID chip."
        },
        {
            label: "All non-empty lines are numeric model IDs",
            pass: idState.invalidLines.length === 0,
            required: true,
            help: "Remove invalid values from the ID chips."
        },
        {
            label: "No duplicate model IDs",
            pass: idState.duplicateIds.length === 0,
            required: false,
            help: "Duplicates are allowed but not recommended."
        },
        {
            label: "Enhanced Step 2 test mode is acknowledged",
            pass: elements.testModeCheck.checked,
            required: false,
            help: "Run --test first so one file validates before full download."
        }
    ];

    const requiredTotal = requirements.filter((item) => item.required).length;
    const requiredPassed = requirements.filter((item) => item.required && item.pass).length;
    const readiness = Math.round((requiredPassed / requiredTotal) * 100);

    return {
        idState,
        cookieState,
        medusaAuthState,
        requirements,
        requiredTotal,
        requiredPassed,
        readiness
    };
}

function makeRequirementItem({ label, help, pass, required }) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.classList.add("dot");

    if (pass) {
        dot.classList.add("dot-pass");
    } else if (required) {
        dot.classList.add("dot-fail");
    } else {
        dot.classList.add("dot-warn");
    }

    const copy = document.createElement("div");
    copy.className = "req-copy";

    const title = document.createElement("strong");
    title.textContent = label;

    const details = document.createElement("span");
    details.textContent = help;

    copy.appendChild(title);
    copy.appendChild(document.createElement("br"));
    copy.appendChild(details);

    li.appendChild(dot);
    li.appendChild(copy);

    return li;
}

function renderRequirements(requirementState) {
    elements.requirementsList.innerHTML = "";
    requirementState.requirements.forEach((item) => {
        elements.requirementsList.appendChild(makeRequirementItem(item));
    });
}

function updateStats(requirementState) {
    const { idState, readiness, requiredPassed, requiredTotal } = requirementState;

    elements.validIdCount.textContent = String(idState.validIds.length);
    elements.invalidLineCount.textContent = String(idState.invalidLines.length);
    elements.requiredPassCount.textContent = `${requiredPassed} / ${requiredTotal}`;
    elements.readinessPct.textContent = `${readiness}%`;
    elements.readinessBar.style.width = `${readiness}%`;

    const previewLines = idState.validIds.slice(0, 40);
    elements.idsPreview.textContent = previewLines.length
        ? `${previewLines.join("\n")}${idState.validIds.length > 40 ? "\n..." : ""}`
        : "No valid IDs yet.";

    if (idState.invalidLines.length === 0) {
        elements.readinessText.textContent = "No syntax issues detected in the IDs list.";
    } else {
        const invalidList = idState.invalidLines.slice(0, 3)
            .map((item) => `line ${item.line}: ${item.value}`)
            .join(" | ");
        elements.readinessText.textContent = `Invalid entries detected (${idState.invalidLines.length}): ${invalidList}`;
    }

    if (readiness === 100) {
        elements.connectionBadge.textContent = "Ready";
        elements.connectionBadge.classList.remove("badge-offline");
        elements.connectionBadge.classList.add("badge-ready");
    } else {
        elements.connectionBadge.textContent = "Not ready";
        elements.connectionBadge.classList.remove("badge-ready");
        elements.connectionBadge.classList.add("badge-offline");
    }
}

function setStatus(message, kind) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = "status";

    if (kind === "ok") {
        elements.statusMessage.classList.add("status-ok");
        return;
    }

    if (kind === "warn") {
        elements.statusMessage.classList.add("status-warn");
        return;
    }

    if (kind === "bad") {
        elements.statusMessage.classList.add("status-bad");
        return;
    }

    elements.statusMessage.classList.add("status-neutral");
}

function setRunStatus(message, kind) {
    elements.runStatus.textContent = message;
    elements.runStatus.className = "status";

    if (kind === "ok") {
        elements.runStatus.classList.add("status-ok");
        return;
    }

    if (kind === "warn") {
        elements.runStatus.classList.add("status-warn");
        return;
    }

    if (kind === "bad") {
        elements.runStatus.classList.add("status-bad");
        return;
    }

    elements.runStatus.classList.add("status-neutral");
}

function refreshDashboard() {
    const state = buildRequirementState();
    renderRequirements(state);
    updateStats(state);
    setRunButtonsState();
    return state;
}

function getSettingsSnapshot() {
    return {
        cookie: buildCookieFromInputs(),
        medusaJwt: normalizeJwtValue(elements.jwtInput.value),
        medusaPublishableKey: normalizePublishableKeyValue(elements.publishableKeyInput.value),
        modelIdsText: elements.idsInput.value,
        downloadRoot: elements.downloadRootInput.value,
        testModeCheck: elements.testModeCheck.checked,
        basePath: elements.basePathInput.value,
        extractInPlace: elements.extractModeSelect.value === "true",
        jsonPath: elements.jsonPathInput.value,
        foldersPath: elements.foldersPathInput.value,
        namingFormat: elements.namingFormatSelect.value,
        maxNameLength: elements.maxLengthInput.value
    };
}

function applySettingsToForm(settings) {
    if (!settings || typeof settings !== "object") {
        return;
    }

    settingsApplyInProgress = true;

    if (typeof settings.cookie === "string" && settings.cookie.trim()) {
        const parts = parseLegacyCookie(settings.cookie);
        elements.phpSessidInput.value = parts.phpSessid;
        elements.cfClearanceInput.value = parts.cfClearance;
    }
    if (typeof settings.medusaJwt === "string") {
        elements.jwtInput.value = normalizeJwtValue(settings.medusaJwt);
    }
    if (typeof settings.medusaPublishableKey === "string") {
        elements.publishableKeyInput.value = normalizePublishableKeyValue(settings.medusaPublishableKey);
    }
    const modelIdsText = typeof settings.modelIdsText === "string"
        ? settings.modelIdsText
        : elements.idsInput.value;
    setModelIdEntriesFromText(modelIdsText);
    elements.downloadRootInput.value = typeof settings.downloadRoot === "string" ? settings.downloadRoot : elements.downloadRootInput.value;
    elements.testModeCheck.checked = typeof settings.testModeCheck === "boolean"
        ? settings.testModeCheck
        : elements.testModeCheck.checked;

    if (typeof settings.basePath === "string" && settings.basePath) {
        elements.basePathInput.value = settings.basePath;
    }
    if (typeof settings.extractInPlace === "boolean") {
        elements.extractModeSelect.value = settings.extractInPlace ? "true" : "false";
    }
    if (typeof settings.jsonPath === "string" && settings.jsonPath) {
        elements.jsonPathInput.value = settings.jsonPath;
    }
    if (typeof settings.foldersPath === "string" && settings.foldersPath) {
        elements.foldersPathInput.value = settings.foldersPath;
    }
    if (settings.namingFormat === "NAME_ONLY" || settings.namingFormat === "ID_NAME") {
        elements.namingFormatSelect.value = settings.namingFormat;
    }
    if (settings.maxNameLength !== undefined && settings.maxNameLength !== null) {
        elements.maxLengthInput.value = String(settings.maxNameLength);
    }

    settingsApplyInProgress = false;
    refreshDashboard();
}

async function saveSettingsNow() {
    if (!mmfDesktopApi || !mmfDesktopApi.saveSettings || settingsApplyInProgress) {
        return;
    }

    try {
        await mmfDesktopApi.saveSettings(getSettingsSnapshot());
    } catch (_error) {
        // Ignore transient persistence errors; the UI should remain usable.
    }
}

function scheduleSettingsSave() {
    if (!mmfDesktopApi || !mmfDesktopApi.saveSettings || settingsApplyInProgress) {
        return;
    }

    if (settingsSaveTimer) {
        clearTimeout(settingsSaveTimer);
    }

    settingsSaveTimer = setTimeout(() => {
        settingsSaveTimer = null;
        saveSettingsNow();
    }, 400);
}

async function loadSavedSettings() {
    if (!mmfDesktopApi || !mmfDesktopApi.loadSettings) {
        return;
    }

    try {
        const settings = await mmfDesktopApi.loadSettings();
        applySettingsToForm(settings);
    } catch (_error) {
        // Ignore settings load errors; defaults and manual input still work.
    }
}

function setRunButtonsState() {
    const running = Boolean(activeRunId) || pipelineRunning;

    const readinessState = buildRequirementState();
    const readinessReady = readinessState.readiness === 100;
    const readinessHint = "Complete required checks first (5/5) to unlock this action.";

    [elements.runExecuteBtn, elements.runStep1Btn].forEach((button) => {
        if (!button) {
            return;
        }

        button.disabled = running || !readinessReady;
        button.title = !readinessReady ? readinessHint : "";
    });

    [
        elements.runStep2TestBtn,
        elements.runStep2FullBtn,
        elements.runStep3Btn,
        elements.runStep4Btn,
        elements.runPostProcessBtn
    ].forEach((button) => {
        if (!button) {
            return;
        }

        button.disabled = running;
        button.title = "";
    });

    elements.stopRunBtn.disabled = !running;
}

function appendRunLog(text, stream = "stdout") {
    if (!text) {
        return;
    }

    const existing = elements.runLog.textContent === "Run log will appear here." ? "" : elements.runLog.textContent;
    const prefix = stream === "stderr" ? "[stderr] " : "";
    const incoming = text.endsWith("\n") ? text : `${text}\n`;
    const combined = `${existing}${prefix}${incoming}`;
    const trimmed = combined.length > 120000 ? combined.slice(combined.length - 120000) : combined;

    elements.runLog.textContent = trimmed;
    elements.runLog.scrollTop = elements.runLog.scrollHeight;
}

function clearRunLog() {
    elements.runLog.textContent = "Run log will appear here.";
}

function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    document.execCommand("copy");
    helper.remove();
}

async function autoLoadOwnModelIds() {
    if (!mmfDesktopApi || !mmfDesktopApi.resolveOwnModelIds) {
        setStatus("Auto-load is available only in desktop mode.", "warn");
        return;
    }

    if (modelIdEntries.length > 0) {
        const confirmed = window.confirm("Replace current Model IDs with your auto-loaded IDs?");
        if (!confirmed) {
            setStatus("Auto-load canceled.", "warn");
            return;
        }
    }

    const button = elements.autoLoadMyIdsBtn;
    const previousLabel = button ? button.textContent : "";

    if (button) {
        button.disabled = true;
        button.textContent = "Loading...";
    }

    setStatus("Resolving your mmf_id and loading your own catalog IDs...", "neutral");

    try {
        const response = await mmfDesktopApi.resolveOwnModelIds({
            cookie: buildCookieFromInputs(),
            medusaJwt: normalizeJwtValue(elements.jwtInput.value),
            medusaPublishableKey: normalizePublishableKeyValue(elements.publishableKeyInput.value)
        });

        if (!response || !response.ok) {
            setStatus(response && response.message ? response.message : "Failed to auto-load your IDs.", "bad");
            return;
        }

        const normalizedIds = Array.isArray(response.ids)
            ? response.ids
                .map((id) => String(id || "").trim())
                .filter((id) => /^\d+$/.test(id))
            : [];

        if (normalizedIds.length === 0) {
            setStatus(
                `No creator-owned IDs found for mmf_id ${response.mmfId || "unknown"} in objectPreviews.`,
                "warn"
            );
            return;
        }

        setModelIdEntriesFromText(`${normalizedIds.join("\n")}\n`);
        refreshDashboard();
        scheduleSettingsSave();

        setStatus(
            `Loaded ${normalizedIds.length} IDs from your own catalog (mmf_id ${response.mmfId}).`,
            "ok"
        );
    } catch (err) {
        setStatus(`Auto-load failed: ${String(err?.message || err)}`, "bad");
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = previousLabel || "Auto load my IDs";
        }
    }
}

function buildCommandPlan() {
    const downloadsPath = getActiveDownloadsPath() || "<your-download-folder>";

    return [
        "# Run from repository root",
        "bash 1_mmf_download_metadata.sh",
        "",
        "# Then run Step 2 from selected download folder",
        `cd \"${downloadsPath}\"`,
        "bash ../mmf_download_stl_files_enhanced.sh --test",
        "bash ../mmf_download_stl_files_enhanced.sh",
        "",
        "# Step 2 output per model: model_<id>.json (compact) + <model_name>.zip + images/"
    ].join("\n");
}

function buildPostProcessSnippet() {
    const maxLength = Number.parseInt(elements.maxLengthInput.value, 10);
    const safeLength = Number.isNaN(maxLength) ? 80 : Math.max(10, Math.min(160, maxLength));

    if (runtimePlatform === "win32") {
        return [
            "# 3_extract_all_zips.ps1",
            `$BASE_PATH = \"${elements.basePathInput.value.trim()}\"`,
            `$EXTRACT_IN_PLACE = $${elements.extractModeSelect.value}`,
            "",
            "# 4_rename_folders_from_json.ps1",
            `$JSON_PATH = \"${elements.jsonPathInput.value.trim()}\"`,
            `$FOLDERS_PATH = \"${elements.foldersPathInput.value.trim()}\"`,
            `$NAMING_FORMAT = \"${elements.namingFormatSelect.value}\"`,
            `$MAX_NAME_LENGTH = ${safeLength}`
        ].join("\n");
    }

    return [
        "# 3_extract_all_zips.sh",
        `export MMF_BASE_PATH=\"${elements.basePathInput.value.trim()}\"`,
        `export MMF_EXTRACT_IN_PLACE=\"${elements.extractModeSelect.value}\"`,
        "bash 3_extract_all_zips.sh",
        "",
        "# 4_rename_folders_from_json.sh",
        `export MMF_JSON_PATH=\"${elements.jsonPathInput.value.trim()}\"`,
        `export MMF_FOLDERS_PATH=\"${elements.foldersPathInput.value.trim()}\"`,
        `export MMF_NAMING_FORMAT=\"${elements.namingFormatSelect.value}\"`,
        `export MMF_MAX_NAME_LENGTH=\"${safeLength}\"`,
        "bash 4_rename_folders_from_json.sh"
    ].join("\n");
}

function getActiveDownloadsPath() {
    const fromInput = elements.downloadRootInput && elements.downloadRootInput.value
        ? elements.downloadRootInput.value.trim()
        : "";

    if (fromInput) {
        return fromInput;
    }

    if (runtimeInfoCache && runtimeInfoCache.downloadsPath) {
        return runtimeInfoCache.downloadsPath;
    }

    return "";
}

function getActiveStlFilesPath() {
    const downloadsPath = getActiveDownloadsPath();
    if (downloadsPath) {
        if (downloadsPath.endsWith("\\") || downloadsPath.endsWith("/")) {
            return `${downloadsPath}stl_files`;
        }

        const separator = downloadsPath.includes("\\") && !downloadsPath.includes("/") ? "\\" : "/";
        return `${downloadsPath}${separator}stl_files`;
    }

    if (runtimeInfoCache && runtimeInfoCache.stlFilesPath) {
        return runtimeInfoCache.stlFilesPath;
    }

    return "";
}

async function openPathFromUi(pathValue, label) {
    const targetPath = (pathValue || "").trim();
    if (!targetPath) {
        setStatus(`${label} is empty. Select a folder first.`, "warn");
        return;
    }

    if (!mmfDesktopApi || !mmfDesktopApi.openPath) {
        setStatus("Open folder action is available only in desktop mode.", "warn");
        return;
    }

    try {
        const result = await mmfDesktopApi.openPath({ path: targetPath });
        if (result && result.ok) {
            setStatus(`${label} opened.`, "ok");
            return;
        }

        setStatus(result && result.message ? result.message : `Failed to open ${label}.`, "bad");
    } catch (err) {
        setStatus(`Failed to open ${label}: ${String(err?.message || err)}`, "bad");
    }
}

function setJsonViewerMessage(message) {
    if (!elements.jsonViewer) {
        return;
    }

    elements.jsonViewer.textContent = message;
}

async function loadSelectedModelJson() {
    if (!elements.jsonFileSelect) {
        return;
    }

    const selected = elements.jsonFileSelect.value;
    if (!selected) {
        setJsonViewerMessage("No model JSON selected yet.");
        return;
    }

    if (!mmfDesktopApi || !mmfDesktopApi.readModelJsonFile) {
        setJsonViewerMessage("JSON viewer requires desktop mode.");
        return;
    }

    try {
        const response = await mmfDesktopApi.readModelJsonFile({
            downloadRoot: getActiveDownloadsPath(),
            fileName: selected
        });

        if (!response || !response.ok) {
            const message = response && response.message ? response.message : "Unable to read selected JSON file.";
            setJsonViewerMessage(message);
            return;
        }

        setJsonViewerMessage(response.prettyJson || "Empty JSON file.");
    } catch (err) {
        setJsonViewerMessage(`Unable to read selected JSON file: ${String(err?.message || err)}`);
    }
}

async function refreshModelJsonList() {
    if (!elements.jsonFileSelect) {
        return;
    }

    if (!mmfDesktopApi || !mmfDesktopApi.listModelJsonFiles) {
        elements.jsonFileSelect.innerHTML = "";
        setJsonViewerMessage("JSON viewer requires desktop mode.");
        return;
    }

    const previousSelection = elements.jsonFileSelect.value;

    try {
        const response = await mmfDesktopApi.listModelJsonFiles({
            downloadRoot: getActiveDownloadsPath()
        });

        const files = response && Array.isArray(response.files) ? response.files : [];
        elements.jsonFileSelect.innerHTML = "";

        if (files.length === 0) {
            const emptyOption = document.createElement("option");
            emptyOption.value = "";
            emptyOption.textContent = "No model_*.json files found";
            elements.jsonFileSelect.appendChild(emptyOption);
            setJsonViewerMessage("No model JSON files found in the selected download folder yet.");
            return;
        }

        files.forEach((file) => {
            const option = document.createElement("option");
            option.value = file.name;
            option.textContent = `${file.id} (${file.name})`;
            elements.jsonFileSelect.appendChild(option);
        });

        const hasPreviousSelection = files.some((file) => file.name === previousSelection);
        elements.jsonFileSelect.value = hasPreviousSelection ? previousSelection : files[0].name;

        await loadSelectedModelJson();
    } catch (err) {
        elements.jsonFileSelect.innerHTML = "";
        const fallbackOption = document.createElement("option");
        fallbackOption.value = "";
        fallbackOption.textContent = "Unable to load JSON list";
        elements.jsonFileSelect.appendChild(fallbackOption);
        setJsonViewerMessage(`Unable to load JSON list: ${String(err?.message || err)}`);
    }
}

function updatePathHelperHint() {
    if (!elements.pathHelperHint) {
        return;
    }

    const basePath = elements.basePathInput.value.trim();
    const jsonPath = elements.jsonPathInput.value.trim();
    const foldersPath = elements.foldersPathInput.value.trim();
    const downloadRoot = getActiveDownloadsPath();

    if (downloadRoot) {
        elements.pathHelperHint.textContent = `Selected download folder: ${downloadRoot}`;
        if (basePath && jsonPath && foldersPath) {
            elements.pathHelperHint.textContent += " | BASE_PATH/FOLDERS_PATH should usually be stl_files under this folder.";
        }
        return;
    }

    if (runtimeInfoCache && runtimeInfoCache.downloadsPath && runtimeInfoCache.stlFilesPath) {
        elements.pathHelperHint.textContent = `Recommended now: JSON_PATH = ${runtimeInfoCache.downloadsPath} | BASE_PATH/FOLDERS_PATH = ${runtimeInfoCache.stlFilesPath}`;
        return;
    }

    elements.pathHelperHint.textContent = "Tip: use your downloads and stl_files folders. You can click Browse to pick folders.";
}

function applyRecommendedPaths(force = false) {
    if (!runtimeInfoCache) {
        return false;
    }

    let changed = false;

    if (force || !elements.basePathInput.value.trim()) {
        elements.basePathInput.value = getActiveStlFilesPath() || elements.basePathInput.value;
        changed = true;
    }

    if (force || !elements.jsonPathInput.value.trim()) {
        elements.jsonPathInput.value = getActiveDownloadsPath() || elements.jsonPathInput.value;
        changed = true;
    }

    if (force || !elements.foldersPathInput.value.trim()) {
        elements.foldersPathInput.value = getActiveStlFilesPath() || elements.foldersPathInput.value;
        changed = true;
    }

    updatePathHelperHint();
    return changed;
}

async function pickDirectoryInto(inputElement, title) {
    if (!inputElement) {
        return "";
    }

    if (!mmfDesktopApi || !mmfDesktopApi.pickDirectory) {
        setStatus("Folder picker is available only in desktop mode.", "warn");
        return "";
    }

    try {
        const result = await mmfDesktopApi.pickDirectory({
            title,
            defaultPath: inputElement.value || (runtimeInfoCache && runtimeInfoCache.scriptRoot) || ""
        });

        if (!result || result.canceled || !result.path) {
            return "";
        }

        inputElement.value = result.path;
        updatePathHelperHint();
        scheduleSettingsSave();
        setStatus(`${title} selected.`, "ok");
        return result.path;
    } catch (err) {
        setStatus(`Unable to open folder picker: ${String(err?.message || err)}`, "bad");
        return "";
    }
}

function renderDependencySummary(summary) {
    elements.depList.innerHTML = "";

    summary.dependencies.forEach((dep) => {
        const li = document.createElement("li");

        const dot = document.createElement("span");
        dot.classList.add("dot", dep.installed ? "dot-pass" : dep.required ? "dot-fail" : "dot-warn");

        const copy = document.createElement("div");
        copy.className = "req-copy";

        const title = document.createElement("strong");
        title.textContent = dep.displayName;

        const details = document.createElement("span");
        const status = dep.installed ? "installed" : dep.required ? "missing" : "optional missing";
        const version = dep.version ? ` (version: ${dep.version})` : "";
        details.textContent = `${status}${version}`;

        copy.appendChild(title);
        copy.appendChild(document.createElement("br"));
        copy.appendChild(details);

        li.appendChild(dot);
        li.appendChild(copy);
        elements.depList.appendChild(li);
    });

    if (summary.missingRequired.length === 0) {
        elements.depSummary.textContent = "All required dependencies are installed.";
        elements.depInstallBtn.disabled = true;
        elements.depSkipBtn.textContent = "Continue";
        return;
    }

    const installHint = summary.canInstall
        ? `Auto-install available via ${summary.installMethod}.`
        : "Auto-install tool is not available on this system.";
    elements.depSummary.textContent = `${summary.missingRequired.length} required dependency(ies) are missing. ${installHint}`;
    elements.depInstallBtn.disabled = false;
    elements.depSkipBtn.textContent = "Continue without install";
}

async function runDependencyCheck() {
    if (!mmfDesktopApi) {
        elements.desktopGate.classList.add("hidden");
        setStatus("Browser mode: desktop dependency checks are disabled.", "warn");
        return;
    }

    elements.depSummary.textContent = "Checking dependencies...";
    elements.depLog.textContent = "No installer output yet.";
    elements.depRefreshBtn.disabled = true;
    elements.depInstallBtn.disabled = true;

    try {
        const summary = await mmfDesktopApi.checkDependencies();
        lastDependencySummary = summary;
        renderDependencySummary(summary);

        if (summary.missingRequired.length === 0) {
            setStatus("Desktop dependencies are ready.", "ok");
            elements.desktopGate.classList.add("hidden");
        } else {
            setStatus("Missing desktop dependencies detected. Install or continue manually.", "warn");
            elements.desktopGate.classList.remove("hidden");
        }
    } catch (err) {
        elements.depSummary.textContent = "Dependency check failed.";
        elements.depLog.textContent = String(err?.message || err);
        setStatus("Dependency check failed. Use Refresh check or continue manually.", "bad");
        elements.desktopGate.classList.remove("hidden");
    } finally {
        elements.depRefreshBtn.disabled = false;
        if (lastDependencySummary && lastDependencySummary.missingRequired.length > 0) {
            elements.depInstallBtn.disabled = false;
        }
    }
}

async function installMissingDependencies() {
    if (!mmfDesktopApi) {
        return;
    }

    if (!lastDependencySummary || lastDependencySummary.missingRequired.length === 0) {
        setStatus("No missing required dependencies to install.", "ok");
        return;
    }

    const confirmed = window.confirm("Install missing dependencies now? This may trigger UAC prompts.");
    if (!confirmed) {
        setStatus("Dependency installation canceled by user.", "warn");
        return;
    }

    elements.depInstallBtn.disabled = true;
    elements.depRefreshBtn.disabled = true;
    elements.depSummary.textContent = "Installing missing dependencies...";
    elements.depLog.textContent = "Running installer commands...";

    try {
        const result = await mmfDesktopApi.installMissingDependencies();
        elements.depLog.textContent = result.log || "Install command finished with no output.";

        if (result.success) {
            setStatus("Dependency installation finished. Revalidating...", "ok");
        } else {
            setStatus("Some dependency installs failed. Review log and retry.", "bad");
        }

        await runDependencyCheck();
    } catch (err) {
        elements.depLog.textContent = String(err?.message || err);
        setStatus("Dependency installation crashed. Review log and retry.", "bad");
    } finally {
        elements.depInstallBtn.disabled = false;
        elements.depRefreshBtn.disabled = false;
    }
}

async function loadRuntimeInfo() {
    if (!mmfDesktopApi || !mmfDesktopApi.getRuntimeInfo) {
        elements.runtimePath.textContent = "Execution root: browser preview mode";
        updatePathHelperHint();
        return;
    }

    try {
        const runtime = await mmfDesktopApi.getRuntimeInfo({
            downloadRoot: getActiveDownloadsPath()
        });
        runtimeInfoCache = runtime;
        runtimePlatform = runtime.platform || "unknown";
        elements.runtimePath.textContent = `Execution root: ${runtime.scriptRoot} (${runtimePlatform}) | download folder: ${runtime.downloadsPath}`;

        applyRecommendedPaths(false);
    } catch (err) {
        elements.runtimePath.textContent = `Execution root: unavailable (${String(err?.message || err)})`;
    } finally {
        updatePathHelperHint();
    }
}

function collectExecutionConfig() {
    return {
        cookie: buildCookieFromInputs(),
        medusaJwt: normalizeJwtValue(elements.jwtInput.value),
        medusaPublishableKey: normalizePublishableKeyValue(elements.publishableKeyInput.value),
        modelIdsText: elements.idsInput.value,
        downloadRoot: elements.downloadRootInput.value,
        basePath: elements.basePathInput.value,
        extractInPlace: elements.extractModeSelect.value === "true",
        jsonPath: elements.jsonPathInput.value,
        foldersPath: elements.foldersPathInput.value,
        namingFormat: elements.namingFormatSelect.value,
        maxNameLength: elements.maxLengthInput.value
    };
}

function validateBeforeRun(stepKey) {
    const state = buildRequirementState();

    if (stepKey === "step1") {
        if (!state.cookieState.hasPhpSession || !state.cookieState.hasCfClearance) {
            return "Step 1 requires both PHPSESSID and cf_clearance.";
        }
        if (!state.idState.validIds.length) {
            return "Step 1 requires at least one model ID.";
        }
        if (state.idState.invalidLines.length > 0) {
            return "Fix invalid ID lines before running Step 1.";
        }
    }

    if (stepKey === "step2-test" || stepKey === "step2-full") {
        if (!state.cookieState.hasPhpSession || !state.cookieState.hasCfClearance) {
            return "Step 2 requires both PHPSESSID and cf_clearance.";
        }
    }

    return "";
}

async function startWorkflowStep(stepKey, label, options = {}) {
    const silent = options && options.silent === true;

    if (!mmfDesktopApi || !mmfDesktopApi.startWorkflowStep) {
        if (!silent) {
            setRunStatus("Desktop execution is unavailable in browser mode.", "bad");
        }
        return {
            accepted: false,
            message: "Desktop execution is unavailable in browser mode."
        };
    }

    if (activeRunId) {
        if (!silent) {
            setRunStatus("Another workflow step is already running.", "warn");
        }
        return {
            accepted: false,
            message: "Another workflow step is already running."
        };
    }

    const validationError = validateBeforeRun(stepKey);
    if (validationError) {
        if (!silent) {
            setRunStatus(validationError, "bad");
        }
        return {
            accepted: false,
            message: validationError
        };
    }

    await saveSettingsNow();

    if (!silent) {
        setRunStatus(`Starting ${label}...`, "neutral");
    }

    try {
        const response = await mmfDesktopApi.startWorkflowStep({
            stepKey,
            config: collectExecutionConfig()
        });

        if (!response.accepted) {
            if (!silent) {
                setRunStatus(response.message || "Failed to start workflow step.", "bad");
            }
            return response;
        }

        activeRunId = response.runId;
        latestRunId = response.runId;
        setRunButtonsState();
        appendRunLog(`[start] ${response.label}`);
        appendRunLog(`[command] ${response.commandLine}`);
        appendRunLog(`[cwd] ${response.cwd}`);

        if (Array.isArray(response.warnings) && response.warnings.length > 0) {
            response.warnings.forEach((warning) => {
                appendRunLog(`[warning] ${warning}`, "stderr");
            });
        }

        if (!silent) {
            setRunStatus(`${label} started.`, "ok");
        }

        return response;
    } catch (err) {
        const message = `Failed to start ${label}: ${String(err?.message || err)}`;
        if (!silent) {
            setRunStatus(message, "bad");
        }
        return {
            accepted: false,
            message
        };
    }
}

function waitForRunCompletion(runId) {
    return new Promise((resolve) => {
        pendingRunResolvers.set(runId, resolve);
    });
}

async function executePipeline() {
    if (!mmfDesktopApi || !mmfDesktopApi.startWorkflowStep) {
        setRunStatus("Desktop execution is unavailable in browser mode.", "bad");
        return;
    }

    const readinessState = buildRequirementState();
    if (readinessState.readiness !== 100) {
        const failedRequired = readinessState.requirements
            .filter((item) => item.required && !item.pass)
            .map((item) => item.label);
        const details = failedRequired.length > 0
            ? failedRequired.join(" | ")
            : "Complete the required setup checks.";

        setRunStatus(`Pipeline blocked until setup is ready: ${details}`, "bad");
        setStatus(`Setup not ready: ${details}`, "bad");
        window.alert(`Pipeline blocked. Fix these checks first:\n- ${details.replace(/ \| /g, "\n- ")}`);
        return;
    }

    if (activeRunId || pipelineRunning) {
        setRunStatus("Another workflow step is already running.", "warn");
        return;
    }

    pipelineRunning = true;
    setRunButtonsState();

    const runTestStep = elements.testModeCheck.checked;
    const pipelineSteps = [
        { key: "step1", label: "Step 1" },
        ...(runTestStep ? [{ key: "step2-test", label: "Step 2 Test" }] : []),
        { key: "step2-full", label: "Step 2 Full" }
    ];

    appendRunLog("[pipeline] Starting automatic execution.");
    setRunStatus("Pipeline started.", "ok");

    try {
        for (const step of pipelineSteps) {
            const startResult = await startWorkflowStep(step.key, step.label, { silent: true });
            if (!startResult || !startResult.accepted) {
                const message = startResult && startResult.message
                    ? startResult.message
                    : `Failed to start ${step.label}.`;
                appendRunLog(`[pipeline] ${message}`, "stderr");
                setRunStatus(`Pipeline stopped: ${message}`, "bad");
                return;
            }

            appendRunLog(`[pipeline] ${step.label} launched.`);
            const outcome = await waitForRunCompletion(startResult.runId);

            if (!outcome) {
                appendRunLog("[pipeline] Missing run completion event.", "stderr");
                setRunStatus("Pipeline stopped unexpectedly.", "bad");
                return;
            }

            if (outcome.type === "completed" && outcome.success) {
                appendRunLog(`[pipeline] ${step.label} completed successfully.`);
                continue;
            }

            if (outcome.type === "stopped") {
                appendRunLog(`[pipeline] ${step.label} was stopped by user.`, "stderr");
                setRunStatus("Pipeline stopped by user.", "warn");
                return;
            }

            appendRunLog(`[pipeline] ${step.label} failed.`, "stderr");
            setRunStatus(`Pipeline failed at ${step.label}.`, "bad");
            return;
        }

        appendRunLog("[pipeline] All pipeline steps finished successfully.");
        setRunStatus("Pipeline completed successfully.", "ok");
    } finally {
        pipelineRunning = false;
        setRunButtonsState();
    }
}

async function executePostProcessFromHelper() {
    if (!mmfDesktopApi || !mmfDesktopApi.startWorkflowStep) {
        setRunStatus("Desktop execution is unavailable in browser mode.", "bad");
        return;
    }

    if (activeRunId || pipelineRunning) {
        setRunStatus("Another workflow step is already running.", "warn");
        return;
    }

    await saveSettingsNow();

    pipelineRunning = true;
    setRunButtonsState();
    appendRunLog("[post] Starting optional Step 3 + Step 4 execution.");
    setRunStatus("Running optional Step 3 + Step 4...", "ok");

    const postSteps = [
        { key: "step3", label: "Step 3" },
        { key: "step4", label: "Step 4" }
    ];

    try {
        for (const step of postSteps) {
            const startResult = await startWorkflowStep(step.key, step.label, { silent: true });
            if (!startResult || !startResult.accepted) {
                const message = startResult && startResult.message
                    ? startResult.message
                    : `Failed to start ${step.label}.`;
                appendRunLog(`[post] ${message}`, "stderr");
                setRunStatus(`Optional flow stopped: ${message}`, "bad");
                return;
            }

            appendRunLog(`[post] ${step.label} launched.`);
            const outcome = await waitForRunCompletion(startResult.runId);

            if (!outcome) {
                appendRunLog("[post] Missing run completion event.", "stderr");
                setRunStatus("Optional flow stopped unexpectedly.", "bad");
                return;
            }

            if (outcome.type === "completed" && outcome.success) {
                appendRunLog(`[post] ${step.label} completed successfully.`);
                continue;
            }

            if (outcome.type === "stopped") {
                appendRunLog(`[post] ${step.label} was stopped by user.`, "stderr");
                setRunStatus("Optional flow stopped by user.", "warn");
                return;
            }

            appendRunLog(`[post] ${step.label} failed.`, "stderr");
            setRunStatus(`Optional flow failed at ${step.label}.`, "bad");
            return;
        }

        appendRunLog("[post] Optional Step 3 + Step 4 completed successfully.");
        setRunStatus("Optional Step 3 + Step 4 completed successfully.", "ok");
    } finally {
        pipelineRunning = false;
        setRunButtonsState();
    }
}

async function stopWorkflowStep() {
    if (!mmfDesktopApi || !mmfDesktopApi.stopWorkflowStep) {
        setRunStatus("Desktop execution is unavailable in browser mode.", "bad");
        return;
    }

    if (!activeRunId) {
        setRunStatus("No active run to stop.", "warn");
        return;
    }

    try {
        const result = await mmfDesktopApi.stopWorkflowStep();
        if (result.stopped) {
            setRunStatus("Stop requested. Waiting for process to exit...", "warn");
            return;
        }

        setRunStatus(result.message || "Unable to stop run.", "bad");
    } catch (err) {
        setRunStatus(`Stop request failed: ${String(err?.message || err)}`, "bad");
    }
}

function handleWorkflowLog(payload) {
    if (!payload || !payload.runId || !payload.text) {
        return;
    }

    if (latestRunId && payload.runId !== latestRunId) {
        return;
    }

    appendRunLog(payload.text, payload.stream || "stdout");
}

function handleWorkflowState(payload) {
    if (!payload || !payload.type) {
        return;
    }

    if (payload.type === "cookie-expired") {
        elements.phpSessidInput.value = "";
        elements.cfClearanceInput.value = "";
        scheduleSettingsSave();
        appendRunLog(`[cookie] ${payload.message || "Stored cookie expired and was cleared."}`, "stderr");
        setStatus("Stored cookie expired and was cleared. Paste a fresh cookie.", "warn");
        refreshDashboard();
        return;
    }

    if (payload.runId) {
        latestRunId = payload.runId;
    }

    if (payload.type === "started") {
        activeRunId = payload.runId;
        setRunButtonsState();
        setRunStatus(`${payload.label || "Workflow step"} is running...`, "ok");
        return;
    }

    if (payload.type === "stop-requested") {
        setRunStatus("Stop requested. Waiting for process to terminate...", "warn");
        return;
    }

    if (payload.type === "stopped") {
        const waiter = pendingRunResolvers.get(payload.runId);
        if (waiter) {
            pendingRunResolvers.delete(payload.runId);
            waiter(payload);
        }

        if (activeRunId === payload.runId) {
            activeRunId = null;
        }
        setRunButtonsState();
        appendRunLog(`[stopped] Run ${payload.runId} was stopped by user.`);
        setRunStatus("Run stopped by user.", "warn");
        return;
    }

    if (payload.type === "completed") {
        const waiter = pendingRunResolvers.get(payload.runId);
        if (waiter) {
            pendingRunResolvers.delete(payload.runId);
            waiter(payload);
        }

        if (activeRunId === payload.runId) {
            activeRunId = null;
        }
        setRunButtonsState();

        const code = typeof payload.code === "number" ? payload.code : "unknown";
        appendRunLog(`[exit] Run ${payload.runId} finished with code ${code}.`);

        if (payload.success) {
            refreshModelJsonList().catch(() => {
                // Ignore viewer refresh errors after successful run.
            });
            setRunStatus(`Run completed successfully (code ${code}).`, "ok");
        } else {
            setRunStatus(`Run finished with errors (code ${code}).`, "bad");
        }
        return;
    }

    if (payload.type === "error") {
        const waiter = pendingRunResolvers.get(payload.runId);
        if (waiter) {
            pendingRunResolvers.delete(payload.runId);
            waiter(payload);
        }

        if (activeRunId === payload.runId) {
            activeRunId = null;
        }
        setRunButtonsState();
        appendRunLog(`[error] ${payload.message || "Unknown process error."}`, "stderr");
        setRunStatus("Run crashed due to process error.", "bad");
    }
}

elements.loadSampleBtn.addEventListener("click", () => {
    setModelIdEntriesFromText(`${SAMPLE_IDS.join("\n")}\n`);
    setStatus("Sample IDs loaded.", "ok");
    refreshDashboard();
    scheduleSettingsSave();
});

if (elements.autoLoadMyIdsBtn) {
    elements.autoLoadMyIdsBtn.addEventListener("click", autoLoadOwnModelIds);
}

elements.clearBtn.addEventListener("click", () => {
    elements.phpSessidInput.value = "";
    elements.cfClearanceInput.value = "";
    elements.jwtInput.value = "";
    elements.publishableKeyInput.value = "";
    setModelIdEntriesFromText("");
    elements.testModeCheck.checked = true;
    setStatus("Inputs cleared.", "neutral");
    refreshDashboard();
    scheduleSettingsSave();
});

elements.validateBtn.addEventListener("click", () => {
    const state = refreshDashboard();
    const failedRequired = state.requirements
        .filter((item) => item.required && !item.pass)
        .map((item) => item.label);

    if (state.readiness === 100) {
        const okMessage = "All required checks passed. You can continue with the workflow.";
        setStatus(okMessage, "ok");
        window.alert(okMessage);
        return;
    }

    const details = failedRequired.length > 0
        ? failedRequired.join(" | ")
        : "Review the checklist on the right.";

    setStatus(`Setup validation failed: ${details}`, "bad");
    window.alert(`Setup validation failed:\n- ${details.replace(/ \| /g, "\n- ")}`);
});

elements.downloadIdsBtn.addEventListener("click", () => {
    const state = refreshDashboard();

    if (state.idState.validIds.length === 0) {
        setStatus("Cannot export model_ids.txt: add at least one valid numeric model ID.", "bad");
        return;
    }

    if (state.idState.invalidLines.length > 0) {
        setStatus("Cannot export model_ids.txt: remove invalid lines first.", "bad");
        return;
    }

    downloadTextFile("model_ids.txt", `${state.idState.validIds.join("\n")}\n`);
    setStatus("model_ids.txt exported successfully.", "ok");
});

elements.copyCommandsBtn.addEventListener("click", async () => {
    try {
        await copyText(buildCommandPlan());
        setStatus("Command plan copied to clipboard.", "ok");
    } catch (err) {
        setStatus(`Copy failed: ${err.message}`, "bad");
    }
});

elements.generatePsBtn.addEventListener("click", () => {
    elements.psSnippet.textContent = buildPostProcessSnippet();
    setStatus("Post-process snippet generated. Use Run Step 3 + Step 4 to execute automatically.", "ok");
});

if (elements.useRecommendedPathsBtn) {
    elements.useRecommendedPathsBtn.addEventListener("click", () => {
        if (!runtimeInfoCache) {
            setStatus("Runtime paths are not loaded yet. Try again in a second.", "warn");
            return;
        }

        applyRecommendedPaths(true);
        scheduleSettingsSave();
        setStatus("Recommended paths applied.", "ok");
    });
}

if (elements.browseBasePathBtn) {
    elements.browseBasePathBtn.addEventListener("click", () => {
        pickDirectoryInto(elements.basePathInput, "Select BASE_PATH folder");
    });
}

if (elements.browseJsonPathBtn) {
    elements.browseJsonPathBtn.addEventListener("click", () => {
        pickDirectoryInto(elements.jsonPathInput, "Select JSON_PATH folder");
    });
}

if (elements.browseFoldersPathBtn) {
    elements.browseFoldersPathBtn.addEventListener("click", () => {
        pickDirectoryInto(elements.foldersPathInput, "Select FOLDERS_PATH folder");
    });
}

if (elements.browseDownloadRootBtn) {
    elements.browseDownloadRootBtn.addEventListener("click", async () => {
        const selected = await pickDirectoryInto(elements.downloadRootInput, "Select download folder");
        if (!selected) {
            return;
        }

        await loadRuntimeInfo();
        await refreshModelJsonList();
    });
}

if (elements.openDownloadRootBtn) {
    elements.openDownloadRootBtn.addEventListener("click", () => {
        openPathFromUi(getActiveDownloadsPath(), "Download folder");
    });
}

if (elements.openFilesFolderBtn) {
    elements.openFilesFolderBtn.addEventListener("click", () => {
        const preferredPath = getActiveStlFilesPath() || getActiveDownloadsPath();
        openPathFromUi(preferredPath, "Files folder");
    });
}

if (elements.openJsonFolderBtn) {
    elements.openJsonFolderBtn.addEventListener("click", () => {
        openPathFromUi(getActiveDownloadsPath(), "JSON folder");
    });
}

if (elements.refreshJsonListBtn) {
    elements.refreshJsonListBtn.addEventListener("click", () => {
        refreshModelJsonList();
    });
}

if (elements.jsonFileSelect) {
    elements.jsonFileSelect.addEventListener("change", () => {
        loadSelectedModelJson();
    });
}

elements.copyPsBtn.addEventListener("click", async () => {
    const snippet = buildPostProcessSnippet();
    elements.psSnippet.textContent = snippet;

    try {
        await copyText(snippet);
        setStatus("Post-process snippet copied.", "ok");
    } catch (err) {
        setStatus(`Copy failed: ${err.message}`, "bad");
    }
});

elements.depRefreshBtn.addEventListener("click", runDependencyCheck);
elements.depInstallBtn.addEventListener("click", installMissingDependencies);
elements.depSkipBtn.addEventListener("click", () => {
    elements.desktopGate.classList.add("hidden");
    setStatus("Dependency install skipped. You can continue, but scripts may fail until dependencies are installed.", "warn");
});

elements.runExecuteBtn.addEventListener("click", executePipeline);
elements.runStep1Btn.addEventListener("click", () => startWorkflowStep("step1", "Step 1"));
elements.runStep2TestBtn.addEventListener("click", () => startWorkflowStep("step2-test", "Step 2 Test"));
elements.runStep2FullBtn.addEventListener("click", () => startWorkflowStep("step2-full", "Step 2 Full"));
elements.runStep3Btn.addEventListener("click", () => startWorkflowStep("step3", "Step 3"));
elements.runStep4Btn.addEventListener("click", () => startWorkflowStep("step4", "Step 4"));
if (elements.runPostProcessBtn) {
    elements.runPostProcessBtn.addEventListener("click", executePostProcessFromHelper);
}
elements.stopRunBtn.addEventListener("click", stopWorkflowStep);
elements.clearLogBtn.addEventListener("click", clearRunLog);

[elements.phpSessidInput, elements.cfClearanceInput, elements.jwtInput, elements.publishableKeyInput, elements.testModeCheck].forEach((input) => {
    input.addEventListener("input", () => {
        refreshDashboard();
        scheduleSettingsSave();
    });
    input.addEventListener("change", () => {
        refreshDashboard();
        scheduleSettingsSave();
    });
});

if (elements.downloadRootInput) {
    elements.downloadRootInput.addEventListener("input", () => {
        updatePathHelperHint();
        scheduleSettingsSave();
    });

    elements.downloadRootInput.addEventListener("change", async () => {
        updatePathHelperHint();
        scheduleSettingsSave();
        await loadRuntimeInfo();
        await refreshModelJsonList();
    });
}

[
    elements.basePathInput,
    elements.extractModeSelect,
    elements.jsonPathInput,
    elements.foldersPathInput,
    elements.namingFormatSelect,
    elements.maxLengthInput
].forEach((input) => {
    input.addEventListener("input", () => {
        updatePathHelperHint();
        scheduleSettingsSave();
    });
    input.addEventListener("change", () => {
        updatePathHelperHint();
        scheduleSettingsSave();
    });
});

if (mmfDesktopApi && mmfDesktopApi.onWorkflowLog) {
    mmfDesktopApi.onWorkflowLog(handleWorkflowLog);
}

if (mmfDesktopApi && mmfDesktopApi.onWorkflowState) {
    mmfDesktopApi.onWorkflowState(handleWorkflowState);
}

setModelIdEntriesFromText(elements.idsInput.value);
setupModelIdChipEditor();
setRunButtonsState();
refreshDashboard();
updatePathHelperHint();

Promise.resolve()
    .then(() => loadSavedSettings())
    .then(() => loadRuntimeInfo())
    .then(() => refreshModelJsonList())
    .then(() => runDependencyCheck());

})();