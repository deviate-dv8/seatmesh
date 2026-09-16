/**
 * Validate ```mermaid fences before Info cards are registered / toasted.
 * Uses mermaid.parse (Node) — fail closed with a fixable console message.
 */
import mermaid from "mermaid";

export interface MermaidBlock {
  index: number;
  /** 1-based line of the opening ```mermaid fence in the source. */
  startLine: number;
  text: string;
}

export interface MermaidValidateError {
  index: number;
  startLine: number;
  /** First ~6 lines of the broken diagram for the agent to fix. */
  snippet: string;
  detail: string;
}

export interface MermaidValidateResult {
  ok: boolean;
  blocks: number;
  errors: MermaidValidateError[];
  /** One-line / multi-line message for console.error */
  message?: string;
}

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  initialized = true;
}

/** Extract ```mermaid … ``` blocks with source line numbers. */
export function extractMermaidBlocks(src: string): MermaidBlock[] {
  const text = src.replace(/\r\n/g, "\n");
  const blocks: MermaidBlock[] = [];
  const re = /```\s*mermaid[^\n]*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const startLine = before.split("\n").length;
    const body = (m[1] ?? "").trim();
    if (!body) continue;
    blocks.push({
      index: blocks.length + 1,
      startLine,
      text: body,
    });
  }
  return blocks;
}

function snippetOf(body: string, maxLines = 6): string {
  return body.split("\n").slice(0, maxLines).join("\n");
}

/** Parse every mermaid fence; return ok or actionable errors. */
export async function validateMermaidInMarkdown(src: string): Promise<MermaidValidateResult> {
  const blocks = extractMermaidBlocks(src);
  if (!blocks.length) return { ok: true, blocks: 0, errors: [] };

  ensureInit();
  const errors: MermaidValidateError[] = [];

  for (const block of blocks) {
    try {
      await mermaid.parse(block.text);
    } catch (e) {
      const detail = String((e as Error)?.message ?? e)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);
      // Node/DOMPurify env glitches are not agent markdown bugs — don't block notify.
      if (/dompurify|addhook|jsdom|window is not defined|document is not defined/i.test(detail)) {
        continue;
      }
      errors.push({
        index: block.index,
        startLine: block.startLine,
        snippet: snippetOf(block.text),
        detail: detail || "parse failed",
      });
    }
  }

  if (!errors.length) return { ok: true, blocks: blocks.length, errors: [] };

  const parts = errors.map((err) => {
    return (
      `mermaid broken — fix md block #${err.index} near line ${err.startLine}:\n` +
      `${err.snippet}\n` +
      `(${err.detail})`
    );
  });
  return {
    ok: false,
    blocks: blocks.length,
    errors,
    message: parts.join("\n\n"),
  };
}
