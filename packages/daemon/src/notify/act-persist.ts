/**
 * Persist act cards + tokens so Yes/No / Info survive inbox restart + reboot.
 */
import fs from "node:fs";
import type { NotifyActCardRow, NotifyActTokenRow, NotifyActRegistry } from "../notify/notify-act.js";

export interface PersistedActState {
  cards: NotifyActCardRow[];
  tokens: NotifyActTokenRow[];
  savedAt: string;
}

function readState(file: string): PersistedActState {
  if (!fs.existsSync(file)) return { cards: [], tokens: [], savedAt: "" };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as PersistedActState;
    return {
      cards: Array.isArray(raw.cards) ? raw.cards : [],
      tokens: Array.isArray(raw.tokens) ? raw.tokens : [],
      savedAt: raw.savedAt ?? "",
    };
  } catch {
    return { cards: [], tokens: [], savedAt: "" };
  }
}

export function saveActRegistry(file: string, reg: NotifyActRegistry): void {
  const snap = reg.snapshot();
  const now = Date.now();
  const cards = snap.cards.filter((c) => c.expiresAt > now);
  const tokens = snap.tokens.filter((t) => t.expiresAt > now && !t.used);
  fs.mkdirSync(file.replace(/[/\\][^/\\]+$/, "") || ".", { recursive: true });
  const state: PersistedActState = {
    cards,
    tokens,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

/** Hydrate in-memory registry from disk. Returns restored card count. */
export function restoreActRegistry(file: string, reg: NotifyActRegistry): number {
  const state = readState(file);
  const now = Date.now();
  const cards = state.cards.filter((c) => c.expiresAt > now);
  const tokens = state.tokens.filter((t) => t.expiresAt > now && !t.used);
  reg.hydrate({ cards, tokens });
  return cards.length;
}
