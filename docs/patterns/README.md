# Seatmesh patterns (modular)

North star: **one command per job**, rich small files, never paste patterns into pane injects
(inject copy = `mesh-copy.ts` consts only).

Adapted from the zsign `doc-inputs/patterns.md` convention: **one feature = one file**,
tagged for surface coverage.

| Tag | Meaning |
|-----|---------|
| **CLI** | `sm` / `seatmesh` top-level or `agent` gateway |
| **web** | `packages/web` hub (`:3190`) |
| **daemon** | inbox / mesh-inbox-server |

## Index

| Feature | File | Surfaces |
|---------|------|----------|
| CLI ↔ web parity | [cli-web-parity.md](./cli-web-parity.md) | CLI · web |
| One-path / discoverability | [one-path.md](./one-path.md) | CLI |
| Inject / DIGEST / peer-bulk | [inject-digest.md](./inject-digest.md) | CLI · daemon |
| OC-proxy / CPE | [oc-proxy.md](./oc-proxy.md) | CLI · daemon |
| Config / update | [config-update.md](./config-update.md) | CLI |

Legacy mega-doc (zsign): `~/Desktop/Work/zsign/doc-inputs/patterns.md` — do not grow it;
slice new seatmesh guidance here instead.
