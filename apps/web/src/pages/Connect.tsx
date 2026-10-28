import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { CreateTokenResult, TokenKind } from "@oyee/schema";
import { errorMessage } from "../lib/api";
import { relativeTime, formatDateTime } from "../lib/format";
import { useCreateToken, useRevokeToken, useTokens } from "../lib/queries";
import { mcpSnippets, webhookSnippets, type Snippet } from "../lib/snippets";
import { CodeBlock, CopyField } from "../components/Code";
import { AlertTriangleIcon, BotIcon, ChevronRightIcon, KeyIcon, SendIcon, TrashIcon, WebhookIcon } from "../components/Icons";
import { PageContainer } from "../components/Layout";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorBanner,
  FormField,
  Input,
  PageHeader,
  Panel,
  Spinner,
  buttonClasses,
  cx,
  Avatar,
} from "../components/ui";

const KIND_COPY: Record<TokenKind, { title: string; button: string; description: string; labelPlaceholder: string; sourcePlaceholder: string }> = {
  mcp: {
    title: "Create MCP server URL",
    button: "Create MCP server URL",
    description: "Lets Claude Code, Codex and any MCP client send, update and ask via Oyee tools.",
    labelPlaceholder: "Claude Code",
    sourcePlaceholder: "claude-code",
  },
  webhook: {
    title: "Create webhook",
    button: "Create webhook",
    description: "A send-only URL for Home Assistant, Alertmanager, Grafana, CI, cron and curl.",
    labelPlaceholder: "Home Assistant",
    sourcePlaceholder: "home-assistant",
  },
};

function SnippetTabs({ snippets }: { snippets: Snippet[] }) {
  const [active, setActive] = useState(snippets[0]?.id);
  const s = snippets.find((x) => x.id === active) ?? snippets[0];
  return (
    <div>
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
        {snippets.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setActive(x.id)}
            className={cx(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              x.id === s?.id
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            {x.title}
          </button>
        ))}
      </div>
      {s && (
        <div>
          {s.description && <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{s.description}</p>}
          <CodeBlock code={s.code} />
        </div>
      )}
    </div>
  );
}

function CreateTokenDialog({ kind, onClose }: { kind: TokenKind | null; onClose: () => void }) {
  const create = useCreateToken();
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [result, setResult] = useState<CreateTokenResult | null>(null);
  const copy = kind ? KIND_COPY[kind] : null;

  const close = () => {
    onClose();
    // Reset after the close animation; the secret is gone for good.
    setTimeout(() => {
      setResult(null);
      setLabel("");
      setSource("");
      create.reset();
    }, 150);
  };

  const submit = async () => {
    if (!kind) return;
    const res = await create.mutateAsync({
      kind,
      label: label.trim() || copy!.labelPlaceholder,
      ...(source.trim() ? { defaultSource: source.trim() } : {}),
    });
    setResult(res);
  };

  return (
    <Dialog
      open={!!kind}
      onClose={close}
      size={result ? "lg" : "md"}
      title={result ? (kind === "mcp" ? "Your MCP server URL" : "Your webhook URL") : copy?.title}
      description={result ? `“${result.token.label}”` : copy?.description}
    >
      {!result ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit().catch(() => undefined);
          }}
        >
          <FormField label="Label" htmlFor="token-label" hint="Shown in your token list. Also the default source.">
            <Input
              id="token-label"
              autoFocus
              maxLength={64}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={copy?.labelPlaceholder}
            />
          </FormField>
          <FormField
            label="Default source (optional)"
            htmlFor="token-source"
            hint="Notifications sent with this token use it unless they set their own source."
          >
            <Input
              id="token-source"
              maxLength={64}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={copy?.sourcePlaceholder}
            />
          </FormField>
          {create.error && <ErrorBanner>{errorMessage(create.error)}</ErrorBanner>}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="flex gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangleIcon size={15} className="mt-px shrink-0" />
            <span>
              Copy this URL now. It contains the secret token and <strong>won't be shown again</strong>. Anyone with it
              can {kind === "mcp" ? "use your Oyee MCP tools" : "send you notifications"}. Revoke it below if it leaks.
            </span>
          </div>
          <CopyField value={result.url} />
          {result.callbackSecret && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Callback signing secret</div>
              <CopyField value={result.callbackSecret} />
              <p className="mt-1.5 text-xs text-zinc-500">
                Used to verify <code>X-Oyee-Signature: sha256=&lt;hmac-sha256(body)&gt;</code> on action callback requests.
                Also shown only once.
              </p>
            </div>
          )}
          <SnippetTabs snippets={kind === "mcp" ? mcpSnippets(result.url) : webhookSnippets(result.url)} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function BigAction({
  icon,
  title,
  description,
  onClick,
  accent,
  cta,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent: string;
  cta: "brand" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3.5 rounded-[22px] bg-zinc-50 p-5 text-left transition-[background-color,scale] duration-150 hover:bg-zinc-100 active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-brand dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
    >
      <span className={cx("inline-flex size-11 items-center justify-center rounded-[14px]", accent)}>{icon}</span>
      <div>
        <div className="text-[17px] font-bold tracking-[-0.015em]">{title}</div>
        <p className="mt-1 text-[13.5px] text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <span className={buttonClasses(cta, "sm", "mt-1 pointer-events-none")}>
        {title}
        <ChevronRightIcon size={14} />
      </span>
    </button>
  );
}

function TokenList() {
  const tokens = useTokens();
  const revoke = useRevokeToken();
  const toast = useToast();

  if (tokens.isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (tokens.error) return <ErrorBanner onRetry={() => void tokens.refetch()}>{errorMessage(tokens.error)}</ErrorBanner>;
  if (tokens.data.length === 0) {
    return (
      <Panel>
        <EmptyState icon={<KeyIcon size={20} />} title="No tokens yet">
          Create an MCP server URL or a webhook above to start sending notifications.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="-mx-2">
      {tokens.data.map((t) => (
        <div key={t.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <Avatar name={t.label} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{t.label}</span>
              <Badge>{t.kind === "mcp" ? "MCP" : "Webhook"}</Badge>
              {t.defaultSource && <Badge className="bg-transparent text-zinc-500">source: {t.defaultSource}</Badge>}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
              <code className="font-mono">{t.prefix}…</code>
              <span title={formatDateTime(t.createdAt)}>created {relativeTime(t.createdAt)}</span>
              <span title={formatDateTime(t.lastUsedAt)}>{t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)}` : "never used"}</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<TrashIcon size={13} />}
            loading={revoke.isPending && revoke.variables === t.id}
            onClick={() => {
              if (!confirm(`Revoke “${t.label}”? Anything using this ${t.kind === "mcp" ? "MCP URL" : "webhook"} will stop working.`)) return;
              revoke.mutate(t.id, {
                onSuccess: () => toast.success("Token revoked", t.label),
                onError: (e) => toast.error("Couldn't revoke token", errorMessage(e)),
              });
            }}
          >
            <span className="hidden sm:inline">Revoke</span>
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ConnectPage() {
  const [kind, setKind] = useState<TokenKind | null>(null);
  return (
    <PageContainer>
      <PageHeader
        title="Connect"
        description="Give your agents and tools a URL. Notifications arrive live in your inbox and on paired devices."
        actions={
          <Link to="/send" className={buttonClasses("secondary", "md")}>
            <SendIcon size={14} /> Send a test
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <BigAction
          icon={<BotIcon size={22} />}
          title={KIND_COPY.mcp.button}
          description={KIND_COPY.mcp.description}
          onClick={() => setKind("mcp")}
          accent="bg-[#fde7d7] text-[#9a3412]"
          cta="brand"
        />
        <BigAction
          icon={<WebhookIcon size={22} />}
          title={KIND_COPY.webhook.button}
          description={KIND_COPY.webhook.description}
          onClick={() => setKind("webhook")}
          accent="bg-[#e2ecfb] text-[#1e4e9a]"
          cta="primary"
        />
      </div>

      <section className="mt-10">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">Your connections</h2>
        <TokenList />
      </section>

      <CreateTokenDialog kind={kind} onClose={() => setKind(null)} />
    </PageContainer>
  );
}
