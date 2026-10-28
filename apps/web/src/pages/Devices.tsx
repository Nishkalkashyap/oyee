import { useEffect, useRef, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Device, PairingCode, Platform } from "@herald/schema";
import { errorMessage } from "../lib/api";
import { REPO_URL, isMockMode } from "../lib/env";
import { formatCountdown, formatDateTime, formatPairingCode, relativeTime } from "../lib/format";
import {
  browserDeviceName,
  getExistingSubscription,
  getWebDeviceId,
  isPushSupported,
  rememberWebDeviceId,
  subscribeToPush,
  unsubscribeFromPush,
} from "../lib/push";
import { useConfig, useCreatePairingCode, useDevices, useRegisterWebDevice, useRemoveDevice, useRenameDevice, useSendNotification } from "../lib/queries";
import { CopyButton } from "../components/Code";
import { BellIcon, DevicesIcon, GlobeIcon, LaptopIcon, PlusIcon, RefreshIcon, SmartphoneIcon, TrashIcon } from "../components/Icons";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, PageHeader, Panel, Segmented, Spinner, cx } from "../components/ui";

const PLATFORM_LABEL: Record<Platform, string> = { android: "Android", ios: "iOS", macos: "macOS", web: "Web" };

function PlatformIcon({ platform, size = 16 }: { platform: Platform; size?: number }) {
  if (platform === "macos") return <LaptopIcon size={size} />;
  if (platform === "web") return <GlobeIcon size={size} />;
  return <SmartphoneIcon size={size} />;
}

function useCountdown(expiresAt: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Date.parse(expiresAt) - now) : 0;
}

type PairPlatform = "android" | "ios" | "macos";

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-600 marker:text-zinc-400 dark:text-zinc-400">{children}</ol>;
}

function PairingInstructions({ code }: { code: string }) {
  const [platform, setPlatform] = useState<PairPlatform>("android");
  const link = (path: string) => `${REPO_URL}/tree/main/${path}`;
  const a = "font-medium text-blue-600 hover:underline dark:text-blue-400";
  return (
    <div>
      <Segmented<PairPlatform>
        size="sm"
        value={platform}
        onChange={setPlatform}
        options={[
          { value: "android", label: "Android" },
          { value: "ios", label: "iOS" },
          { value: "macos", label: "macOS" },
        ]}
      />
      <div className="mt-3">
        {platform === "android" && (
          <Steps>
            <li>
              Build the app from source:{" "}
              <a className={a} href={link("apps/android")} target="_blank" rel="noreferrer">
                apps/android
              </a>{" "}
              (<code className="text-xs">./gradlew assembleDebug</code>) and sideload the APK.
            </li>
            <li>Open Herald and scan this QR code, or tap “Enter code” and type <strong className="font-mono">{code}</strong>.</li>
            <li>Allow notifications when asked.</li>
          </Steps>
        )}
        {platform === "ios" && (
          <Steps>
            <li>
              Build from source with Xcode:{" "}
              <a className={a} href={link("apps/apple")} target="_blank" rel="noreferrer">
                apps/apple
              </a>{" "}
              (<code className="text-xs">xcodegen && open Herald.xcodeproj</code>, run on your device).
            </li>
            <li>Scan the QR code with the Camera app (opens Herald), or enter <strong className="font-mono">{code}</strong> in the app.</li>
            <li>iOS has no background push in Herald: notifications arrive while the app is open or recently used.</li>
          </Steps>
        )}
        {platform === "macos" && (
          <Steps>
            <li>
              Build the menu-bar app:{" "}
              <a className={a} href={link("apps/apple")} target="_blank" rel="noreferrer">
                apps/apple
              </a>{" "}
              (<code className="text-xs">apps/apple/scripts/build-macos-app.sh</code>).
            </li>
            <li>Open Herald from the menu bar → “Pair”, then enter <strong className="font-mono">{code}</strong>.</li>
            <li>Turn on “Launch at login” to keep receiving notifications.</li>
          </Steps>
        )}
      </div>
    </div>
  );
}

function PairDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreatePairingCode();
  const devices = useDevices({ poll: open });
  const toast = useToast();
  const [pc, setPc] = useState<PairingCode | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const remaining = useCountdown(pc?.expiresAt);
  const expired = !!pc && remaining <= 0;

  const generate = () => {
    create.mutate(undefined, { onSuccess: setPc });
  };

  useEffect(() => {
    if (open) {
      knownIds.current = devices.data ? new Set(devices.data.map((d) => d.id)) : null;
      generate();
    } else {
      setPc(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Detect the newly paired device while the dialog is open.
  useEffect(() => {
    if (!open || !devices.data) return;
    if (!knownIds.current) {
      knownIds.current = new Set(devices.data.map((d) => d.id));
      return;
    }
    const fresh = devices.data.find((d) => !knownIds.current!.has(d.id) && d.platform !== "web");
    if (fresh) {
      toast.success(`Paired ${fresh.name}`, `${PLATFORM_LABEL[fresh.platform]} device is ready`);
      onClose();
    }
  }, [devices.data, open, onClose, toast]);

  const code = pc ? formatPairingCode(pc.code) : "";

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Pair a device" description="Codes are single-use and expire after 10 minutes.">
      {create.error && !pc ? (
        <ErrorBanner onRetry={generate}>{errorMessage(create.error)}</ErrorBanner>
      ) : !pc ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className={cx("rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700", expired && "opacity-30 blur-[2px]")}>
              <QRCodeSVG value={pc.deepLink} size={176} marginSize={0} level="M" />
            </div>
            <div className="text-center">
              <div className={cx("font-mono text-3xl font-semibold tracking-[0.15em]", expired && "text-zinc-400 line-through")}>{code}</div>
              <div className="mt-1 flex items-center justify-center gap-2 text-xs text-zinc-500">
                {expired ? (
                  <span className="text-red-500">Expired</span>
                ) : (
                  <span className="tabular-nums">Expires in {formatCountdown(remaining)}</span>
                )}
                <CopyButton text={pc.code} label="Copy code" />
              </div>
            </div>
            <Button size="sm" variant={expired ? "primary" : "ghost"} icon={<RefreshIcon size={13} />} loading={create.isPending} onClick={generate}>
              New code
            </Button>
          </div>
          <div className="min-w-0">
            <PairingInstructions code={code} />
            <div className="mt-5 flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900">
              <Spinner size={12} /> Waiting for the device to pair…
            </div>
            <details className="mt-3 text-xs text-zinc-500">
              <summary className="cursor-pointer select-none">Deep link</summary>
              <div className="mt-1.5 flex items-center gap-1">
                <code className="min-w-0 flex-1 truncate font-mono">{pc.deepLink}</code>
                <CopyButton text={pc.deepLink} compact />
              </div>
            </details>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function WebPushPanel({ devices }: { devices: Device[] | undefined }) {
  const config = useConfig();
  const register = useRegisterWebDevice();
  const remove = useRemoveDevice();
  const send = useSendNotification();
  const toast = useToast();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = isPushSupported();
  const permission = supported ? Notification.permission : "default";
  const deviceId = getWebDeviceId();
  const registered = !!deviceId && !!devices?.some((d) => d.id === deviceId);

  useEffect(() => {
    void getExistingSubscription().then((s) => setSubscribed(!!s));
  }, []);

  const enable = async () => {
    if (!config.data?.vapidPublicKey) return;
    setBusy(true);
    setError(null);
    try {
      const subscription = await subscribeToPush(config.data.vapidPublicKey);
      const device = await register.mutateAsync({ name: browserDeviceName(), subscription });
      rememberWebDeviceId(device.id);
      setSubscribed(true);
      toast.success("Browser notifications enabled", device.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromPush();
      if (deviceId) await remove.mutateAsync(deviceId).catch(() => undefined);
      rememberWebDeviceId(null);
      setSubscribed(false);
      toast.success("Browser notifications disabled");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    send.mutate(
      { title: "Test from Herald", body: "If you can see this as a **system notification**, Web Push works.", severity: "info", source: "web" },
      { onError: (e) => toast.error("Couldn't send test", errorMessage(e)) },
    );

  let body: ReactNode;
  if (isMockMode()) {
    body = <p className="text-sm text-zinc-500">Not available in mock mode.</p>;
  } else if (config.isPending) {
    body = <Spinner />;
  } else if (!config.data?.vapidPublicKey) {
    body = (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This server doesn't have Web Push configured, so browser notifications are unavailable. The live inbox still works
        while this tab is open. Server admins: set <code className="text-xs">VAPID_PUBLIC_KEY</code>,{" "}
        <code className="text-xs">VAPID_PRIVATE_KEY</code> and <code className="text-xs">VAPID_SUBJECT</code>.
      </p>
    );
  } else if (!supported) {
    body = (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This browser can't receive Web Push here. It needs HTTPS (or localhost) and Push API support. On iPhone/iPad, add
        Herald to your Home Screen first, then open it from there.
      </p>
    );
  } else if (permission === "denied") {
    body = (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Notifications are blocked for this site. Allow them in your browser's site settings (the icon left of the address
        bar), then reload this page.
      </p>
    );
  } else if (subscribed && registered) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Enabled in this browser</Badge>
        <Button size="sm" onClick={test} loading={send.isPending}>
          Send a test
        </Button>
        <Button size="sm" variant="ghost" onClick={disable} loading={busy}>
          Disable
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={<BellIcon size={14} />} onClick={enable} loading={busy}>
          Enable notifications in this browser
        </Button>
        <span className="text-xs text-zinc-500">Your browser will ask for permission.</span>
      </div>
    );
  }

  return (
    <Panel className="p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <GlobeIcon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Browser notifications</h2>
          <p className="mt-0.5 mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Get system notifications from this browser even when Herald isn't open (Web Push). Up to two action buttons;
            replies open the inbox.
          </p>
          {body}
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
    </Panel>
  );
}

function DeviceRow({ d }: { d: Device }) {
  const remove = useRemoveDevice();
  const rename = useRenameDevice();
  const toast = useToast();
  const isThisBrowser = d.id === getWebDeviceId();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        <PlatformIcon platform={d.platform} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{d.name}</span>
          <Badge>{PLATFORM_LABEL[d.platform]}</Badge>
          {isThisBrowser && <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">This browser</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="flex gap-1">
            {d.transports.length === 0 ? (
              <span>no transport</span>
            ) : (
              d.transports.map((t) => (
                <code key={t} className="rounded bg-zinc-100 px-1 font-mono text-[10.5px] dark:bg-zinc-800">
                  {t}
                </code>
              ))
            )}
          </span>
          <span title={formatDateTime(d.lastSeenAt)}>{d.lastSeenAt ? `seen ${relativeTime(d.lastSeenAt)}` : "never seen"}</span>
          <span title={formatDateTime(d.createdAt)}>added {relativeTime(d.createdAt)}</span>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        loading={rename.isPending}
        title="Agents can target this device by name (send_notification → devices)"
        onClick={() => {
          const name = prompt("Device name (agents target devices by this name)", d.name)?.trim();
          if (!name || name === d.name) return;
          rename.mutate(
            { id: d.id, name },
            {
              onSuccess: () => toast.success("Device renamed", name),
              onError: (e) => toast.error("Couldn't rename device", errorMessage(e)),
            },
          );
        }}
      >
        Rename
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<TrashIcon size={13} />}
        loading={remove.isPending}
        onClick={() => {
          if (!confirm(`Remove “${d.name}”? It will stop receiving notifications and must be paired again.`)) return;
          remove.mutate(d.id, {
            onSuccess: () => {
              if (isThisBrowser) {
                rememberWebDeviceId(null);
                void unsubscribeFromPush();
              }
              toast.success("Device removed", d.name);
            },
            onError: (e) => toast.error("Couldn't remove device", errorMessage(e)),
          });
        }}
      >
        <span className="hidden sm:inline">Remove</span>
      </Button>
    </div>
  );
}

export function DevicesPage() {
  const [pairing, setPairing] = useState(false);
  const devices = useDevices();

  return (
    <PageContainer>
      <PageHeader
        title="Devices"
        description="Phones, laptops and browsers that receive your notifications."
        actions={
          <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setPairing(true)}>
            Pair a device
          </Button>
        }
      />

      <WebPushPanel devices={devices.data} />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Paired devices</h2>
        {devices.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : devices.error ? (
          <ErrorBanner onRetry={() => void devices.refetch()}>{errorMessage(devices.error)}</ErrorBanner>
        ) : devices.data.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<DevicesIcon size={20} />}
              title="No devices yet"
              actions={
                <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setPairing(true)}>
                  Pair a device
                </Button>
              }
            >
              Pair the Android, iOS or macOS app with a short code, or enable browser notifications above.
            </EmptyState>
          </Panel>
        ) : (
          <Panel className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {devices.data.map((d) => (
              <DeviceRow key={d.id} d={d} />
            ))}
          </Panel>
        )}
      </section>

      <PairDialog open={pairing} onClose={() => setPairing(false)} />
    </PageContainer>
  );
}
