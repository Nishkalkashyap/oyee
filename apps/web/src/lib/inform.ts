/** What the inform card shows (GLOSSARY.md: Inform), derived from the intent-shaped notification. Pure, so it's tested. */
import { LIMITS, type Field, type LinkButton, type Notification, type Severity } from "@oyee/schema";
import { isHttpUrl } from "./format";
import { safeHref } from "./markdown";
import { SEVERITY_STYLES } from "./severity";

export type InformNotification = Extract<Notification, { intent: "inform" }>;

export interface InformView {
  severity: Severity;
  severityLabel: string;
  resolved: boolean;
  /** The sender's emoji or image; null falls back to the severity glyph. */
  icon: { kind: "emoji"; text: string } | { kind: "image"; src: string } | null;
  title: string;
  body: string | null;
  image: string | null;
  rows: Field[];
  /** Link buttons, at most `LIMITS.maxLinks`, only with URLs safe to open. */
  links: LinkButton[];
  /** Where tapping the notification goes. */
  open: { url: string; host: string } | null;
}

export function informView(n: InformNotification): InformView {
  const { inform } = n;
  const icon = inform.icon?.trim();
  const open = n.url ? safeHref(n.url) : null;
  return {
    severity: n.severity,
    severityLabel: SEVERITY_STYLES[n.severity].label,
    resolved: n.status === "resolved",
    icon: !icon ? null : isHttpUrl(icon) ? { kind: "image", src: icon } : { kind: "emoji", text: [...icon].slice(0, 2).join("") },
    title: n.title,
    body: n.body,
    image: inform.image && isHttpUrl(inform.image) ? inform.image : null,
    rows: inform.fields.map((f) => ({ label: f.label, value: f.value || "—" })),
    links: inform.links.filter((l) => safeHref(l.url)).slice(0, LIMITS.maxLinks),
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
