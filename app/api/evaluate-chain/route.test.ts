import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioMetrics, ChainStep } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  messagesCreate: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mocks.getUser,
    },
  })),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mocks.messagesCreate,
    },
  })),
}));

const { POST } = await import("./route");

const metrics: AudioMetrics = {
  lufs: -12,
  dynamicRange: 5,
  spectralCentroid: 2200,
  truePeak: -3,
  lowEndEnergy: 0.18,
  stereoWidth: 0.1,
  reverbEstimate: 0.08,
};

const chainStep = (overrides: Partial<ChainStep> = {}): ChainStep => ({
  step: overrides.step ?? 1,
  tool: overrides.tool ?? "High-pass",
  action: overrides.action ?? "High-pass at 100 Hz, 24 dB/oct.",
  reason: overrides.reason ?? "Clean rumble before compression.",
  role: overrides.role ?? "highpass",
  bus: overrides.bus,
  sendPoint: overrides.sendPoint,
  enabled: overrides.enabled,
});

const completeChain = (): ChainStep[] => [
  chainStep(),
  chainStep({
    step: 2,
    tool: "Subtractive EQ",
    role: "subtractive_eq",
    action: "Cut -3 dB at 350 Hz, Q 1.4.",
  }),
  chainStep({
    step: 3,
    tool: "FET Compressor",
    role: "compressor_primary",
    action: "Use 4:1 ratio, threshold -24 dB, 4 dB GR.",
  }),
];

function request(body: unknown, auth = "Bearer valid-token") {
  return new Request("http://localhost/api/evaluate-chain", {
    method: "POST",
    headers: {
      ...(auth ? { authorization: auth } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/evaluate-chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.ANTHROPIC_API_KEY;
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.messagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "Anthropic explanation." }],
    });
  });

  it("returns 401 when auth is missing", async () => {
    const response = await POST(request({ chain: completeChain(), metrics }, "") as never);

    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({ error: "auth_required" });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("returns 400 when JSON is invalid", async () => {
    const response = await POST(
      new Request("http://localhost/api/evaluate-chain", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        body: "{",
      }) as never
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for an empty chain", async () => {
    const response = await POST(request({ chain: [], metrics }) as never);

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for an oversized chain", async () => {
    const oversized = Array.from({ length: 65 }, (_value, index) =>
      chainStep({ step: index + 1 })
    );
    const response = await POST(request({ chain: oversized, metrics }) as never);

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for invalid step strings", async () => {
    const response = await POST(
      request({
        chain: [{ ...chainStep(), action: "" }],
        metrics,
      }) as never
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for invalid bus values", async () => {
    const response = await POST(
      request({
        chain: [{ ...chainStep(), bus: "admin_bus" }],
        metrics,
      }) as never
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for invalid send points", async () => {
    const response = await POST(
      request({
        chain: [{ ...chainStep(), sendPoint: "side-door" }],
        metrics,
      }) as never
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for invalid optional metric fields", async () => {
    const response = await POST(
      {
        headers: new Headers({ authorization: "Bearer valid-token" }),
        json: async () => ({
          chain: completeChain(),
          metrics: {
            ...metrics,
            harshness: Number.NaN,
          },
        }),
      } as never
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request" });
  });

  it("returns deterministic evaluation without Anthropic", async () => {
    const response = await POST(
      request({ chain: completeChain(), metrics, genre: "golden", daw: "Logic Pro" }) as never
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.measured_fit).toBe("good");
    expect(body.checked).toEqual(expect.arrayContaining(["main_highpass", "main_compression"]));
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });

  it("preserves checked and unknowns from the deterministic result", async () => {
    const response = await POST(
      request({
        chain: [
          chainStep({ action: "High-pass cleanup.", role: "highpass" }),
          chainStep({
            step: 2,
            tool: "FET Compressor",
            role: "compressor_primary",
            action: "Compression stage.",
          }),
          chainStep({
            step: 3,
            tool: "Subtractive EQ",
            role: "subtractive_eq",
            action: "Cut -3 dB at 350 Hz.",
          }),
        ],
        metrics,
      }) as never
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.measured_fit).toBe("unknown");
    expect(body.checked).toEqual(expect.arrayContaining(["main_highpass", "eq_stage"]));
    expect(body.unknowns).toEqual(
      expect.arrayContaining(["The high-pass step does not expose a frequency in its action text."])
    );
  });
});
