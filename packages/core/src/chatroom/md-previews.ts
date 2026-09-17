/**
 * @deprecated Use hosted-mds (.sm/mds local gallery). Kept so older imports compile.
 */
export {
  listHostedMds as readMdPreviews,
  listHostedMds as listMdPreviewsNewestFirst,
  type HostedMdItem as MdPreviewRow,
} from "./hosted-mds.js";

export function appendMdPreview(): void {
  /* no-op — local .sm/mds files need no registry append */
}

export function mdPreviewsPath(): string {
  return "";
}
