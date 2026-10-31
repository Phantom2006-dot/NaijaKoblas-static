// Only the public Maps proxy URL and browser key may reach the client. Never serialize process.env.
export function publicPlatformConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    apiUrl: env.MANUS_API_URL ?? "",
    apiBrowserKey: env.MANUS_API_BROWSER_KEY ?? "",
  };
}

export function publicPlatformScript(env: NodeJS.ProcessEnv = process.env): string {
  const json = JSON.stringify(publicPlatformConfig(env)).replaceAll("<", "\\u003c");
  return `window.__MANUS_CONFIG__=${json};`;
}
