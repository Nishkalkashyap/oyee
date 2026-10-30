/**
 * Home after sign-in: what sends to you (MCP URLs and webhooks) on the left, the devices it reaches on the right.
 * One picture of the whole pipe, with an add button on each side and a nudge when something can't receive.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Device, Platform, TokenKind } from "@oyee/schema";
import { errorMessage } from "../lib/api";
import { formatDateTime, relativeTime } from "../lib/format";
import { useDevices, useRemoveDevice, useRenameDevice, useRevokeToken, useTokens } from "../lib/queries";
import { useWebPush } from "../lib/useWebPush";
import { CreateTokenDialog, KIND_COPY } from "../components/CreateTokenDialog";
import {
  ArrowRightIcon,
  BellIcon,
  BotIcon,
  GlobeIcon,
  LaptopIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  SmartphoneIcon,
  TrashIcon,
  WebhookIcon,
} from "../components/Icons";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import { Avatar, Badge, BrandMark, Button, ErrorBanner, PageHeader, Spinner, buttonClasses } from "../components/ui";

// The QR code library only loads when someone pairs.
const PairDialog = lazy(() => import("../components/PairDialog").then((m) => ({ default: m.PairDialog })));

const PLATFORM_LABEL: Record<Platform, string> = { android: "Android app", ios: "iOS app", macos: "Mac app", web: "Browser" };

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "macos") return <LaptopIcon size={19} />;
  if (platform === "web") return <GlobeIcon size={19} />;
  return <SmartphoneIcon size={19} />;
}

function Column({ title, count, action, children }: { title: string; count?: number; action: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-[22px] bg-zinc-50 p-2 dark:bg-zinc-800/50">
      <div className="flex min-h-11 items-center gap-2 px-3 pt-1 pb-1.5">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
        {!!count && <span className="text-[13px] font-semibold text-zinc-400 tabular-nums">{count}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

/** A connection or device. Row actions (revoke, rename, remove) show on hover with a mouse and always on touch. */
function Row({
  icon,
  title,
  badge,
  meta,
  metaTitle,
  status,
  actions,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  meta: ReactNode;
  metaTitle?: string;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-background dark:hover:bg-zinc-800">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{title}</span>
          {badge}
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-zinc-500 dark:text-zinc-400" title={metaTitle}>
          {meta}
        </div>
      </div>
      {status}
      {actions && (
        <div className="flex shrink-0 items-center transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-fine:opacity-0">{actions}</div>
      )}
    </div>
  );
}

function IconAction({ label, onClick, loading, children }: { label: string; onClick: () => void; loading?: boolean; children: ReactNode }) {
  return <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={label} title={label} loading={loading} icon={loading ? undefined : children} onClick={onClick} />;
}

// ─── Sends to you ───────────────────────────────────────────────────────────

const KIND_ICON: Record<TokenKind, ReactNode> = { mcp: <BotIcon size={19} />, webhook: <WebhookIcon size={19} /> };
const KIND_NAME: Record<TokenKind, string> = { mcp: "MCP server URL", webhook: "Webhook" };

function KindOption({ kind, onPick }: { kind: TokenKind; onPick: (k: TokenKind) => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onPick(kind)}
      className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-chip-foreground">{KIND_ICON[kind]}</span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold">{KIND_NAME[kind]}</span>
        <span className="block text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400">{KIND_COPY[kind].description}</span>
      </span>
    </button>
  );
}

function AddMenu({ onPick }: { onPick: (k: TokenKind) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <Button size="sm" icon={<PlusIcon size={14} />} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Add
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-[19rem] rounded-[20px] bg-background p-1.5 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
          {(["mcp", "webhook"] as const).map((k) => (
            <KindOption
              key={k}
              kind={k}
              onPick={(kind) => {
                setOpen(false);
                onPick(kind);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Senders({ onCreate }: { onCreate: (k: TokenKind) => void }) {
  const tokens = useTokens();
  const revoke = useRevokeToken();
  const toast = useToast();

  let body: ReactNode;
  if (tokens.isPending) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  } else if (tokens.error) {
    body = <ErrorBanner onRetry={() => void tokens.refetch()}>{errorMessage(tokens.error)}</ErrorBanner>;
  } else if (tokens.data.length === 0) {
    body = (
      <div className="px-1 pb-1">
        <p className="px-3 pb-2 text-[13.5px] text-zinc-500 dark:text-zinc-400">Nothing sends to you yet. Give an agent or a tool its own URL:</p>
        <KindOption kind="mcp" onPick={onCreate} />
        <KindOption kind="webhook" onPick={onCreate} />
      </div>
    );
  } else {
    body = tokens.data.map((t) => (
      <Row
        key={t.id}
        icon={<Avatar name={t.label} size={40} />}
        title={t.label}
        badge={<Badge>{t.kind === "mcp" ? "MCP" : "Webhook"}</Badge>}
        meta={
          <>
            <code className="font-mono text-[11.5px]">{t.prefix}…</code>
            {" · "}
            {t.lastUsedAt ? `used ${relativeTime(t.lastUsedAt)}` : "never used"}
            {t.defaultSource && ` · source: ${t.defaultSource}`}
          </>
        }
        metaTitle={`Created ${formatDateTime(t.createdAt)}`}
        actions={
          <IconAction
            label="Revoke"
            loading={revoke.isPending && revoke.variables === t.id}
            onClick={() => {
              if (!confirm(`Revoke “${t.label}”? Anything using this ${t.kind === "mcp" ? "MCP URL" : "webhook"} will stop working.`)) return;
              revoke.mutate(t.id, {
                onSuccess: () => toast.success("Revoked", t.label),
                onError: (e) => toast.error("Couldn't revoke", errorMessage(e)),
              });
            }}
          >
            <TrashIcon size={14} />
          </IconAction>
        }
      />
    ));
  }

  return (
    <Column title="Sends to you" count={tokens.data?.length} action={<AddMenu onPick={onCreate} />}>
      {body}
    </Column>
  );
}

// ─── Reaches you on ─────────────────────────────────────────────────────────

function DeviceRow({ d, thisBrowser, onRemoveThisBrowser }: { d: Device; thisBrowser: boolean; onRemoveThisBrowser: () => Promise<void> }) {
  const remove = useRemoveDevice();
  const rename = useRenameDevice();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  return (
    <Row
      icon={
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-secondary-label dark:bg-zinc-800">
          <PlatformIcon platform={d.platform} />
        </span>
      }
      title={d.name}
      badge={thisBrowser ? <Badge className="bg-chip text-chip-foreground">This browser</Badge> : undefined}
      meta={`${PLATFORM_LABEL[d.platform]} · ${d.lastSeenAt ? `seen ${relativeTime(d.lastSeenAt)}` : "never seen"}`}
      metaTitle={`Added ${formatDateTime(d.createdAt)}`}
      status={d.transports.length === 0 && <span className="shrink-0 text-[12.5px] font-semibold text-amber-600 dark:text-amber-400">No push channel</span>}
      actions={
        <>
          <IconAction
            label="Rename"
            loading={rename.isPending}
            onClick={() => {
              const name = prompt("Device name (agents can target devices by this name)", d.name)?.trim();
              if (!name || name === d.name) return;
              rename.mutate(
                { id: d.id, name },
                {
                  onSuccess: () => toast.success("Renamed", name),
                  onError: (e) => toast.error("Couldn't rename", errorMessage(e)),
                },
              );
            }}
          >
            <PencilIcon size={13} />
          </IconAction>
          <IconAction
            label="Remove"
            loading={removing || remove.isPending}
            onClick={() => {
              if (!confirm(`Remove “${d.name}”? It stops receiving notifications${thisBrowser ? "" : " and must be paired again"}.`)) return;
              if (thisBrowser) {
                setRemoving(true);
                void onRemoveThisBrowser().finally(() => setRemoving(false));
                return;
              }
              remove.mutate(d.id, {
                onSuccess: () => toast.success("Removed", d.name),
                onError: (e) => toast.error("Couldn't remove", errorMessage(e)),
              });
            }}
          >
            <TrashIcon size={14} />
          </IconAction>
        </>
      }
    />
  );
}

function Receivers({ onPair }: { onPair: () => void }) {
  const devices = useDevices();
  const push = useWebPush(devices.data);
  const toast = useToast();
  const list = devices.data ?? [];
  const browserListed = push.state === "on" && list.some((d) => d.id === push.deviceId);
  const offerBrowser = push.state === "off" || push.state === "blocked";
  // Why this browser can't get pushes, when there's something to say about it.
  const browserNote =
    push.state === "unsupported"
      ? /iPhone|iPad/.test(navigator.userAgent)
        ? "On iPhone and iPad, add Oyee to your Home Screen (Share → Add to Home Screen) and open it from there."
        : "This browser can't get push notifications here. It needs HTTPS and the Push API."
      : push.state === "unconfigured"
        ? "This server doesn't have Web Push set up (VAPID keys). The inbox still updates live while it's open."
        : null;

  const turnOn = async () => {
    const d = await push.enable();
    if (d) toast.success("Notifications on in this browser", d.name);
  };

  return (
    <Column
      title="Reaches you on"
      count={list.length}
      action={
        <Button size="sm" variant="brand" icon={<PlusIcon size={14} />} onClick={onPair}>
          Connect a device
        </Button>
      }
    >
      {devices.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : devices.error ? (
        <ErrorBanner onRetry={() => void devices.refetch()}>{errorMessage(devices.error)}</ErrorBanner>
      ) : (
        <>
          {list.length === 0 && (
            <p className="px-3 pb-2 text-[13.5px] text-zinc-500 dark:text-zinc-400">
              Nothing receives your notifications yet. Pair the Android or Mac app{offerBrowser ? ", or turn on this browser" : ""}.
            </p>
          )}
          {list.map((d) => (
            <DeviceRow
              key={d.id}
              d={d}
              thisBrowser={browserListed && d.id === push.deviceId}
              onRemoveThisBrowser={async () => {
                await push.disable();
                toast.success("Notifications off in this browser");
              }}
            />
          ))}
          {offerBrowser && (
            <Row
              icon={
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700">
                  <GlobeIcon size={19} />
                </span>
              }
              title="This browser"
              meta={push.state === "blocked" ? "Allow notifications for this site in your browser's settings, then reload." : "Get notifications here, even with the tab closed."}
              status={
                push.state === "blocked" ? (
                  <span className="shrink-0 text-[12.5px] font-semibold text-amber-600 dark:text-amber-400">Blocked</span>
                ) : (
                  <Button size="sm" icon={<BellIcon size={13} />} loading={push.busy} onClick={() => void turnOn()}>
                    Turn on
                  </Button>
                )
              }
            />
          )}
          {browserNote && (
            <Row
              icon={
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700">
                  <GlobeIcon size={19} />
                </span>
              }
              title="This browser"
              meta={<span className="whitespace-normal">{browserNote}</span>}
            />
          )}
          {push.error && <p className="px-3 pt-1 pb-2 text-xs text-red-600 dark:text-red-400">{push.error}</p>}
        </>
      )}
    </Column>
  );
}

export function HomePage() {
  const [kind, setKind] = useState<TokenKind | null>(null);
  const [pairing, setPairing] = useState(false);
  return (
    <PageContainer wide>
      <PageHeader
        title="Home"
        description="What sends to you, and where it lands."
        actions={
          <Link to="/send" className={buttonClasses("secondary", "md")}>
            <SendIcon size={14} /> Send a test
          </Link>
        }
      />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] lg:gap-0">
        <Senders onCreate={setKind} />
        <div aria-hidden className="hidden items-center justify-center gap-1 self-stretch text-zinc-300 lg:flex dark:text-zinc-600">
          <ArrowRightIcon size={16} />
          <BrandMark className="size-9 rounded-xl" />
          <ArrowRightIcon size={16} />
        </div>
        <Receivers onPair={() => setPairing(true)} />
      </div>
      <CreateTokenDialog kind={kind} onClose={() => setKind(null)} />
      {pairing && (
        <Suspense fallback={null}>
          <PairDialog open onClose={() => setPairing(false)} />
        </Suspense>
      )}
    </PageContainer>
  );
}

