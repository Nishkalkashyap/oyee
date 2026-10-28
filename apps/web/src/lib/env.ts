/** Runtime mode + small environment helpers. */

const MOCK_KEY = "herald:mock";

/**
 * Mock mode serves fixtures from an in-memory fake API (no backend needed).
 * Enabled by `VITE_MOCK=1` at build/dev time or `?mock=1` (sticky until `?mock=0`).
 */
export function isMockMode(): boolean {
  if (import.meta.env.VITE_MOCK === "1") return true;
  try {
    const param = new URLSearchParams(window.location.search).get("mock");
    if (param === "1") localStorage.setItem(MOCK_KEY, "1");
    if (param === "0") localStorage.removeItem(MOCK_KEY);
    return localStorage.getItem(MOCK_KEY) === "1";
  } catch {
    return false;
  }
}

/** Where users find the native apps' source. Override with VITE_REPO_URL. */
export const REPO_URL: string = (import.meta.env.VITE_REPO_URL as string | undefined) ?? "https://github.com/herald-oss/herald";
