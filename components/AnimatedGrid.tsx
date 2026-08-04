"use client";

import { useEffect, useRef } from "react";

interface AnimatedGridProps {
  cursorX: number;
  cursorY: number;
}

export function AnimatedGrid({ cursorX, cursorY }: AnimatedGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    let accent = "#ffffff";

    const setSize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    setSize();
    window.addEventListener("resize", setSize);

    const cols = 80;
    const rows = 80;
    const spacing = 16;

    let currentMouseX = cursorX * width;
    let currentMouseY = (1 - cursorY) * height;

    const render = (time: number) => {
      const targetMouseX = cursorX * width;
      const targetMouseY = (1 - cursorY) * height;
      currentMouseX += (targetMouseX - currentMouseX) * 0.18;
      currentMouseY += (targetMouseY - currentMouseY) * 0.18;

      ctx.clearRect(0, 0, width, height);

      const computedStyle = getComputedStyle(document.documentElement);
      const newAccent = computedStyle.getPropertyValue("--accent").trim();
      if (newAccent) accent = newAccent;

      const points: { px: number; py: number; z: number }[][] = [];

      for (let i = 0; i < rows; i++) {
        points[i] = [];
        for (let j = 0; j < cols; j++) {
          const x = (j - cols / 2) * spacing;
          const z = (i - rows / 2) * spacing;

          const isAxis = i === Math.floor(rows / 2) || j === Math.floor(cols / 2);

          const t = time * 0.0012;

          const wave1 = Math.sin(x * 0.01 + t) * 8;
          const wave2 = Math.cos(z * 0.012 - t * 0.8) * 8;

          const blobX = Math.sin(x * 0.015 - t * 0.6);
          const blobZ = Math.cos(z * 0.015 + t * 0.5);
          const blobs = Math.pow(Math.max(0, blobX * blobZ), 2) * 20;

          let y = wave1 + wave2 - blobs;

          if (isAxis) {
            y = 0;
          }

          const angle = Math.PI * 0.35;
          const ry = y * Math.cos(angle) - z * Math.sin(angle);
          const rz = y * Math.sin(angle) + z * Math.cos(angle);

          const fov = 900;
          const zOffset = 400;
          const finalZ = rz + zOffset;

          if (finalZ < 1) {
            points[i][j] = { px: -999, py: -999, z: -999 };
            continue;
          }

          const fScale = fov / finalZ;
          let px = x * fScale + width / 2;
          let py = ry * fScale + height / 2;

          const dx = px - currentMouseX;
          const dy = py - currentMouseY;
          const dist = Math.hypot(dx, dy);
          const maxDist = 140;

          if (dist < maxDist) {
            const force = (maxDist - dist) / maxDist;
            const pulse = Math.sin(time * 0.005) * 5 + 10;
            const displacement = Math.pow(force, 2) * (25 + pulse);

            // Keep the center lines steady while the rest follows the cursor.
            const movementMultiplier = isAxis ? 0 : 1.0;

            px += (dx / dist) * displacement * 0.2 * movementMultiplier;
            py += (dy / dist) * displacement * 0.2 * movementMultiplier;
          }

          points[i][j] = { px, py, z: finalZ };
        }
      }

      const drawSmoothPath = (pts: { px: number; py: number }[], axisType: "horizontal" | "vertical" | "none") => {
        if (pts.length < 2) return;

        ctx.beginPath();
        ctx.moveTo(pts[0].px, pts[0].py);
        for (let k = 1; k < pts.length - 1; k++) {
          const p1 = pts[k];
          const p2 = pts[k + 1];
          const midX = (p1.px + p2.px) / 2;
          const midY = (p1.py + p2.py) / 2;
          ctx.quadraticCurveTo(p1.px, p1.py, midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.px, last.py);

        if (axisType !== "none") {
          let axisGradient;
          if (axisType === "horizontal") {
            axisGradient = ctx.createLinearGradient(0, height / 2, width, height / 2);
          } else {
            axisGradient = ctx.createLinearGradient(width / 2, 0, width / 2, height);
          }

          axisGradient.addColorStop(0, "transparent");
          axisGradient.addColorStop(0.12, `color-mix(in srgb, ${accent} 90%, white)`);
          axisGradient.addColorStop(0.3, `color-mix(in srgb, ${accent} 100%, white)`);
          axisGradient.addColorStop(0.7, `color-mix(in srgb, ${accent} 100%, white)`);
          axisGradient.addColorStop(0.88, `color-mix(in srgb, ${accent} 90%, white)`);
          axisGradient.addColorStop(1, "transparent");

          ctx.lineWidth = 1.8;
          ctx.strokeStyle = axisGradient;
          ctx.shadowBlur = 12;
          ctx.shadowColor = accent;
        } else {
          ctx.lineWidth = 0.6;
          ctx.strokeStyle = `color-mix(in srgb, ${accent} 25%, transparent)`;
          ctx.shadowBlur = 2;
          ctx.shadowColor = `color-mix(in srgb, ${accent} 20%, transparent)`;
        }

        ctx.stroke();
      };

      const centerRow = Math.floor(rows / 2);
      const centerCol = Math.floor(cols / 2);

      for (let i = 0; i < rows; i++) {
        const validRow = [];
        for (let j = 0; j < cols; j++) {
          if (points[i][j].z !== -999) validRow.push(points[i][j]);
        }
        drawSmoothPath(validRow, i === centerRow ? "horizontal" : "none");
      }

      for (let j = 0; j < cols; j++) {
        const validCol = [];
        for (let i = 0; i < rows; i++) {
          if (points[i][j].z !== -999) validCol.push(points[i][j]);
        }
        drawSmoothPath(validCol, j === centerCol ? "vertical" : "none");
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", setSize);
    };
  }, [cursorX, cursorY]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        mixBlendMode: "screen",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
        WebkitMaskComposite: "source-in",
        maskImage: "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
        maskComposite: "intersect"
      }}
    />
  );
}
