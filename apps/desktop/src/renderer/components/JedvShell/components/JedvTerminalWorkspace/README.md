# Terminal and browser workspace

`TerminalLayoutStore` now holds `WorkspacePaneData = TerminalPaneData | JedvBrowserPaneData`. Browser data has no terminalId. Use `paneTerminalId(pane)` for terminal selection and `isTerminalPane` / `isBrowserPane` for kind-specific actions. `terminalPaneKey` returns a terminal session ID only; browsers return undefined so separate browser tabs are not deduplicated by URL.

The existing reconcile/detach/attach/reopen helpers retain their names for callers. They now handle mixed tabs: closing terminal views leaves PTYs running, closing browsers destroys their guests, and reopening restores only terminal IDs that still exist plus browser URL panes. A closed HTML preview reopens blank; its document is never retained in the closed-tab stack.

## Browser entry point

```ts
const paneId = openBrowserPane(store, {
  url,
  placement: "new-tab", // or "split-pane"
  source: { kind: "private", origin: new URL(url).origin },
  // optional: anchorPaneId, position: "right" | "bottom"
});
```

`url` is validated by the BrowserView URL policy. Private preview URLs must come from the existing forwarding layer and be reachable by this desktop. This helper creates no forward, sends no PSK and navigates only when the caller explicitly opens a pane.

HTML document URLs live only in a WeakMap keyed by the store. Per store, at most eight raw previews and 4 MiB of encoded URL bytes are retained; closing one releases capacity. Browser panes are capped at 64, source origins at 2048 characters, and pane splits at eight. These limits reject an extra open rather than silently evicting an active document. Normal pane data contains URL/title/favicon; preview data contains about:blank with empty title/favicon.

`getBrowserPaneLaunch` supplies the ephemeral URL/source to the local wrapper. `updateBrowserPaneData` strips preview documents and releases the original document when the guest navigates elsewhere. Removing/replacing a browser pane destroys it even outside a mounted React Workspace.

Eight stores are retained in LRU order. Eviction calls `disposeTerminalWorkspaceStore`, destroys that store's browser guests, clears preview/closed-browser metadata and rejects stale browser opens. It never calls a terminal kill API. A disposed store is not reused when the workspace returns.

## Shell contract

Additional `JedvTerminalWorkspace` props:

```ts
hostUrl: string;
onOpenUrl?(url: string): void;
onOpenBrowserSettings?(): void;
```

`onOpenUrl` routes terminal context-menu URL actions through the host's actual browser preference. Browser guest new-tab/split callbacks open another browser pane in the same store. The existing terminal renderer and LocalTerminal props remain separate.

Additional `TerminalWorkspaceActions`:

```ts
newBrowser(placement?: "new-tab" | "split-pane"): Promise<void>;
focusKind(): "terminal" | "browser" | null;
zoom(direction: "in" | "out" | "reset"): boolean;
```

`zoom` returns true only when an active browser consumed the action; Shell retains terminal-font and whole-window zoom. `find` uses the browser find bar for a browser and terminal search for a terminal. Clear/scroll/terminal IDs and Agent metadata never read browser data as a terminal.

Root still owns Shell/TabStrip/LocalTerminal, global key dispatch, open-request subscriptions, and port/Files preview entry points. See `plans/jedv/REPORT_browser-workspace-integration.md` for checks and remaining integration steps. No GUI or user data was used for fixture tests.
