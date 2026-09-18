/** One-shot notification link → inbox daemon side effect (GET /act/v1/:token). */

export type NotifyActType =
  | "peer"
  | "inbox-resolve"
  | "checkback-ack"
  | "ping"
  /** Operator-approved shell in workspace (after Review card). */
  | "run-cmd";

export interface NotifyActRegisterAction {
  label: string;
  type: NotifyActType;
  params: Record<string, unknown>;
}

export interface NotifyActLink {
  label: string;
  url: string;
  token: string;
}

/** Browser decision card (Info) — title/body + Yes/No act links; not one-shot. */
export interface NotifyActCard {
  id: string;
  title: string;
  body: string;
  infoUrl: string;
  links: NotifyActLink[];
  expiresAt: number;
}

export interface NotifyActRegisterCardInput {
  title: string;
  body: string;
  /** External https URL → "Open" button on the Info card (not a one-shot act). */
  openUrl?: string;
}

