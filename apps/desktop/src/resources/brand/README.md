# Jedv dot mark

The user-provided dot J is the brand mark. Reference: `plans/jedv/brand/user-logo-reference.png` from the repository root. `jedv-mark.svg` is the editable vector source: fourteen white circles on a near-black tile. The rounded tile fits application icons; the dot arrangement follows the supplied reference.

Run `bun run scripts/generate-brand-icons.ts` from `apps/desktop` to update the renderer SVG, PNG, ICO and tray resources. On macOS it also builds ICNS files with `iconutil`. The generator uses `rsvg-convert` (librsvg); no JavaScript image dependency is added. Stable, dev and canary resources share this approved mark.
