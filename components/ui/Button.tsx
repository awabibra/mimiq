import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "default" | "sm";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--accent)",
    color: "var(--bg-base)",
  },
  secondary: {
    background: "transparent",
    color: "var(--text-primary)",
    border: "0.5px solid var(--border-default)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  default: {
    padding: "8px 16px",
    fontSize: "var(--fs-body)",
  },
  sm: {
    padding: "4px 12px",
    fontSize: "var(--fs-secondary)",
  },
};

export function Button({
  variant = "secondary",
  size = "default",
  children,
  style,
  ...props
}: ButtonProps) {
  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "var(--font-body)",
    fontWeight: "var(--fw-medium)" as unknown as number,
    lineHeight: 1,
    borderRadius: "var(--radius-button)",
    border: "none",
    cursor: "pointer",
    transition: "all var(--transition)",
    whiteSpace: "nowrap",
    userSelect: "none",
    ...variantStyles[variant],
    ...sizeStyles[size],
    ...style,
  };

  return (
    <button
      style={baseStyle}
      onMouseEnter={(e) => {
        if (variant === "secondary" || variant === "ghost") {
          e.currentTarget.style.boxShadow =
            "0 0 0 1px rgba(255, 255, 255, 0.04)";
        }
        if (variant === "ghost") {
          e.currentTarget.style.color = "var(--text-primary)";
        }
        props.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
        if (variant === "ghost") {
          e.currentTarget.style.color = "var(--text-secondary)";
        }
        props.onMouseLeave?.(e);
      }}
      {...props}
    >
      {children}
    </button>
  );
}
