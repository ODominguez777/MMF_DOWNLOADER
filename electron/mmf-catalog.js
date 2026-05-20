const MMF_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0";
const OBJECT_PREVIEWS_URL = "https://www.myminifactory.com/api/data-library/objectPreviews";
const CATALOG_LOAD_MODES = ["listing", "library"];
const PREVIEW_PROCESS_CHUNK_SIZE = 400;

function normalizeCatalogLoadMode(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    const legacyMap = {
        owned: "listing",
        library_all: "library"
    };

    if (legacyMap[normalized]) {
        return legacyMap[normalized];
    }

    return CATALOG_LOAD_MODES.includes(normalized) ? normalized : "library";
}

function extractMmfCustomerProfile(meJson) {
    const customer = meJson && typeof meJson.customer === "object" ? meJson.customer : {};
    const metadata = customer.metadata && typeof customer.metadata === "object" ? customer.metadata : {};

    const usernameCandidates = [
        metadata.mmf_username,
        metadata.username,
        customer.username,
        metadata.slug
    ];

    let username = "";
    usernameCandidates.forEach((candidate) => {
        if (!username && typeof candidate === "string" && candidate.trim()) {
            username = candidate.trim();
        }
    });

    return {
        mmfId: String(metadata.mmf_id || "").trim(),
        username
    };
}

function extractObjectIdFromUrl(urlValue) {
    if (typeof urlValue !== "string" || !urlValue) {
        return "";
    }

    const objectMatch = urlValue.match(/\/object\/(\d+)(?:\/|$)/i);
    if (objectMatch) {
        return objectMatch[1];
    }

    return "";
}

function extractCatalogItemFromPreview(preview) {
    if (!preview || typeof preview !== "object") {
        return null;
    }

    const id = String(
        preview.originalId !== undefined && preview.originalId !== null
            ? preview.originalId
            : preview.id !== undefined && preview.id !== null
                ? String(preview.id).replace(/^object-/i, "")
                : ""
    ).trim();

    if (!/^\d+$/.test(id)) {
        return null;
    }

    const name = String(preview.name || preview.title || preview.objectName || "").trim();
    return { id, name };
}

function extractCatalogItemFromStoreProduct(product) {
    if (!product || typeof product !== "object") {
        return null;
    }

    const urlCandidates = [product.absolute_url, product.url, product.obj_url];
    let id = "";

    urlCandidates.forEach((urlValue) => {
        if (!id) {
            id = extractObjectIdFromUrl(urlValue);
        }
    });

    if (!id) {
        const rawId = product.object_id !== undefined
            ? product.object_id
            : product.originalId !== undefined
                ? product.originalId
                : product.objectId;

        if (rawId !== undefined && rawId !== null) {
            const asString = String(rawId).trim();
            if (/^\d+$/.test(asString)) {
                id = asString;
            }
        }
    }

    if (!id) {
        return null;
    }

    const name = String(product.name || product.title || "").trim();
    return { id, name };
}

function mergeCatalogItems(targetMap, items, source) {
    items.forEach((item) => {
        if (!item || !/^\d+$/.test(item.id)) {
            return;
        }

        const existing = targetMap.get(item.id);
        if (!existing) {
            targetMap.set(item.id, {
                id: item.id,
                name: item.name || "",
                sources: [source]
            });
            return;
        }

        if (!existing.name && item.name) {
            existing.name = item.name;
        }

        if (!existing.sources.includes(source)) {
            existing.sources.push(source);
        }
    });
}

function parseObjectPreviewsPayload(json) {
    if (Array.isArray(json)) {
        return {
            items: json,
            total: json.length,
            page: 1,
            perPage: json.length,
            paginated: false
        };
    }

    if (!json || typeof json !== "object") {
        return {
            items: [],
            total: 0,
            page: 1,
            perPage: 0,
            paginated: false
        };
    }

    const listKeys = ["data", "items", "previews", "objects", "results"];
    let items = [];

    listKeys.forEach((key) => {
        if (items.length === 0 && Array.isArray(json[key])) {
            items = json[key];
        }
    });

    const total = Number.isFinite(Number(json.total))
        ? Number(json.total)
        : Number.isFinite(Number(json.totalCount))
            ? Number(json.totalCount)
            : items.length;

    const page = Number.isFinite(Number(json.page)) ? Number(json.page) : 1;
    const perPage = Number.isFinite(Number(json.perPage))
        ? Number(json.perPage)
        : items.length;

    const hasServerPagination = Number.isFinite(Number(json.page))
        && Number.isFinite(Number(json.perPage))
        && Number(json.perPage) > 0
        && total > items.length;

    return {
        items,
        total,
        page,
        perPage,
        paginated: hasServerPagination
    };
}

function previewMatchesLoadMode(preview, mmfId, loadMode) {
    if (loadMode === "library") {
        return true;
    }

    const creatorId = preview && preview.creatorId !== undefined && preview.creatorId !== null
        ? String(preview.creatorId).trim()
        : "";

    return Boolean(mmfId) && creatorId === mmfId;
}

function yieldToEventLoop() {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

async function mergePreviewsInChunks(collected, previews, mmfId, loadMode, onProgress) {
    const total = previews.length;
    if (total === 0) {
        return 0;
    }

    let matched = 0;

    for (let offset = 0; offset < total; offset += PREVIEW_PROCESS_CHUNK_SIZE) {
        if (offset > 0) {
            await yieldToEventLoop();
        }

        const end = Math.min(offset + PREVIEW_PROCESS_CHUNK_SIZE, total);
        const chunkItems = [];

        for (let index = offset; index < end; index += 1) {
            const preview = previews[index];
            if (!previewMatchesLoadMode(preview, mmfId, loadMode)) {
                continue;
            }

            const item = extractCatalogItemFromPreview(preview);
            if (item) {
                chunkItems.push(item);
            }
        }

        matched += chunkItems.length;
        mergeCatalogItems(collected, chunkItems, "objectPreviews");

        emitCatalogProgress(onProgress, {
            phase: "library",
            processed: end,
            total,
            collected: collected.size,
            message: `Processing library: ${end.toLocaleString()} / ${total.toLocaleString()} entries (${collected.size.toLocaleString()} unique IDs)…`
        });
    }

    return matched;
}

async function fetchJson(requestJson, url, cookie, extraHeaders = {}, requestOptions = {}) {
    return requestJson(url, {
        headers: {
            "User-Agent": MMF_USER_AGENT,
            Accept: "application/json",
            Cookie: cookie,
            ...extraHeaders
        },
        ...requestOptions
    });
}

async function fetchObjectPreviewsPage(requestJson, cookie, query = "", requestOptions = {}) {
    const suffix = query ? (query.startsWith("?") ? query : `?${query}`) : "";
    return fetchJson(requestJson, `${OBJECT_PREVIEWS_URL}${suffix}`, cookie, {}, requestOptions);
}

async function fetchAllObjectPreviews(requestJson, cookie, mmfId, loadMode, sleep, pageDelayMs, batchSize, rateLimits, onProgress) {
    const collected = new Map();
    const warnings = [];
    const largeRequestOptions = {
        maxResponseBytes: rateLimits.catalogObjectPreviewsMaxBytes || 64 * 1024 * 1024,
        timeoutMs: rateLimits.catalogObjectPreviewsTimeoutMs || 180000
    };

    emitCatalogProgress(onProgress, {
        phase: "library",
        message: "Downloading objectPreviews (data library)…"
    });

    const first = await fetchObjectPreviewsPage(requestJson, cookie, "", largeRequestOptions);
    if (first.statusCode !== 200) {
        return {
            ok: false,
            message: `objectPreviews returned HTTP ${first.statusCode}.`,
            items: [],
            warnings
        };
    }

    if (first.truncated) {
        return {
            ok: false,
            message: "objectPreviews response was truncated (library JSON exceeds size limit).",
            items: [],
            warnings
        };
    }

    if (!first.json) {
        return {
            ok: false,
            message: "objectPreviews response was not valid JSON.",
            items: [],
            warnings
        };
    }

    const parsedFirst = parseObjectPreviewsPayload(first.json);

    if (!parsedFirst.paginated && parsedFirst.items.length > 0) {
        warnings.push(
            `objectPreviews returned ${parsedFirst.items.length.toLocaleString()} entries in one response (no server pagination).`
        );
    }

    const allPreviewRows = [...parsedFirst.items];

    if (parsedFirst.paginated) {
        const totalPages = parsedFirst.perPage > 0
            ? Math.ceil((parsedFirst.total || parsedFirst.items.length) / parsedFirst.perPage)
            : 0;

        let page = parsedFirst.page + 1;
        const maxPages = totalPages > 0 ? totalPages : 400;

        while (page <= maxPages) {
            await sleep(pageDelayMs);
            emitCatalogProgress(onProgress, {
                phase: "library",
                page,
                totalPages: maxPages,
                collected: collected.size,
                message: `objectPreviews: page ${page} of ~${maxPages}…`
            });

            const response = await fetchObjectPreviewsPage(
                requestJson,
                cookie,
                `page=${page}&perPage=${batchSize}`,
                largeRequestOptions
            );

            if (response.statusCode !== 200) {
                warnings.push(`objectPreviews page ${page} returned HTTP ${response.statusCode}; stopped pagination.`);
                break;
            }

            if (response.truncated) {
                warnings.push(`objectPreviews page ${page} was truncated; stopped pagination.`);
                break;
            }

            const parsed = parseObjectPreviewsPayload(response.json);
            if (parsed.items.length === 0) {
                break;
            }

            allPreviewRows.push(...parsed.items);
            page += 1;

            if (parsed.items.length < batchSize) {
                break;
            }
        }
    }

    emitCatalogProgress(onProgress, {
        phase: "library",
        processed: 0,
        total: allPreviewRows.length,
        collected: 0,
        message: `Parsing ${allPreviewRows.length.toLocaleString()} library entries…`
    });

    const matchedRows = await mergePreviewsInChunks(collected, allPreviewRows, mmfId, loadMode, onProgress);

    if (loadMode === "listing" && matchedRows === 0 && allPreviewRows.length > 0) {
        warnings.push(
            `No library entries matched your creator ID (${mmfId}). Use “Library” to include purchases, gifts, and tribe models.`
        );
    }

    return {
        ok: true,
        items: [...collected.values()],
        rawEntryCount: allPreviewRows.length,
        matchedEntryCount: matchedRows,
        warnings
    };
}

async function fetchStoreProductsPage(requestJson, username, cookie, page, perPage, objectFlag, bundleFlag) {
    const query = new URLSearchParams({
        object: String(objectFlag),
        bundle: String(bundleFlag),
        page: String(page),
        perPage: String(perPage),
        sortBy: "position"
    });

    const url = `https://www.myminifactory.com/api/users/${encodeURIComponent(username)}/store/products?${query.toString()}`;
    return fetchJson(requestJson, url, cookie);
}

function emitCatalogProgress(onProgress, payload) {
    if (typeof onProgress === "function") {
        onProgress(payload);
    }
}

async function fetchAllStoreProducts(requestJson, username, cookie, sleep, pageDelayMs, batchSize, onProgress) {
    const collected = new Map();
    const warnings = [];
    const modes = [
        { object: 1, bundle: 0, label: "store-objects" },
        { object: 0, bundle: 1, label: "store-bundles" }
    ];

    for (const mode of modes) {
        let page = 1;
        let total = Infinity;
        let estimatedPages = null;

        while (collected.size < total) {
            if (page > 1) {
                await sleep(pageDelayMs);
            }

            emitCatalogProgress(onProgress, {
                phase: "store",
                mode: mode.label,
                page,
                totalPages: estimatedPages,
                collected: collected.size,
                message: estimatedPages
                    ? `Store listing (${mode.label}): page ${page} of ~${estimatedPages}…`
                    : `Store listing (${mode.label}): page ${page}…`
            });

            const response = await fetchStoreProductsPage(
                requestJson,
                username,
                cookie,
                page,
                batchSize,
                mode.object,
                mode.bundle
            );

            if (response.statusCode !== 200 || !response.json || typeof response.json !== "object") {
                warnings.push(`${mode.label} page ${page} returned HTTP ${response.statusCode || 0}.`);
                break;
            }

            const products = Array.isArray(response.json.products) ? response.json.products : [];
            const pageTotal = Number(response.json.totalProducts ?? response.json.total ?? 0);
            total = pageTotal > 0 ? pageTotal : collected.size + products.length;
            if (pageTotal > 0 && batchSize > 0) {
                estimatedPages = Math.ceil(pageTotal / batchSize);
            }

            const pageItems = products
                .map(extractCatalogItemFromStoreProduct)
                .filter(Boolean);

            mergeCatalogItems(collected, pageItems, mode.label);

            if (products.length === 0 || products.length < batchSize) {
                break;
            }

            page += 1;
            if (page > 500) {
                warnings.push(`${mode.label} pagination stopped after 500 pages (safety cap).`);
                break;
            }
        }
    }

    return {
        ok: collected.size > 0,
        items: [...collected.values()],
        warnings
    };
}

async function resolveOwnCatalog({
    requestJson,
    sleep,
    cookie,
    medusaJwt,
    medusaPublishableKey,
    catalogLoadMode,
    rateLimits,
    onProgress
}) {
    const loadMode = normalizeCatalogLoadMode(catalogLoadMode);
    const batchSize = rateLimits.catalogBatchSize || 100;
    const pageDelayMs = rateLimits.catalogPageDelayMs || 800;

    emitCatalogProgress(onProgress, {
        phase: "account",
        message: "Verifying MyMiniFactory account…"
    });

    const meResponse = await requestJson("https://api-shop-manager.myminifactory.com/store/customers/me", {
        headers: {
            "User-Agent": MMF_USER_AGENT,
            Accept: "application/json",
            Authorization: `Bearer ${medusaJwt}`,
            "x-publishable-api-key": medusaPublishableKey,
            Cookie: cookie
        }
    });

    if (meResponse.statusCode !== 200 || !meResponse.json || typeof meResponse.json !== "object") {
        return {
            ok: false,
            message: `/store/customers/me returned HTTP ${meResponse.statusCode}.`
        };
    }

    const profile = extractMmfCustomerProfile(meResponse.json);
    if (!profile.mmfId) {
        return {
            ok: false,
            message: "Could not read customer.metadata.mmf_id from /store/customers/me response."
        };
    }

    await sleep(rateLimits.medusaApiDelayMs || 2000);

    const merged = new Map();
    const warnings = [];
    const sourcesUsed = [];
    let libraryRawCount = 0;

    const previewsResult = await fetchAllObjectPreviews(
        requestJson,
        cookie,
        profile.mmfId,
        loadMode,
        sleep,
        pageDelayMs,
        batchSize,
        rateLimits,
        onProgress
    );

    if (!previewsResult.ok) {
        return {
            ok: false,
            message: previewsResult.message || "Failed to load objectPreviews."
        };
    }

    warnings.push(...previewsResult.warnings);
    libraryRawCount = previewsResult.rawEntryCount || 0;

    if (previewsResult.items.length > 0) {
        mergeCatalogItems(merged, previewsResult.items, "objectPreviews");
        sourcesUsed.push("objectPreviews");
    } else {
        return {
            ok: false,
            message: loadMode === "listing"
                ? `No models you created (creatorId ${profile.mmfId}) were found in your data library.`
                : "objectPreviews returned no usable model IDs."
        };
    }

    const items = [...merged.values()]
        .map((entry) => ({
            id: entry.id,
            name: entry.name || ""
        }))
        .sort((a, b) => Number(a.id) - Number(b.id));

    const ids = items.map((item) => item.id);

    const modeLabels = {
        listing: "models you created",
        library: "full data library"
    };

    emitCatalogProgress(onProgress, {
        phase: "done",
        collected: ids.length,
        message: `Catalog ready: ${ids.length.toLocaleString()} model(s) (${modeLabels[loadMode] || loadMode}).`
    });

    return {
        ok: ids.length > 0,
        mmfId: profile.mmfId,
        username: profile.username,
        catalogLoadMode: loadMode,
        items,
        ids,
        totalCount: items.length,
        ownedCount: items.length,
        libraryRawCount,
        sourcesUsed,
        warnings,
        message: ""
    };
}

module.exports = {
    resolveOwnCatalog,
    extractMmfCustomerProfile,
    normalizeCatalogLoadMode,
    CATALOG_LOAD_MODES
};
