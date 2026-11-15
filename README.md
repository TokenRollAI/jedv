# Jedv

Jedv is a local development workspace for projects, Git worktrees, terminals, and native coding agents. It is based on [Paradev](https://github.com/paradevai/paradev); the original copyright and license notices are retained.

## Run from source

```sh
bun install --frozen-lockfile
bun run dev:desktop
```

The desktop and local host do not require a cloud account. The default application data directory is `~/.jedv`; development workspaces use separate profiles.

## Packages and CLI

Workspace packages use the `@jedv/*` scope. The desktop package is `@jedv/desktop`, the CLI is `@jedv/cli`,.

Build the CLI:

```sh
bun run --cwd packages/cli build
./packages/cli/dist/jedv --help
```

The standalone distribution includes `bin/jedv`, `bin/jedv-host`, and its runtime dependencies:

```sh
bun run --cwd packages/cli build:dist --target=darwin-arm64
```

For a standalone installation, use:

```sh
jedv start --daemon
jedv status
jedv --help
jedv completion zsh
```

The command name is `jedv`. New distributions do not install `superset` or `paradev` aliases. Runtime variables use the `JEDV_*` prefix. `JEDV_HOME_DIR` selects the application data directory; `JEDV_HOME` selects the standalone CLI installation directory.

## Project configuration

New project configuration lives in `.jedv/config.toml`. The reader also recognizes existing `.paradev` and `.superset` project configuration. Renaming the product does not move or delete user data or rewrite database migrations.

## Product scope

Jedv keeps PR management, automations, private host connections, Files/Git, terminals and native Agents. It does not include an embedded browser, Design Mode, voice input or plugin marketplace publishing tools. Web links open in the system browser.

## Build and release

See [desktop packaging](llmdoc/distribution/release-integrity.mdx) for the build workflow and signing requirements. Source builds and local checks do not publish npm packages or create releases.

## License

[MIT](LICENSE.md). Upstream attribution and third-party notices remain in the repository.
