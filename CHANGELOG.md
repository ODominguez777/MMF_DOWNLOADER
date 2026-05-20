# Changelog

## [1.2.0] — 2026-05-19

### Added
- **Catalog load modes** (two options, both from `objectPreviews`):
  - **Listing** — models you created (`creatorId` matches your account).
  - **Library** — full data library (creations, purchases, gifts, tribes, downloads).
- Large-library catalog handling: up to 64 MB JSON response, 3-minute timeout, in-memory parsing in 400-entry chunks (UI stays responsive).
- **Resume by assets ZIP**: if a valid model archive ZIP already exists in the output folder, Step 2 skips STL/ZIP re-download for that model.
- **Readable output folders** in Step 2: `{id}_{model_name}` by default (e.g. `228967_Kell_Ombis`); respects GUI `NAMING_FORMAT` / `MAX_NAME_LENGTH`. Legacy `model_<id>` folders still work on resume.
- Card-style **Auto load source** selector in the UI.
- Catalog auto-load after **Capture session** runs silently when the model list is empty (no extra confirm dialogs).

### Fixed
- Step 2 re-downloading files after a prior run: canonical path check before `unique_output_path` (avoids `file_1.zip`, `file_2.zip` duplicates).
- Image downloads now skip existing valid files the same way as STL/ZIP.
- Cross-run idempotency when switching between Listing and Library into the same download folder (metadata JSON skip + file/ZIP skip).

### Changed
- Removed store-API-only “listing” path; Listing and Library both use `objectPreviews` with different filters.
- Step 2 receives `MMF_NAMING_FORMAT` and `MMF_MAX_NAME_LENGTH` from the desktop app (aligned with Step 4 rename settings).

## [1.1.0] — 2026-05-19

### Added
- Embedded MyMiniFactory sign-in window with **Capture session** (cookies + JWT + publishable key).
- **Check session** validation against Medusa API; session badge in the UI.
- Paginated catalog load via store API (25 items per request) with `objectPreviews` merge when applicable.
- Model list with ID + name, UI pagination (25 rows per page), remove per row.
- Auto-load catalog after successful session capture when the list is empty.
- Resume-safe downloads: skip existing metadata JSON and already-downloaded STL/ZIP files.
- Encrypted credential storage (OS keychain when available), password fields, Electron sandbox.
- Zip-slip protection on extraction; restricted “open folder” paths.

### Changed
- Application display name: **Bulk Downloader** (installer, window title, UI).
- Conservative rate limits: 6s metadata, 5s STL/ZIP, 3s images, 1s between catalog pages.
- Electron 33.x (from 31.x).
- Manual model ID input removed; catalog comes from Auto load or saved list.

### Security
- Settings file chmod 600; full session cleared on auth failure during runs.

## [1.0.0]
- Initial desktop app with workflow scripts and dependency bootstrapper.
