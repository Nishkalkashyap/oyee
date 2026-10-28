import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { CreateTokenResult, TokenKind } from "@herald/schema";
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
} from "../components/ui";

const KIND_COPY: Record<TokenKind, { title: string; button: string; description: string; labelPlaceholder: string; sourcePlaceholder: string }> = {
  mcp: {
    title: "Create MCP server URL",
    button: "Create MCP server URL",
    description: "Lets Claude Code, Codex and any MCP client send, update and ask via Herald tools.",
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
              can {kind === "mcp" ? "use your Herald MCP tools" : "send you notifications"}. Revoke it below if it leaks.
            </span>
          </div>
          <CopyField value={result.url} />
          {result.callbackSecret && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Callback signing secret</div>
              <CopyField value={result.callbackSecret} />
              <p className="mt-1.5 text-xs text-zinc-500">
                Used to verify <code>X-Herald-Signature: sha256=&lt;hmac-sha256(body)&gt;</code> on action callback requests.
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
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-start gap-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
    >
      <div className={cx("pointer-events-none absolute -top-16 -right-16 size-48 rounded-full opacity-20 blur-3xl transition-opacity group-hover:opacity-35", accent)} />
      <span className={cx("inline-flex size-11 items-center justify-center rounded-xl text-white shadow-sm", accent)}>{icon}</span>
      <div>
        <div className="flex items-center gap-1.5 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
          <ChevronRightIcon size={16} className="text-zinc-400 transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
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
    <Panel className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {tokens.data.map((t) => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-3">
          <span
            className={cx(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
              t.kind === "mcp" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400" : "bg-sky-500/10 text-sky-600 dark:text-sky-400",
            )}
          >
            {t.kind === "mcp" ? <BotIcon size={16} /> : <WebhookIcon size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{t.label}</span>
              <Badge>{t.kind === "mcp" ? "MCP" : "Webhook"}</Badge>
              {t.defaultSource && <Badge className="bg-transparent text-zinc-500 ring-1 ring-zinc-200 dark:ring-zinc-700">source: {t.defaultSource}</Badge>}
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
    </Panel>
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
          accent="bg-gradient-to-br from-violet-500 to-indigo-600"
        />
        <BigAction
          icon={<WebhookIcon size={22} />}
          title={KIND_COPY.webhook.button}
          description={KIND_COPY.webhook.description}
          onClick={() => setKind("webhook")}
          accent="bg-gradient-to-br from-sky-500 to-cyan-600"
        />
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your tokens</h2>
        <TokenList />
      </section>

      <CreateTokenDialog kind={kind} onClose={() => setKind(null)} />
    </PageContainer>
  );
}
