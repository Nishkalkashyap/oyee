/**
 * Approximate mock-ups of how one notification renders as a system notification on each platform, per intent
 * (protocol §9). They're illustrations, not pixel-perfect replicas.
 */
import { useState, type ReactNode } from "react";
import type { Notification } from "@oyee/schema";
import { askView } from "../lib/ask";
import { SEVERITY_STYLES } from "../lib/severity";
import { webPushActions, webPushBody, webPushPresentation } from "../lib/webpush";
import { ChevronDownIcon } from "./Icons";
import { NotificationCard } from "./NotificationCard";
import { ProgressBar } from "./NotificationParts";
import { Segmented, cx, OyeeMark } from "./ui";

function AppGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center bg-brand font-extrabold text-brand-foreground",
        className,
      )}
    >
      <OyeeMark className="size-[62%]" />
    </span>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">{children}</p>;
}

const iconOf = (n: Notification) => (n.intent === "inform" ? n.inform.icon : null);
const imageOf = (n: Notification) => (n.intent === "inform" ? n.inform.image : null);
const emojiOf = (n: Notification) => {
  const icon = iconOf(n);
  return icon && !/^https?:/.test(icon) ? icon : null;
};
/** Every severity alerts; only a running progress updates quietly. */
const quiet = (n: Notification) => n.intent === "progress" && n.progress.state === "running";

/** Android's buttons (at most 3): an open ask's answers and inline reply, an inform's links then Resolve, a progress's Resolve. */
function androidButtons(n: Notification): string[] {
  if (n.intent === "ask") {
    const v = askView(n);
    if (!v.open) return [];
    const reply = v.reply ? [v.reply.placeholder] : [];
    return [...v.options.slice(0, 3 - reply.length).map((o) => o.label), ...reply];
  }
  const links = n.intent === "inform" ? n.inform.links.map((l) => l.label) : [];
  return links.length < 3 ? [...links, "✓ Resolve"] : links.slice(0, 3);
}

/** Apple's buttons: an open ask's answers and a text-input Reply, an inform's links; nothing else. */
function appleButtons(n: Notification): string[] {
  if (n.intent === "ask") {
    const v = askView(n);
    return v.open ? [...v.options.map((o) => o.label), ...(v.reply ? ["Reply"] : [])] : [];
  }
  return n.intent === "inform" ? n.inform.links.map((l) => l.label) : [];
}

export function AndroidPreview({ n }: { n: Notification }) {
  const s = SEVERITY_STYLES[n.severity];
  const text = webPushBody(n);
  const icon = iconOf(n);
  const image = imageOf(n);
  const emoji = emojiOf(n);
  const buttons = androidButtons(n);
  return (
    <div>
      <div className="rounded-[22px] bg-[#f2f0f7] p-3.5 text-[#1c1b1f] shadow-sm dark:bg-[#2b2930] dark:text-[#e6e1e5]">
        <div className="flex items-center gap-2 text-[11px] text-[#49454f] dark:text-[#cac4d0]">
          <AppGlyph className="size-5 rounded-full" />
          <span className="font-medium">Oyee</span>
          <span>•</span>
          <span className="truncate">{n.source}</span>
          <span>•</span>
          <span>now</span>
          <ChevronDownIcon size={14} className="ml-auto rotate-180" />
        </div>
        <div className="mt-2 flex gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold leading-tight">
              {emoji ? `${emoji} ` : ""}
              {n.title}
            </div>
            {text && <div className="mt-0.5 text-[13px] leading-snug whitespace-pre-line text-[#49454f] dark:text-[#cac4d0]">{text}</div>}
          </div>
          {icon && /^https:/.test(icon) && <img src={icon} alt="" className="size-10 rounded-lg object-cover" />}
        </div>
        {n.intent === "progress" && (
          <div className="mt-2.5">
            <ProgressBar progress={{ ...n.progress, label: undefined }} severity={n.severity} muted={n.progress.state === "stopped"} compact />
          </div>
        )}
        {image && <img src={image} alt="" className="mt-2.5 max-h-40 w-full rounded-xl object-cover" />}
        {buttons.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {buttons.map((b, i) => (
              <span
                key={i}
                className="rounded-full bg-[#e8def8] px-3 py-1.5 text-[12px] font-medium text-[#1d192b] dark:bg-[#4a4458] dark:text-[#e8def8]"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
      <Caption>
        Channel <code>oyee.{n.severity}</code>
        {quiet(n) ? " · updates quietly while running" : ""}
        <span className={cx("ml-1 inline-block size-1.5 rounded-full align-middle", s.dot)} />
      </Caption>
    </div>
  );
}

export function ApplePreview({ n, platform }: { n: Notification; platform: "ios" | "macos" }) {
  const title = `${emojiOf(n) ? `${emojiOf(n)} ` : ""}${n.title}`;
  const body = webPushBody(n);
  const image = imageOf(n);
  const buttons = appleButtons(n);
  const level = quiet(n) ? "passive" : "active";
  if (platform === "macos") {
    return (
      <div>
        <div className="flex gap-2.5 rounded-2xl border border-black/5 bg-white/80 p-3 text-[#1d1d1f] shadow-lg backdrop-blur dark:border-white/10 dark:bg-[#323232]/90 dark:text-white">
          <AppGlyph className="size-9 rounded-[9px]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="truncate text-[13px] font-semibold">{title}</div>
              <div className="shrink-0 text-[11px] text-black/45 dark:text-white/45">now</div>
            </div>
            <div className="truncate text-[12px] text-black/55 dark:text-white/55">{n.source}</div>
            <div className="line-clamp-4 text-[12.5px] leading-snug whitespace-pre-line text-black/70 dark:text-white/75">{body}</div>
          </div>
          {image && <img src={image} alt="" className="size-10 shrink-0 rounded-md object-cover" />}
        </div>
        {buttons.length > 0 && (
          <div className="mt-1.5 ml-auto w-44 overflow-hidden rounded-lg border border-black/5 bg-white/90 text-[12.5px] shadow-md dark:border-white/10 dark:bg-[#323232] dark:text-white">
            <div className="border-b border-black/5 px-3 py-1 text-[11px] text-black/45 dark:border-white/10 dark:text-white/45">Options</div>
            {buttons.map((b, i) => (
              <div key={i} className="px-3 py-1">
                {b}
              </div>
            ))}
          </div>
        )}
        <Caption>Grouped by source ({n.source}) · interruption level {level} · progress as text</Caption>
      </div>
    );
  }
  return (
    <div>
      <div className="rounded-[22px] bg-white/75 p-3 text-[#1d1d1f] shadow-lg ring-1 ring-black/5 backdrop-blur dark:bg-[#1c1c1e]/85 dark:text-white dark:ring-white/10">
        <div className="flex gap-2.5">
          <AppGlyph className="size-[38px] rounded-[9px]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="truncate text-[14px] font-semibold">{title}</div>
              <div className="shrink-0 text-[12px] text-black/40 dark:text-white/40">now</div>
            </div>
            <div className="line-clamp-4 text-[13.5px] leading-snug whitespace-pre-line text-black/80 dark:text-white/80">{body}</div>
          </div>
          {image && <img src={image} alt="" className="size-[38px] shrink-0 rounded-md object-cover" />}
        </div>
      </div>
      {buttons.length > 0 && (
        <div className="mt-1.5 overflow-hidden rounded-[14px] bg-white/75 text-[14px] shadow ring-1 ring-black/5 backdrop-blur dark:bg-[#1c1c1e]/85 dark:text-white dark:ring-white/10">
          {buttons.map((b, i) => (
            <div key={i} className={cx("px-4 py-2", i > 0 && "border-t border-black/5 dark:border-white/10")}>
              {b}
            </div>
          ))}
        </div>
      )}
      <Caption>Long-press actions shown · grouped by source · {level}</Caption>
    </div>
  );
}

export function WebPushPreview({ n }: { n: Notification }) {
  const p = webPushPresentation(n, true);
  const actions = webPushActions(n);
  const origin = typeof window !== "undefined" ? window.location.host : "oyee";
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-black/10 bg-white text-[#202124] shadow-lg dark:border-white/10 dark:bg-[#2d2e30] dark:text-[#e8eaed]">
        <div className="flex gap-3 p-3">
          {p.options.icon.startsWith("https://") ? (
            <img src={p.options.icon} alt="" className="size-10 rounded object-cover" />
          ) : (
            <AppGlyph className="size-10 rounded-lg" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{p.title}</div>
            <div className="text-[11px] text-black/50 dark:text-white/50">{origin}</div>
            <div className="mt-0.5 line-clamp-3 text-[12.5px] whitespace-pre-line text-black/70 dark:text-white/70">
              {p.options.body}
            </div>
          </div>
        </div>
        {p.options.image && <img src={p.options.image} alt="" className="max-h-36 w-full object-cover" />}
        {actions.length > 0 && (
          <div className="grid border-t border-black/10 dark:border-white/10" style={{ gridTemplateColumns: `repeat(${actions.length}, 1fr)` }}>
            {actions.map((a, i) => (
              <div
                key={a.action}
                className={cx("px-3 py-2 text-center text-[12.5px] font-medium", i > 0 && "border-l border-black/10 dark:border-white/10")}
              >
                {a.title}
              </div>
            ))}
          </div>
        )}
      </div>
      <Caption>
        {p.options.requireInteraction ? "Stays until dismissed (critical)" : "Auto-dismisses"}
        {p.options.silent ? " · silent while running" : ""} · max 2 buttons
        {n.intent === "ask" && n.ask.allowText ? " · Reply opens the inbox" : ""}
      </Caption>
    </div>
  );
}

type PreviewTab = "all" | "android" | "ios" | "macos" | "web" | "app";

export function PlatformPreviews({ notification, className }: { notification: Notification; className?: string }) {
  const [tab, setTab] = useState<PreviewTab>("all");
  const items: { id: Exclude<PreviewTab, "all">; label: string; node: ReactNode }[] = [
    { id: "app", label: "In-app card", node: <NotificationCard notification={notification} preview /> },
    { id: "android", label: "Android", node: <AndroidPreview n={notification} /> },
    { id: "ios", label: "iOS", node: <ApplePreview n={notification} platform="ios" /> },
    { id: "macos", label: "macOS", node: <ApplePreview n={notification} platform="macos" /> },
    { id: "web", label: "Web Push", node: <WebPushPreview n={notification} /> },
  ];
  const visible = tab === "all" ? items : items.filter((i) => i.id === tab);
  return (
    <div className={className}>
      <div className="mb-3 overflow-x-auto">
        <Segmented<PreviewTab>
          size="sm"
          value={tab}
          onChange={setTab}
          options={[{ value: "all", label: "All" }, ...items.map((i) => ({ value: i.id, label: i.label }))]}
        />
      </div>
      <div className="space-y-5">
        {visible.map((i) => (
          <section key={i.id}>
            <h4 className="mb-2 text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">{i.label}</h4>
            <div className="rounded-xl bg-[radial-gradient(circle_at_30%_20%,#c7d2fe_0,transparent_45%),radial-gradient(circle_at_80%_80%,#fbcfe8_0,transparent_40%)] p-3 dark:bg-[radial-gradient(circle_at_30%_20%,#312e81_0,transparent_45%),radial-gradient(circle_at_80%_80%,#4a044e_0,transparent_40%)]">
              {i.node}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
