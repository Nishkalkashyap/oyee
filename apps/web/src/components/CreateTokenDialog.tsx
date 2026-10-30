/** Creating an MCP server URL or a webhook: label + default source, then the one-time secret URL and paste-ready snippets. */
import { useState } from "react";
import type { CreateTokenResult, TokenKind } from "@oyee/schema";
import { errorMessage } from "../lib/api";
import { useCreateToken } from "../lib/queries";
import { mcpSnippets, webhookSnippets, type Snippet } from "../lib/snippets";
import { CodeBlock, CopyField } from "./Code";
import { AlertTriangleIcon } from "./Icons";
import { Button, Dialog, ErrorBanner, FormField, Input, cx } from "./ui";

export const KIND_COPY: Record<TokenKind, { title: string; button: string; description: string; labelPlaceholder: string; sourcePlaceholder: string }> = {
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

export function CreateTokenDialog({ kind, onClose }: { kind: TokenKind | null; onClose: () => void }) {
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
