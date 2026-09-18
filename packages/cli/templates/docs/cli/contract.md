# seatmesh contract

```text
contract [status]
  contract show <id>
  contract on|off <id> [--agent <seat>]
  contract create|open <slug>
```

Easy locks under `.sm/contracts/`:

| Command | Effect |
|---------|--------|
| `contract` / `status` | Vendor contracts + ON/off |
| `show <id>` | Merged `_vendor` + extend yaml |
| `on <id>` | Arm lock (agent defaults from yaml) |
| `off <id>` | Disarm |
| `create <slug>` | Ad-hoc contract **room** (not vendor) |

Defaults: `supervise` → `supervisor` (secretary); `balance` → `balance_lead`.

- CLI: `seatmesh contract --help`
- Agent: `seatmesh agent help contract`
- Catalog: [../COMMANDS.md#contract](../COMMANDS.md#contract)
- Hub: `/mds/…/contracts-easy`
