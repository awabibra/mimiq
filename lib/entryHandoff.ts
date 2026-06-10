import type { Project } from "@/lib/types";

export const ENTRY_AUTH_HANDOFF_KEY = "mimiq-entry-auth-handoff";
export const ENTRY_PROJECTS_CACHE_KEY = "mimiq-entry-projects-cache";
export const ENTRY_VISUAL_HANDOFF_KEY = "mimiq-entry-visual-handoff";

export function writeEntryProjectsCache(projects: Project[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ENTRY_PROJECTS_CACHE_KEY, JSON.stringify(projects));
}

export function consumeEntryProjectsCache() {
  if (typeof window === "undefined") return null;

  const cached = window.sessionStorage.getItem(ENTRY_PROJECTS_CACHE_KEY);
  window.sessionStorage.removeItem(ENTRY_PROJECTS_CACHE_KEY);

  if (!cached) return null;

  try {
    return JSON.parse(cached) as Project[];
  } catch {
    return null;
  }
}

export function consumeEntryVisualHandoff() {
  if (typeof window === "undefined") return false;

  const active = window.sessionStorage.getItem(ENTRY_VISUAL_HANDOFF_KEY) === "1";
  window.sessionStorage.removeItem(ENTRY_VISUAL_HANDOFF_KEY);
  return active;
}
