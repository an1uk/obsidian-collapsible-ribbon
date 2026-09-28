# Development and release notes

Build instructions, implementation details, verification, manual acceptance checks, and community directory submission steps for maintainers. The [README](../README.md) is the short plugin listing.

## Build and checks

Requires Node.js 20+ and pnpm; Obsidian API types are pinned to 1.13.1.

~~~sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
~~~

The optional browser fixture accepts local Obsidian app archive, AnuPpuccin theme CSS, Chromium executable and installed Playwright module paths:

~~~sh
node tests/browser-check.cjs <obsidian.asar> <theme.css> <chrome.exe> <playwright-module>
~~~

Quote paths containing spaces. The browser check reads the app/theme resources and runs temporary fixtures in a headless browser; it never operates on the live vault. It also generates preview screenshots in tests/.generated/.

main.ts manages lifecycle and serialized settings writes; settings.ts validates and migrates state; ribbon.ts owns interaction and geometry; ribbon-items.ts preserves action labels/tooltip metadata; styles.css controls layout. No framework or runtime dependency is added. The pnpm build-script allowlist permits only esbuild's platform-binary setup.

## Compatibility and cleanup

The existing action nodes, SVGs, handlers and order are retained. An action with no rendered content receives a temporary icon: board-labelled actions use Obsidian's Kanban icon and other empty actions use its help icon. A later native icon replaces the fallback, and unload removes it. Kanban 2.0.51 requests lucide-trello, which Obsidian 1.13.7 no longer provides. Labels come from aria-labelledby, aria-label, title or data-tooltip and are displayed with CSS pseudo-elements. Items without useful metadata remain icons. The plugin watches the ribbon for inserted/removed actions and metadata changes; externally referenced label text is also refreshed on workspace layout changes.

Only pinned mode changes --ribbon-width. Hover mode widens the existing action groups and uses a positioned background and edge handle, leaving the native ribbon's flex allocation and header width unchanged. Theme colours, borders, typography and hover states use inherited styling or Obsidian variables. The native sidebar buttons remain usable.

Tooltip suppression uses Obsidian's --no-tooltip hook plus a ribbon-specific tooltip class to hide already-visible/pending ribbon tooltips. Browser title attributes are temporarily suppressed while expanded, with accessible-name fallback where needed. Current metadata changes from other plugins are preserved when the rail collapses or unloads.

Obsidian does not publicly expose ribbon action DOM or tooltip geometry. The implementation therefore uses the existing .workspace-ribbon.mod-left, .side-dock-actions, .side-dock-settings and .side-dock-ribbon-action structure. These and tooltip behavior were inspected in installed Obsidian 1.13.7; the declared minimum is 1.13.7 to match the CSS version used for verification. Themes/plugins that hide or fundamentally restructure the ribbon, implement custom tooltip systems, or transform its containing layout may need additional compatibility work. No Style Settings dependency is required.

On unload or ribbon replacement, the plugin restores its attributes and CSS properties, retains external metadata changes, removes its pin/background/grip, disconnects observers and listeners, cancels timers/frames, and releases pointer capture. Resizing and normal action dragging keep the unpinned overlay open until the gesture finishes.

## Verification and live acceptance

TypeScript, the production build and 14 behavior tests passed on 2026-09-28. Browser fixtures using actual Obsidian 1.13.7 and AnuPpuccin 1.5.0 CSS passed light, dark, card/actions and border/colourful-frame variants. They verified a 44 px ribbon and unchanged editor geometry while hovering; 220 px pinned width and corresponding editor reflow; clickable labels, fixed icon alignment, ellipsis, real pointer resizing, keyboard resizing, tooltip scope, reduced motion, window resizing and unload restoration.

These fixtures do not establish live Obsidian acceptance. After installation:

- Confirm the first upgrade starts unpinned at 220 px. Change pin/width and restart to check persistence.
- Hover icons, move through blank panel space, and move away. Confirm overlay behavior and delayed dismissal.
- Pin/unpin and verify editor reflow, stable icon positions and both sidebar controls.
- Drag the grip in both modes, release outside the rail, cancel a drag, and test keyboard resizing.
- Click core/community actions through their icon or label, open context menus, hide/show commands, and test native drag/reordering. Check Kanban's Create new board action collapsed and expanded.
- Enable/disable a ribbon-adding plugin, switch workspaces, and try AnuPpuccin's light/dark, card, border and frame options.
- Check tooltip suppression only while expanded, labels disabled, animation disabled, and OS reduced motion.
- Disable the plugin while hovering, pinned, resizing or waiting to dismiss. Confirm native width and tooltips return and all existing actions work.

## Plugin icon

The custom icon depicts an expanded navigation rail and its action labels. Use [assets/icon.png](../assets/icon.png) (512 by 512 pixels) for the community listing, or the scalable [SVG](../assets/icon.svg). A [monochrome SVG](../assets/icon-monochrome.svg) is also available; it uses currentColor for theme-aware embedding. All artwork is original and covered by this repository's MIT licence.

After adding the plugin to the community directory, open its entry, choose Edit listing, and set the icon there. See the [official listing instructions](https://docs.obsidian.md/community-directory/manage-entry). These assets give the plugin a visual identity; the ribbon's pin/unpin control keeps its existing functional icons.

## Community directory submission

This repository is public under the [MIT licence](../LICENSE). Releases include main.js, manifest.json and styles.css as individual assets, as well as the manual-install ZIP. The release tag must exactly match manifest.json (1.1.1, without a v prefix).

After completing the live acceptance checks above, follow the [official submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin):

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account and connect GitHub.
2. Select Plugins, then New plugin, and enter https://github.com/an1uk/obsidian-collapsible-ribbon.
3. Select the owner, review the developer policies and maintenance commitment, and submit.
4. Address any review errors with an incremented manifest/package version, updated versions.json, and a matching GitHub release with the three runtime assets.

Publishing this GitHub repository does not submit it to the community directory. Directory review and live Obsidian testing are separate steps.
