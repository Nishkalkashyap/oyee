import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ActionStyle, SendNotificationInput, type Severity, type TemplateCard } from "@oyee/schema";
import { errorMessage } from "../lib/api";
import { composeCard, parseVars, templateVariables, toPreviewNotification } from "../lib/card";
import { buildSendInput, COMPOSER_PRESETS, emptyComposer, type ComposerAction, type ComposerState } from "../lib/composer";
import { useDevices, useSendNotification, useTemplates } from "../lib/queries";
import { SEVERITIES, SEVERITY_STYLES } from "../lib/severity";
import { CodeBlock } from "../components/Code";
import { PlusIcon, SendIcon, XIcon } from "../components/Icons";
import { PageContainer } from "../components/Layout";
import { PlatformPreviews } from "../components/PlatformPreviews";
import { useToast } from "../components/Toast";
import { Button, FormField, Input, PageHeader, Panel, Select, Textarea, cx } from "../components/ui";

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Panel className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </Panel>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-600 select-none dark:text-zinc-400">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-4.5 w-8 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand" : "bg-zinc-300 dark:bg-zinc-700",
        )}
      >
        <span className={cx("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
      {label}
    </label>
  );
}

const IconButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
  >
    <XIcon size={14} />
  </button>
);

export function SendPage() {
  const [s, setS] = useState<ComposerState>(emptyComposer);
  const [varsText, setVarsText] = useState("{}");
  const templates = useTemplates();
  const send = useSendNotification();
  const toast = useToast();
  const navigate = useNavigate();

  const set = <K extends keyof ComposerState>(k: K, v: ComposerState[K]) => setS((p) => ({ ...p, [k]: v }));
  const { vars, error: varsError } = useMemo(() => parseVars(varsText), [varsText]);
  const template = templates.data?.find((t) => t.name === s.template) ?? null;
  const input = useMemo(() => buildSendInput(s, vars), [s, vars]);
  const validation = useMemo(() => SendNotificationInput.safeParse(input), [input]);

  const composed = useMemo(() => {
    const { template: _t, vars: _v, replaceKey: _r, ...explicit } = input;
    return composeCard(template?.card as TemplateCard | undefined, vars, explicit);
  }, [input, template, vars]);
  const preview = useMemo(() => toPreviewNotification(composed, { template: template?.name ?? null }), [composed, template]);
  const hasTitle = !!composed.title?.trim();
  const issues = validation.success ? [] : validation.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
  const canSend = hasTitle && validation.success && !varsError;

  const updateField = (i: number, patch: Partial<{ label: string; value: string }>) =>
    set("fields", s.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const updateAction = (i: number, patch: Partial<ComposerAction>) =>
    set("actions", s.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const submit = () => {
    send.mutate(input, {
      onSuccess: (n) =>
        toast.show({
          kind: "success",
          title: "Notification sent",
          description: `${n.title} · click to open`,
          onClick: () => navigate(`/inbox/${n.id}`),
        }),
      onError: (e) => toast.error("Couldn't send", errorMessage(e)),
    });
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Send"
        description="Compose a card and send it to yourself. Handy for testing devices and templates."
        actions={
          <>
            {COMPOSER_PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant="ghost" onClick={() => setS({ ...emptyComposer, ...p.state })}>
                {p.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setS(emptyComposer)}>
              Reset
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) submit();
          }}
        >
          <Section title="Content">
            <FormField label="Title" htmlFor="c-title" hint={template ? "Optional: the template can provide it." : undefined}>
              <Input id="c-title" value={s.title} maxLength={200} onChange={(e) => set("title", e.target.value)} placeholder="Backup finished" />
            </FormField>
            <FormField label="Body" htmlFor="c-body" hint="Supports **bold**, *italic*, `code`, [links](https://…) and line breaks.">
              <Textarea id="c-body" rows={3} maxLength={4000} value={s.body} onChange={(e) => set("body", e.target.value)} />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Severity" htmlFor="c-sev">
                <Select id="c-sev" value={s.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
                  {SEVERITIES.map((sv) => (
                    <option key={sv} value={sv}>
                      {SEVERITY_STYLES[sv].label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Source" htmlFor="c-src">
                <Input id="c-src" value={s.source} maxLength={64} onChange={(e) => set("source", e.target.value)} placeholder="web" />
              </FormField>
              <FormField label="Thread" htmlFor="c-thread">
                <Input id="c-thread" value={s.threadId} maxLength={128} onChange={(e) => set("threadId", e.target.value)} placeholder="run-42" />
              </FormField>
              <FormField label="Icon" htmlFor="c-icon" hint="Emoji or https URL">
                <Input id="c-icon" value={s.icon} onChange={(e) => set("icon", e.target.value)} placeholder="🚀" />
              </FormField>
              <FormField label="Tags" htmlFor="c-tags" hint="Comma-separated">
                <Input id="c-tags" value={s.tags} onChange={(e) => set("tags", e.target.value)} placeholder="prod, api" />
              </FormField>
              <FormField label="Replace key" htmlFor="c-rk" hint="Updates the active one with this key">
                <Input id="c-rk" value={s.replaceKey} onChange={(e) => set("replaceKey", e.target.value)} placeholder="nightly-backup" />
              </FormField>
            </div>
            <DevicePicker value={s.devices} onChange={(devices) => set("devices", devices)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Click URL" htmlFor="c-url">
                <Input id="c-url" type="url" value={s.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
              </FormField>
              <FormField label="Image URL" htmlFor="c-img">
                <Input id="c-img" type="url" value={s.image} onChange={(e) => set("image", e.target.value)} placeholder="https://…/graph.png" />
              </FormField>
            </div>
            <Toggle checked={s.silent} onChange={(v) => set("silent", v)} label="Silent (no sound or vibration)" />
          </Section>

          <Section
            title="Fields"
            right={
              <Button size="sm" variant="ghost" icon={<PlusIcon size={13} />} disabled={s.fields.length >= 10} onClick={() => set("fields", [...s.fields, { label: "", value: "" }])}>
                Add field
              </Button>
            }
          >
            {s.fields.length === 0 && <p className="text-xs text-zinc-500">Key/value pairs shown as a grid (max 10).</p>}
            {s.fields.map((f, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label="Field label" value={f.label} maxLength={40} placeholder="Label" onChange={(e) => updateField(i, { label: e.target.value })} className="w-2/5" />
                <Input aria-label="Field value" value={f.value} maxLength={200} placeholder="Value" onChange={(e) => updateField(i, { value: e.target.value })} />
                <IconButton label="Remove field" onClick={() => set("fields", s.fields.filter((_, j) => j !== i))} />
              </div>
            ))}
          </Section>

          <Section title="Progress" right={<Toggle checked={s.progressOn} onChange={(v) => set("progressOn", v)} label="Show" />}>
            {s.progressOn ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <FormField label="Value" htmlFor="c-pv">
                  <Input id="c-pv" type="number" min={0} value={s.progress.value} onChange={(e) => set("progress", { ...s.progress, value: Number(e.target.value) })} />
                </FormField>
                <FormField label="Max" htmlFor="c-pm">
                  <Input id="c-pm" type="number" min={1} value={s.progress.max} onChange={(e) => set("progress", { ...s.progress, max: Number(e.target.value) })} />
                </FormField>
                <FormField label="Label" htmlFor="c-pl">
                  <Input id="c-pl" value={s.progress.label} maxLength={64} placeholder="3/7 checks" onChange={(e) => set("progress", { ...s.progress, label: e.target.value })} />
                </FormField>
                <div className="flex items-end pb-2">
                  <Toggle checked={s.progress.indeterminate} onChange={(v) => set("progress", { ...s.progress, indeterminate: v })} label="Indeterminate" />
                </div>
                <input
                  type="range"
                  aria-label="Progress value"
                  min={0}
                  max={s.progress.max || 100}
                  value={s.progress.value}
                  onChange={(e) => set("progress", { ...s.progress, value: Number(e.target.value) })}
                  className="col-span-full accent-brand"
                />
              </div>
            ) : (
              <p className="text-xs text-zinc-500">A live progress bar (native on Android, text elsewhere).</p>
            )}
          </Section>

          <Section
            title="Actions"
            right={
              <Button
                size="sm"
                variant="ghost"
                icon={<PlusIcon size={13} />}
                disabled={s.actions.length >= 3}
                onClick={() => set("actions", [...s.actions, { id: `action_${s.actions.length + 1}`, label: "", style: "default", url: "", resolves: false }])}
              >
                Add action
              </Button>
            }
          >
            {s.actions.length === 0 && <p className="text-xs text-zinc-500">Up to 3 buttons. With a URL they open it; otherwise they record a response.</p>}
            {s.actions.map((a, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex gap-2">
                  <Input aria-label="Action label" value={a.label} maxLength={32} placeholder="Label" onChange={(e) => updateAction(i, { label: e.target.value })} />
                  <Input
                    aria-label="Action id"
                    value={a.id}
                    maxLength={32}
                    placeholder="id"
                    onChange={(e) => updateAction(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                    className="w-32 font-mono"
                  />
                  <Select aria-label="Action style" value={a.style} onChange={(e) => updateAction(i, { style: e.target.value as ActionStyle })} className="w-36">
                    {ActionStyle.options.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </Select>
                  <IconButton label="Remove action" onClick={() => set("actions", s.actions.filter((_, j) => j !== i))} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Input aria-label="Action URL" type="url" value={a.url} placeholder="Optional URL to open (https://…)" onChange={(e) => updateAction(i, { url: e.target.value })} className="min-w-0 flex-1" />
                  <Toggle checked={a.resolves} onChange={(v) => updateAction(i, { resolves: v })} label="Resolves" />
                </div>
              </div>
            ))}
          </Section>

          <Section title="Reply" right={<Toggle checked={s.replyOn} onChange={(v) => set("replyOn", v)} label="Allow text reply" />}>
            {s.replyOn ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Placeholder" htmlFor="c-rp">
                  <Input id="c-rp" value={s.reply.placeholder} maxLength={64} placeholder="Tell the agent…" onChange={(e) => set("reply", { ...s.reply, placeholder: e.target.value })} />
                </FormField>
                <FormField label="Button label" htmlFor="c-rb">
                  <Input id="c-rb" value={s.reply.buttonLabel} maxLength={32} placeholder="Send" onChange={(e) => set("reply", { ...s.reply, buttonLabel: e.target.value })} />
                </FormField>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">A text box. On web push, replying opens the inbox.</p>
            )}
          </Section>

          <Section title="Template">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Template" htmlFor="c-tpl" hint="Explicit fields above override the template.">
                <Select id="c-tpl" value={s.template} onChange={(e) => set("template", e.target.value)}>
                  <option value="">None</option>
                  {templates.data?.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {template && (
                <FormField
                  label="Vars (JSON)"
                  htmlFor="c-vars"
                  error={varsError ?? undefined}
                  hint={`Uses: ${templateVariables(template.card).join(", ") || "no variables"}`}
                >
                  <Textarea id="c-vars" rows={3} value={varsText} onChange={(e) => setVarsText(e.target.value)} className="font-mono text-xs" spellCheck={false} />
                </FormField>
              )}
            </div>
          </Section>

          {issues.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {issues.map((i) => (
                <li key={i} className="font-mono">
                  {i}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="lg" icon={<SendIcon size={15} />} loading={send.isPending} disabled={!canSend}>
              Send notification
            </Button>
            {!hasTitle && <span className="text-xs text-zinc-500">A title is required (or a template that sets one).</span>}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-zinc-500 select-none">Request body (POST /api/notifications)</summary>
            <CodeBlock className="mt-2" code={JSON.stringify(input, null, 2)} />
          </details>
        </form>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <h3 className="mb-3 text-sm font-semibold">Live preview</h3>
          <PlatformPreviews notification={preview} />
        </div>
      </div>
    </PageContainer>
  );
}

/** Optional targeting: no selection = every device; otherwise only the chosen devices alert. */
function DevicePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const devices = useDevices();
  if (!devices.data?.length) return null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <FormField label="Deliver to" hint={value.length ? "Only the selected devices alert" : "All devices"}>
      <div className="flex flex-wrap gap-1.5">
        {devices.data.map((d) => {
          const on = value.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(d.id)}
              className={cx(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                on
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-300",
              )}
            >
              {d.name}
            </button>
          );
        })}
      </div>
    </FormField>
  );
}
