<!-- codex-generated: 2026-09-27 -->
# Collapsible Ribbon 1.1.0

Hover over an existing left-ribbon action to open a wider navigation rail over nearby content. The native ribbon remains narrow and the editor does not move. Click the bottom pin to keep the rail open and reserve space for it; unpinning returns to hover mode.

## Installation and use

1. Download **collapsible-ribbon.zip** from the [latest GitHub release](https://github.com/an1uk/collapsible-ribbon/releases/latest). Extract the folder into your vault's community-plugin directory, or copy **manifest.json**, **main.js**, and **styles.css** into **.obsidian/plugins/collapsible-ribbon/**.
2. Disable/re-enable Collapsible Ribbon or restart Obsidian. The ribbon must be visible in Appearance settings.
3. Hover an action to reveal labels. The panel stays open across its full area, including the space between top and bottom actions. When unpinned, it closes 180 ms after both pointer and keyboard focus leave.
4. Click the bottom pin to pin/unpin. Tab, Enter and Space work with the pin. Drag the subtle grip at the right edge to resize in either expanded mode.
5. Focus the grip to resize with Left/Right (1 px), Shift+Left/Right (10 px), Home (120 px), or End (300 px). Pointer dragging previews without saving; release commits, while cancellation or lost capture restores the prior width.

The default expanded width is **220 px**, with a **120–300 px** range. Settings retain only width, animation and expanded labels. Pin state and width are remembered through Obsidian's plugin data API; hover state and drag previews are temporary. Animation respects reduced motion and is disabled during pointer resizing.

**Upgrading from 1.0:** the first launch switches to unpinned hover mode at 220 px, preserving animation and label preferences. A settings-version marker makes this migration happen once; later launches restore the pin/width choices you make.

Tooltips are suppressed whenever expanded, including when expanded labels are switched off. Normal tooltips return when collapsed. Accessible action names remain intact. Native tooltips outside the ribbon are unaffected.

Development and generated packages stay outside the vault. This project does not install itself or edit workspace.json. The ZIP contains only the three runtime files in a collapsible-ribbon/ folder.

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

The existing action nodes, SVGs, handlers and order are retained. Labels come from aria-labelledby, aria-label, title or data-tooltip and are displayed with CSS pseudo-elements. Items without useful metadata remain icons. The plugin watches the ribbon for inserted/removed actions and metadata changes; externally referenced label text is also refreshed on workspace layout changes.

Only pinned mode changes --ribbon-width. Hover mode widens the existing action groups and uses a positioned background and edge handle, leaving the native ribbon's flex allocation and header width unchanged. Theme colours, borders, typography and hover states use inherited styling or Obsidian variables. The native sidebar buttons remain usable.

Tooltip suppression uses Obsidian's --no-tooltip hook plus a ribbon-specific tooltip class to hide already-visible/pending ribbon tooltips. Browser title attributes are temporarily suppressed while expanded, with accessible-name fallback where needed. Current metadata changes from other plugins are preserved when the rail collapses or unloads.

Obsidian does not publicly expose ribbon action DOM or tooltip geometry. The implementation therefore uses the existing .workspace-ribbon.mod-left, .side-dock-actions, .side-dock-settings and .side-dock-ribbon-action structure. These and tooltip behavior were inspected in installed Obsidian 1.13.7; the declared minimum is 1.13.7 to match the CSS version used for verification. Themes/plugins that hide or fundamentally restructure the ribbon, implement custom tooltip systems, or transform its containing layout may need additional compatibility work. No Style Settings dependency is required.

On unload or ribbon replacement, the plugin restores its attributes and CSS properties, retains external metadata changes, removes its pin/background/grip, disconnects observers and listeners, cancels timers/frames, and releases pointer capture. Resizing and normal action dragging keep the unpinned overlay open until the gesture finishes.

## Verification and live acceptance

TypeScript, the production build and 13 behavior tests passed on 2026-09-27. Browser fixtures using actual Obsidian 1.13.7 and AnuPpuccin 1.5.0 CSS passed light, dark, card/actions and border/colourful-frame variants. They verified a 44 px ribbon and unchanged editor geometry while hovering; 220 px pinned width and corresponding editor reflow; clickable labels, fixed icon alignment, ellipsis, real pointer resizing, keyboard resizing, tooltip scope, reduced motion, window resizing and unload restoration.

These fixtures do not establish live Obsidian acceptance. After installation:

- Confirm the first upgrade starts unpinned at 220 px. Change pin/width and restart to check persistence.
- Hover icons, move through blank panel space, and move away. Confirm overlay behavior and delayed dismissal.
- Pin/unpin and verify editor reflow, stable icon positions and both sidebar controls.
- Drag the grip in both modes, release outside the rail, cancel a drag, and test keyboard resizing.
- Click core/community actions through their icon or label, open context menus, hide/show commands, and test native drag/reordering.
- Enable/disable a ribbon-adding plugin, switch workspaces, and try AnuPpuccin's light/dark, card, border and frame options.
- Check tooltip suppression only while expanded, labels disabled, animation disabled, and OS reduced motion.
- Disable the plugin while hovering, pinned, resizing or waiting to dismiss. Confirm native width and tooltips return and all existing actions work.
## Community directory submission

This repository is public under the [MIT licence](LICENSE). Releases include main.js, manifest.json and styles.css as individual assets, as well as the manual-install ZIP. The release tag must exactly match manifest.json (1.1.0, without a v prefix).

After completing the live acceptance checks above, follow the [official submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin):

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account and connect GitHub.
2. Select Plugins, then New plugin, and enter https://github.com/an1uk/collapsible-ribbon.
3. Select the owner, review the developer policies and maintenance commitment, and submit.
4. Address any review errors with an incremented manifest/package version, updated versions.json, and a matching GitHub release with the three runtime assets.

Publishing this GitHub repository does not submit it to the community directory. Directory review and live Obsidian testing are separate steps.
<!-- /codex-generated -->