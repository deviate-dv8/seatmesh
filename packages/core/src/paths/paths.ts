import path from "node:path";

export function resolveWorkspace(profileWorkspace: string, profileDir: string): string {
  const raw = profileWorkspace.trim();
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.normalize(path.resolve(profileDir, raw));
}

export function resolveFromWorkspace(workspace: string, rel: string): string {
  return path.normalize(path.resolve(workspace, rel));
}

export function resolveFromProfile(profileDir: string, rel: string): string {
  return path.normalize(path.resolve(profileDir, rel));
}

export function portsForSlot(formula: string, slot: number): string {
  return formula.replace(/\{n\}/g, String(slot));
}
