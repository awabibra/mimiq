"use client";

import type { AudioAssetKind, ProjectAudioAsset } from "@/lib/types";
import { getProjectAudioAssets } from "@/lib/projectAudio";
import { useProject } from "@/lib/useProject";
import { formatAudioAssetKind } from "@/components/ProjectAudioUpload";
import styles from "./AudioAssetPicker.module.css";

interface AudioAssetPickerProps {
  label: string;
  value: string | null;
  onChange: (assetId: string | null) => void;
  allowedKinds: AudioAssetKind[];
  preferredKinds?: AudioAssetKind[];
  emptyLabel?: string;
  warning?: string | null;
  disabled?: boolean;
  variant?: "default" | "compact";
}

const formatSize = (size: number) => {
  if (!size) return null;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

export function pickReadyAsset(
  assets: ProjectAudioAsset[],
  allowedKinds: AudioAssetKind[],
  preferredKinds: AudioAssetKind[] = allowedKinds
) {
  return (
    assets.find(
      (asset) => asset.status === "ready" && preferredKinds.includes(asset.kind)
    ) ??
    assets.find(
      (asset) => asset.status === "ready" && allowedKinds.includes(asset.kind)
    ) ??
    null
  );
}

export function AudioAssetPicker({
  label,
  value,
  onChange,
  allowedKinds,
  preferredKinds = allowedKinds,
  emptyLabel = "Select asset",
  warning,
  disabled = false,
  variant = "default",
}: AudioAssetPickerProps) {
  const project = useProject((state) => state.project);
  const assets = getProjectAudioAssets(project).filter(
    (asset) => asset.status === "ready" && allowedKinds.includes(asset.kind)
  );
  const selectedAsset = assets.find((asset) => asset.id === value) ?? null;
  const selectedIsPreferred = selectedAsset
    ? preferredKinds.includes(selectedAsset.kind)
    : true;
  const selectedSize = selectedAsset ? formatSize(selectedAsset.size) : null;

  return (
    <label
      className={`${styles.picker} ${variant === "compact" ? styles.pickerCompact : ""}`}
    >
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        value={value ?? ""}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        disabled={disabled || assets.length === 0}
      >
        <option value="">{assets.length === 0 ? "No ready assets" : emptyLabel}</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.filename} ({formatAudioAssetKind(asset.kind)})
          </option>
        ))}
      </select>
      <span className={styles.meta}>
        {selectedAsset
          ? `${formatAudioAssetKind(selectedAsset.kind)}${selectedSize ? ` / ${selectedSize}` : ""}`
          : "Project audio only"}
      </span>
      {warning && !selectedIsPreferred && (
        <span className={styles.warning}>{warning}</span>
      )}
    </label>
  );
}
