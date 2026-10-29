import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { SpinnerIcon, XIcon } from "./Icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "brand" | "secondary" | "ghost" | "danger" | "outline-danger";
type ButtonSize = "sm" | "md" | "lg";

// Gluon's pill buttons: filled ink primary, blue brand (send / create), soft secondary and quiet ghost.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:opacity-90",
  brand: "bg-brand text-brand-foreground hover:opacity-90",
  secondary: "bg-zinc-100 text-foreground hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700",
  ghost: "text-secondary-label hover:bg-zinc-200/70 hover:text-foreground dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-500",
  "outline-danger": "text-red-600 hover:bg-red-500/10 dark:text-red-400",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

/** Button styling for links (<a>/<Link>) so we never nest a <button> inside an anchor. */
export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return cx(
    "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap select-none",
    "transition-[color,background-color,opacity,scale] duration-150 active:scale-[0.96]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <SpinnerIcon className="animate-spin" size={size === "sm" ? 12 : 14} /> : icon}
      {children}
    </button>
  );
});

const fieldBase =
  "w-full rounded-xl border border-zinc-300 bg-background px-3.5 text-sm text-foreground placeholder:text-zinc-400 transition-colors " +
  "focus:border-brand focus:ring-3 focus:ring-brand/15 focus:outline-none " +
  "dark:border-zinc-700 dark:placeholder:text-zinc-500 " +
  "disabled:opacity-60 aria-invalid:border-red-500 aria-invalid:ring-red-500/20";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(fieldBase, "py-2", className)} {...rest} />;
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function FormField({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-secondary-label">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** A soft card inside a page: Gluon's `card` fill with large rounded corners, no border. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-[22px] bg-zinc-50 dark:bg-zinc-800/60", className)}>
      {children}
    </div>
  );
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-semibold leading-none",
        className ?? "bg-zinc-100 text-secondary-label dark:bg-zinc-800",
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return <SpinnerIcon size={size} className={cx("animate-spin text-brand", className)} />;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.035em] text-foreground md:text-2xl md:font-bold md:tracking-tight">
          {title}
        </h1>
        {description && <p className="mt-1 text-[14.5px] text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBanner({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
      <span>{children}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-chip text-chip-foreground">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold tracking-tight text-foreground">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            "rounded-full font-medium transition-colors",
            size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-[13px]",
            value === o.value
              ? "bg-chip font-semibold text-chip-foreground"
              : "bg-zinc-100 text-secondary-label hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Modal built on the native <dialog> element (focus trap + Esc for free). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-[26px] bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/60",
        size === "md" ? "max-w-md" : size === "lg" ? "max-w-2xl" : "max-w-4xl",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <XIcon size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-6 pt-1 pb-6">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Avatar({ name, src, size = 28, letters = 1 }: { name: string; src?: string | null; size?: number; letters?: number }) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, letters)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  if (src)
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...avatarTint(name) }}
    >
      {initials || "?"}
    </span>
  );
}

// Pastel avatar fills with matching ink, picked by hashing the name.
const TINTS = [
  { background: "#E4E8EF", color: "#334155" },
  { background: "#D5F0EC", color: "#0F5F57" },
  { background: "#E2ECFB", color: "#1E4E9A" },
  { background: "#E3F2E1", color: "#2F6B2A" },
  { background: "#F9D3DE", color: "#9D174D" },
  { background: "#EDE4F7", color: "#5B21B6" },
];

export function avatarTint(name: string): { background: string; color: string } {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

/** Brand-coloured unread count (Gluon's CountBadge); pops in when it appears. */
export function CountBadge({ count, size = "md", className }: { count: number; size?: "sm" | "md"; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        "pop-in inline-flex shrink-0 items-center justify-center rounded-full bg-brand font-bold text-brand-foreground tabular-nums",
        size === "sm" ? "h-[18px] min-w-[18px] px-[5px] text-[11px]" : "h-5 min-w-5 px-1.5 text-xs",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The Oyee mark: an "o" speech bubble with an unread dot (docs/brand/oyee-mark.svg). Inherits `currentColor`. */
export function OyeeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path fillRule="evenodd" d="M3.3 13.5a7.2 7.2 0 1 0 14.4 0a7.2 7.2 0 1 0-14.4 0ZM7.2 13.5a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0Z" />
      <path d="M4.4 17.2L3 21.6l5.4-1.4Z" />
      <circle cx="19" cy="5" r="3" />
    </svg>
  );
}

/** The brand tile: the mark in white on blue. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground", className)}
    >
      <OyeeMark className="size-[62%]" />
    </span>
  );
}

/** Single-select light-blue pill filters (Gluon's FilterChips). */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors",
        active
          ? "bg-chip font-semibold text-chip-foreground"
          : "bg-zinc-100 font-medium text-secondary-label hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700",
      )}
    >
      {children}
    </button>
  );
}
