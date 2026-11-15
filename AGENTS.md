# Jedv

Always answer in 简体中文.

Jedv is a local desktop development workspace, built with Electron, React, Bun and tRPC. The main product lives in `apps/desktop`; `packages/host-service` owns local projects, worktrees, terminals and native Agent sessions, and `packages/cli` exposes the `jedv` command. Packages use `@jedv/*`.

## Scope and data

- Keep the local desktop and CLI usable without a cloud account. Do not restore removed browser, Design Mode, voice-input or marketplace-publishing features.
- Keep PR management, terminals, native Agents, Files/Git, automations and private host connections.
- Preserve user changes, credentials, active processes and application data. Test with isolated temporary profiles and repositories.
- Do not run shared/production migrations, reset databases, or rewrite migration history. Keep existing database columns compatible with stored data.
- Do not commit, push, tag, publish or reply to reviewers unless the user authorizes that action.
- Use external tools only when the task needs the connected service; local work does not require a Tool Bridge call.

## Structure

- One folder per component: `Name/Name.tsx` and `index.ts`.
- Co-locate tests, hooks and helpers with their consumer. Promote shared code to the nearest shared parent.
- Keep one component per file. shadcn/ui files retain their existing kebab-case layout.
- Prefer existing components and theme tokens. For substantial UI design changes, use Pencil before implementation when available.
- Keep code self-describing. Comments explain constraints that names and types cannot express.

## Verification

- Run checks relevant to the change; do not substitute unit tests for real GUI verification.
- Tests must be fast, isolated and order-independent. No real timeout waits or global mocks of shared environment/client modules.
- Desktop renderer localStorage needs bounded entries and cleanup; follow `apps/desktop/AGENTS.md`.
- User-facing strings use Lingui English message IDs. Update translations and run `bun run check:i18n`; never ship missing translations.
- Keep desktop, host-service and CLI versions aligned. Run `bun run check:versions` before preparing a release.
- Report what changed, what was actually checked, and what remains unverified.
