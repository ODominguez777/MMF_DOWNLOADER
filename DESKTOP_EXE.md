# Desktop EXE Guide

This project includes an Electron desktop app that packages the existing scripts and GUI for Windows and macOS.

## What the EXE does on startup

1. Opens a dependency gate before the main dashboard is usable.
2. Checks for required tools:
   - Bash (Git Bash)
   - curl
   - jq
3. Checks optional tools:
   - PowerShell (Windows) / pwsh (macOS)
   - winget (Windows) / Homebrew (macOS)
4. Lets the user choose:
   - Install missing dependencies (via winget on Windows, brew on macOS)
   - Continue without install

## Run workflow steps from the GUI

The desktop dashboard now executes the real scripts with live logs:

1. Execute Pipeline (Step 1 -> Step 2 Test -> Step 2 Full)
1. Run Step 1
2. Run Step 2 Test
3. Run Step 2 Full
4. Run Step 3 (optional)
5. Run Step 4 (optional)
6. Stop active run

The run log panel streams stdout and stderr from the process in real time.

## Cookie persistence behavior

- The session cookie is saved locally in app settings.
- It is reused automatically between app launches.
- If an expiration/auth error pattern is detected during Step 1/2 output, the stored cookie is cleared automatically and the UI asks for a new cookie.

The app passes configuration to scripts via environment variables:

- `MMF_COOKIE`
- `MMF_BASE_PATH`
- `MMF_EXTRACT_IN_PLACE`
- `MMF_JSON_PATH`
- `MMF_FOLDERS_PATH`
- `MMF_NAMING_FORMAT`
- `MMF_MAX_NAME_LENGTH`

## Local development

From repository root:

```powershell
npm install
npm start
```

## Build Windows installer (.exe)

From repository root:

```powershell
npm run dist:win
```

Output installer path:

- `dist\MyMiniFactory Bulk Downloader Setup 1.0.0.exe`

## Build macOS packages

From repository root:

```bash
npm run dist:mac
```

Typical outputs in `dist`:

- `*.dmg`
- `*.zip`

Note: macOS artifacts must be built on a macOS machine.

## Branding assets

- App and installer icon: `build/icon.ico`
- Source image: `build/icon.png`

## Notes about dependency installation

- Automatic install requires `winget` on Windows or `brew` on macOS.
- If installer tooling is missing, the app allows continue without install.
- Install commands can trigger UAC prompts depending on package and policy.

## Runtime files

- Electron main process: `electron/main.js`
- Preload bridge: `electron/preload.js`
- UI renderer: `gui/index.html`, `gui/app.js`, `gui/styles.css`
