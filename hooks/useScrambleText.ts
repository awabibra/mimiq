import { useState, useEffect, useRef } from 'react';

interface ScrambleOptions {
  text: string;
  chars?: string;
  speed?: number;
  revealDelay?: number;
}

export function useScrambleText(
  targetText: string,
  isActive: boolean,
  options: Partial<ScrambleOptions> = {}
) {
  const [displayText, setDisplayText] = useState(targetText);
  const chars = options.chars || "qwerty1337h@ck3r";
  const speed = options.speed || 0.4;
  const revealDelay = options.revealDelay || 0.3;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isActive) {
      if (timerRef.current) clearInterval(timerRef.current);
      setDisplayText(targetText);
      return;
    }

    let frame = 0;
    const maxFrames = Math.floor(targetText.length / speed);
    const delayFrames = Math.floor((revealDelay * 1000) / 16);

    timerRef.current = setInterval(() => {
      frame++;
      
      if (frame < delayFrames) {
        // Just scramble everything initially
        setDisplayText(
          targetText
            .split("")
            .map((c) => (c === " " ? " " : chars[Math.floor(Math.random() * chars.length)]))
            .join("")
        );
        return;
      }

      const activeFrame = frame - delayFrames;
      const revealProgress = Math.min(1, activeFrame / maxFrames);
      const charsToReveal = Math.floor(targetText.length * revealProgress);

      if (charsToReveal >= targetText.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        setDisplayText(targetText);
        return;
      }

      setDisplayText(
        targetText
          .split("")
          .map((char, index) => {
            if (char === " ") return " ";
            if (index < charsToReveal) return char;
            return chars[Math.floor(Math.random() * chars.length)];
          })
          .join("")
      );
    }, 30); // ~30fps

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [targetText, isActive, chars, speed, revealDelay]);

  return displayText;
}
