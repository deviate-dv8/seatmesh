/**
 * Agent golf / shorthand forum — printed by `sm agent forum` (alias: golf).
 * This is what "shorthand" means: collapse bash magic into one sm verb + Ruby ranges.
 */
export function printAgentForum(): void {
  console.log(`--- golf / shorthand ---
NOT synonym soup. Shorthand = collapse bash into one sm verb + Ruby ranges.

| Job | Type this | Not this |
|-----|-----------|----------|
| Tell seats | sm agent peer 1..4 "…" | for i in 1 2 3 4; do … peer slot-$i |
| Tell list | sm agent peer 1,3,5 "…" | three peer calls / bash loop |
| Empty→CLI | sm agent spawn slot-1 opencode | type opencode by hand / slow switch |
| Fast paste | spawn (default --fast) | switch (waits verify+summon) |
| Replace live | sm agent switch slot-1 claude | C-c; opencode; hope |
| Resume cfg | sm agent launch 1..4 | bash paste each pane |
| Give work | sm agent todo give slot-2 "…" | edit TASKS.md |
| Close ask | sm agent ack <id> | chat "ACK" |
| Eyes | sm agent notify … | ./scripts/notify.sh |

Ranges: 1..4 · slot-2..5 · mini-1..3 · 1,3,5
Gateway: sm agent whoami · sm agent  (every turn)
Bin: sm  (not seatmesh --profile .sm · not ./sm.sh · not npx --prefix)
`);
}
