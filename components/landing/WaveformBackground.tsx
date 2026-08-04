"use client";

import React, { useEffect, useRef } from "react";

export function WaveformBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };

    window.addEventListener("resize", resize);
    resize();

    const draw = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      ctx.clearRect(0, 0, width, height);

      const waves = [
        { amplitude: height * 0.15, frequency: 0.002, speed: 0.0005, phase: 0, opacity: 0.08, lineWidth: 1.5 },
        { amplitude: height * 0.2, frequency: 0.0015, speed: 0.0007, phase: Math.PI / 3, opacity: 0.06, lineWidth: 1 },
        { amplitude: height * 0.1, frequency: 0.003, speed: 0.0004, phase: Math.PI / 1.5, opacity: 0.1, lineWidth: 2 },
      ];

      waves.forEach((wave) => {
        ctx.beginPath();
        const currentAmplitude = wave.amplitude + Math.sin(time * 0.0002) * (wave.amplitude * 0.2);

        for (let x = 0; x <= width; x += 2) {
          const y = height / 2 +
            Math.sin(x * wave.frequency + time * wave.speed + wave.phase) * currentAmplitude *
            Math.sin(x * 0.0005 - time * 0.0001);

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.strokeStyle = `rgba(255, 255, 255, ${wave.opacity})`;
        ctx.lineWidth = wave.lineWidth;
        ctx.stroke();
      });

      time += 16;
      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none opacity-80 mix-blend-screen h-full w-full">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
