interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div className={`rounded-lg border border-border bg-bg-surface ${className}`} {...rest}>
      {children}
    </div>
  );
}
