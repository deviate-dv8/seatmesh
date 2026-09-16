# Inject / DIGEST / peer-bulk

**Surfaces:** CLI · daemon

- Enqueue only — no raw `tmux send-keys` for mesh mail.
- DIGEST = up to `PEER_BULK_MAX` (5) peer rows → one paste (`formatPeerBulkDigest`).
- After `todo check`, remaining open TASKS are DIGEST-bulk'd to that seat (same peer queue).
- Inject copy = `mesh-copy.ts` consts — never paste patterns into a pane.
