import { seatmeshCmd } from "@seat-mesh/core";

const m = (sub: string) => seatmeshCmd(sub);

/** Whoami + bare `hub` — no whoami import (avoids cycle with whoami-context). */
export function hubRetrievalWhoamiLines(): string[] {
  return [
    "--- retrieval (hub) ---",
    `hub=${m("hub")}  # map + live summary; hub <entity> to fetch`,
    "hub_entities=contexts | todos | acks | cbs | chat | room | shared | sessions",
    `retrieve_contexts=${m("contexts")} | ${m("hub contexts")}`,
    `retrieve_todos=${m("hub todos")} | ${m("seat task list")} | ${m("todo list")}  # agent method — do not grep TASKS.md`,
    `retrieve_acks=${m("ack")} | ${m("hub acks")}`,
    `retrieve_cbs=${m("cb list")} | ${m("hub cbs")}`,
    `retrieve_chat=${m("chat tail")} | ${m("hub chat")} | ${m("read-history")}  # prompt/response CHAT.jsonl`,
    `retrieve_room=${m("room tail [-r slug]")} | ${m("hub room")}`,
    `retrieve_shared=${m("hub shared")}  # .sm/seats/_shared MDs`,
    `retrieve_sessions=${m("sessions")} | ${m("remote")} | ${m("hub sessions")}  # other meshes`,
    `retrieve_ppa=${m("ppa")}  # who is slacking? (idle∧open work)`,
    `mutate_todos=${m('todo give <target> "…"')} | ${m('todo <target> "…"')} | ${m('todo add|check …')}`,
    `mutate_acks=${m("ack <id>")} | ${m('ack reply <id> [msg]')} | ${m("reply <id> [msg]")}`,
    `mutate_peer=${m('ask|msg <t> "…"')} | ${m('ackmsg <t> "…"')} | ${m('peer <t> "…"')}`,
    `mutate_cbs=${m('cb start <dur> --expect "…"')} | ${m("cb cancel <id>")}`,
    `mutate_room=${m('room say [-r slug] "…"')}`,
    `mutate_notify=${m('notify yesno "<title>" "<blurb>" --body "…"')} | ${m('notify info "…" --body "…"')} | ${m("help notify")}`,
    `mutate_remote=${m('remote <alias> <seat> "…"')} | ${m('peer @alias:seat "…"')}`,
    "hub_hint=whoami = dump this turn; hub = fetch/CRUD map — chat prose does NOT clear ack/cb",
    "operator_eyes=need human look/decide → notify (not chat). shapes: eyes-only | info | yesno — run help notify",
    `help_cmds=${m("help <cmd>")} | ${m("help peer")} | <cmd> --help | docs/COMMANDS.md | docs/cli/<verb>.md`,
  ];
}
