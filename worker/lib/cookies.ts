export const SESSION_COOKIE = "__Host-session";
export const LOCAL_SESSION_COOKIE = "character-taste-session";

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function sessionCookieName(environment: string): string {
  return environment === "local" ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
}

function sessionCookieAttributes(environment: string): string {
  const secure = environment === "local" ? "" : "; Secure";
  return `Path=/; HttpOnly${secure}; SameSite=Strict`;
}

export function readSessionCookie(header: string | undefined, environment: string): string | undefined {
  return readCookie(header, sessionCookieName(environment));
}

export function sessionCookie(token: string, maxAgeSeconds: number, environment: string): string {
  return `${sessionCookieName(environment)}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; ${sessionCookieAttributes(environment)}`;
}

export function clearSessionCookie(environment: string): string {
  return `${sessionCookieName(environment)}=; Max-Age=0; ${sessionCookieAttributes(environment)}`;
}
