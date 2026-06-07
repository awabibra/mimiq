import React from "react";

type BadgeVariant = "default" | "accent" | "muted";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: {
    background: "rgba(255, 255, 255, 0.06)",
    color: "var(--text-secondary)",
  },
  accent: {
    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
    color: "var(--accent)",
  },
  muted: {
    background: "rgba(255, 255, 255, 0.03)",
    color: "var(--text-tertiary)",
  },
};

export function Badge({
  variant = "default",
  children,
  style,
  ...props
}: BadgeProps) {
  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 10px",
    fontSize: "var(--fs-label)",
    fontWeight: "var(--fw-medium)" as unknown as number,
    fontFamily: "var(--font-body)",
    lineHeight: 1.4,
    borderRadius: "var(--radius-pill)",
    whiteSpace: "nowrap",
    userSelect: "none",
    letterSpacing: "0.01em",
    transition: "all var(--transition)",
    ...variantStyles[variant],
    ...style,
  };

  return (
    <span style={baseStyle} {...props}>
      {children}
    </span>
  );
}
