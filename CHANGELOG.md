# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
