import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { ApiClientError, api, setCsrfToken, setSessionExpiredHandler } from "./api";
import { Brand, Spinner } from "./components/Ui";
import { Landing } from "./pages/Landing";

const EntriesPage = lazy(() => import("./pages/EntriesPage").then((module) => ({ default: module.EntriesPage })));
const GeneratePage = lazy(() => import("./pages/GeneratePage").then((module) => ({ default: module.GeneratePage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

export type SessionUser = { id: string; username: string };
type MeResponse = { user: SessionUser; csrfToken: string; expiresAt: string };

export function App() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clearAuthentication = useCallback(() => {
    setCsrfToken(undefined);
    void queryClient.cancelQueries();
    queryClient.setQueryData<MeResponse | null>(["me"], null);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    navigate("/", { replace: true });
  }, [navigate, queryClient]);

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
        <Route path="/" element={me.data ? <Navigate to="/app/profile" replace /> : <Landing onLogin={login} />} />
        <Route
          path="/app"
          element={
            me.data ? (
              <AuthenticatedLayout user={me.data.user} onLogout={clearAuthentication} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        >
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="entries" element={<EntriesPage />} />
          <Route path="generate" element={<GeneratePage />} />
          <Route path="settings" element={<SettingsPage user={me.data?.user} />} />
        </Route>
        <Route path="*" element={<Navigate to={me.data ? "/app/profile" : "/"} replace />} />
      </Routes>
    </Suspense>
  );
}

function AuthenticatedLayout({ user, onLogout }: { user: SessionUser; onLogout(): void }) {
  function logout() {
    const serverLogout = api("/api/v1/sessions", { method: "DELETE" }).catch(() => undefined);
    onLogout();
    void serverLogout;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="メインメニュー">
          <NavLink to="/app/profile">
            <span>⌁</span>
            <b>分析プロフィール</b>
          </NavLink>
          <NavLink to="/app/entries">
            <span>◇</span>
            <b>キャラクター</b>
          </NavLink>
          <NavLink to="/app/generate">
            <span>✦</span>
            <b>キャラ生成</b>
          </NavLink>
          <NavLink to="/app/settings">
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
            <b>トップへ戻る</b>
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
