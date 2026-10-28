/**
 * Approximate mock-ups of how one card renders as a system notification on each platform (protocol §9 / PLAN §5.5).
 * They're illustrations, not pixel-perfect replicas.
 */
import { useState, type ReactNode } from "react";
import type { Notification } from "@herald/schema";
import { fieldLines, systemNotificationBody } from "../lib/format";
import { markdownToPlainText } from "../lib/markdown";
import { SEVERITY_STYLES } from "../lib/severity";
import { webPushActions, webPushPresentation } from "../lib/webpush";
import { BellIcon, ChevronDownIcon } from "./Icons";
import { NotificationCard } from "./NotificationCard";
import { ProgressBar } from "./NotificationParts";
import { Segmented, cx } from "./ui";

function AppGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center bg-brand font-extrabold text-brand-foreground",
        className,
      )}
    >
      h
    </span>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">{children}</p>;
}

export function AndroidPreview({ n }: { n: Notification }) {
  const s = SEVERITY_STYLES[n.severity];
  const text = [markdownToPlainText(n.body).trim(), ...fieldLines(n.fields)].filter(Boolean).join("\n");
  const buttons = [...(n.reply ? [n.reply.buttonLabel || "Reply"] : []), ...n.actions.map((a) => a.label)];
  const shown = buttons.slice(0, 3);
  const channel = `herald.${n.severity}`;
  return (
    <div>
      <div className="rounded-[22px] bg-[#f2f0f7] p-3.5 text-[#1c1b1f] shadow-sm dark:bg-[#2b2930] dark:text-[#e6e1e5]">
        <div className="flex items-center gap-2 text-[11px] text-[#49454f] dark:text-[#cac4d0]">
          <AppGlyph className="size-5 rounded-full" />
          <span className="font-medium">Herald</span>
          <span>•</span>
          <span className="truncate">{n.source}</span>
          <span>•</span>
          <span>now</span>
          <ChevronDownIcon size={14} className="ml-auto rotate-180" />
        </div>
        <div className="mt-2 flex gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold leading-tight">
              {n.icon && !/^https?:/.test(n.icon) ? `${n.icon} ` : ""}
              {n.title}
            </div>
            {text && <div className="mt-0.5 text-[13px] leading-snug whitespace-pre-line text-[#49454f] dark:text-[#cac4d0]">{text}</div>}
          </div>
          {n.icon && /^https:/.test(n.icon) && <img src={n.icon} alt="" className="size-10 rounded-lg object-cover" />}
        </div>
        {n.progress && (
          <div className="mt-2.5">
            <ProgressBar progress={{ ...n.progress, label: undefined }} severity={n.severity} compact />
          </div>
        )}
        {n.image && <img src={n.image} alt="" className="mt-2.5 max-h-40 w-full rounded-xl object-cover" />}
        {shown.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {shown.map((b, i) => (
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
        Channel <code>{channel}</code>
        {n.silent ? " · silent" : ""}
        {buttons.length > 3 ? " · Android shows at most 3 buttons" : ""}
        <span className={cx("ml-1 inline-block size-1.5 rounded-full align-middle", s.dot)} />
      </Caption>
    </div>
  );
}

export function ApplePreview({ n, platform }: { n: Notification; platform: "ios" | "macos" }) {
  const body = systemNotificationBody(n);
  const buttons = [...n.actions.map((a) => a.label), ...(n.reply ? [n.reply.buttonLabel || "Reply"] : [])];
  const level =
    n.severity === "critical" ? "time-sensitive" : n.severity === "debug" || n.silent ? "passive" : "active";
  if (platform === "macos") {
    return (
      <div>
        <div className="flex gap-2.5 rounded-2xl border border-black/5 bg-white/80 p-3 text-[#1d1d1f] shadow-lg backdrop-blur dark:border-white/10 dark:bg-[#323232]/90 dark:text-white">
          <AppGlyph className="size-9 rounded-[9px]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="truncate text-[13px] font-semibold">{n.title}</div>
              <div className="shrink-0 text-[11px] text-black/45 dark:text-white/45">now</div>
            </div>
            <div className="line-clamp-4 text-[12.5px] leading-snug whitespace-pre-line text-black/70 dark:text-white/75">{body}</div>
          </div>
          {n.image && <img src={n.image} alt="" className="size-10 shrink-0 rounded-md object-cover" />}
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
        <Caption>Thread {n.threadId ?? n.source} · interruption level {level} · progress as text</Caption>
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
              <div className="truncate text-[14px] font-semibold">{n.title}</div>
              <div className="shrink-0 text-[12px] text-black/40 dark:text-white/40">now</div>
            </div>
            <div className="line-clamp-4 text-[13.5px] leading-snug whitespace-pre-line text-black/80 dark:text-white/80">{body}</div>
          </div>
          {n.image && <img src={n.image} alt="" className="size-[38px] shrink-0 rounded-md object-cover" />}
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
      <Caption>Long-press actions shown · thread {n.threadId ?? n.source} · {level}</Caption>
    </div>
  );
}

export function WebPushPreview({ n }: { n: Notification }) {
  const p = webPushPresentation(n, true);
  const actions = webPushActions(n);
  const origin = typeof window !== "undefined" ? window.location.host : "herald";
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
        {p.options.silent ? " · silent" : ""} · max 2 buttons; URL actions open from the inbox
        {n.reply ? " · reply opens the inbox" : ""}
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
