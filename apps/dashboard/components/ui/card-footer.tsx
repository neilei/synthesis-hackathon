/**
 * Card footer with top border divider. Used for sponsor attribution
 * at the bottom of cards throughout the dashboard.
 *
 * @module @maw/dashboard/components/ui/card-footer
 */

interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function CardFooter({ children, className = "" }: CardFooterProps) {
  return (
    <div className={`mt-4 border-t border-border-subtle pt-3 ${className}`}>
      {children}
    </div>
  );
}
