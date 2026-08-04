import { supabase } from "@/lib/supabase";
import type {
  PluginBundleId,
  SupportedDaw,
  UserProfile,
} from "@/lib/types";

export const SUPPORTED_DAWS: SupportedDaw[] = [
  "Logic Pro",
  "FL Studio",
  "Ableton Live",
  "Pro Tools",
];

export const PLUGIN_BUNDLES: Array<{
  id: PluginBundleId;
  label: string;
  detail: string;
}> = [
  { id: "waves_gold", label: "Waves Gold", detail: "Gold bundle" },
  { id: "waves_ultimate", label: "Waves Ultimate", detail: "Ultimate subscription" },
  { id: "fabfilter", label: "FabFilter", detail: "FabFilter plugins" },
  { id: "soundtoys", label: "Soundtoys", detail: "Soundtoys bundle" },
  {
    id: "antares_auto_tune",
    label: "Antares Auto-Tune",
    detail: "Auto-Tune products",
  },
];

const supportedDaws = new Set<string>(SUPPORTED_DAWS);
const supportedPlugins = new Set<string>(
  PLUGIN_BUNDLES.map((plugin) => plugin.id)
);

export function isSupportedDaw(value: unknown): value is SupportedDaw {
  return typeof value === "string" && supportedDaws.has(value);
}

export function normalizePlugins(value: unknown): PluginBundleId[] {
  if (!Array.isArray(value)) return [];

  const plugins = Array.from(
    new Set(
      value.filter(
        (plugin): plugin is PluginBundleId =>
          typeof plugin === "string" && supportedPlugins.has(plugin)
      )
    )
  );

  if (plugins.includes("waves_ultimate")) {
    return plugins.filter((plugin) => plugin !== "waves_gold");
  }

  return plugins;
}

export function normalizeUserProfile(value: unknown): UserProfile | null {
  if (!value || typeof value !== "object") return null;

  const profile = value as Partial<UserProfile>;
  if (typeof profile.id !== "string") return null;

  return {
    id: profile.id,
    daw: isSupportedDaw(profile.daw) ? profile.daw : null,
    genres: Array.isArray(profile.genres)
      ? profile.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    plugins: normalizePlugins(profile.plugins),
    created_at:
      typeof profile.created_at === "string" ? profile.created_at : "",
    onboarding_completed_at:
      typeof profile.onboarding_completed_at === "string"
        ? profile.onboarding_completed_at
        : null,
  };
}

export function isOnboardingComplete(
  profile: UserProfile | null
): profile is UserProfile & {
  daw: SupportedDaw;
  onboarding_completed_at: string;
} {
  return Boolean(profile?.daw && profile.onboarding_completed_at);
}

export async function getUserProfile(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id,daw,genres,plugins,created_at,onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return normalizeUserProfile(data);
}

export async function saveUserOnboarding(params: {
  userId: string;
  daw: SupportedDaw;
  plugins: PluginBundleId[];
}) {
  const plugins = normalizePlugins(params.plugins);
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        id: params.userId,
        daw: params.daw,
        plugins,
        onboarding_completed_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("id,daw,genres,plugins,created_at,onboarding_completed_at")
    .single();

  if (error) throw error;

  const profile = normalizeUserProfile(data);
  if (!isOnboardingComplete(profile)) {
    throw new Error("Your studio setup was not saved. Try again.");
  }

  return profile;
}
