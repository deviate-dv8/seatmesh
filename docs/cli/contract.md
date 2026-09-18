# seatmesh contract

```text
contract [status]
  contract show <id>
  contract on|off <id> [--agent <seat>]
  contract create|open <slug>
  Easy locks: status = vendor + ON/off. on/off default agent from yaml
  (supervise→secretary, balance→balance_lead). No --agent needed.
```

- CLI: `seatmesh contract --help`
- Agent: `seatmesh agent help contract`
- Catalog: [../COMMANDS.md#contract](../COMMANDS.md#contract)
