# Development and release notes

Build instructions, implementation details, verification, manual acceptance checks, and community directory submission steps for maintainers. The [README](../README.md) is the short plugin listing.

## Build and checks

Requires Node.js 20+ and pnpm; Obsidian API types are pinned to 1.13.1.

~~~sh
pnpm install --frozen-lockfile
pnpm lint
pnpm check
pnpm build
pnpm test
~~~

The optional browser fixture accepts a local Obsidian app archive, theme CSS, Chromium executable and installed Playwright module paths:

~~~sh
node tests/browser-check.cjs <obsidian.asar> <theme.css> <chrome.exe> <playwright-module> [basic]
~~~

Omit basic for the five AnuPpuccin variants; use basic for light/dark checks with Blue Topaz or another theme. An optional native ribbon check is also available:

~~~sh
node tests/native-order-check.cjs <obsidian.asar>
~~~

It reads the installed code into an isolated test harness and does not modify Obsidian. Quote paths containing spaces. The browser check reads the app/theme resources and runs temporary fixtures in a headless browser; it never operates on the live vault. It also generates preview screenshots in tests/.generated/.

main.ts manages lifecycle, declarative searchable settings and serialized settings writes; guards.ts validates unknown input; settings.ts validates and migrates state; ribbon.ts owns interaction and geometry; ribbon-items.ts preserves action labels/tooltip metadata; ribbon-order.ts synchronizes saved positions with native ribbon ordering; styles.css controls layout. No framework or runtime dependency is added. Development linting uses Obsidian’s official recommended ESLint configuration with zero warnings permitted in CI. No reported rules are disabled. The pnpm build-script allowlist permits only esbuild's platform-binary setup.

## Compatibility and cleanup

The existing action nodes, SVGs and handlers are retained. An action with no rendered content receives a temporary icon: board-labelled actions use Obsidian's Kanban icon and other empty actions use its help icon. A later native icon replaces the fallback, and unload removes it. Kanban 2.0.51 requests lucide-trello, which Obsidian 1.13.7 no longer provides. Labels come from aria-labelledby, aria-label, title or data-tooltip and are displayed with CSS pseudo-elements. Items without useful metadata remain icons. The plugin watches the ribbon for inserted/removed actions and metadata changes; externally referenced label text is also refreshed on workspace layout changes.

Ribbon order is stored as native item IDs in plugin data. On first use, the current native order is adopted after layout startup; arrange the icons once if that order is already incorrect. Both native ribbon drags and reorders in Settings → Interface → Ribbon menu configuration update the saved list after Obsidian commits the change. The latest explicit reorder from either control wins. Missing IDs retain their slots for late-loading or temporarily disabled plugins, while new IDs append. Restoration updates the native item array and calls its existing onChange(false), preserving hidden states and reordering behavior. It does not write workspace.json directly. The internal items/ribbonItemsEl/onChange structure is checked before use; ordering is skipped if it is unavailable or if another plugin inserts unmanaged rows. A plugin that changes an action ID is treated as adding a new command. Saved order applies across workspace changes; plugins that also enforce ribbon order may conflict.

A guarded wrapper delegates to the native onChange method, preserving its receiver, arguments, return value and errors. Successful onChange(true) commits update plugin data before restoration can undo them; onChange(false) startup/layout updates retain the remembered order. Settings refreshes are coalesced through the native Interface tab’s update() method after gestures settle, rebuilding cached definitions even while Settings is closed. Obsidian renders its own current page, including in a separate settings window. If the Settings API shape is unavailable, refreshing is skipped without preventing order persistence. A read-only native onChange method disables the order controller rather than partially changing native behavior.

Only pinned mode changes --ribbon-width. Hover mode widens the existing action groups and uses a positioned background and edge handle, leaving the native ribbon's flex allocation and header width unchanged. Theme colours, borders, typography and hover states use inherited styling or Obsidian variables. The native sidebar buttons remain usable.

Tooltip suppression uses Obsidian's --no-tooltip hook plus a ribbon-specific tooltip class to hide already-visible/pending ribbon tooltips. An owned cr-ribbon-expanded class on the ribbon’s document body controls the tagged tooltips; the stylesheet uses no :has selector. The body class is restored on collapse, layout replacement and unload. DOM creation uses parent createEl/createDiv/createSpan helpers and timers/constructors use the ribbon’s owning window. Browser title attributes are temporarily suppressed while expanded, with accessible-name fallback where needed. Current metadata changes from other plugins are preserved when the rail collapses or unloads.

Obsidian does not publicly expose ribbon action DOM or tooltip geometry. The implementation uses .workspace-ribbon with either .mod-left (Obsidian 1.13) or .mod-primary (1.14), plus .side-dock-actions, .side-dock-settings and .side-dock-ribbon-action. Obsidian 1.14.4 replaced the ribbon’s physical-side class with a logical-side class; version 1.2.2 restores hover and order binding for that structure. The secondary/right ribbon is excluded. Label line height follows --icon-size to keep icons aligned with the changed native sizing. DOM and CSS behavior were verified against Obsidian 1.13.7 and 1.14.4; the minimum remains 1.13.7. Themes/plugins that hide or fundamentally restructure the ribbon, implement custom tooltip systems, or transform its containing layout may need additional compatibility work. No Style Settings dependency is required.

On unload or ribbon replacement, the plugin restores its own native method descriptor (or inherited method). If another plugin has wrapped that method, its wrapper is retained and this plugin’s delegated wrapper becomes inert. It restores its attributes and CSS properties, retains external metadata changes, removes its pin/background/grip, disconnects observers and listeners, cancels timers/frames, and releases pointer capture. Resizing and normal action dragging keep the unpinned overlay open until the gesture finishes.

## Verification and live acceptance

Strict recommended lint (zero warnings/errors), TypeScript, the production build and 36 behavior tests passed on 2026-10-08. New checks cover searchable setting definitions and validated persistence, owner-document DOM helpers and independent tooltip state/cleanup across windows. New regressions cover modern primary/secondary ribbon classes, hover, pinning, resizing, late icons, native Settings commits and unload. Order checks cover both ordering controls, repeated alternation, late icons, restarts, missing IDs, hidden states, handlers, malformed API fallback, serialized persistence, settings caches, separate-document navigation/focus, method receiver/arguments/results/errors, third-party wrappers, layout replacement and cleanup.

The optional native-code fixture reads an Obsidian app archive’s ribbon class, settings page builder and settings update method using shared inspected-source helpers. It executes the actual ribbon constructor to establish its side class, verifies hover, and exercises native drag, reorder, hide/show and startup/load callbacks with a lightweight host renderer. It passed with both 1.13.7 and 1.14.4. Downloaded test archives stay in ignored tests/.generated artifacts and are never installed or packaged.

Browser fixtures using actual Obsidian 1.13.7 and 1.14.4 CSS with AnuPpuccin 1.5.0 passed all five light/dark/card/border/frame variants for each app version. Blue Topaz light/dark fixtures also passed on 1.14.4. They verify both ordering directions, cached settings definitions, native settings callbacks, a separate-document settings panel, focus/navigation and cleanup. Existing geometry checks still verify a 44 px ribbon and unchanged editor space while hovering; 220 px pinned width and editor reflow; clickable labels, fixed icon alignment, ellipsis, pointer/keyboard resizing, tooltip scope, reduced motion and window resizing.

These fixtures do not establish live Obsidian acceptance. After installation:

- Fresh installations start unpinned at 220 px. Existing pin, width, animation, label and order preferences survive the 1.2.3 update. Change pin/width and restart to check persistence.
- Hover icons, move through blank panel space, and move away. Confirm overlay behavior and delayed dismissal.
- Pin/unpin and verify editor reflow, stable icon positions and both sidebar controls.
- Drag the grip in both modes, release outside the rail, cancel a drag, and test keyboard resizing.
- Drag icons in the ribbon, then open Settings → Interface → Ribbon menu configuration and confirm its order matches. Reorder there and confirm the ribbon follows. Repeat, restart, and reload a ribbon-adding plugin; verify the last chosen order and late-icon positions.
- Reopen the configuration page and repeat with Settings in a separate window. Check that the current page and keyboard focus remain usable, and hide/show an action without changing its order.
- Click core/community actions through their icon or label, open context menus, and test native drag/reordering. Check Kanban's Create new board action collapsed and expanded.
- Enable/disable a ribbon-adding plugin, switch workspaces, and try AnuPpuccin's light/dark, card, border and frame options.
- Search Settings for “Expanded ribbon width”, “Animate transitions” and “Show labels when expanded”; change each control and verify persistence after restart.
- Check tooltip suppression only while expanded, labels disabled, animation disabled, and OS reduced motion.
- Disable the plugin while hovering, pinned, resizing, reordering or waiting to dismiss. Confirm native width and tooltips return and all existing actions work.

## Plugin icon

The custom icon depicts an expanded navigation rail and its action labels. Use [assets/icon.png](../assets/icon.png) (512 by 512 pixels) for the community listing, or the scalable [SVG](../assets/icon.svg). A [monochrome SVG](../assets/icon-monochrome.svg) is also available; it uses currentColor for theme-aware embedding. All artwork is original and covered by this repository's MIT licence.

After adding the plugin to the community directory, open its entry, choose Edit listing, and set the icon there. See the [official listing instructions](https://docs.obsidian.md/community-directory/manage-entry). These assets give the plugin a visual identity; the ribbon's pin/unpin control keeps its existing functional icons.

## Community directory submission

This repository is public under the [MIT licence](../LICENSE). Releases include main.js, manifest.json and styles.css as individual assets, as well as the manual-install ZIP. The release tag must exactly match manifest.json (1.2.3, without a v prefix).

After completing the live acceptance checks above, follow the [official submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin):

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account and connect GitHub.
2. Select Plugins, then New plugin, and enter https://github.com/an1uk/obsidian-collapsible-ribbon.
3. Select the owner, review the developer policies and maintenance commitment, and submit.
4. Address any review errors with an incremented manifest/package version, updated versions.json, and a matching GitHub release with the three runtime assets.

Publishing this GitHub repository does not submit it to the community directory. Directory review and live Obsidian testing are separate steps.
