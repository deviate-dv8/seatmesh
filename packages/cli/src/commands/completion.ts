/**
 * Shell tab completion for seatmesh (bash / zsh / fish).
 * Source of truth for top-level verbs: help-text.ts.
 */
import { listHelpAliases, listHelpVerbs } from "./help-text.js";

const GLOBAL_FLAGS = ["--profile", "-p", "--help", "-h"];

const CLI_TYPES = [
  "agent",
  "claude",
  "opencode",
  "opencode-cpe",
  "kiro",
  "empty",
  "cc",
  "oc",
  "cursor",
];

const COMMON_TARGETS = [
  "manager",
  "secretary",
  "here",
  "slot-1",
  "slot-2",
  "slot-3",
  "mini-1",
  "mini-2",
  "all",
];

/** Static second-token (and deeper) completions by verb. */
const SUBS: Record<string, string[]> = {
  help: [], // filled dynamically with top-level words
  completion: ["bash", "zsh", "fish", "reply", "install"],
  config: ["check", "upgrade"],
  web: ["status", "up", "down", "restart", "open", "url", "help"],
  session: ["attach", "up", "down", "status", "sync", "check", "repair", "init"],
  sessions: ["list", "attach", "forget", "register", "pick"],
  layout: ["column", "scale", "reload", "realign"],
  ops: ["list", "clear"],
  inbox: ["list", "resolve", "log", "instances", "stop", "restart"],
  mini: ["list", "spawn", "prompt", "done", "kill", "reassign", "dispatch-all"],
  secretary: ["start", "status", "digest", "restart", "supervise", "switch", "watch"],
  roles: ["status", "migrate", "steps"],
  night: ["on", "off", "status"],
  ack: ["list", "reply", "clear", "redirect"],
  cb: ["list", "start", "cancel", "cancel-all", "reset", "ack"],
  checkback: ["list", "start", "cancel", "cancel-all", "reset", "ack"],
  patience: ["list", "start", "cancel", "cancel-all", "reset", "ack"],
  room: ["tail", "say", "broadcast", "read", "call", "accept"],
  chat: ["tail", "query", "append", "record"],
  hub: ["contexts", "todos", "acks", "cbs", "chat", "room", "shared", "sessions"],
  get: ["contexts", "todos", "acks", "cbs", "chat", "room", "shared", "sessions"],
  seat: ["init", "task", "todo", "now", "mark", "remind", "assign"],
  ask: ["manager", "secretary", "slot-1", "slot-2", "mini-1", "here"],
  msg: ["manager", "secretary", "slot-1", "slot-2", "mini-1", "here"],
  tell: ["manager", "secretary", "slot-1", "slot-2", "mini-1", "here"],
  ackmsg: ["manager", "secretary", "slot-1", "slot-2", "mini-1", "here"],
  answered: ["manager", "secretary", "slot-1", "slot-2", "mini-1", "here"],
  reply: [],
  todo: ["give", "send", "to", "list", "add", "check", "ls", "show"],
  todos: ["give", "send", "to", "list", "add", "check", "ls", "show"],
  notify: ["info", "md", "details", "yesno", "run", "cmd", "desktop"],
  mds: ["hosted", "agent-self", "agent", "status", "list", "help"],
  preview: [],
  limit: ["idle", "idle-clear"],
  proxy: ["status", "check", "reset"],
  providers: ["list", "scan"],
  target: ["add", "list", "done", "triage"],
  targets: ["add", "list", "done", "triage"],
  peek: [...COMMON_TARGETS, "status", "full"],
  kind: [...COMMON_TARGETS],
  what: [...COMMON_TARGETS],
  typeof: [...COMMON_TARGETS],
  whoami: [...COMMON_TARGETS, "--validate", "--json"],
  where: [...COMMON_TARGETS, "--validate", "--json"],
  assign: [...COMMON_TARGETS],
  prompt: ["--manager", ...COMMON_TARGETS],
  remind: ["all", "1", "2", "3", "slot-1", "slot-2", "slot-3"],
  launch: ["all", "manager", "secretary", ...COMMON_TARGETS],
  pane: ["resume"],
  flush: ["all", "manager", ...COMMON_TARGETS],
  continue: ["all", "1", "2", "3"],
  switch: [...COMMON_TARGETS],
  handoff: [...COMMON_TARGETS],
  spawn: [...COMMON_TARGETS],
  set: [...COMMON_TARGETS],
  swap: [...COMMON_TARGETS],
  ppa: ["--raw", "--idle", "perf-index", "index"],
  contexts: ["--json"],
  seats: ["--json"],
  remote: ["--json"],
  meshes: ["--json"],
  report: ["--json", "--verbose"],
  version: ["--json", "--check-registry"],
  update: ["--dry-run", "--migrate", "--no-restart-inbox"],
  reload: ["--layout"],
  rebuild: ["--layout"],
  save: ["--json", "--no-labels"],
  auto: ["--json", "--no-labels"],
  init: ["--force", "--seats-root", "--name"],
  start: [],
  agent: [], // filled with agent verbs
  profile: ["show"],
  base: ["ensure", "realign"],
  index: ["show", "validate"],
  "cold-start": ["--inject", "--force", ...COMMON_TARGETS],
  coldstart: ["--inject", "--force", ...COMMON_TARGETS],
};

const DEEPER: Record<string, Record<string, string[]>> = {
  layout: {
    column: ["list", "add", "remove"],
    scale: ["workers", "minis", "up", "down"],
    reload: ["--yes", "--no-leads", "--no-resume"],
  },
  seat: {
    task: ["list", "add", "check"],
    mark: ["OPEN", "BUSY", "BLOCKED"],
  },
  secretary: {
    supervise: ["on", "run", "off"],
    watch: ["on", "off"],
    switch: CLI_TYPES,
  },
  session: {
    init: [],
  },
  ack: {
    reply: [],
    redirect: ["mini-1", "mini-2"],
  },
  cb: {
    ack: ["yes", "no"],
  },
  checkback: {
    ack: ["yes", "no"],
  },
  peek: {
    // after target
  },
  switch: Object.fromEntries(COMMON_TARGETS.map((t) => [t, CLI_TYPES])),
  handoff: Object.fromEntries(COMMON_TARGETS.map((t) => [t, CLI_TYPES])),
  set: Object.fromEntries(COMMON_TARGETS.map((t) => [t, CLI_TYPES])),
  pane: {
    resume: COMMON_TARGETS.filter((t) => t !== "all"),
  },
  limit: {
    idle: ["--all", "--pane"],
  },
};

function uniqSorted(words: string[]): string[] {
  return [...new Set(words.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Top-level verbs + aliases (+ completion itself). */
export function listTopLevelCompletionWords(): string[] {
  const aliases = listHelpAliases().map((a) => a.alias);
  return uniqSorted([...listHelpVerbs(), ...aliases, "completion", ...GLOBAL_FLAGS]);
}

function agentVerbs(): string[] {
  // Pane gateway: same help verbs minus pure operator setup noise is fine —
  // filter nothing; agent card enforces UNAUTHORIZED at runtime.
  return listTopLevelCompletionWords().filter(
    (w) => !w.startsWith("-") && w !== "completion" && w !== "start" && w !== "init",
  );
}

/**
 * Normalize argv for completion: drop leading node/npx/npm-exec wrappers
 * so `npx seatmesh peer` completes like `seatmesh peer`.
 */
export function normalizeCompletionWords(raw: string[]): string[] {
  const words = [...raw];
  while (words.length) {
    const w0 = words[0]!;
    const base = pathBasename(w0);
    if (
      base === "node" ||
      base === "nodejs" ||
      base === "npm" ||
      base === "npx" ||
      base === "pnpm" ||
      base === "yarn" ||
      base === "bunx" ||
      base === "tsx" ||
      base === "seatmesh" ||
      base.startsWith("seatmesh")
    ) {
      // npx seatmesh … / npm exec seatmesh … / node …/seatmesh …
      if (base === "npx" || base === "bunx") {
        words.shift();
        // npx --yes seatmesh …
        while (words[0]?.startsWith("-")) words.shift();
        if (words[0] && pathBasename(words[0]).startsWith("seatmesh")) words.shift();
        break;
      }
      if (base === "npm" || base === "pnpm" || base === "yarn") {
        words.shift();
        if (words[0] === "exec" || words[0] === "dlx") {
          words.shift();
          while (words[0]?.startsWith("-")) words.shift();
          if (words[0] && pathBasename(words[0]).startsWith("seatmesh")) words.shift();
        }
        break;
      }
      words.shift();
      break;
    }
    break;
  }
  // Drop --profile PATH pairs so positional cmds still complete
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i]!;
    if (a === "--profile" || a === "-p") {
      i++; // skip value
      continue;
    }
    if (a.startsWith("--profile=")) continue;
    out.push(a);
  }
  return out;
}

function pathBasename(p: string): string {
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function filterPrefix(candidates: string[], prefix: string): string[] {
  if (!prefix) return candidates;
  return candidates.filter((c) => c.startsWith(prefix));
}

/**
 * Compute completion candidates.
 * @param words full shell words for this command line (may include wrappers)
 * @param cword index of the word being completed (0-based in `words`)
 */
export function completeArgv(words: string[], cword: number): string[] {
  const raw = words.length ? words : [""];
  const idx = Math.max(0, Math.min(cword, raw.length - 1));
  const prefix = raw[idx] ?? "";

  // Completing a global flag value
  if (idx > 0 && (raw[idx - 1] === "--profile" || raw[idx - 1] === "-p")) {
    return []; // filesystem — shell default
  }

  const norm = normalizeCompletionWords(raw.slice(0, idx + 1));
  // Recompute prefix position inside normalized stream:
  // we complete the last token of the normalized prefix list.
  const cur = norm.length ? norm[norm.length - 1]! : prefix;
  const before = norm.slice(0, -1);

  if (before.length === 0) {
    return filterPrefix(listTopLevelCompletionWords(), cur === "seatmesh" ? "" : cur);
  }

  const cmd = before[0]!;

  if (cmd === "agent") {
    if (before.length === 1) {
      return filterPrefix(uniqSorted(["help", ...agentVerbs()]), cur);
    }
    if (before[1] === "help" && before.length === 2) {
      return filterPrefix(listTopLevelCompletionWords().filter((w) => !w.startsWith("-")), cur);
    }
    // agent <verb> … — reuse verb subs with shifted before
    return completeArgv(["seatmesh", ...before.slice(1), cur], before.length);
  }

  if (cmd === "help") {
    return filterPrefix(
      uniqSorted([
        "human",
        "put-agent",
        "panes",
        "operator",
        ...listTopLevelCompletionWords().filter((w) => !w.startsWith("-")),
      ]),
      cur,
    );
  }

  if (cmd === "completion" && before.length === 1) {
    return filterPrefix(SUBS.completion!, cur);
  }

  // Deeper: cmd sub …
  if (before.length >= 2) {
    const sub = before[1]!;
    const deep = DEEPER[cmd]?.[sub];
    if (deep && before.length === 2) {
      return filterPrefix(uniqSorted(deep), cur);
    }
    // switch <target> <cli>
    if ((cmd === "switch" || cmd === "handoff" || cmd === "set") && before.length === 2) {
      return filterPrefix(CLI_TYPES, cur);
    }
    if (cmd === "peek" && before.length === 2) {
      return filterPrefix(["status", "full"], cur);
    }
    if (cmd === "swap" && before.length === 2) {
      return filterPrefix(COMMON_TARGETS, cur);
    }
  }

  const subs = SUBS[cmd];
  if (subs && before.length === 1) {
    const list =
      cmd === "help"
        ? listTopLevelCompletionWords().filter((w) => !w.startsWith("-"))
        : subs.length
          ? subs
          : [];
    if (list.length) return filterPrefix(uniqSorted(list), cur);
  }

  // Flags often valid after verb
  if (cur.startsWith("-")) {
    return filterPrefix(GLOBAL_FLAGS, cur);
  }

  return [];
}

export function printCompletionReply(words: string[], cword: number): void {
  for (const w of completeArgv(words, cword)) {
    console.log(w);
  }
}

export function renderBashCompletion(): string {
  return `# seatmesh bash completion — eval "$(seatmesh completion bash)"
_seatmesh() {
  local cur cword
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cword="\${COMP_CWORD}"
  local out
  out="$(COMP_CWORD="$cword" seatmesh completion reply -- "\${COMP_WORDS[@]}")"
  # shellcheck disable=SC2207
  COMPREPLY=( $(compgen -W "$out" -- "$cur") )
}
complete -o default -F _seatmesh seatmesh
# npx seatmesh … (best-effort: only when 2nd word is seatmesh*)
_seatmesh_npx() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ "\${COMP_WORDS[1]}" == seatmesh* ]] || [[ "\${COMP_WORDS[1]}" == --* && "\${COMP_WORDS[2]}" == seatmesh* ]]; then
    local out
    out="$(COMP_CWORD="$COMP_CWORD" seatmesh completion reply -- "\${COMP_WORDS[@]}")"
    COMPREPLY=( $(compgen -W "$out" -- "$cur") )
    return
  fi
  return 1
}
complete -o default -F _seatmesh_npx npx 2>/dev/null || true
`;
}

export function renderZshCompletion(): string {
  return `#compdef seatmesh
# seatmesh zsh completion — eval "$(seatmesh completion zsh)"
_seatmesh() {
  local -a opts
  local out
  out="$(COMP_CWORD=$((CURRENT - 1)) seatmesh completion reply -- "\${words[@]}")"
  opts=("\${(f)out}")
  _describe 'seatmesh' opts || compadd -a opts
}
compdef _seatmesh sm
compdef _seatmesh seatmesh
`;
}

export function renderFishCompletion(): string {
  return `# seatmesh fish completion — seatmesh completion fish | source
function __seatmesh_complete
  set -l cword (count (commandline -opc))
  set -l words (commandline -opc)
  set -l cur (commandline -ct)
  if test -n "$cur"
    set cword (math $cword + 1)
    set -a words $cur
  end
  set -x COMP_CWORD (math $cword - 1)
  seatmesh completion reply -- $words
end
complete -c sm -f -a '(__seatmesh_complete)'
complete -c seatmesh -f -a '(__seatmesh_complete)'
`;
}

export function printCompletionInstallHint(): void {
  console.log(`seatmesh shell completion

Enable (pick your shell):
  # zsh
  echo 'eval "$(seatmesh completion zsh)"' >> ~/.zshrc && exec zsh

  # bash
  echo 'eval "$(seatmesh completion bash)"' >> ~/.bashrc && exec bash

  # fish
  seatmesh completion fish > ~/.config/fish/completions/seatmesh.fish

Then: sm <TAB>   → verbs
      sm agent <TAB>
      sm switch slot-1 <TAB>

Install: sm install  (symlinks sm + seatmesh to ~/.local/bin)
  Legacy npm bin name \`seatmesh\` still works; prefer \`sm\`.
`);
}

export function runCompletionCommand(args: string[]): void {
  const [sub, ...rest] = args;
  if (!sub || sub === "install" || sub === "-h" || sub === "--help" || sub === "help") {
    printCompletionInstallHint();
    return;
  }
  if (sub === "bash") {
    process.stdout.write(renderBashCompletion());
    return;
  }
  if (sub === "zsh") {
    process.stdout.write(renderZshCompletion());
    return;
  }
  if (sub === "fish") {
    process.stdout.write(renderFishCompletion());
    return;
  }
  if (sub === "reply") {
    // seatmesh completion reply -- word0 word1 …
    let words = rest;
    if (words[0] === "--") words = words.slice(1);
    const envCword = process.env.COMP_CWORD;
    let cword =
      envCword != null && envCword !== ""
        ? Number.parseInt(envCword, 10)
        : Math.max(0, words.length - 1);
    if (!Number.isFinite(cword) || cword < 0) cword = Math.max(0, words.length - 1);
    // When completing a trailing empty token, shells often omit it — allow +1
    if (cword >= words.length) {
      words = [...words, ""];
      cword = words.length - 1;
    }
    printCompletionReply(words, cword);
    return;
  }
  console.error("usage: seatmesh completion bash|zsh|fish|reply|install");
  process.exit(2);
}
