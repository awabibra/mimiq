import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  padding?: string;
  children: React.ReactNode;
}

export function Card({
  hoverable = false,
  padding = "var(--space-3)",
  children,
  style,
  ...props
}: CardProps) {
  const baseStyle: React.CSSProperties = {
    background: "var(--bg-surface)",
    border: "0.5px solid var(--border-default)",
    borderRadius: "var(--radius-card)",
    padding,
    transition: "all var(--transition)",
    ...style,
  };

  const hoverHandlers = hoverable
    ? {
        onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
          e.currentTarget.style.boxShadow =
            "0 0 0 1px rgba(255, 255, 255, 0.04)";
          props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
          e.currentTarget.style.boxShadow = "none";
          props.onMouseLeave?.(e);
        },
      }
    : {};

  return (
    <div style={baseStyle} {...hoverHandlers} {...props}>
      {children}
    </div>
  );
}
