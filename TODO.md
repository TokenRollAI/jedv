# Jedv TODO

- [ ] Enable signed and notarized macOS releases after an Apple Developer account is available.
  - Configure the repository Actions secrets: `MAC_CERTIFICATE` (base64 Developer ID Application `.p12`), `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD` (app-specific password), and `APPLE_TEAM_ID`.
  - Run **Package Jedv** with `signed: true`. Require successful code-signature, notarization-ticket, and Gatekeeper checks before publishing.
  - Verify an upgrade between two signed versions through the published update feed, including cancellation when a window has unsaved changes.
  - Until then, macOS releases remain unsigned. Version checks work; updates require manual installation from GitHub Releases.
