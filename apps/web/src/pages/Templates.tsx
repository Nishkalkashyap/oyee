import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { TemplateCard, TemplateName, renderTemplateValue, type Template } from "@oyee/schema";
import { errorMessage } from "../lib/api";
import { parseVars, templateVariables, toPreviewNotification } from "../lib/card";
import { relativeTime } from "../lib/format";
import { useDeleteTemplate, usePreviewTemplate, usePutTemplate, useTemplates } from "../lib/queries";
import { CodeBlock } from "../components/Code";
import { CodeIcon, PlusIcon, TemplateIcon, TrashIcon } from "../components/Icons";
import { PageContainer } from "../components/Layout";
import { PlatformPreviews } from "../components/PlatformPreviews";
import { useToast } from "../components/Toast";
import { Button, EmptyState, ErrorBanner, FormField, Input, PageHeader, Panel, Spinner, Textarea, cx } from "../components/ui";

const STARTER_CARD = {
  title: "{{service}} is {{state|down}}",
  body: "Health check for **{{service}}** failed in `{{region|us-east-1}}`.",
  severity: "warning",
  icon: "🩺",
  fields: [
    { label: "Region", value: "{{region|us-east-1}}" },
    { label: "Latency", value: "{{latency|n/a}}" },
  ],
  actions: [
    { id: "ack", label: "Acknowledge", style: "primary", resolves: true },
    { id: "restart", label: "Restart", style: "destructive" },
  ],
};
const STARTER_VARS = { service: "prod-api", state: "degraded", latency: "870 ms" };

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

interface ValidationResult {
  parsed: unknown;
  jsonError: string | null;
  issues: string[];
}

function validateCard(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { parsed: null, jsonError: e instanceof Error ? e.message : "Invalid JSON", issues: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { parsed: null, jsonError: "The card must be a JSON object", issues: [] };
  }
  const r = TemplateCard.safeParse(parsed);
  const issues = r.success ? [] : r.error.issues.map((i) => `${i.path.join(".") || "(card)"}: ${i.message}`);
  return { parsed, jsonError: null, issues };
}

function Editor({ template, onSaved, onDeleted }: { template: Template | null; onSaved: (name: string) => void; onDeleted: () => void }) {
  const put = usePutTemplate();
  const del = useDeleteTemplate();
  const serverPreview = usePreviewTemplate();
  const toast = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [cardText, setCardText] = useState(pretty(template?.card ?? STARTER_CARD));
  const [varsText, setVarsText] = useState(pretty(template ? {} : STARTER_VARS));

  const v = useMemo(() => validateCard(cardText), [cardText]);
  const { vars, error: varsError } = useMemo(() => parseVars(varsText), [varsText]);
  const nameOk = TemplateName.safeParse(name).success;
  const placeholders = useMemo(() => (v.parsed ? templateVariables(v.parsed) : []), [v.parsed]);
  const missingVars = placeholders.filter((p) => !(p in vars));
  const preview = useMemo(() => {
    if (!v.parsed) return null;
    const rendered = renderTemplateValue(v.parsed as TemplateCard, vars);
    return toPreviewNotification(rendered, { template: name || null });
  }, [v.parsed, vars, name]);

  const dirty =
    !template ||
    name !== template.name ||
    (description || "") !== (template.description ?? "") ||
    cardText !== pretty(template.card);
  const canSave = nameOk && !v.jsonError && v.issues.length === 0 && dirty;
  const renaming = !!template && name !== template.name;

  const save = () => {
    put.mutate(
      { name, input: { card: v.parsed as TemplateCard, ...(description.trim() ? { description: description.trim() } : {}) } },
      {
        onSuccess: (t) => {
          toast.success(template && !renaming ? "Template saved" : "Template created", t.name);
          onSaved(t.name);
        },
        onError: (e) => toast.error("Couldn't save template", errorMessage(e)),
      },
    );
  };

  const fillVars = () => {
    const next = { ...vars };
    for (const p of missingVars) next[p] = p;
    setVarsText(pretty(next));
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Name"
            htmlFor="tpl-name"
            error={name && !nameOk ? "Lowercase letters, digits, - and _ (max 64)" : undefined}
            hint={renaming ? "Saving under a new name creates a copy." : "Used as { \"template\": \"name\" } when sending."}
          >
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="health-check"
              aria-invalid={!!name && !nameOk}
              className="font-mono"
            />
          </FormField>
          <FormField label="Description" htmlFor="tpl-desc">
            <Input id="tpl-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="What it's for" />
          </FormField>
        </div>

        <FormField
          label={
            <span className="flex items-center justify-between">
              <span>Card JSON</span>
              <span className="font-normal text-zinc-400">
                Strings may use <code>{"{{var}}"}</code> or <code>{"{{var|fallback}}"}</code>
              </span>
            </span>
          }
          htmlFor="tpl-card"
          error={v.jsonError ?? undefined}
        >
          <Textarea
            id="tpl-card"
            value={cardText}
            onChange={(e) => setCardText(e.target.value)}
            spellCheck={false}
            rows={18}
            aria-invalid={!!v.jsonError || v.issues.length > 0}
            className="font-mono text-[12.5px] leading-relaxed"
          />
        </FormField>
        {v.issues.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {v.issues.map((i) => (
              <li key={i} className="font-mono">
                {i}
              </li>
            ))}
          </ul>
        )}

        <FormField
          label="Preview vars (JSON)"
          htmlFor="tpl-vars"
          error={varsError ?? undefined}
          hint={'Only used for the preview. Senders pass { "vars": { … } }.'}
        >
          <Textarea
            id="tpl-vars"
            value={varsText}
            onChange={(e) => setVarsText(e.target.value)}
            spellCheck={false}
            rows={5}
            aria-invalid={!!varsError}
            className="font-mono text-[12.5px]"
          />
        </FormField>
        {placeholders.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-zinc-500">Variables:</span>
            {placeholders.map((p) => (
              <code
                key={p}
                className={cx(
                  "rounded px-1.5 py-0.5 font-mono",
                  p in vars ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
                )}
              >
                {p}
              </code>
            ))}
            {missingVars.length > 0 && (
              <button type="button" className="font-semibold text-brand hover:underline" onClick={fillVars}>
                Fill missing
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Button variant="primary" onClick={save} disabled={!canSave} loading={put.isPending}>
            {template && !renaming ? "Save changes" : "Create template"}
          </Button>
          {template && (
            <Button
              icon={<CodeIcon size={14} />}
              loading={serverPreview.isPending}
              onClick={() => serverPreview.mutate({ name: template.name, vars })}
              title="Render the saved version on the server"
            >
              Server preview
            </Button>
          )}
          {template && (
            <Button
              variant="outline-danger"
              className="ml-auto"
              icon={<TrashIcon size={14} />}
              loading={del.isPending}
              onClick={() => {
                if (!confirm(`Delete template “${template.name}”?`)) return;
                del.mutate(template.name, {
                  onSuccess: () => {
                    toast.success("Template deleted", template.name);
                    onDeleted();
                  },
                  onError: (e) => toast.error("Couldn't delete", errorMessage(e)),
                });
              }}
            >
              Delete
            </Button>
          )}
          {!canSave && dirty && !put.isPending && (
            <span className="text-xs text-zinc-500">{!nameOk ? "Enter a valid name." : "Fix the card errors to save."}</span>
          )}
        </div>
        {serverPreview.error && <ErrorBanner>{errorMessage(serverPreview.error)}</ErrorBanner>}
        {serverPreview.data && <CodeBlock title="Server-rendered card (saved version)" code={pretty(serverPreview.data)} />}

        {name && nameOk && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-zinc-500">Send with this template</h3>
            <CodeBlock code={pretty({ template: name, vars: Object.keys(vars).length ? vars : undefined })} />
          </div>
        )}
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <h3 className="mb-3 text-sm font-semibold">Live preview</h3>
        {preview ? (
          <PlatformPreviews notification={preview} />
        ) : (
          <Panel className="p-6 text-center text-sm text-zinc-500">Fix the JSON to see a preview.</Panel>
        )}
      </div>
    </div>
  );
}

export function TemplatesPage() {
  const templates = useTemplates();
  const [params, setParams] = useSearchParams();
  const selected = params.get("name");
  const isNew = params.get("new") === "1";
  const current = templates.data?.find((t) => t.name === selected) ?? null;

  const select = (name: string | null, asNew = false) => {
    const next = new URLSearchParams();
    if (name) next.set("name", name);
    if (asNew) next.set("new", "1");
    setParams(next, { replace: true });
  };

  // Default to the first template.
  useEffect(() => {
    if (!selected && !isNew && templates.data && templates.data.length > 0) select(templates.data[0]!.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.data, selected, isNew]);

  return (
    <PageContainer wide>
      <PageHeader
        title="Templates"
        description="Reusable cards with {{variables}}. Write once, rendered natively on every platform."
        actions={
          <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => select(null, true)}>
            New template
          </Button>
        }
      />
      {templates.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : templates.error ? (
        <ErrorBanner onRetry={() => void templates.refetch()}>{errorMessage(templates.error)}</ErrorBanner>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
            {templates.data.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => select(t.name)}
                className={cx(
                  "shrink-0 rounded-lg px-3 py-2 text-left transition-colors",
                  t.name === selected && !isNew
                    ? "bg-zinc-100 dark:bg-zinc-800"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
                )}
              >
                <div className="font-mono text-sm font-medium">{t.name}</div>
                <div className="truncate text-xs text-zinc-500">{t.description || `updated ${relativeTime(t.updatedAt)}`}</div>
              </button>
            ))}
            {isNew && (
              <div className="shrink-0 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
                <div className="text-sm font-medium">New template</div>
                <div className="text-xs text-zinc-500">unsaved</div>
              </div>
            )}
          </nav>

          <div className="min-w-0">
            {isNew || current ? (
              <Editor
                key={isNew ? "__new" : current!.id}
                template={isNew ? null : current}
                onSaved={(name) => select(name)}
                onDeleted={() => select(null)}
              />
            ) : (
              <Panel>
                <EmptyState
                  icon={<TemplateIcon size={20} />}
                  title={templates.data.length === 0 ? "No templates yet" : "Select a template"}
                  actions={
                    <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => select(null, true)}>
                      New template
                    </Button>
                  }
                >
                  Templates let agents send rich cards with just a name and a few variables.
                </EmptyState>
              </Panel>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
