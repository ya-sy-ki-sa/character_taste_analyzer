/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  turnstile?: {
    render(
      element: HTMLElement,
      options: {
        sitekey: string;
        callback(token: string): void;
        "expired-callback"(): void;
        theme?: "light" | "dark" | "auto";
        language?: string;
      },
    ): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
  };
}
