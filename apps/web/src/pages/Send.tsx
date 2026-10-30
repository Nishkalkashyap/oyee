import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { IntentSendInput, LIMITS, Severity, ProgressStatus, type Field, type LinkButton } from "@oyee/schema";
import { errorMessage } from "../lib/api";
import { buildSendInput, COMPOSER_PRESETS, emptyComposer, previewNotification, type ComposerIntent, type ComposerState } from "../lib/composer";
import { useDevices, useSendNotification } from "../lib/queries";
import { SEVERITY_STYLES } from "../lib/severity";
import { CodeBlock } from "../components/Code";
import { PlusIcon, SendIcon, XIcon } from "../components/Icons";
import { PageContainer } from "../components/Layout";
import { PlatformPreviews } from "../components/PlatformPreviews";
import { useToast } from "../components/Toast";
import { Button, FormField, Input, PageHeader, Panel, Segmented, Select, Textarea, cx } from "../components/ui";

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

const INTENTS: { value: ComposerIntent; label: string; hint: string }[] = [
  { value: "inform", label: "Inform", hint: "Something you should know. Alerts on every device." },
  { value: "progress", label: "Progress", hint: "Long-running work, updated in place by key. Alerts once when it's done or failed." },
];

const STATUS_LABEL: Record<ProgressStatus, string> = { running: "Running (silent)", done: "Done (alerts)", failed: "Failed (alerts)" };

/** A number input that maps an empty box to null ("leave it to the server"). */
const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function SendPage() {
  const [s, setS] = useState<ComposerState>(emptyComposer);
  const send = useSendNotification();
  const toast = useToast();
  const navigate = useNavigate();

  const set = <K extends keyof ComposerState>(k: K, v: ComposerState[K]) => setS((p) => ({ ...p, [k]: v }));
  const input = useMemo(() => buildSendInput(s), [s]);
  const validation = useMemo(() => IntentSendInput.safeParse(input), [input]);
  const preview = useMemo(() => previewNotification(input), [input]);
  const hasTitle = !!s.title.trim();
  const issues = validation.success ? [] : validation.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
  const canSend = validation.success;
  const progress = s.intent === "progress";

  const updateField = (i: number, patch: Partial<Field>) => set("fields", s.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const updateLink = (i: number, patch: Partial<LinkButton>) => set("links", s.links.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () => {
    send.mutate(input, {
      onSuccess: (sent) =>
        toast.show({
          kind: "success",
          title: sent.outcome === "created" ? "Notification sent" : `Sent: ${sent.outcome.replace("_", " ")}`,
          description: `${sent.notification.title} · click to open`,
          onClick: () => navigate(`/inbox/${sent.id}`),
        }),
      onError: (e) => toast.error("Couldn't send", errorMessage(e)),
    });
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Send"
        description="Send yourself an inform or a progress, with the same fields agents and webhooks use."
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
          <Section title="Intent">
            <Segmented value={s.intent} options={INTENTS} onChange={(v) => set("intent", v)} />
            <p className="text-xs text-zinc-500">{INTENTS.find((i) => i.value === s.intent)?.hint}</p>
          </Section>

          <Section title="Content">
            <FormField label="Title" htmlFor="c-title">
              <Input
                id="c-title"
                value={s.title}
                maxLength={200}
                onChange={(e) => set("title", e.target.value)}
                placeholder={progress ? "Deploying api to prod" : "Backup finished"}
              />
            </FormField>
            <FormField label="Body" htmlFor="c-body" hint="Supports **bold**, *italic*, `code`, [links](https://…) and line breaks.">
              <Textarea id="c-body" rows={3} maxLength={4000} value={s.body} onChange={(e) => set("body", e.target.value)} />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-3">
              {!progress && (
                <FormField label="Severity" htmlFor="c-sev">
                  <Select id="c-sev" value={s.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
                    {Severity.options.map((sv) => (
                      <option key={sv} value={sv}>
                        {SEVERITY_STYLES[sv].label}
                      </option>
                    ))}
                  </Select>
                </FormField>
              )}
              <FormField label="Source" htmlFor="c-src">
                <Input id="c-src" value={s.source} maxLength={64} onChange={(e) => set("source", e.target.value)} placeholder="web" />
              </FormField>
              <FormField
                label={progress ? "Key (required)" : "Key"}
                htmlFor="c-key"
                hint={progress ? "Reports with this key update one progress" : "A later send with this key updates it"}
              >
                <Input id="c-key" value={s.key} maxLength={128} onChange={(e) => set("key", e.target.value)} placeholder={progress ? "deploy-api" : "nightly-backup"} />
              </FormField>
              {!progress && (
                <>
                  <FormField label="Cooldown" htmlFor="c-cool" hint="With a key: alert at most once per, e.g. 1h">
                    <Input id="c-cool" value={s.cooldown} onChange={(e) => set("cooldown", e.target.value)} placeholder="1h" />
                  </FormField>
                  <FormField label="Icon" htmlFor="c-icon" hint="Emoji or https URL">
                    <Input id="c-icon" value={s.icon} onChange={(e) => set("icon", e.target.value)} placeholder="🚀" />
                  </FormField>
                </>
              )}
            </div>
            <DevicePicker value={s.devices} onChange={(devices) => set("devices", devices)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Click URL" htmlFor="c-url" hint="Opens when the notification is tapped">
                <Input id="c-url" type="url" value={s.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
              </FormField>
              {!progress && (
                <FormField label="Image URL" htmlFor="c-img">
                  <Input id="c-img" type="url" value={s.image} onChange={(e) => set("image", e.target.value)} placeholder="https://…/graph.png" />
                </FormField>
              )}
            </div>
          </Section>

          {progress ? (
            <Section title="Progress">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <FormField label="Value" htmlFor="c-pv">
                  <Input id="c-pv" type="number" min={0} value={s.value ?? ""} placeholder="0" onChange={(e) => set("value", numberOrNull(e.target.value))} />
                </FormField>
                <FormField label="Max" htmlFor="c-pm">
                  <Input id="c-pm" type="number" min={1} value={s.max ?? ""} placeholder="100" onChange={(e) => set("max", numberOrNull(e.target.value))} />
                </FormField>
                <FormField label="Label" htmlFor="c-pl">
                  <Input id="c-pl" value={s.label} maxLength={64} placeholder="3/7 checks" onChange={(e) => set("label", e.target.value)} />
                </FormField>
                <FormField label="Stopped after" htmlFor="c-stale" hint="Quiet this long = stopped">
                  <Input id="c-stale" value={s.staleAfter} placeholder={LIMITS.defaultStaleAfter} onChange={(e) => set("staleAfter", e.target.value)} />
                </FormField>
                <input
                  type="range"
                  aria-label="Progress value"
                  min={0}
                  max={s.max || 100}
                  value={s.value ?? 0}
                  onChange={(e) => set("value", Number(e.target.value))}
                  className="col-span-full accent-brand"
                />
              </div>
              <FormField label="Status">
                <Segmented
                  size="sm"
                  value={s.status}
                  options={ProgressStatus.options.map((st) => ({ value: st, label: STATUS_LABEL[st] }))}
                  onChange={(v) => set("status", v)}
                />
              </FormField>
            </Section>
          ) : (
            <>
              <Section
                title="Rows"
                right={
                  <Button size="sm" variant="ghost" icon={<PlusIcon size={13} />} disabled={s.fields.length >= LIMITS.maxFields} onClick={() => set("fields", [...s.fields, { label: "", value: "" }])}>
                    Add row
                  </Button>
                }
              >
                {s.fields.length === 0 && <p className="text-xs text-zinc-500">Label/value rows for structured facts (max {LIMITS.maxFields}).</p>}
                {s.fields.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <Input aria-label="Row label" value={f.label} maxLength={40} placeholder="Label" onChange={(e) => updateField(i, { label: e.target.value })} className="w-2/5" />
                    <Input aria-label="Row value" value={f.value} maxLength={200} placeholder="Value" onChange={(e) => updateField(i, { value: e.target.value })} />
                    <IconButton label="Remove row" onClick={() => set("fields", s.fields.filter((_, j) => j !== i))} />
                  </div>
                ))}
              </Section>

              <Section
                title="Link buttons"
                right={
                  <Button size="sm" variant="ghost" icon={<PlusIcon size={13} />} disabled={s.links.length >= LIMITS.maxLinks} onClick={() => set("links", [...s.links, { label: "", url: "" }])}>
                    Add link
                  </Button>
                }
              >
                {s.links.length === 0 && <p className="text-xs text-zinc-500">Up to {LIMITS.maxLinks} buttons that open a URL, e.g. the PR or the build log.</p>}
                {s.links.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Input aria-label="Link label" value={l.label} maxLength={32} placeholder="Label" onChange={(e) => updateLink(i, { label: e.target.value })} className="w-2/5" />
                    <Input aria-label="Link URL" type="url" value={l.url} placeholder="https://…" onChange={(e) => updateLink(i, { url: e.target.value })} />
                    <IconButton label="Remove link" onClick={() => set("links", s.links.filter((_, j) => j !== i))} />
                  </div>
                ))}
              </Section>
            </>
          )}

          {hasTitle && issues.length > 0 && (
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
              {progress ? "Report progress" : "Send inform"}
            </Button>
            {!hasTitle && <span className="text-xs text-zinc-500">A title is required{progress ? ", and a key" : ""}.</span>}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-zinc-500 select-none">Request body (POST /api/notifications or a webhook)</summary>
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
