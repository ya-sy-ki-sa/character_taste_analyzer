import { useEffect, useRef } from "react";

type Props = { onToken(token: string | undefined): void };

let scriptPromise: Promise<void> | undefined;
const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  const loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstileの読込に失敗しました")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error("Turnstileの読込に失敗しました"));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
  scriptPromise = loading.catch((error) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

export function Turnstile({ onToken }: Props) {
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sitekey || !container.current) {
      onToken(undefined);
      return;
    }
    let widgetId: string | undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(undefined),
          theme: "light",
          language: "ja",
        });
      })
      .catch(() => onToken(undefined));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken]);

  if (!sitekey) return null;
  return <section ref={container} className="turnstile" aria-label="ボット確認" />;
}
