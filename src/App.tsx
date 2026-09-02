import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { AnalysisDomain } from "../shared/analysis-domain";
import { ApiClientError, api, setCsrfToken, setSessionExpiredHandler } from "./api";
import { Brand, Spinner } from "./components/Ui";
import { Landing } from "./pages/Landing";

const EntriesPage = lazy(() => import("./pages/EntriesPage").then((module) => ({ default: module.EntriesPage })));
const GeneratePage = lazy(() => import("./pages/GeneratePage").then((module) => ({ default: module.GeneratePage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const AnalyzerStatusPage = lazy(() =>
  import("./pages/AnalyzerStatusPage").then((module) => ({ default: module.AnalyzerStatusPage })),
);

export type SessionUser = { id: string; username: string };
type MeResponse = { user: SessionUser; csrfToken: string; expiresAt: string };

export function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const darkTheme = location.pathname.startsWith("/dark-lab");

  useEffect(() => {
    document.body.classList.toggle("dark-lab-theme", darkTheme);
    return () => document.body.classList.remove("dark-lab-theme");
  }, [darkTheme]);

  const clearAuthentication = useCallback(() => {
    setCsrfToken(undefined);
    void queryClient.cancelQueries();
    queryClient.setQueryData<MeResponse | null>(["me"], null);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    if (location.pathname.startsWith("/app") || location.pathname.startsWith("/dark-lab/app"))
      navigate(location.pathname.startsWith("/dark-lab") ? "/dark-lab" : "/", { replace: true });
  }, [location.pathname, navigate, queryClient]);

  useEffect(() => setSessionExpiredHandler(clearAuthentication), [clearAuthentication]);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const result = await api<MeResponse>("/api/v1/me");
        setCsrfToken(result.csrfToken);
        return result;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401 && error.code === "SESSION_REQUIRED") return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (me.isPending)
    return (
      <div className="full-loader">
        <Brand />
        <Spinner label="ラボを準備しています" />
      </div>
    );

  const login = (user: SessionUser) => {
    const session: MeResponse = { user, csrfToken: "", expiresAt: "" };
    queryClient.setQueryData(["me"], session);
    queryClient.invalidateQueries({ queryKey: ["me"] });
    navigate(location.pathname.startsWith("/dark-lab") ? "/dark-lab/app/profile" : "/app/profile", {
      replace: true,
    });
  };

  return (
    <Suspense
      fallback={
        <div className="full-loader">
          <Brand />
          <Spinner label="画面を読み込んでいます" />
        </div>
      }
    >
      <Routes>
        <Route path="/about-analyzer" element={<AnalyzerStatusPage domain="standard" />} />
        <Route
          path="/"
          element={me.data ? <Navigate to="/app/profile" replace /> : <Landing domain="standard" onLogin={login} />}
        />
        <Route
          path="/app"
          element={
            me.data ? (
              <AuthenticatedLayout user={me.data.user} domain="standard" onLogout={clearAuthentication} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        >
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfilePage domain="standard" />} />
          <Route path="entries" element={<EntriesPage domain="standard" />} />
          <Route path="generate" element={<GeneratePage domain="standard" />} />
          <Route path="settings" element={<SettingsPage user={me.data?.user} />} />
        </Route>
        <Route path="/dark-lab/about-analyzer" element={<AnalyzerStatusPage domain="dark" />} />
        <Route path="/dark-lab" element={<Landing domain="dark" user={me.data?.user} onLogin={login} />} />
        <Route
          path="/dark-lab/app"
          element={
            me.data ? (
              <AuthenticatedLayout user={me.data.user} domain="dark" onLogout={clearAuthentication} />
            ) : (
              <Navigate to="/dark-lab" replace />
            )
          }
        >
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfilePage domain="dark" />} />
          <Route path="entries" element={<EntriesPage domain="dark" />} />
          <Route path="generate" element={<GeneratePage domain="dark" />} />
          <Route path="settings" element={<SettingsPage user={me.data?.user} />} />
        </Route>
        <Route
          path="*"
          element={
            <Navigate
              to={
                location.pathname.startsWith("/dark-lab")
                  ? me.data
                    ? "/dark-lab/app/profile"
                    : "/dark-lab"
                  : me.data
                    ? "/app/profile"
                    : "/"
              }
              replace
            />
          }
        />
      </Routes>
    </Suspense>
  );
}

function AuthenticatedLayout({
  user,
  domain,
  onLogout,
}: {
  user: SessionUser;
  domain: AnalysisDomain;
  onLogout(): void;
}) {
  const base = domain === "dark" ? "/dark-lab/app" : "/app";
  function logout() {
    const serverLogout = api("/api/v1/sessions", { method: "DELETE" }).catch(() => undefined);
    onLogout();
    void serverLogout;
  }

  return (
    <div className={`app-shell ${domain === "dark" ? "dark-lab-theme" : ""}`}>
      <aside className="sidebar">
        <Brand />
        {domain === "dark" && <p className="dark-lab-mark">DARK LAB</p>}
        <nav className="side-nav" aria-label="メインメニュー">
          <NavLink to={`${base}/profile`}>
            <span>⌁</span>
            <b>分析プロフィール</b>
          </NavLink>
          <NavLink to={`${base}/entries`}>
            <span>◇</span>
            <b>キャラクター</b>
          </NavLink>
          <NavLink to={`${base}/generate`}>
            <span>✦</span>
            <b>キャラ生成</b>
          </NavLink>
          <NavLink to={`${base}/settings`}>
            <span>⚙</span>
            <b>設定</b>
          </NavLink>
          <button
            type="button"
            className="side-nav-action"
            onClick={logout}
            aria-label="ログアウトしてトップページに戻る"
          >
            <span>↩</span>
            <b>{domain === "dark" ? "ダーク版トップへ" : "トップへ戻る"}</b>
          </button>
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{Array.from(user.username)[0]?.toUpperCase()}</span>
          <span>
            <strong>{user.username}</strong>
            <small>{user.id.slice(0, 8)}</small>
          </span>
        </div>
      </aside>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
