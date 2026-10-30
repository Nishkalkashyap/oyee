/** Pairing a phone or Mac: a single-use code (and QR), where to get the app, and auto-close once the device shows up. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PairingCode, Platform } from "@oyee/schema";
import { errorMessage } from "../lib/api";
import { formatCountdown, formatPairingCode } from "../lib/format";
import { useCreatePairingCode, useDevices } from "../lib/queries";
import { CopyButton } from "./Code";
import { LATEST, REPO, useLatestRelease } from "./HelpDialog";
import { DownloadIcon, RefreshIcon } from "./Icons";
import { useToast } from "./Toast";
import { Button, Dialog, ErrorBanner, Segmented, Spinner, buttonClasses, cx } from "./ui";

const PLATFORM_LABEL: Record<Platform, string> = { android: "Android", ios: "iOS", macos: "macOS", web: "Web" };

function useCountdown(expiresAt: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Date.parse(expiresAt) - now) : 0;
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-600 marker:text-zinc-400 dark:text-zinc-400">{children}</ol>;
}

function PairingInstructions({ code, open }: { code: string; open: boolean }) {
  const [platform, setPlatform] = useState<"android" | "macos">("android");
  const latest = useLatestRelease(open).data;
  const download = (href: string | undefined, label: string) => (
    <a href={href ?? LATEST} target={href ? undefined : "_blank"} rel="noreferrer" className={buttonClasses("secondary", "sm", "mt-1.5")}>
      <DownloadIcon size={13} />
      {label}
    </a>
  );
  return (
    <div>
      <Segmented
        size="sm"
        value={platform}
        onChange={setPlatform}
        options={[
          { value: "android", label: "Android" },
          { value: "macos", label: "Mac" },
        ]}
      />
      <div className="mt-3.5">
        {platform === "android" ? (
          <Steps>
            <li>
              Install the Android app.
              <br />
              {download(latest?.apk, "Download APK")}
            </li>
            <li>Open Oyee and scan this QR code, or tap “Enter code” and type <strong className="font-mono text-foreground">{code}</strong>.</li>
            <li>Allow notifications when asked.</li>
          </Steps>
        ) : (
          <Steps>
            <li>
              Install the Mac menu-bar app.
              <br />
              {download(latest?.mac, "Download for Mac")}
            </li>
            <li>Click Oyee in the menu bar → “Pair”, then enter <strong className="font-mono text-foreground">{code}</strong>.</li>
            <li>Allow notifications when asked.</li>
          </Steps>
        )}
      </div>
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        iPhone: build the iOS app from source (
        <a className="underline underline-offset-2 hover:text-foreground" href={`${REPO}/blob/main/docs/setup.md`} target="_blank" rel="noreferrer">
          guide
        </a>
        ).
      </p>
    </div>
  );
}

export function PairDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Dialog open={open} onClose={onClose} size="lg" title="Connect a device" description="Pair your phone or Mac with a one-time code. It expires after 10 minutes.">
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
            <PairingInstructions code={code} open={open} />
            <div className="mt-5 flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900">
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
