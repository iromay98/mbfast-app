import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// 共通の軽量UIパーツ（業務的・モバイルファースト）

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface p-4 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold text-ink sm:text-xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-gold-500 text-white hover:bg-gold-600 active:bg-gold-700",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-ink-soft hover:bg-surface-2",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function LinkButton({
  variant = "primary",
  className = "",
  href,
  children,
}: {
  variant?: ButtonVariant;
  className?: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition ${buttonStyles[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

// input/textarea/select は font-size 16px 以上でスマホのズームを防ぐ
const fieldBase =
  "w-full min-h-11 rounded-lg border border-line bg-surface px-3 text-base text-ink outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-200";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${fieldBase} ${props.className ?? ""}`} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={`${fieldBase} py-2 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: ComponentProps<"select">) {
  return (
    <select {...props} className={`${fieldBase} ${props.className ?? ""}`} />
  );
}

const badgeStyles: Record<string, string> = {
  gold: "bg-gold-100 text-gold-700",
  gray: "bg-gray-100 text-gray-600",
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-800",
};

export function Badge({
  children,
  color = "gray",
}: {
  children: ReactNode;
  color?: keyof typeof badgeStyles;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeStyles[color]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-soft">
      {message}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}
