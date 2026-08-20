export function isTrustedRendererUrl(
  value: string,
  developmentRendererUrl: string | undefined,
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "app:") {
      return url.host === "bundle";
    }
    return developmentRendererUrl !== undefined &&
      url.origin === new URL(developmentRendererUrl).origin;
  } catch {
    return false;
  }
}
