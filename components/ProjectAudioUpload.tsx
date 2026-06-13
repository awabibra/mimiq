"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  getProjectAudioAssets,
  prepareAudioFile,
  uploadPreparedAudioAsset,
  upsertProjectAudioAsset,
} from "@/lib/projectAudio";
import { removeProjectAudio, saveProjectPatch } from "@/lib/projects";
import { hasSupabaseClientConfig, supabase } from "@/lib/supabase";
import type { AudioAssetKind, ProjectAudioAsset } from "@/lib/types";
import { useAuth } from "@/lib/useAuth";
import { isLocalProject, useProject } from "@/lib/useProject";
import styles from "./ProjectAudioUpload.module.css";

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;

export const AUDIO_ACCEPT = ".wav,.mp3,.flac,.aif,.aiff,audio/*";

export function formatAudioAssetKind(kind: AudioAssetKind) {
  if (kind === "full_song") return "Full song";
  if (kind === "processed") return "Processed export";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    if (error.message.includes("No API key found")) {
      return "Supabase public key was not sent. Restart the dev server and check NEXT_PUBLIC_SUPABASE_ANON_KEY.";
    }
    return error.message;
  }
  if (typeof error === "object" && error !== null && "__isStorageError" in error) {
    const e = error as { statusCode?: string; message?: string };
    if (e.statusCode === "415") return "File format not supported by storage bucket.";
    if (e.statusCode === "413") return "File is too large.";
    if (e.statusCode === "400") return "Upload failed due to an invalid request or permissions.";
    if (e.message) return e.message;
  }
  return "Upload failed. Try again.";
}

interface UseProjectAudioUploadParams {
  maxSize?: number;
  onUploaded?: (asset: ProjectAudioAsset) => void;
}

export function useProjectAudioUpload({
  maxSize = DEFAULT_MAX_SIZE,
  onUploaded,
}: UseProjectAudioUploadParams = {}) {
  const updateProject = useProject((state) => state.updateProject);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const setAuth = useAuth((state) => state.setAuth);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastAsset, setLastAsset] = useState<ProjectAudioAsset | null>(null);

  const uploadAudio = useCallback(
    async (params: { file: File; kind: AudioAssetKind }) => {
      const project = useProject.getState().project;
      if (!project || isLocalProject(project)) {
        setMessage("Select a saved project before uploading project audio.");
        return null;
      }

      if (!hasSupabaseClientConfig()) {
        setMessage(
          "Supabase public config is missing. Restart the dev server after setting NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
        return null;
      }

      setUploading(true);
      setMessage("Checking session...");

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const session = sessionData.session;
      const user = userData.user;

      if (sessionError || userError || !session || !user) {
        setUploading(false);
        const authError = sessionError ?? userError;
        if (authError?.message?.includes("No API key found")) {
          setMessage(uploadErrorMessage(authError));
          return null;
        }
        setMessage("Log in again before uploading project audio.");
        return null;
      }

      setAuth(session);

      if (params.file.size > maxSize) {
        setUploading(false);
        setMessage(`Audio file exceeds ${formatSize(maxSize)}.`);
        return null;
      }

      let prepared: Awaited<ReturnType<typeof prepareAudioFile>>;
      try {
        prepared = await prepareAudioFile({
          kind: params.kind,
          file: params.file,
        });
      } catch (error) {
        setUploading(false);
        setMessage(uploadErrorMessage(error));
        return null;
      }

      const baseAssets = getProjectAudioAssets(project);
      const uploadingAssets = upsertProjectAudioAsset(baseAssets, prepared.asset);
      updateProject({ audio_assets: uploadingAssets });
      setLastAsset(prepared.asset);
      setMessage("Uploading...");

      try {
        const readyAsset = await uploadPreparedAudioAsset({
          userId: user.id,
          projectId: project.id,
          asset: prepared.asset,
          file: prepared.file,
        });
        const readyAssets = upsertProjectAudioAsset(uploadingAssets, readyAsset);

        try {
          const saved = await saveProjectPatch(project.id, {
            audio_assets: readyAssets,
          });
          setActiveProject(saved);
          setLastAsset(readyAsset);
          setMessage(`${readyAsset.filename} ready.`);
          onUploaded?.(readyAsset);
          return readyAsset;
        } catch (saveError) {
          let cleanupFailed = false;
          try {
            if (readyAsset.storagePath) {
              await removeProjectAudio(readyAsset.storagePath);
            }
          } catch {
            cleanupFailed = true;
          }

          const failedAsset: ProjectAudioAsset = {
            ...readyAsset,
            storagePath: cleanupFailed ? readyAsset.storagePath : null,
            status: "failed",
            error: cleanupFailed
              ? "Stored file was not attached to project."
              : "Upload could not attach to the project.",
          };
          updateProject({
            audio_assets: upsertProjectAudioAsset(uploadingAssets, failedAsset),
          });
          setLastAsset(failedAsset);
          setMessage(failedAsset.error ?? uploadErrorMessage(saveError));
          return null;
        }
      } catch (error) {
        const failedAsset: ProjectAudioAsset = {
          ...prepared.asset,
          status: "failed",
          error: uploadErrorMessage(error),
        };
        updateProject({
          audio_assets: upsertProjectAudioAsset(uploadingAssets, failedAsset),
        });
        setLastAsset(failedAsset);
        setMessage(uploadErrorMessage(error));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [maxSize, onUploaded, setActiveProject, setAuth, updateProject]
  );

  return {
    uploading,
    message,
    lastAsset,
    uploadAudio,
  };
}

interface ProjectAudioUploadProps {
  label: string;
  defaultKind: AudioAssetKind;
  kinds?: AudioAssetKind[];
  maxSize?: number;
  description?: string;
  disabled?: boolean;
  onUploaded?: (asset: ProjectAudioAsset) => void;
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 14V4" />
      <path d="m6.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M4 15.5h12" />
    </svg>
  );
}

export function ProjectAudioUpload({
  label,
  defaultKind,
  kinds = [defaultKind],
  maxSize = DEFAULT_MAX_SIZE,
  description,
  disabled = false,
  onUploaded,
}: ProjectAudioUploadProps) {
  const [kind, setKind] = useState<AudioAssetKind>(defaultKind);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploading, message, lastAsset, uploadAudio } = useProjectAudioUpload({
    maxSize,
    onUploaded,
  });
  const canUpload = !disabled && !uploading;
  const selectedKind = kinds.includes(kind)
    ? kind
    : kinds.includes(defaultKind)
      ? defaultKind
      : kinds[0] ?? defaultKind;

  const handleFile = async (file: File | null) => {
    if (!file || !canUpload) return;
    await uploadAudio({ file, kind: selectedKind });
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    void handleFile(file).finally(() => {
      input.value = "";
    });
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0] ?? null);
  };

  return (
    <section className={styles.upload} data-status={lastAsset?.status ?? "idle"}>
      <div className={styles.header}>
        <div>
          <span className={styles.label}>{label}</span>
          {description && <p>{description}</p>}
        </div>
        {kinds.length > 1 && (
          <select
            className={styles.kindSelect}
            value={selectedKind}
            onChange={(event) => setKind(event.currentTarget.value as AudioAssetKind)}
            disabled={!canUpload}
            aria-label={`${label} asset type`}
          >
            {kinds.map((entry) => (
              <option key={entry} value={entry}>
                {formatAudioAssetKind(entry)}
              </option>
            ))}
          </select>
        )}
      </div>

      <button
        type="button"
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (canUpload) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        disabled={!canUpload}
        aria-label={`${label} upload`}
      >
        <UploadIcon className={styles.icon} />
        <span>{uploading ? "Uploading project audio" : "Drop audio or browse"}</span>
        <em>{formatAudioAssetKind(selectedKind)} / up to {formatSize(maxSize)}</em>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className={styles.input}
        onChange={handleInput}
        disabled={!canUpload}
      />
      {message && (
        <p className={styles.message} data-error={lastAsset?.status === "failed" ? "true" : undefined}>
          {message}
        </p>
      )}
    </section>
  );
}

function ProjectAudioUploadSlot({
  kind,
  label,
  hint,
  maxSize = DEFAULT_MAX_SIZE,
  disabled = false,
  onUploaded,
}: {
  kind: AudioAssetKind;
  label: string;
  hint: string;
  maxSize?: number;
  disabled?: boolean;
  onUploaded?: (asset: ProjectAudioAsset) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Read project at render time so the button disables immediately when
  // there is no saved project — not only after a failed upload attempt.
  const project = useProject((state) => state.project);
  const { uploading, message, lastAsset, uploadAudio } = useProjectAudioUpload({
    maxSize,
    onUploaded,
  });

  const hasRealProject = Boolean(project && !isLocalProject(project));
  const canUpload = !disabled && !uploading && hasRealProject;

  const handleFile = async (file: File | null) => {
    if (!file || !canUpload) return;
    await uploadAudio({ file, kind });
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    void handleFile(file).finally(() => {
      input.value = "";
    });
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0] ?? null);
  };

  const assets = project ? getProjectAudioAssets(project) : [];
  // Show ready AND in-progress assets so the user always sees what happened.
  // "local" is the only status we hide (blob URLs that were never persisted).
  const existingAssets = assets.filter((a) => a.kind === kind && a.status !== "local");

  const uploadButtonLabel = uploading
    ? "Uploading…"
    : hasRealProject
    ? "+ Drop or click"
    : "Select a project first";

  return (
    <div className={styles.tableWidget}>
      <div className={styles.tableWidgetHeader}>
        <span className={styles.tableWidgetLabel}>{label}</span>
      </div>
      <div className={styles.tableWidgetList}>
        <div className={styles.tableWidgetColHeaders}>
          <span>File</span>
          <span>Size</span>
        </div>
        {existingAssets.map((asset) => (
          <div
            key={asset.id}
            className={styles.tableWidgetRow}
            data-status={asset.status}
          >
            <span
              className={styles.tableWidgetFilename}
              title={
                asset.status === "failed"
                  ? (asset.error ?? asset.filename)
                  : asset.filename
              }
            >
              {asset.filename}
            </span>
            <span className={styles.tableWidgetSize}>
              {asset.status === "uploading"
                ? "…"
                : asset.status === "failed"
                ? "✕"
                : formatSize(asset.size)}
            </span>
          </div>
        ))}
        <button
          type="button"
          className={`${styles.tableWidgetRow} ${styles.tableWidgetUpload} ${
            dragging ? styles.tableWidgetUploadActive : ""
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (canUpload) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          disabled={!canUpload}
          title={
            hasRealProject
              ? hint
              : "Select a saved project to upload audio"
          }
        >
          <span className={styles.tableWidgetFilename}>{uploadButtonLabel}</span>
          <span className={styles.tableWidgetSize}>—</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className={styles.input}
        onChange={handleInput}
        disabled={!canUpload}
      />
      {message && (
        <p
          className={styles.tableWidgetMessage}
          data-error={lastAsset?.status === "failed" ? "true" : undefined}
        >
          {message}
        </p>
      )}
    </div>
  );
}

interface ProjectAudioUploadWidgetSlot {
  kind: AudioAssetKind;
  label: string;
  hint: string;
}

interface ProjectAudioUploadWidgetProps {
  maxSize?: number;
  disabled?: boolean;
  slots?: ProjectAudioUploadWidgetSlot[];
  onUploaded?: (asset: ProjectAudioAsset) => void;
}

const DEFAULT_WIDGET_SLOTS: ProjectAudioUploadWidgetSlot[] = [
  {
    kind: "vocal",
    label: "Vocal",
    hint: "Lead take",
  },
  {
    kind: "beat",
    label: "Beat",
    hint: "Optional instrumental context",
  },
  {
    kind: "full_song",
    label: "Full song",
    hint: "Use when stems are not ready",
  },
];

export function ProjectAudioUploadWidget({
  maxSize = DEFAULT_MAX_SIZE,
  disabled = false,
  slots = DEFAULT_WIDGET_SLOTS,
  onUploaded,
}: ProjectAudioUploadWidgetProps) {
  return (
    <div className={styles.tableWidgetContainer} aria-label="Project audio upload widget">
      {slots.map((slot) => (
        <ProjectAudioUploadSlot
          key={slot.kind}
          kind={slot.kind}
          label={slot.label}
          hint={`${slot.hint} / ${formatSize(maxSize)} max`}
          maxSize={maxSize}
          disabled={disabled}
          onUploaded={onUploaded}
        />
      ))}
    </div>
  );
}
