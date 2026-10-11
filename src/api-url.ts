/** A separate HTTPS API origin is optional; local previews stay same-origin. */
export function apiUrl(path: string, origin: string): string {
  if (!origin) return `/api/${path}`;
  const url = new URL(origin);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("VITE_API_ORIGIN must be an HTTPS origin without credentials, a path or query.");
  }
  return `${url.origin}/api/${path}`;
}
