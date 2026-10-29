import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CreateTokenInput,
  Notification,
  RegisterWebDeviceInput,
  RespondInput,
  SendNotificationInput,
  UpsertTemplateInput,
} from "@oyee/schema";
import { api } from "./api";
import {
  applyEventToDetail,
  applyEventsToPages,
  flattenPages,
  markAllReadInPages,
  type CacheEvent,
  type InboxFilters,
  type NotificationPages,
} from "./cache";

export const PAGE_SIZE = 30;

export const qk = {
  config: ["config"] as const,
  me: ["me"] as const,
  usage: ["usage"] as const,
  tokens: ["tokens"] as const,
  devices: ["devices"] as const,
  sources: ["sources"] as const,
  templates: ["templates"] as const,
  notificationLists: ["notifications", "list"] as const,
  notificationList: (f: InboxFilters) => ["notifications", "list", f] as const,
  notification: (id: string) => ["notifications", "detail", id] as const,
};

/** Drops empty filter values so equivalent filters share a cache key. */
export function normalizeFilters(f: InboxFilters): InboxFilters {
  const out: InboxFilters = {};
  if (f.source) out.source = f.source;
  if (f.severity) out.severity = f.severity;
  if (f.status) out.status = f.status;
  if (f.threadId) out.threadId = f.threadId;
  if (f.q?.trim()) out.q = f.q.trim();
  return out;
}

// ─── Live cache patching ────────────────────────────────────────────────────

let sourcesTimer: ReturnType<typeof setTimeout> | null = null;
/** Source counts (and the unread badge) are server-computed; refetch them, debounced. */
export function invalidateSourcesSoon(qc: QueryClient): void {
  if (sourcesTimer) clearTimeout(sourcesTimer);
  sourcesTimer = setTimeout(() => {
    sourcesTimer = null;
    void qc.invalidateQueries({ queryKey: qk.sources });
  }, 400);
}

/** Applies live events to every cached notification list and detail. */
export function applyLiveEvents(qc: QueryClient, events: CacheEvent[]): void {
  if (events.length === 0) return;
  for (const q of qc.getQueryCache().findAll({ queryKey: qk.notificationLists })) {
    const filters = (q.queryKey[2] ?? {}) as InboxFilters;
    qc.setQueryData<NotificationPages>(q.queryKey, (old) => applyEventsToPages(old, events, filters));
  }
  for (const ev of events) {
    if (ev.kind === "upsert") {
      qc.setQueryData<Notification>(qk.notification(ev.notification.id), (old) =>
        applyEventToDetail(old, ev.notification),
      );
    } else {
      qc.removeQueries({ queryKey: qk.notification(ev.id), exact: true });
    }
  }
  invalidateSourcesSoon(qc);
}

function useApplyNotification() {
  const qc = useQueryClient();
  return (n: Notification) => applyLiveEvents(qc, [{ kind: "upsert", notification: n }]);
}

// ─── Meta / auth ────────────────────────────────────────────────────────────

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: 5 * 60_000 });
}

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: api.me, staleTime: 5 * 60_000, retry: false });
}

/** Today's quota usage; refetched each time it's shown (e.g. opening the account menu). */
export function useUsage(enabled: boolean) {
  return useQuery({ queryKey: qk.usage, queryFn: api.usage, enabled, staleTime: 0 });
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

export function useTokens() {
  return useQuery({ queryKey: qk.tokens, queryFn: async () => (await api.tokens.list()).items });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTokenInput) => api.tokens.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
}

// ─── Devices ────────────────────────────────────────────────────────────────

export function useDevices(opts: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.devices,
    queryFn: async () => (await api.devices.list()).items,
    refetchInterval: opts.poll ? 3000 : false,
    enabled: opts.enabled ?? true,
  });
}

export function useCreatePairingCode() {
  return useMutation({ mutationFn: () => api.devices.createPairingCode() });
}

export function useRemoveDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.devices.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }),
  });
}

export function useRenameDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.devices.rename(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }),
  });
}

export function useRegisterWebDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterWebDeviceInput) => api.devices.registerWeb(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }),
  });
}

// ─── Notifications ──────────────────────────────────────────────────────────

export function useNotificationList(filters: InboxFilters) {
  const f = normalizeFilters(filters);
  return useInfiniteQuery({
    queryKey: qk.notificationList(f),
    queryFn: ({ pageParam }) => api.notifications.list({ ...f, limit: PAGE_SIZE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Finds a notification in any cached list (instant detail render before the GET returns). */
function findInLists(qc: QueryClient, id: string): Notification | undefined {
  for (const [, data] of qc.getQueriesData<NotificationPages>({ queryKey: qk.notificationLists })) {
    const hit = flattenPages(data).find((n) => n.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function useNotification(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.notification(id ?? ""),
    queryFn: () => api.notifications.get(id!),
    enabled: !!id,
    placeholderData: () => (id ? findInLists(qc, id) : undefined),
  });
}

export function useSources() {
  return useQuery({ queryKey: qk.sources, queryFn: async () => (await api.sources()).items, staleTime: 15_000 });
}

export function useUnreadCount(): number {
  const { data } = useSources();
  return (data ?? []).reduce((sum, s) => sum + s.unread, 0);
}

export function useSendNotification() {
  const apply = useApplyNotification();
  return useMutation({
    mutationFn: (input: SendNotificationInput) => api.notifications.send(input),
    onSuccess: apply,
  });
}

export function useRespond(id: string) {
  const apply = useApplyNotification();
  return useMutation({
    mutationFn: (input: RespondInput) => api.notifications.respond(id, input),
    onSuccess: apply,
  });
}

export function useMarkRead() {
  const apply = useApplyNotification();
  return useMutation({ mutationFn: (id: string) => api.notifications.read(id), onSuccess: apply });
}

export function useResolve() {
  const apply = useApplyNotification();
  return useMutation({ mutationFn: (id: string) => api.notifications.resolve(id), onSuccess: apply });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notifications.remove(id),
    onSuccess: (_d, id) => applyLiveEvents(qc, [{ kind: "delete", id }]),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source?: string) => api.notifications.readAll(source),
    onSuccess: (_d, source) => {
      const at = new Date().toISOString();
      for (const q of qc.getQueryCache().findAll({ queryKey: qk.notificationLists })) {
        qc.setQueryData<NotificationPages>(q.queryKey, (old) => markAllReadInPages(old, at, source));
      }
      void qc.invalidateQueries({ queryKey: qk.sources });
      void qc.invalidateQueries({ queryKey: qk.notificationLists });
    },
  });
}

// ─── Templates ──────────────────────────────────────────────────────────────

export function useTemplates() {
  return useQuery({ queryKey: qk.templates, queryFn: async () => (await api.templates.list()).items });
}

export function usePutTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, input }: { name: string; input: UpsertTemplateInput }) => api.templates.put(name, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.templates }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.templates.remove(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.templates }),
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: ({ name, vars }: { name: string; vars: Record<string, string | number | boolean> }) =>
      api.templates.preview(name, vars),
  });
}
