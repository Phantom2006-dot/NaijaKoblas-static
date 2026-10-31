export {};
declare global {
  interface Window {
    __MANUS_CONFIG__?: {
      apiUrl: string;
      apiBrowserKey: string;
    };
  }
}
