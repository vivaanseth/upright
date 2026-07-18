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
    const isLoopbackDevelopmentHost = [
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
    ].includes(developmentUrl.hostname);
    if (!isLoopbackDevelopmentHost) return false;
    return url.protocol === "http:" && url.origin === developmentUrl.origin;
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
  if (!mediaTypes || mediaTypes.length === 0) return false;
  return mediaTypes.every((type) => type === "video");
}

export function validateTrustedExternalUrl(input: string): string {
  const url = new URL(input);
  const isTrustedHost =
    url.hostname === "github.com" || url.hostname === "developers.google.com";
  if (
    url.protocol !== "https:" ||
    !isTrustedHost ||
    url.username ||
    url.password
  ) {
    throw new Error(`Untrusted external URL configured for Upright: ${input}`);
  }
  return url.toString().replace(/\/$/, "");
}
