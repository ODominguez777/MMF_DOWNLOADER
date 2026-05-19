const { BrowserWindow, session } = require("electron");

const MMF_PARTITION = "persist:mmf-auth";
const MMF_ORIGIN = "https://www.myminifactory.com";
const MMF_HOME_URL = "https://www.myminifactory.com/";
const MMF_LOGIN_URL = "https://www.myminifactory.com/login";
const SHOP_MANAGER_HOST = "api-shop-manager.myminifactory.com";
const PAGE_LOAD_TIMEOUT_MS = 45000;

let loginWindow = null;
let capturedPublishableKey = "";

function getMmfSession() {
    return session.fromPartition(MMF_PARTITION);
}

function ensurePublishableKeyCapture() {
    const mmfSession = getMmfSession();

    if (mmfSession.__mmfPublishableCaptureInstalled) {
        return;
    }

    mmfSession.__mmfPublishableCaptureInstalled = true;
    mmfSession.webRequest.onBeforeSendHeaders(
        { urls: [`https://${SHOP_MANAGER_HOST}/*`] },
        (details, callback) => {
            const headers = details.requestHeaders || {};
            const key = headers["x-publishable-api-key"]
                || headers["X-Publishable-Api-Key"]
                || "";

            if (key) {
                capturedPublishableKey = key;
            }

            callback({ requestHeaders: headers });
        }
    );
}

function isMmfCookieDomain(domainValue) {
    const domain = String(domainValue || "").replace(/^\./, "").toLowerCase();
    return domain === "myminifactory.com" || domain.endsWith(".myminifactory.com");
}

async function getAllMmfCookies() {
    const mmfSession = getMmfSession();
    const allCookies = await mmfSession.cookies.get({});

    return allCookies.filter((entry) => isMmfCookieDomain(entry.domain));
}

function hasSessionCookies(cookies) {
    const cookie = buildCookieHeader(cookies);
    return /(?:^|;\s*)PHPSESSID=/i.test(cookie) && /(?:^|;\s*)cf_clearance=/i.test(cookie);
}

function buildCookieHeader(cookies) {
    const byName = new Map();

    cookies.forEach((entry) => {
        if (!entry || !entry.name) {
            return;
        }

        byName.set(entry.name, entry.value);
    });

    const priority = ["PHPSESSID", "cf_clearance"];
    const parts = [];

    priority.forEach((name) => {
        if (byName.has(name)) {
            parts.push(`${name}=${byName.get(name)}`);
            byName.delete(name);
        }
    });

    byName.forEach((value, name) => {
        parts.push(`${name}=${value}`);
    });

    return parts.join("; ");
}

function profileUrlForUsername(username) {
    const normalized = String(username || "").trim();
    if (!normalized) {
        return "";
    }

    return `https://www.myminifactory.com/users/${encodeURIComponent(normalized)}`;
}

async function readLocalStorageSnapshot(webContents) {
    if (!webContents || webContents.isDestroyed()) {
        return {
            medusaJwt: "",
            username: ""
        };
    }

    try {
        const raw = await webContents.executeJavaScript(`(() => {
            const read = (key) => {
                try {
                    return localStorage.getItem(key) || "";
                } catch (_error) {
                    return "";
                }
            };

            let username = read("mmf_username") || read("username") || "";
            const pathMatch = window.location.pathname.match(/\\/users\\/([^/]+)/i);
            if (pathMatch && pathMatch[1]) {
                username = pathMatch[1];
            }

            if (!username) {
                const profileLink = document.querySelector('a[href*="/users/"]');
                if (profileLink) {
                    const linkMatch = profileLink.getAttribute("href").match(/\\/users\\/([^/?#]+)/i);
                    if (linkMatch && linkMatch[1]) {
                        username = linkMatch[1];
                    }
                }
            }

            return JSON.stringify({
                medusaJwt: read("medusa_auth_token"),
                username
            });
        })()`, true);

        const parsed = JSON.parse(raw);
        return {
            medusaJwt: typeof parsed.medusaJwt === "string" ? parsed.medusaJwt.trim() : "",
            username: typeof parsed.username === "string" ? parsed.username.trim() : ""
        };
    } catch (_error) {
        return {
            medusaJwt: "",
            username: ""
        };
    }
}

function waitForPageLoad(webContents, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
        if (!webContents || webContents.isDestroyed()) {
            resolve({ timedOut: true });
            return;
        }

        if (!webContents.isLoading()) {
            resolve({ timedOut: false });
            return;
        }

        let settled = false;

        const finish = (timedOut) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timer);
            webContents.removeListener("did-finish-load", onLoad);
            webContents.removeListener("did-stop-loading", onStop);
            resolve({ timedOut });
        };

        const onLoad = () => finish(false);
        const onStop = () => finish(false);
        const timer = setTimeout(() => finish(true), timeoutMs);

        webContents.once("did-finish-load", onLoad);
        webContents.once("did-stop-loading", onStop);
    });
}

async function readLocalStorageWithFallback() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        const currentUrl = loginWindow.webContents.getURL();
        if (currentUrl.includes("myminifactory.com")) {
            await waitForPageLoad(loginWindow.webContents);
            return readLocalStorageSnapshot(loginWindow.webContents);
        }
    }

    const tempWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            partition: MMF_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    try {
        await tempWindow.loadURL(MMF_HOME_URL);
        await waitForPageLoad(tempWindow.webContents);
        return await readLocalStorageSnapshot(tempWindow.webContents);
    } finally {
        if (!tempWindow.isDestroyed()) {
            tempWindow.close();
        }
    }
}

async function resolveMmfBrowseUrl(preferredUsername = "", options = {}) {
    const forceLogin = Boolean(options && options.forceLogin);

    if (forceLogin) {
        return {
            url: MMF_LOGIN_URL,
            mode: "login"
        };
    }

    const mmfCookies = await getAllMmfCookies();

    if (!hasSessionCookies(mmfCookies)) {
        return {
            url: MMF_LOGIN_URL,
            mode: "login"
        };
    }

    const username = String(preferredUsername || "").trim();
    if (username) {
        return {
            url: profileUrlForUsername(username),
            mode: "profile"
        };
    }

    return {
        url: MMF_HOME_URL,
        mode: "home"
    };
}

async function openMmfLoginWindow(preferredUsername = "", options = {}) {
    ensurePublishableKeyCapture();
    const target = await resolveMmfBrowseUrl(preferredUsername, options);

    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.focus();
        if (loginWindow.webContents.getURL() !== target.url) {
            loginWindow.loadURL(target.url);
        }

        return {
            ok: true,
            mode: target.mode,
            url: target.url
        };
    }

    loginWindow = new BrowserWindow({
        width: 1080,
        height: 820,
        minWidth: 900,
        minHeight: 640,
        title: target.mode === "login" ? "Sign in to MyMiniFactory" : "MyMiniFactory",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            partition: MMF_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    loginWindow.once("ready-to-show", () => {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.show();
            loginWindow.focus();
        }
    });

    loginWindow.on("closed", () => {
        loginWindow = null;
    });

    loginWindow.loadURL(target.url);

    return {
        ok: true,
        mode: target.mode,
        url: target.url
    };
}

function closeMmfLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
    }

    loginWindow = null;
}

async function clearMmfBrowserSession() {
    const mmfSession = getMmfSession();

    await mmfSession.clearStorageData();
    await mmfSession.clearCache();
    capturedPublishableKey = "";
    closeMmfLoginWindow();

    return { ok: true };
}

async function captureMmfSession() {
    ensurePublishableKeyCapture();

    const mmfCookies = await getAllMmfCookies();
    const cookie = buildCookieHeader(mmfCookies);
    const cookieNames = mmfCookies.map((entry) => entry.name).sort();

    const hasPhpSessid = /(?:^|;\s*)PHPSESSID=/i.test(cookie);
    const hasCfClearance = /(?:^|;\s*)cf_clearance=/i.test(cookie);

    if (!hasPhpSessid && !hasCfClearance && mmfCookies.length === 0) {
        const opened = await openMmfLoginWindow("", { forceLogin: true });
        return {
            ok: false,
            openedLoginWindow: true,
            message: "No MMF session found. Sign in in the window that opened, then click Capture session again.",
            cookieNames,
            browseMode: opened.mode
        };
    }

    if (!hasPhpSessid || !hasCfClearance) {
        const missing = [];
        if (!hasPhpSessid) {
            missing.push("PHPSESSID");
        }
        if (!hasCfClearance) {
            missing.push("cf_clearance");
        }

        if (!loginWindow || loginWindow.isDestroyed()) {
            await openMmfLoginWindow("", { forceLogin: true });
        } else {
            loginWindow.focus();
        }

        return {
            ok: false,
            openedLoginWindow: true,
            message: `Session incomplete. Missing: ${missing.join(", ")}. Finish login in the MMF window, then capture again.`,
            cookieNames,
            partialCookie: cookie
        };
    }

    const storage = await readLocalStorageWithFallback();

    return {
        ok: true,
        cookie,
        medusaJwt: storage.medusaJwt,
        medusaUsername: storage.username,
        medusaPublishableKey: capturedPublishableKey,
        hasMedusaJwt: Boolean(storage.medusaJwt),
        hasPublishableKey: Boolean(capturedPublishableKey),
        cookieNames,
        capturedAt: new Date().toISOString()
    };
}

async function probeMmfSessionCookies() {
    const mmfCookies = await getAllMmfCookies();
    return {
        ok: true,
        valid: hasSessionCookies(mmfCookies),
        cookieNames: mmfCookies.map((entry) => entry.name).sort()
    };
}

module.exports = {
    openMmfLoginWindow,
    closeMmfLoginWindow,
    captureMmfSession,
    clearMmfBrowserSession,
    probeMmfSessionCookies,
    getMmfSession,
    buildCookieHeader,
    getAllMmfCookies
};
