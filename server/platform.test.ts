import { afterEach, describe, expect, it, vi } from "vitest";
import { listLLMModels } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { publicPlatformConfig, publicPlatformScript } from "./_core/publicConfig";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("public platform configuration", () => {
  it("exposes only allowlisted Maps values and excludes all server auth/data secrets", () => {
    const env = {
      MANUS_API_URL: "https://maps.example",
      MANUS_API_BROWSER_KEY: "maps-public-key",
      MANUS_API_KEY: "manus-private-key",
      CLERK_SECRET_KEY: "clerk-private-key",
      CLERK_PUBLISHABLE_KEY: "clerk-public-key",
      DATABASE_URL: "postgres-secret",
    };
    expect(publicPlatformConfig(env)).toEqual({ apiUrl: "https://maps.example", apiBrowserKey: "maps-public-key" });
    const script = publicPlatformScript(env);
    for (const secret of [env.MANUS_API_KEY, env.CLERK_SECRET_KEY, env.CLERK_PUBLISHABLE_KEY, env.DATABASE_URL]) {
      expect(script).not.toContain(secret);
    }
  });
});

describe("optional Manus service integrations", () => {
  it("does not guess an API endpoint when the service URL is absent", async () => {
    vi.stubEnv("MANUS_API_URL", "");
    vi.stubEnv("MANUS_API_KEY", "test-only");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(listLLMModels()).rejects.toThrow("MANUS_API_URL");
    expect(request).not.toHaveBeenCalled();
  });

  it("persists URL-only image results through current managed storage", async () => {
    vi.stubEnv("MANUS_API_URL", "https://api.example");
    vi.stubEnv("MANUS_API_KEY", "test-only");
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ image: { url: "https://image.example/result.png", mimeType: "image/png" } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://upload.example/object" })))
      .mockResolvedValueOnce(new Response(""));
    vi.stubGlobal("fetch", request);
    const image = await generateImage({ prompt: "test", originalImages: [] });
    expect(image.url).toMatch(/^\/manus-storage\/generated\//);
    expect(request).toHaveBeenCalledTimes(4);
    expect(JSON.parse(request.mock.calls[0][1].body)).toHaveProperty("originalImages");
  });
});
