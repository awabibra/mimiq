"use client";

import type { ReactNode } from "react";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ProjectGate } from "@/components/ProjectGate";
import { Sidebar } from "@/components/Sidebar";
import type { Project } from "@/lib/types";
import {
  getCurrentVocal,
  getLatestGeneratedChain,
  useProject,
} from "@/lib/useProject";
import styles from "./StudioShell.module.css";

export type StudioTool =
  | "projects"
  | "sandbox"
  | "mix-room"
  | "level-lab"
  | "stem-splitter"
  | "vocal-diagnostics"
  | "vault";

interface StudioShellProps {
  activePage: StudioTool;
  savedCount: number;
  children: ReactNode;
  contentClassName?: string;
  dimNavItems?: boolean;
}

const toolLabels: Record<StudioTool, string> = {
  projects: "Projects",
  sandbox: "Chain Lab",
  "mix-room": "Collision Check",
  "level-lab": "E-Val",
  "stem-splitter": "Stem Rip",
  "vocal-diagnostics": "Vocal Check",
  vault: "Vault",
};

function evidenceLabel(project: Project | null) {
  const latestChain = getLatestGeneratedChain(project);
  const levelLab = project?.level_lab_report;
  const chainStatus = latestChain?.chain_data.audio_service_status;
  const levelStatus = levelLab?.audio_service_status;

  if (chainStatus === "ok" || levelStatus === "ok") return "measured";
  if (latestChain?.chain_data.fallback_used || levelLab?.fallback_used) {
    return "fallback labeled";
  }
  if (latestChain || levelLab) return "saved project data";
  return "unknown";
}

export function StudioContextStrip({ activePage }: { activePage: StudioTool }) {
  const project = useProject((state) => state.project);
  const vocal = getCurrentVocal(project);
  const latestChain = getLatestGeneratedChain(project);
  const chainSteps = latestChain?.chain_data.chain.length ?? 0;

  return (
    <section className={styles.contextStrip} aria-label="Active project context">
      <div className={styles.contextCell}>
        <span>Tool</span>
        <strong>{toolLabels[activePage]}</strong>
      </div>
      <div className={styles.contextCell}>
        <span>Project</span>
        <strong>{project?.name ?? "No active project"}</strong>
      </div>
      <div className={styles.contextCell}>
        <span>Take</span>
        <strong>{vocal?.label ?? vocal?.filename ?? "No vocal loaded"}</strong>
      </div>
      <div className={styles.contextCell}>
        <span>Chain</span>
        <strong>
          {latestChain ? `${latestChain.daw} / ${chainSteps} steps` : "No chain yet"}
        </strong>
      </div>
      <div className={styles.contextCell}>
        <span>Evidence</span>
        <strong data-evidence={evidenceLabel(project)}>{evidenceLabel(project)}</strong>
      </div>
    </section>
  );
}

export function StudioShell({
  activePage,
  savedCount,
  children,
  contentClassName,
  dimNavItems,
}: StudioShellProps) {
  return (
    <ProjectGate>
      <div className={styles.shell}>
        <Sidebar
          activePage={activePage}
          savedCount={savedCount}
          dimNavItems={dimNavItems}
        />
        <main className={styles.workspace}>
          <StudioContextStrip activePage={activePage} />
          <div className={styles.content}>
            <div className={`${styles.contentSurface} ${contentClassName ?? ""}`}>
              {children}
            </div>
          </div>
        </main>
        {activePage !== "projects" && <MobileTabBar activePage={activePage} />}
      </div>
    </ProjectGate>
  );
}
