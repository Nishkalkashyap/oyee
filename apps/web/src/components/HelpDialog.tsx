import { useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BugIcon,
  CodeIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LaptopIcon,
  LayersIcon,
  SmartphoneIcon,
  TemplateIcon,
  type IconProps,
} from "./Icons";
import { CodeBlock } from "./Code";
import { Dialog, Segmented, buttonClasses, cx } from "./ui";
import { INSTALL_PROMPTS, type InstallPrompt } from "../lib/installPrompts";

export const REPO = "https://github.com/Nishkalkashyap/oyee";
export const LATEST = `${REPO}/releases/latest`;

interface LatestRelease {
  version: string;
  apk?: string;
  mac?: string;
}

/** The newest GitHub release, for direct download links (falls back to the releases page). */
export function useLatestRelease(enabled: boolean) {
  return useQuery({
    queryKey: ["github-latest-release"],
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<LatestRelease> => {
      const res = await fetch("https://api.github.com/repos/Nishkalkashyap/oyee/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
      const json = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
      const asset = (suffix: string) => json.assets.find((a) => a.name.endsWith(suffix))?.browser_download_url;
      return { version: json.tag_name.replace(/^v/, ""), apk: asset(".apk"), mac: asset("-macOS.zip") };
    },
  });
}

function AppRow({
  icon: Icon,
  name,
  meta,
  note,
  action,
}: {
  icon: ComponentType<IconProps>;
  name: string;
  meta: string;
  note?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3.5 not-last:border-b not-last:border-zinc-100 dark:not-last:border-zinc-800">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-secondary-label dark:bg-zinc-800">
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">{name}</div>
        <div className="text-[13px] text-zinc-500 dark:text-zinc-400">{meta}</div>
        {note && <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{note}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{action}</div>
    </div>
  );
}

function HelpLink({ href, icon: Icon, label }: { href: string; icon: ComponentType<IconProps>; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-secondary-label transition-colors hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
    >
      <Icon size={16} />
      <span className="flex-1">{label}</span>
      <ExternalLinkIcon size={13} className="text-zinc-400" />
    </a>
  );
}

const Heading = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-1 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">{children}</h3>
);

/** Copyable prompts that let a coding agent on the user's computer do the install. */
function AgentInstall() {
  const [id, setId] = useState<InstallPrompt["id"]>("macos");
  const p = INSTALL_PROMPTS.find((x) => x.id === id)!;
  return (
    <div className="mt-5">
      <Heading>Install with an AI agent</Heading>
      <p className="mb-2.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Let Claude Code, Codex or another coding agent download, verify and install the app for you.
      </p>
      <Segmented size="sm" value={id} onChange={setId} options={INSTALL_PROMPTS.map((x) => ({ value: x.id, label: x.title }))} />
      <p className="mt-2.5 mb-2 text-xs text-zinc-500 dark:text-zinc-400">{p.description}</p>
      <CodeBlock title="Prompt" code={p.prompt} wrap />
    </div>
  );
}

/** Downloads for every platform plus docs and support links. Opened from the help button in the sidebar. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const latest = useLatestRelease(open).data;
  const version = latest ? ` · v${latest.version}` : "";
  const download = (href: string | undefined, label: string) => (
    <a href={href ?? LATEST} target={href ? undefined : "_blank"} rel="noreferrer" className={buttonClasses("brand", "sm")}>
      <DownloadIcon size={14} />
      {label}
    </a>
  );

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Get Oyee" description="Free and open source apps for your devices.">
      <Heading>Apps</Heading>
      <div>
        <AppRow
          icon={SmartphoneIcon}
          name="Android"
          meta={`Android 8.0+ · APK${version}`}
          note="Allow “Install unknown apps” when asked. The app tells you about updates and downloads them for you."
          action={download(latest?.apk, "APK")}
        />
        <AppRow
          icon={LaptopIcon}
          name="macOS"
          meta={`macOS 14+ · Apple Silicon and Intel${version}`}
          note={
            <>
              Unzip and move to Applications. It isn't notarized, so if macOS blocks the first launch, open{" "}
              <b className="font-medium">System Settings → Privacy &amp; Security → Open Anyway</b>. Updates install
              themselves.
            </>
          }
          action={download(latest?.mac, "Mac")}
        />
        <AppRow
          icon={GlobeIcon}
          name="Web"
          meta="You're using it"
          note="Turn on browser notifications to get pushes on this computer, even with the tab closed."
          action={
            <Link to="/devices" onClick={onClose} className={buttonClasses("secondary", "sm")}>
              Devices
            </Link>
          }
        />
        <AppRow
          icon={SmartphoneIcon}
          name="iOS"
          meta="Build from source"
          note="iOS apps can't be shared without a paid Apple developer account."
          action={
            <a href={`${REPO}/blob/main/docs/setup.md`} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "sm")}>
              Guide
            </a>
          }
        />
      </div>
      <a
        href={LATEST}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground dark:text-zinc-400"
      >
        All downloads and checksums <ExternalLinkIcon size={12} />
      </a>

      <AgentInstall />

      <div className="mt-5">
        <Heading>Help</Heading>
        <div className={cx("-mx-3 grid sm:grid-cols-2")}>
          <HelpLink href={`${REPO}/blob/main/docs/setup.md`} icon={LayersIcon} label="Setup guide" />
          <HelpLink href={`${REPO}/blob/main/docs/protocol.md`} icon={TemplateIcon} label="API and MCP reference" />
          <HelpLink href={`${REPO}/issues/new`} icon={BugIcon} label="Report a problem" />
          <HelpLink href={REPO} icon={CodeIcon} label="Source code" />
        </div>
      </div>
    </Dialog>
  );
}
