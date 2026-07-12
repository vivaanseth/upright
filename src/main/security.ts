import { isAbsolute, relative, resolve } from "node:path";

export interface RendererTrustOptions {
  isPackaged: boolean;
  developmentUrl?: string;
}

export function isTrustedRendererUrl(
  input: string,
  options: RendererTrustOptions,
): boolean {
  try {
    const url = new URL(input);
    if (
      url.protocol === "app:" &&
      url.hostname === "posture" &&
      url.port === ""
    ) {
      return true;
    }

    if (options.isPackaged || !options.developmentUrl) return false;
    const developmentUrl = new URL(options.developmentUrl);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.origin === developmentUrl.origin
    );
  } catch {
    return false;
  }
}

export function resolveRendererAsset(
  rendererRoot: string,
  requestUrl: string,
): string | null {
  try {
    const url = new URL(requestUrl);
    if (
      url.protocol !== "app:" ||
      url.hostname !== "posture" ||
      url.port !== ""
    ) {
      return null;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const decoded = decodeURIComponent(pathname).replaceAll("\\", "/");
    const candidate = resolve(rendererRoot, `.${decoded}`);
    const child = relative(rendererRoot, candidate);
    if (child.startsWith("..") || isAbsolute(child)) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function isVideoOnlyMediaRequest(
  mediaTypes: readonly string[] | undefined,
): boolean {
  if (!mediaTypes || mediaTypes.length === 0) return true;
  return mediaTypes.every((type) => type === "video");
}
