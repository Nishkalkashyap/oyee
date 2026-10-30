/** What the inform card shows (GLOSSARY.md: Inform), derived from the intent-shaped notification. Pure, so it's tested. */
import type { Field, IntentNotification, IntentSeverity, LinkButton, Severity } from "@oyee/schema";
import { isHttpUrl } from "./format";
import { safeHref } from "./markdown";
import { SEVERITY_STYLES } from "./severity";

/** An inform as received. While flat cards are still sent (until ticket 15), its severity may be the old `debug`. */
export type InformNotification = Omit<Extract<IntentNotification, { intent: "inform" }>, "severity"> & { severity: Severity };

export interface InformView {
  severity: IntentSeverity;
  severityLabel: string;
  resolved: boolean;
  /** The sender's emoji or image; null falls back to the severity glyph. */
  icon: { kind: "emoji"; text: string } | { kind: "image"; src: string } | null;
  title: string;
  body: string | null;
  image: string | null;
  rows: Field[];
  /** Link buttons, at most three, only with URLs safe to open. */
  links: LinkButton[];
  /** Where tapping the notification goes. */
  open: { url: string; host: string } | null;
}

const MAX_LINKS = 3;

export function informView(n: InformNotification): InformView {
  const { inform } = n;
  const icon = inform.icon?.trim();
  const open = n.url ? safeHref(n.url) : null;
  const severity = n.severity === "debug" ? "info" : n.severity;
  return {
    severity,
    severityLabel: SEVERITY_STYLES[severity].label,
    resolved: n.status === "resolved",
    icon: !icon ? null : isHttpUrl(icon) ? { kind: "image", src: icon } : { kind: "emoji", text: [...icon].slice(0, 2).join("") },
    title: n.title,
    body: n.body,
    image: inform.image && isHttpUrl(inform.image) ? inform.image : null,
    rows: inform.fields.map((f) => ({ label: f.label, value: f.value || "—" })),
    links: inform.links.filter((l) => safeHref(l.url)).slice(0, MAX_LINKS),
    open: open ? { url: open, host: hostOf(open) } : null,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
