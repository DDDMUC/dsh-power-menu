# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.11] - 2026-10-19

### Added

- `install.ps1`: one-command install — cleans up a stale `link:` junction, installs from GitHub through the DSH CLI, registers `dsh-power-menu` in `dsh.profile.bundles`, and reminds you to restart DSH.
- `install.ps1 -Mirror`: install through the gh-proxy mirror when GitHub is slow or unreachable from the machine.

### Fixed

- `enable.ps1` and `install.ps1` are saved as UTF-8 with BOM, so their Chinese console messages render correctly under Windows PowerShell 5.1 instead of turning into mojibake.
- `enable.ps1` now warns when `node_modules\dsh-power-menu` is still a junction (the `link:` install shape) and prints the exact command to remove it before a plugin-manager upgrade — that junction is what makes pnpm fail with `ERR_PNPM_EPERM`, reported by the UI as "No write permission; the plugin cannot be installed".

### Docs

- README: the install section now marks the `enable.ps1` step as mandatory, adds a one-click install path, and documents the EPERM / permission error and slow-GitHub workaround.

## [0.1.10] - 2026-10-18

### Fixed

- The default export is now the full plugin object (`name`, `inject`, `apply`) instead of the bare `apply` function. The 0.1.7 default-export fix dropped the named `inject`, so Cordis unwrapped a function without `inject` and the host failed with `cannot get property "webServer" without inject`; the client menu still opened, but every action returned HTTP 404.

## [0.1.9] - 2026-10-18

### Changed

- Removed the 0.1.8 `postinstall` auto-enable. pnpm 11 blocks dependency lifecycle scripts by default (`ERR_PNPM_IGNORED_BUILDS`), so the hook did not run and could make the install exit non-zero.

### Added

- `enable.ps1`: one-click append of `dsh-power-menu` to `dsh.profile.bundles` for an already-installed plugin, with a profile backup before writing.

## [0.1.8] - 2026-10-18

### Added

- A `postinstall` hook that appends `dsh-power-menu` to `dsh.profile.bundles` when the package is installed inside a DSH profile. A fresh install now becomes usable after a restart without a separate "enable" step; link/workspace installs and non-DSH directories are left untouched. If pnpm runs with `--ignore-scripts`, the hook is skipped and the plugin still has to be enabled manually.

## [0.1.7] - 2026-10-18

### Fixed

- Added a default export for the host plugin (`export default apply`) while keeping the named exports. Some installers/loaders unwrap ESM through `default`, so a Git install could otherwise fail with `invalid plugin, expect function or object with an "apply" method, received object`.

## [0.1.6] - 2026-10-18

### Fixed

- Show the power button on the first frame of a new conversation without resizing the window. The mount now uses `useLayoutEffect` and forces a header reflow (layout read plus a next-frame `resize` event) after inserting the button.

## [0.1.5] - 2026-10-18

### Changed

- The power button now mounts at the end of `conversation.session.header.corner` in both welcome and conversation, giving the order **layout / sidebar / power**.
- Removed the `conversation.session.header.utilities` registration; the same mounted button serves both states, so there is no duplicate.

## [0.1.4] - 2026-10-18

### Fixed

- Reverted the welcome-screen fallback to a fixed-position overlay. Mounting a foreign node inside the React-managed header made the button jump whenever the header re-rendered.
- The fallback now sits to the left of the layout/sidebar pair (not between them). The positioning scan ignores the plugin's own menu items and trigger, so opening the menu no longer moves the button and the menu drops below it.

## [0.1.3] - 2026-10-18

### Changed

- The welcome-screen power button is now mounted inside the header icon row (`conversation.session.header.corner`) instead of being absolutely positioned. It participates in the same flex layout as the native icons, so it aligns and spaces naturally and the menu drops below it.
- The fallback stays fully transparent (no background or shadow).

## [0.1.2] - 2026-10-18

### Changed

- The welcome-screen fallback button is now fully transparent (no background or shadow), so custom DSH themes are not broken by a sudden colour block.
- The fallback button aligns with the first native header icon in `conversation.session.header.corner`: vertically centred, 12px to its left.

## [0.1.1] - 2026-10-18

### Fixed

- Keep the power button visible on the no-session welcome screen: a `shell.overlay` fallback renders at the top-right when the session-header button is absent, and hides as soon as the header button is present.
- Refresh the injected stylesheet when the client bundle reloads, so new CSS rules (such as the floating fallback) apply instead of being skipped by a stale `<style>` tag.

## [0.1.0] - 2026-10-18

### Added

- Power button in the DSH Desktop session header (`conversation.session.header.utilities`).
- Windows power-menu style popover with exactly two actions:
  - **关闭DSH** — quit the whole desktop app without relaunching.
  - **重启DSH** — quit and relaunch the app, waiting for the old port to free first.
- Detached helper (`lib/helper.cjs`) that ends only the Electron main process (`taskkill /F`, no `/T`) so the Host can run its own graceful shutdown and flush session logs.
- Clean-environment relaunch with retry and a failure message box.
- Loopback-only, same-origin-fenced HTTP routes:
  - `POST /api/dsh-power-menu/shutdown`
  - `POST /api/dsh-power-menu/restart`
  - `GET /api/dsh-power-menu/health`
- Keyboard and pointer interaction: `Esc`, `↑` / `↓` / `Home` / `End`, `Enter` / `Space`, outside click.
- Full-page progress overlay while the app is shutting down or restarting.
- Local diagnostics under `%USERPROFILE%\.dsh\dsh-power-menu\`.
- Static `npm run check` validation and GitHub Actions workflow.
