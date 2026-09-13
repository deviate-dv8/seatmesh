/** One-shot notification link → inbox daemon side effect (GET /act/v1/:token). */

export type NotifyActType = "peer" | "inbox-resolve" | "checkback-ack" | "ping";

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
