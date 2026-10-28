import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircleIcon, InfoIcon, AlertTriangleIcon, XIcon } from "./Icons";
import { cx } from "./ui";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: ReactNode;
  description?: ReactNode;
  onClick?: () => void;
}

interface ToastApi {
  show: (t: Omit<ToastItem, "id">, durationMs?: number) => void;
  success: (title: ReactNode, description?: ReactNode) => void;
  error: (title: ReactNode, description?: ReactNode) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (t: Omit<ToastItem, "id">, durationMs = 4000) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ kind: "success", title, description }),
      error: (title, description) => show({ kind: "error", title, description }, 6000),
    }),
    [show],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white p-3 text-sm shadow-lg dark:bg-zinc-900",
              "border-zinc-200 dark:border-zinc-800 animate-[toast-in_160ms_ease-out]",
              t.onClick && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/80",
            )}
            onClick={() => {
              if (t.onClick) {
                t.onClick();
                dismiss(t.id);
              }
            }}
          >
            <span
              className={cx(
                "mt-0.5",
                t.kind === "success" && "text-emerald-500",
                t.kind === "error" && "text-red-500",
                t.kind === "info" && "text-brand",
              )}
            >
              {t.kind === "success" ? (
                <CheckCircleIcon />
              ) : t.kind === "error" ? (
                <AlertTriangleIcon />
              ) : (
                <InfoIcon />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{t.title}</div>
              {t.description && (
                <div className="mt-0.5 line-clamp-2 text-zinc-500 dark:text-zinc-400">{t.description}</div>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
            >
              <XIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
