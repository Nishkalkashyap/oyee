/** Sign-in helpers shared by the landing page. */

const LOGIN_ERRORS: Record<string, string> = {
  not_allowed: "This email isn't allowed on this Oyee instance. Ask the admin to add it to ALLOWED_EMAILS.",
  too_many_signups: "Too many new accounts were created from your network today. Try again tomorrow.",
  access_denied: "Google sign-in was cancelled.",
  invalid_state: "The sign-in session expired or was tampered with. Please try again.",
  oauth_failed: "Google sign-in failed. Please try again.",
  not_configured: "Google sign-in isn't configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
};

export function loginErrorMessage(code: string): string {
  return LOGIN_ERRORS[code] ?? `Sign-in failed (${code}). Please try again.`;
}

/** Only allow same-origin relative redirects. */
export function safeRedirect(r: string | null): string {
  return r && r.startsWith("/") && !r.startsWith("//") ? r : "/";
}
