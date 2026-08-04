"use client";

import Link from "next/link";
import { FolderKanban, LogOut, Settings, SplitSquareVertical, Waves } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { useAuth } from "@/lib/useAuth";
import { useProject } from "@/lib/useProject";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  activePage: string;
  savedCount: number;
  dimNavItems?: boolean;
}

export function Sidebar({ activePage, savedCount, dimNavItems = false }: SidebarProps) {
  const project = useProject((state) => state.project);
  const signOut = useAuth((state) => state.signOut);
  const workspaceHref = project ? `/projects/${project.id}?stage=prepare` : "/projects";

  return (
    <aside className={styles.sidebar}>
      <Link href="/projects" className={styles.brand} aria-label="MimiQ projects">
        <Logo className="text-base" />
      </Link>

      <nav className={dimNavItems ? styles.dimmed : ""}>
        <Link href="/projects" className={activePage === "projects" ? styles.active : ""}>
          <FolderKanban size={18} aria-hidden="true" />
          <span>Projects</span>
        </Link>
        <Link href={workspaceHref} className={activePage === "workspace" || ["sandbox", "mix-room", "level-lab", "vocal-diagnostics", "vault"].includes(activePage) ? styles.active : ""}>
          <Waves size={19} aria-hidden="true" />
          <span>Workspace</span>
          {project && <i />}
        </Link>
        <div className={styles.utilityLabel}>Utilities</div>
        <Link href="/stem-splitter" className={activePage === "stem-splitter" ? styles.active : ""}>
          <SplitSquareVertical size={18} aria-hidden="true" />
          <span>Stem Rip</span>
        </Link>
      </nav>

      {project && (
        <div className={styles.projectContext}>
          <span>Active project</span>
          <strong>{project.name}</strong>
          <small>{savedCount > 0 ? `${savedCount} history items` : "Project workspace"}</small>
        </div>
      )}

      <div className={styles.footer}>
        <Link href="/onboarding"><Settings size={17} aria-hidden="true" /><span>Studio settings</span></Link>
        <button type="button" onClick={() => void signOut()}><LogOut size={17} aria-hidden="true" /><span>Sign out</span></button>
      </div>
    </aside>
  );
}
