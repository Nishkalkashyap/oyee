/**
 * Live connection to `/api/ws` (protocol §6): ping every 30 s, `sync` with the last cursor on every (re)connect,
 * exponential backoff (1 s → 60 s, jitter), and TanStack Query cache patching on created/updated/deleted.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { ClientMessage, ServerMessage } from "@oyee/schema";
import { eventsFromServerMessage } from "./cache";
import { applyLiveEvents, qk } from "./queries";

export type LiveStatus = "connecting" | "open" | "reconnecting" | "offline" | "stopped";

export interface LiveState {
  status: LiveStatus;
  /** When the next reconnect attempt happens (ms epoch), if waiting. */
  retryAt: number | null;
  /** Server time from the last `hello`. */
  connectedAt: number | null;
}

/** Minimal WebSocket surface, so mock mode can substitute an in-memory socket. */
export interface LiveSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => LiveSocket;

let socketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as LiveSocket;

export function setSocketFactory(f: SocketFactory): void {
  socketFactory = f;
}

export const PING_INTERVAL_MS = 30_000;
/** No frame at all (not even pong) for this long → assume the connection is dead. */
export const STALE_AFTER_MS = 75_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;

/** Exponential backoff with "equal jitter": half fixed, half random. attempt starts at 0. */
export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + (rand() * exp) / 2);
}

export function wsUrl(loc: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/ws`;
}

type MessageListener = (msg: ServerMessage) => void;
type StateListener = () => void;

export class LiveConnection {
  private qc: QueryClient;
  private socket: LiveSocket | null = null;
  private attempt = 0;
  private cursor: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastFrameAt = 0;
  private everOpened = false;
  private running = false;
  private state: LiveState = { status: "stopped", retryAt: null, connectedAt: null };
  private stateListeners = new Set<StateListener>();
  private messageListeners = new Set<MessageListener>();

  constructor(qc: QueryClient) {
    this.qc = qc;
  }

  getState = (): LiveState => this.state;

  subscribeState = (fn: StateListener): (() => void) => {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  };

  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.connect();
  }

  stop(): void {
    this.running = false;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.clearTimers();
    this.teardownSocket();
    this.setState({ status: "stopped", retryAt: null });
  }

  /** Skip the backoff wait and reconnect immediately. */
  reconnectNow(): void {
    if (!this.running) return;
    this.attempt = 0;
    this.clearTimers();
    this.teardownSocket();
    this.connect();
  }

  send(msg: ClientMessage): void {
    try {
      this.socket?.send(JSON.stringify(msg));
    } catch {
      /* socket closing; the close handler reconnects */
    }
  }

  private setState(patch: Partial<LiveState>): void {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((fn) => fn());
  }

  private connect(): void {
    if (!this.running) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setState({ status: "offline", retryAt: null });
      return;
    }
    this.setState({ status: this.everOpened ? "reconnecting" : "connecting", retryAt: null });
    let socket: LiveSocket;
    try {
      socket = socketFactory(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    let opened = false;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      opened = true;
      this.everOpened = true;
      this.attempt = 0;
      this.lastFrameAt = Date.now();
      this.setState({ status: "open", retryAt: null });
      this.send({ type: "sync", since: this.cursor });
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastFrameAt > STALE_AFTER_MS) {
          // Half-open connection: force a reconnect.
          this.teardownSocket();
          this.scheduleReconnect();
          return;
        }
        this.send({ type: "ping" });
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      this.lastFrameAt = Date.now();
      if (typeof ev.data !== "string") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    socket.onerror = () => {
      /* onclose follows */
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      // Failing to even open may mean the session expired: re-check /api/me so the auth gate can redirect.
      if (!opened && this.attempt % 3 === 2) void this.qc.invalidateQueries({ queryKey: qk.me });
      this.scheduleReconnect();
    };
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "hello":
        this.setState({ connectedAt: Date.parse(msg.serverTime) || Date.now() });
        break;
      case "sync.result":
        applyLiveEvents(this.qc, eventsFromServerMessage(msg));
        this.cursor = msg.cursor;
        if (msg.hasMore) this.send({ type: "sync", since: this.cursor });
        break;
      case "notification.created":
      case "notification.updated":
      case "notification.deleted":
        applyLiveEvents(this.qc, eventsFromServerMessage(msg));
        break;
      default:
        break;
    }
    this.messageListeners.forEach((fn) => fn(msg));
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = backoffDelay(this.attempt++);
    this.setState({ status: "reconnecting", retryAt: Date.now() + delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private teardownSocket(): void {
    const s = this.socket;
    this.socket = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close(1000, "client closing");
      } catch {
        /* ignore */
      }
    }
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private handleOnline = () => this.reconnectNow();

  private handleOffline = () => {
    this.clearTimers();
    this.teardownSocket();
    if (this.running) this.setState({ status: "offline", retryAt: null });
  };

  private handleVisibility = () => {
    if (document.visibilityState === "visible" && this.running && !this.socket) this.reconnectNow();
  };
}
