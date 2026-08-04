import type { WorkflowStage } from "@/lib/types";
import { ProjectWorkspace } from "@/components/workspace/ProjectWorkspace";
import styles from "./page.module.css";

const stages = new Set<WorkflowStage>([
  "setup",
  "prepare",
  "main_chain",
  "buses",
  "match_beat",
]);

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ stage?: string; preview?: string; history?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const initialStage = stages.has(query.stage as WorkflowStage)
    ? (query.stage as WorkflowStage)
    : "setup";
  const preview = process.env.NODE_ENV !== "production" && query.preview === "1";

  return (
    <main className={styles.page}>
      <ProjectWorkspace
        projectId={projectId}
        initialStage={initialStage}
        preview={preview}
        openHistory={query.history === "1"}
      />
    </main>
  );
}
