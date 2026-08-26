# Tabbed

Create accessible, lazy-loading tabs for Markdown content in Obsidian. Tabbed
renders only the selected tab body, supports nested tabs and Bases, and keeps
editing local to your vault.

## Usage

Create a fenced `tabs` block. A line beginning with the configured separator
(`tab: ` by default) starts a new tab; everything up to the next tab line is
that tab's Markdown content.

<!-- prettier-ignore -->
~~~~~markdown
````tabs
tab: Preview
This tab contains **Markdown**.

tab: Source
```ts
const lazy = true;
```
````
~~~~~

Tab titles also support Markdown. If a block is empty, Tabbed shows one virtual
tab using the configured default title and content. A non-empty block with no
separator becomes the content of one virtual tab, so existing content is not
discarded.

Use a longer outer fence, or switch the outer fence to tildes, when tab content
contains fenced blocks. This also enables nesting:

<!-- prettier-ignore -->
~~~~~markdown
````tabs
tab: Outer one
The selected outer tab contains another block:

```tabs
left, action-none
tab: Inner one
Nested content one.
tab: Inner two
Nested content two.
```

tab: Outer two
Only this body is rendered after selecting it.
````
~~~~~

### Block options

Put options before the first `tab: ` line, separated by commas or newlines.
Unknown options are preserved and ignored. When options from the same group
repeat, the last one wins.

| Options                                    | Effect                                                      |
| ------------------------------------------ | ----------------------------------------------------------- |
| `top`, `bottom`, `left`, `right`           | Place the tab titles on that side of the active panel.      |
| `one`, `multi`                             | Keep titles on one scrollable line or allow multiple lines. |
| `action-add`, `action-edit`, `action-none` | Override the global end control for this block.             |

Left and right layouts expose a vertical tab list to assistive technology and
use Up/Down for focus movement. Top and bottom layouts use Left/Right. Home and
End move focus; Enter or Space activates the focused tab.

Only one direct body panel is attached for each rendered block. Inactive tab
bodies are not rendered or prefetched; embedded Bases, queries, media, and
nested tab blocks are created only when their tab becomes active and are
unloaded when it becomes inactive.

## Editing and commands

Navigation works in both Reading view and Live Preview. Source-changing
controls are available only when the block belongs to a Markdown view in source
mode (including Live Preview):

- use the optional end control to add a tab or edit the selected tab;
- right-click a title to add, delete, copy, or paste a tab;
- optionally double-click the active body to edit it;
- optionally drag titles to reorder or move tabs between blocks in the same
  note on desktop.

Reading view deliberately omits mutation controls. Drag and drop is also
disabled in the Android and iOS apps; navigation, lazy rendering, menus, and the
editor remain mobile-compatible.

The tab editor saves after the configured idle delay, on close, or with
`Ctrl/Cmd+S`. Its toolbar provides bold, italic, underline, strike, bullet,
numbered and task lists, quote, fenced code, callout, table, indent, and outdent
actions. Normal Obsidian Undo restores source mutations.

Tabbed adds two commands:

- **Create tabs block** wraps the current selection, or inserts a block using
  the configured default title and content.
- **Refresh tab contents** rerenders the active body of every currently loaded
  tab block without rendering inactive bodies.

## Settings

| Setting                 | Default           | Purpose                                                      |
| ----------------------- | ----------------- | ------------------------------------------------------------ |
| Tab separator           | `tab: `           | Single-line prefix that starts a tab.                        |
| Default title           | `New tab`         | Title for virtual and newly added tabs.                      |
| Default content         | `New tab content` | Content for empty blocks and newly added tabs.               |
| Tab action              | Add tab           | Global end control: none, add, or edit.                      |
| Show success notices    | On                | Show confirmation after successful mutations and commands.   |
| Enable drag and drop    | Off               | Enable desktop source-mode drag and drop.                    |
| Double-click to edit    | Off               | Open the selected tab editor from its active body.           |
| Show editor toolbar     | On                | Show formatting actions above the modal editor.              |
| Tab size                | `4`               | Spaces used by indent and outdent, from 1 through 8.         |
| Autosave delay (ms)     | `5000`            | Idle delay before saving, from 0 through 60000 milliseconds. |
| Border                  | On hover          | Hide, hover, or always show the block border.                |
| Border color            | `#e0e0e0`         | Block border color.                                          |
| Hide native edit button | On                | Hide Obsidian's code-block edit button for Tabbed blocks.    |
| Title position          | Top               | Default top, bottom, left, or right title placement.         |
| Title line mode         | Single line       | Default one-line scrolling or multi-line wrapping.           |
| Limit title width       | Off               | Cap long title buttons.                                      |
| Content padding         | `1em 2em`         | CSS padding inside the active panel.                         |
| Content maximum height  | `none`            | Panel maximum height as a CSS length, `0`, or `none`.        |

Settings apply to currently rendered blocks and are stored in Obsidian's local
plugin data. Block options override the three matching global defaults: title
position, title line mode, and tab action.

## CSS variables

Tabbed uses Obsidian theme variables for its colors and typography. These
plugin variables are available to snippets and themes:

| Variable                      | Default or source              |
| ----------------------------- | ------------------------------ |
| `--tabbed-title-max-width`    | `18rem`                        |
| `--tabbed-border-color`       | Border color setting           |
| `--tabbed-content-padding`    | Content padding setting        |
| `--tabbed-content-max-height` | Content maximum height setting |
| `--tabbed-editor-width`       | `52rem`                        |

## Compatibility

| Environment                         | Support                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| Obsidian desktop                    | Declared minimum 1.13.1; locally verified with latest stable 1.13.7. |
| Obsidian Android and iOS            | Supported; drag and drop is disabled.                                |
| Reading view                        | Navigation and active-body rendering; source mutations are hidden.   |
| Live Preview / Markdown source mode | Navigation, add/edit/menu controls, modal editing, and desktop drag. |
| Nested `tabs` blocks                | Supported inside the active body.                                    |
| Bases and other Markdown embeds     | Supported and loaded only with their active body.                    |

The local minimum-version E2E run was unavailable because the launcher
classified Obsidian 1.13.1 as a beta build and required Insiders credentials
or a predownloaded installation. No local minimum-version pass is claimed.

The plugin is fully local and offline. It makes no network requests, sends no
telemetry or analytics, and never downloads or evaluates remote code.

## Installation and development

When Tabbed is available in the Community Store, install it from **Settings →
Community plugins → Browse**, search for “Tabbed,” and select **Install** then
**Enable**.

For a manual installation, copy `main.js`, `manifest.json`, and `styles.css`
into `<vault>/.obsidian/plugins/tabbed/`, then reload Obsidian and enable
Tabbed. To build those files from source:

```bash
pnpm install
pnpm run build
```

Run the complete project gate before submitting a change:

```bash
pnpm run verify
```

## Credits

Tabbed is a compatibility-focused successor to Huajin's
[Markdown Tabs](https://github.com/xhuajin/obsidian-tabs), which was inspired by
[Code Tab](https://github.com/lazyloong/obsidian-code-tab). The established
`tabs` fence, `tab: ` separator, layout options, nesting, and editing workflow
remain supported for existing notes.
