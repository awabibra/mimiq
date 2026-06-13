import React from "react";

interface LogoProps {
  className?: string;
  variant?: "nav" | "hero";
}

export function Logo({ className = "", variant = "nav" }: LogoProps) {
  const isHero = variant === "hero";

  // Hero: large, fluid, clamp-controlled so it never overflows on small screens
  // Nav: compact, fixed 18-20px
  const fontSize = isHero
    ? "clamp(64px, 16vw, 128px)"
    : "clamp(16px, 2vw, 20px)";

  return (
    <span
      className={`inline-flex items-center font-extrabold tracking-tighter lowercase text-white ${className}`}
      style={{
        fontSize,
        letterSpacing: "-0.03em",
        lineHeight: 1,
        // Prevent the hero logo from exceeding screen width
        maxWidth: isHero ? "min(90vw, 640px)" : undefined,
      }}
    >
      m
      <span className="relative">
        i
        {/* Dot above the 'i' */}
        <span
          className="absolute rounded-full bg-[#CBFF1E]"
          style={{
            width: "0.15em",
            height: "0.15em",
            left: "50%",
            transform: "translate(-50%, -85%)",
            top: "0.1em",
            boxShadow: "0 0 8px rgba(203,255,30,0.6)",
          }}
          aria-hidden
        />
      </span>
      m
      <span className="relative">
        i
        <span
          className="absolute rounded-full bg-[#CBFF1E]"
          style={{
            width: "0.15em",
            height: "0.15em",
            left: "50%",
            transform: "translate(-50%, -85%)",
            top: "0.1em",
            boxShadow: "0 0 8px rgba(203,255,30,0.6)",
          }}
          aria-hidden
        />
      </span>
      <span className="text-[#CBFF1E] relative inline-flex">
        q
        {/* Accent underline on descender */}
        <span
          className="absolute rounded-full bg-[#CBFF1E]"
          style={{
            height: "0.15em",
            width: "0.3em",
            bottom: "-0.05em",
            right: 0,
          }}
          aria-hidden
        />
      </span>
    </span>
  );
}
