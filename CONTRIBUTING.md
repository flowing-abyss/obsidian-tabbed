# Contributing

Thanks for taking an interest. Issues and pull requests are both welcome.

## Getting set up

You need pnpm and a Node version matching `engines` in `package.json`, then:

```bash
pnpm install
pnpm dev
```

`pnpm dev` rebuilds `main.js` on every save. Copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/tabbed/` in a vault you do not mind breaking, or symlink them there so each rebuild lands immediately. `tests/vaults/minimal` contains the fixture used by the automated Obsidian tests.

## Before you open a pull request

```bash
pnpm run verify
```

That runs formatting, lint, types, architecture rules, dead-code checks and unit tests with coverage. CI runs the same command.

`pnpm run test:e2e` drives a real Obsidian desktop instance. Run it when changing rendering, editing, lifecycle behavior or Obsidian integration.

Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), such as `fix: ...`, `feat: ...` or `docs: ...`.

New behavior needs a test. Coverage thresholds are enforced per file.

## Worth knowing

Read `AGENTS.md` before changing the plugin. It lists project invariants that no single source file makes obvious.

Anything that introduces a network request or external service needs discussion first. Tabbed is local and offline by default.
