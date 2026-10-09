import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * Plain list rows on one raised card with hairlines between them. A row is a
 * line icon, a title, one quiet line under it and a chevron. Nothing here is
 * orange: orange is for the lip button.
 */
const ROW =
  "flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left focus-visible:[outline-offset:-2px]";

export function RowGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-hidden rounded-hz border border-line bg-ink-2 [&>*+*]:border-t [&>*+*]:border-line", className)}>
      {children}
    </div>
  );
}

function Body({
  icon: Icon,
  lead,
  title,
  hint,
  tone,
  chevron = true,
  trailing,
}: {
  icon?: LucideIcon;
  lead?: React.ReactNode;
  title: string;
  hint?: string;
  tone?: "danger";
  chevron?: boolean;
  /** Replaces the chevron (an action that is not a page). */
  trailing?: React.ReactNode;
}) {
  return (
    <>
      {lead ?? (Icon && <Icon size={19} strokeWidth={1.9} aria-hidden className={clsx("flex-none", tone === "danger" ? "text-fireant" : "text-dim")} />)}
      <span className="min-w-0 flex-1">
        <span className={clsx("block font-body text-[15px] font-semibold leading-tight", tone === "danger" && "text-fireant")}>{title}</span>
        {hint && <span className="hint mt-0.5 block">{hint}</span>}
      </span>
      {trailing ?? (chevron && <ChevronRight size={18} aria-hidden className="flex-none text-dim" />)}
    </>
  );
}

type RowProps = { icon?: LucideIcon; lead?: React.ReactNode; title: string; hint?: string; tone?: "danger"; chevron?: boolean; trailing?: React.ReactNode };

export function RowLink({ href, ...rest }: RowProps & { href: string }) {
  return (
    <Link href={href} className={ROW}>
      <Body {...rest} />
    </Link>
  );
}

export function RowButton({
  onClick,
  disabled,
  ...rest
}: RowProps & { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={clsx(ROW, "disabled:opacity-60")}>
      <Body {...rest} />
    </button>
  );
}

/** A row that shows a value and has one small action on the right. */
export function RowValue({
  label,
  value,
  action,
  onAction,
}: {
  label: string;
  value: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className={clsx(ROW, "justify-between")}>
      <span className="min-w-0 flex-1">
        <span className="seclabel block">{label}</span>
        <span className="mt-0.5 block truncate font-body text-[15px] font-semibold">{value}</span>
      </span>
      <button type="button" onClick={onAction} className="btn btn-ghost flex-none px-3 py-2 text-[11px]">
        {action}
      </button>
    </div>
  );
}
