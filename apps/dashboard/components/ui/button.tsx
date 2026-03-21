/**
 * Variant-based button component. Consolidates the 7+ button patterns
 * used across the dashboard into a single composable primitive.
 *
 * @module @maw/dashboard/components/ui/button
 */

type ButtonVariant = "secondary" | "outline" | "solid" | "danger" | "text";
type ButtonSize = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BASE =
  "inline-flex items-center justify-center font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Border button — View Audit, Download, Cancel, Disconnect
  secondary:
    "rounded-md border border-border text-text-secondary hover:text-text-primary hover:border-text-tertiary focus-visible:ring-1 focus-visible:ring-accent-positive",
  // Outline accent — Preview Strategy, Retry Auth, Try Again
  outline:
    "rounded-lg border border-accent-positive text-accent-positive hover:bg-accent-positive-dim active:bg-accent-positive/20 focus-visible:ring-1 focus-visible:ring-accent-positive",
  // Filled accent — Deploy Agent, Go to Configure
  solid:
    "rounded-lg bg-accent-positive text-bg-primary hover:bg-accent-positive/90 active:bg-accent-positive/80 focus-visible:ring-1 focus-visible:ring-accent-positive focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
  // Red danger — Stop Agent
  danger:
    "rounded-md border border-accent-danger/30 text-accent-danger hover:bg-accent-danger/10 focus-visible:ring-1 focus-visible:ring-accent-danger",
  // Text-only — Back links
  text:
    "rounded-sm text-text-secondary hover:text-text-primary focus-visible:ring-1 focus-visible:ring-accent-positive",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-2 min-h-[44px] text-xs",
  md: "px-5 py-2.5 min-h-[44px] text-sm",
};

export function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
