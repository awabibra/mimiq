import React, { useState, useEffect, useRef, useCallback } from "react";
import { useScrambleText } from "@/hooks/useScrambleText";
import styles from "./MusicPortfolio.module.css";

export interface ProjectData {
  id: number;
  artist: string;
  album: string;
  category: string;
  label: string;
  year: string;
  image: string;
}

interface Config {
  timeZone?: string;
  timeUpdateInterval?: number;
  idleDelay?: number;
}

const TimeDisplay = ({ config }: { config: Config }) => {
  const [time, setTime] = useState({ hours: "", minutes: "", dayPeriod: "" });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        timeZone: config.timeZone || "America/New_York",
        hour12: true,
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      };
      const formatter = new Intl.DateTimeFormat("en-US", options);
      const parts = formatter.formatToParts(now);

      setTime({
        hours: parts.find((part) => part.type === "hour")?.value || "",
        minutes: parts.find((part) => part.type === "minute")?.value || "",
        dayPeriod: parts.find((part) => part.type === "dayPeriod")?.value || "",
      });
    };

    updateTime();
    const interval = setInterval(updateTime, config.timeUpdateInterval || 1000);
    return () => clearInterval(interval);
  }, [config]);

  return (
    <time className={`${styles.cornerItem} ${styles.bottomRight}`} id="current-time">
      {time.hours}
      <span className={styles.timeBlink}>:</span>
      {time.minutes} {time.dayPeriod}
    </time>
  );
};

const ProjectItem = ({
  project,
  index,
  onMouseEnter,
  onMouseLeave,
  isActive,
  isIdle,
}: {
  project: ProjectData;
  index: number;
  onMouseEnter: (index: number, image: string) => void;
  onMouseLeave: () => void;
  isActive: boolean;
  isIdle: boolean;
}) => {
  const scrambledArtist = useScrambleText(project.artist, isActive);
  const scrambledAlbum = useScrambleText(project.album, isActive);
  const scrambledCategory = useScrambleText(project.category, isActive);
  const scrambledLabel = useScrambleText(project.label, isActive);
  const scrambledYear = useScrambleText(project.year, isActive);

  return (
    <li
      className={`${styles.projectItem} ${isActive ? styles.active : ""} ${
        isIdle ? styles.idle : ""
      }`}
      onMouseEnter={() => onMouseEnter(index, project.image)}
      onMouseLeave={onMouseLeave}
      data-image={project.image}
    >
      <span className={`${styles.projectData} ${styles.artist} ${styles.hoverText}`}>
        {scrambledArtist}
      </span>
      <span className={`${styles.projectData} ${styles.album} ${styles.hoverText}`}>
        {scrambledAlbum}
      </span>
      <span className={`${styles.projectData} ${styles.category} ${styles.hoverText}`}>
        {scrambledCategory}
      </span>
      <span className={`${styles.projectData} ${styles.label} ${styles.hoverText}`}>
        {scrambledLabel}
      </span>
      <span className={`${styles.projectData} ${styles.year} ${styles.hoverText}`}>
        {scrambledYear}
      </span>
    </li>
  );
};

interface MusicPortfolioProps {
  projectsData?: ProjectData[];
  location?: { latitude: string; longitude: string; display: boolean };
  config?: Config;
  socialLinks?: { spotify?: string; email?: string; x?: string };
  defaultBackgroundImage?: string;
  themeAccent?: string;
  themeFont?: string;
}

export default function MusicPortfolio({
  projectsData = [],
  location = { latitude: "43.9250° N", longitude: "19.5530° E", display: true },
  config = { timeZone: "America/New_York", timeUpdateInterval: 1000, idleDelay: 4000 },
  socialLinks = {},
  defaultBackgroundImage = "",
  themeAccent,
  themeFont,
}: MusicPortfolioProps) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isIdle, setIsIdle] = useState(true);

  const backgroundRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Apply CSS variables for the theme context
  useEffect(() => {
    if (themeAccent) {
      document.documentElement.style.setProperty("--color-accent", themeAccent);
    }
    if (themeFont) {
      document.documentElement.style.setProperty("--font-primary", themeFont);
    }
    return () => {
      document.documentElement.style.removeProperty("--color-accent");
      document.documentElement.style.removeProperty("--font-primary");
    };
  }, [themeAccent, themeFont]);

  // Preload images
  useEffect(() => {
    projectsData.forEach((project) => {
      if (project.image) {
        const img = new Image();
        img.src = project.image;
      }
    });
    if (defaultBackgroundImage) {
      const img = new Image();
      img.src = defaultBackgroundImage;
    }
  }, [projectsData, defaultBackgroundImage]);

  // Start idle timer
  const startIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    idleTimerRef.current = setTimeout(() => {
      if (activeIndex === -1) {
        setIsIdle(true);
      }
    }, config.idleDelay || 4000);
  }, [activeIndex, config.idleDelay]);

  // Stop idle timer
  const stopIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  // Handle mouse enter on project
  const handleProjectMouseEnter = useCallback(
    (index: number, imageUrl: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      stopIdleTimer();
      setIsIdle(false);

      if (activeIndex === index) return;

      setActiveIndex(index);

      if (backgroundRef.current) {
        const bg = backgroundRef.current;
        const targetImage = imageUrl || defaultBackgroundImage;
        if (targetImage) {
          bg.style.transition = "none";
          bg.style.transform = "translate(-50%, -50%) scale(1.1)";
          bg.style.backgroundImage = `url(${targetImage})`;
          bg.style.opacity = "1";

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              bg.style.transition =
                "opacity 0.6s ease, transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
              bg.style.transform = "translate(-50%, -50%) scale(1.0)";
            });
          });
        }
      }
    },
    [activeIndex, stopIdleTimer, defaultBackgroundImage]
  );

  // Handle mouse leave on project
  const handleProjectMouseLeave = useCallback(() => {
    debounceRef.current = setTimeout(() => {}, 50);
  }, []);

  // Handle container mouse leave
  const handleContainerMouseLeave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setActiveIndex(-1);

    if (backgroundRef.current) {
      if (defaultBackgroundImage) {
        backgroundRef.current.style.backgroundImage = `url(${defaultBackgroundImage})`;
        backgroundRef.current.style.opacity = "1"; // keep the default background visible
      } else {
        backgroundRef.current.style.opacity = "0";
      }
    }

    startIdleTimer();
  }, [startIdleTimer, defaultBackgroundImage]);

  // Initial idle setup
  useEffect(() => {
    startIdleTimer();
    // Setup initial default background
    if (backgroundRef.current && defaultBackgroundImage && activeIndex === -1) {
      backgroundRef.current.style.backgroundImage = `url(${defaultBackgroundImage})`;
      backgroundRef.current.style.opacity = "1";
    }
    return () => {
      stopIdleTimer();
    };
  }, [startIdleTimer, stopIdleTimer, defaultBackgroundImage, activeIndex]);

  return (
    <div className={styles.container}>
      <div
        ref={backgroundRef}
        className={styles.backgroundImage}
        id="backgroundImage"
        role="img"
        aria-hidden="true"
      />
      <div className={styles.overlay} />

      <main
        ref={containerRef}
        className={`${styles.portfolioContainer} ${activeIndex !== -1 ? styles.hasActive : ""}`}
        onMouseLeave={handleContainerMouseLeave}
      >
        <h1 className="sr-only">Music Portfolio</h1>
        <ul className={styles.projectList} role="list">
          <li className={`${styles.projectItem} ${styles.headerItem}`}>
            <span className={`${styles.projectData} ${styles.artist}`}>NO</span>
            <span className={`${styles.projectData} ${styles.album}`}>ARTIST</span>
            <span className={`${styles.projectData} ${styles.category}`}>PROJECT</span>
            <span className={`${styles.projectData} ${styles.label}`}>FORMAT</span>
            <span className={`${styles.projectData} ${styles.year}`}>YEAR</span>
          </li>
          {projectsData.map((project, index) => (
            <ProjectItem
              key={project.id}
              project={project}
              index={index}
              onMouseEnter={handleProjectMouseEnter}
              onMouseLeave={handleProjectMouseLeave}
              isActive={activeIndex === index}
              isIdle={isIdle}
            />
          ))}
        </ul>
      </main>

      <aside className={styles.cornerElements}>
        <div className={`${styles.cornerItem} ${styles.topLeft}`}>
          <div className={styles.cornerSquare} aria-hidden="true"></div>
        </div>
        <nav className={`${styles.cornerItem} ${styles.topRight}`}>
          {socialLinks.spotify && (
            <>
              <a href={socialLinks.spotify}>Spotify</a> |{" "}
            </>
          )}
          {socialLinks.email && (
            <>
              <a href={socialLinks.email}>Email</a> |{" "}
            </>
          )}
          {socialLinks.x && (
            <a href={socialLinks.x} target="_blank" rel="noopener noreferrer">
              X
            </a>
          )}
        </nav>
        {location.display && (
          <div className={`${styles.cornerItem} ${styles.bottomLeft}`}>
            {location.latitude}, {location.longitude}
          </div>
        )}
        <TimeDisplay config={config} />
      </aside>
    </div>
  );
}
