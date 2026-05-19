# Changelog

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
