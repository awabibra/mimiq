export type WaveSurferInstance = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  destroy?: () => void;
  play?: () => void;
  pause?: () => void;
  setTime?: (seconds: number) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  setVolume?: (volume: number) => void;
  isPlaying?: () => boolean;
};

type WaveSurferFactory = {
  create: (options: Record<string, unknown>) => WaveSurferInstance;
};

type MaybeFactoryModule = {
  create?: WaveSurferFactory["create"];
  default?: { create?: WaveSurferFactory["create"] };
};

type WaveSurferWindow = Window & { WaveSurfer?: MaybeFactoryModule };

const WAVE_SURFER_SCRIPT_ID = "wavesurfer-runtime-script";
const WAVE_SURFER_CDN_SCRIPT = "https://cdn.jsdelivr.net/npm/wavesurfer.js@7.9.0/dist/wavesurfer.min.js";
const WAVE_SURFER_CDN_MODULE = "https://cdn.jsdelivr.net/npm/wavesurfer.js@7.9.0/dist/wavesurfer.esm.js";

function extractFactory(value: unknown): WaveSurferFactory | null {
  const moduleValue = value as MaybeFactoryModule | undefined;
  if (moduleValue?.default?.create) {
    return {
      create: moduleValue.default.create,
    };
  }

  if (moduleValue?.create) {
    return {
      create: moduleValue.create,
    };
  }

  return null;
}

function getWindowFactory(): WaveSurferFactory | null {
  if (typeof window === "undefined") return null;

  const global = window as WaveSurferWindow;
  return extractFactory(global.WaveSurfer);
}

function waitForScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(WAVE_SURFER_SCRIPT_ID);
    if (existing) {
      if (existing.getAttribute("data-wavesurfer-ready") === "1") {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("WaveSurfer CDN script failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = WAVE_SURFER_SCRIPT_ID;
    script.src = url;
    script.async = true;
    script.setAttribute("data-wavesurfer-ready", "loading");
    script.onload = () => {
      script.setAttribute("data-wavesurfer-ready", "1");
      resolve();
    };
    script.onerror = () => {
      script.setAttribute("data-wavesurfer-ready", "error");
      reject(new Error("WaveSurfer CDN script failed to load."));
    };
    document.head.appendChild(script);
  });
}

let loaderPromise: Promise<WaveSurferFactory | null> | null = null;

export async function loadWaveSurferFactory(): Promise<WaveSurferFactory | null> {
  if (loaderPromise) {
    return loaderPromise;
  }

  loaderPromise = (async () => {
    if (typeof window === "undefined") {
      return null;
    }

    const immediate = getWindowFactory();
    if (immediate) {
      return immediate;
    }

    await waitForScript(WAVE_SURFER_CDN_SCRIPT);

    const fromScript = getWindowFactory();
    if (fromScript) {
      return fromScript;
    }

    // Some CDN bundles expose only ES modules; import that as a fallback.
    const waveSurferModule = await import(/* webpackIgnore: true */ WAVE_SURFER_CDN_MODULE);
    const moduleFactory = extractFactory(waveSurferModule as MaybeFactoryModule);
    if (moduleFactory) {
      return moduleFactory;
    }

    return null;
  })().catch((error) => {
    loaderPromise = null;
    throw error;
  });

  return loaderPromise;
}
