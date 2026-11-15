# CLI distribution

Build the CLI and bundled local host from the repository root:

```sh
bun run --cwd packages/cli build:dist --target=darwin-arm64
```

The distribution contains `bin/jedv`, `bin/jedv-host`, the Node runtime, native dependencies, local database migrations and the license. Keep the extracted directories together and add its `bin` directory to `PATH`.

```sh
jedv start --daemon
jedv status
jedv stop
```

No cloud login is required. `JEDV_HOME_DIR` selects the local data directory; `JEDV_HOME` selects the installation directory. Build scripts do not publish releases. See [release preparation](../../llmdoc/distribution/release-integrity.mdx).
