# Seatmesh agent skills

Project skills for Cursor / agents (installed under `.agents/skills/`).

| Skill | When |
|-------|------|
| [seatmesh-agent](seatmesh-agent/SKILL.md) | Mesh CLI gateway, inbox, peers, todos, CBs |
| [seatmesh-notify](seatmesh-notify/SKILL.md) | Operator eyes / Info / Yes-No |
| [seatmesh-web](seatmesh-web/SKILL.md) | Adonis 7 hub UI (`packages/web`) |
| [seatmesh-cpe](seatmesh-cpe/SKILL.md) | OpenCode via `opencode-cpe.sh` / scrape preserve |
| [web-design-guidelines](web-design-guidelines/SKILL.md) | antfu → Vercel UI audit (vendored) |

## Add / refresh remote skills

```bash
npx skills add https://github.com/antfu/skills --skill web-design-guidelines
```

Local seatmesh skills are authored here; keep `SKILL.md` lean and link out to `.sm/AGENTS.md` / `docs/cli/*`.
