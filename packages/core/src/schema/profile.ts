import { z } from "zod";
import { LayoutSchema } from "./layout.js";
import { UxSchema } from "./ux.js";

const ConnectivityPolicySchema = z.object({
  rebootWifiBounce: z.boolean().default(false),
  smartRestart: z.boolean().default(false),
  /** Legacy reboot-loop cap (cpe-proxy-rotate-until.sh); OC-LIMIT default is wait-ip poll. */
  rotateMaxAttempts: z.number().int().min(0).default(15),
  /** Max seconds to poll ipify for a new carrier IP (no CPE reboot). */
  waitIpMaxSec: z.number().int().min(60).default(3600),
  waitIpPollSec: z.number().int().min(5).default(30),
  cooldownMs: z.number().int().min(0).default(1_800_000),
  /** Consecutive ipify probe failures before PROXY-DOWN recovery (wifi-probe / cpe-proxy-up). */
  ipifyFailBeforeRecovery: z.number().int().min(1).default(15),
  /** Consecutive oc-connect observations on a pane before it counts toward PROXY-DOWN (debounce stale scrollback). */
  connectFailBeforeRecovery: z.number().int().min(1).default(15),
});

const ConnectivityDriversSchema = z
  .object({
    cpe: z
      .object({
        host: z.string().default("192.168.100.1"),
        rebootPath: z.string().default("/api/system/fun"),
      })
      .optional(),
    gost: z
      .object({
        container: z.string().optional(),
      })
      .optional(),
  })
  .optional();

/** User-supplied scripts when connectivity.driver === "script". See docs/PORTABILITY.md */
const ConnectivityHooksSchema = z
  .object({
    status: z.string().optional(),
    up: z.string().optional(),
    rotate: z.string().optional(),
    smartRestart: z.string().optional(),
  })
  .optional();

const DataRootSchema = z
  .object({
    /** Runtime root — relative to profileDir when paths.scope=profile (default runtime). */
    root: z.string().default("runtime"),
  })
  .optional();

const PathsScopeSchema = z
  .object({
    /** profile = harness paths under .sm/; workspace = legacy workspace-relative */
    scope: z.enum(["profile", "workspace"]).default("profile"),
  })
  .optional();

const StorageSchema = z
  .object({
    backend: z.enum(["sqlite", "jsonl"]).default("sqlite"),
    sqlite: z
      .object({
        path: z.string().default("runtime/mesh.sqlite"),
      })
      .default({}),
    jsonl: z
      .object({
        dir: z.string().default("runtime/daemon"),
      })
      .default({}),
  })
  .default({});

export const MeshProfileSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().min(1),
  layout: LayoutSchema.optional(),
  session: z.object({
    name: z.string().default("mesh"),
    /** workspace = suffix tmux session with hash of workspace path; global = fixed name */
    scope: z.enum(["workspace", "global"]).default("workspace"),
    idLength: z.number().int().min(4).max(12).default(6),
    workerCount: z.number().int().min(1).max(32).default(6),
    miniMax: z.number().int().min(1).max(16).default(8),
  }),
  orchestrator: z
    .object({
      drain: z
        .object({
          maxInjectPerTick: z.number().int().default(1),
          digestCooldownMs: z.number().int().default(5000),
          idleSettleMs: z.number().int().default(5000),
        })
        .default({}),
    })
    .optional(),
  paths: PathsScopeSchema,
  storage: StorageSchema,
  providers: z
    .array(z.enum(["cursor-agent", "kiro", "claude", "opencode", "empty"]))
    .default(["cursor-agent", "kiro", "claude", "opencode", "empty"]),
  seats: z.object({
    root: z.string().default("seats"),
    templates: z.array(z.string()).default(["FOCUS", "TASKS", "REMINDER"]),
    dirs: z
      .record(z.string(), z.string())
      .default({
        manager: "manager",
        secretary: "secretary",
        worker: "slot-{n}",
        mini: "mini-{n}",
      }),
  }),
  state: z.object({
    /** Optional read-only seed file until mesh-agents.json exists. */
    agentsJson: z.string().default("tmux-main-agents.json"),
    /** Mesh-owned slot state (CLI type + resume per slot). */
    meshAgentsJson: z.string().default("mesh-agents.json"),
    /** Periodic scrape interval for `./sm.sh auto` (default 10 min). 0 = off. */
    autoScrapeIntervalMs: z.number().int().min(0).default(600_000),
  }),
  daemon: z
    .object({
      /** Fixed port when portScope=profile */
      port: z.number().int().default(31670),
      /** workspace = portBase + hash offset; profile = use port */
      portScope: z.enum(["workspace", "profile"]).default("workspace"),
      portBase: z.number().int().default(31670),
      portRange: z.number().int().min(1).max(500).default(90),
      /** Start mesh inbox daemon with session/reload (engine — not manual inbox start). */
      autoStart: z.boolean().default(true),
      /** Supervisor: crash restart + reload when dist/mesh-inbox-server.js changes after build. */
      watch: z.boolean().default(true),
      restartDelayMs: z.number().int().default(1500),
      hmrPollMs: z.number().int().default(2000),
      pollMs: z.number().int().default(4000),
      idleSettleSec: z.number().int().default(5),
      /** TEMP: do not hold PEER/INBOX on composer typing (still hold busy/settle). */
      skipTypingGate: z.boolean().default(false),
      managerPromptPrefix: z
        .string()
        .default("[agent-manager-kiro-cursor-claude]"),
    })
    .default({}),
  ports: z
    .object({
      worker: z.string().default("30{n}0/30{n}1"),
    })
    .default({}),
  roles: z.object({
    dir: z.string().default("roles"),
  }),
  /** AGENT-FUNC-GUARDS.md func registry — `./sm.sh func <id> <args>` attached externals. */
  external: z
    .object({
      default: z.enum(["allow", "deny"]).default("allow"),
    })
    .default({}),
  funcs: z.record(z.string(), z.object({ command: z.string() })).default({}),
  data: DataRootSchema,
  connectivity: z
    .object({
      enabled: z.boolean().default(false),
      proxyPort: z.number().int().default(18887),
      /** none | http-proxy | script | cpe — see docs/PORTABILITY.md */
      driver: z
        .enum(["none", "http-proxy", "script", "cpe"])
        .default("none"),
      hooks: ConnectivityHooksSchema,
      drivers: ConnectivityDriversSchema,
      policy: ConnectivityPolicySchema.default({}),
    })
    .optional(),
  chatRooms: z
    .object({
      root: z.string().default("chat-rooms"),
      /** Default room for every tmux agent; manager/secretary broadcast here. */
      globalSlug: z.string().default("global"),
      checkback: z
        .object({
          duration: z.string().default("5m"),
          renew: z.string().default("3m"),
          /** Room call accept/decline wait — short so callers are not stuck on 5m. */
          callPending: z
            .object({
              duration: z.string().default("1m"),
              renew: z.string().default("1m"),
            })
            .default({}),
        })
        .default({}),
    })
    .optional(),
  chatFiles: z
    .object({
      root: z.string().default("chat-files"),
      filename: z.string().default("CHAT.jsonl"),
    })
    .optional(),
  /** External stack driver invoked by the stack subcommand (omit when unused). */
  stack: z
    .object({
      command: z.string(),
      summary: z.string().optional(),
    })
    .optional(),
  /**
   * UX tool detection — regex rules on pane capture for border status + daemon triggers.
   * Omit to use built-in provider heuristics (legacy). Set `useDefaults: true` for harness parity.
   */
  ux: UxSchema.optional(),
  /** Foreign mesh sessions on this host (cross-session peer via `@alias:seat`). */
  remotes: z
    .record(
      z.string(),
      z.object({
        /** Path to foreign `.sm/` dir or mesh.config.yaml. */
        profile: z.string().min(1),
      }),
    )
    .optional(),
});

export type MeshProfile = z.infer<typeof MeshProfileSchema>;
export type ConnectivityPolicy = z.infer<typeof ConnectivityPolicySchema>;
