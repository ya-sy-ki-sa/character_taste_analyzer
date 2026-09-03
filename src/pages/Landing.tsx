import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { api, idempotencyKey, setCsrfToken } from "../api";
import { Turnstile } from "../components/Turnstile";
import { Brand, Modal, Notice } from "../components/Ui";

type PublicUser = { id: string; username: string };
type SessionUser = { id: string; username: string };

export function Landing({
  domain,
  user,
  onLogin,
}: {
  domain: AnalysisDomain;
  user?: SessionUser;
  onLogin(user: SessionUser): void;
}) {
  const dark = domain === "dark";
  const [showCreate, setShowCreate] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  return (
    <main className={`landing ${dark ? "dark-lab-theme dark-landing" : ""}`}>
      <div className="landing-chassis">
        <header className="landing-nav">
          <Brand />
          <span className="landing-device-id">
            {dark ? "黒蝕式嗜好観測機 / CTL–ECLIPSE" : "CHARACTER TASTE OBSERVATORY / CTL–01"}
          </span>
          <div className="landing-nav-links">
            {dark && <Link to="/">通常観測機へ</Link>}
            <Link to={dark ? "/dark-lab/about-analyzer" : "/about-analyzer"}>分析器の現在地</Link>
            <span className="observatory-ready">観測準備完了</span>
          </div>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">{dark ? "黒蝕を観測する" : "観測をはじめる"}</p>
            <h1>
              {dark ? (
                <>
                  <span>光が欠けるほど、</span>
                  <em>嗜好は満ちる。</em>
                </>
              ) : (
                <>
                  <span>好きは、</span>
                  <em>観測できる。</em>
                </>
              )}
            </h1>
            <p className="hero-description">
              {dark
                ? "惹かれた表情、譲れない信念、忘れられない関係性。日食の暗がりにだけ現れる軌道から、まだ言葉にならない「好き」の輪郭を観測します。"
                : "惹かれた表情、譲れない信念、忘れられない関係性。その軌跡を結び、まだ言葉になっていない「好き」の座標を見つけます。"}
            </p>

            {user ? (
              <div className="landing-session">
                <p>
                  <span className="session-light" aria-hidden="true" />
                  {user.username} の観測記録を開けます
                </p>
                <Link
                  className="button button-primary button-large"
                  to={dark ? "/dark-lab/app/profile" : "/app/profile"}
                >
                  {dark ? "黒蝕式観測機に入る" : "観測記録を開く"}
                </Link>
              </div>
            ) : (
              <div className="landing-access-panel">
                <div className="landing-actions">
                  <button
                    type="button"
                    className="button button-primary button-large"
                    onClick={() => setShowCreate(true)}
                  >
                    新規ユーザ作成
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-large"
                    onClick={() => setShowLogin(true)}
                  >
                    ログイン
                  </button>
                </div>
                <p className="landing-privacy">分析内容と生成履歴はログインキーで保護されます</p>
              </div>
            )}
          </div>

          <ObservatoryScope dark={dark} />
        </section>

        <footer className="process-strip">
          <span>
            <b>観測</b>
            <small>{dark ? "ダーク状態と変化差分を登録" : "好きなキャラクターと理由を登録"}</small>
          </span>
          <span>
            <b>解析</b>
            <small>{dark ? "主体性・支配・道徳を専用解析" : "表情・信念・関係性・葛藤を整理"}</small>
          </span>
          <span>
            <b>記録</b>
            <small>{dark ? "通常版と分離して安全に保存" : "根拠と確かさを分けて蓄積"}</small>
          </span>
        </footer>
      </div>
      <footer className="landing-footer">
        <a href="/third-party-licenses.html">サードパーティライセンス</a>
      </footer>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={onLogin} />}
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </main>
  );
}

function ObservatoryScope({ dark }: { dark: boolean }) {
  return (
    <section className="scope-bay" aria-label={dark ? "黒蝕式嗜好観測スコープ" : "嗜好観測スコープ"}>
      <div
        className={`observatory-scope ${dark ? "eclipse-scope" : "constellation-scope"}`}
        role="img"
        aria-label={
          dark
            ? "欠けた目盛りと偏心した日食の中で、表情、信念、関係性、葛藤を結ぶ閉じない軌道を捉えています"
            : "均等な目盛りを持つ円形スコープで、表情、信念、関係性、葛藤の四つの嗜好軸を観測します"
        }
      >
        <span className="scope-degree degree-0">000°</span>
        <span className="scope-degree degree-90">090°</span>
        <span className="scope-degree degree-180">180°</span>
        <span className="scope-degree degree-270">270°</span>
        <span className="scope-corrosion" aria-hidden="true" />
        <div className="scope-glass">
          <span className="scope-scan" aria-hidden="true" />
          {dark && <span className="eclipse-occluder" aria-hidden="true" />}
          <svg className="scope-orbit" viewBox="0 0 100 100" aria-hidden="true">
            <path className="scope-frame" d="M29 30 L72 34 L70 72 L27 68 Z M29 30 L50 50 L72 34 M27 68 L50 50 L70 72" />
            <path
              className="scope-path"
              d={
                dark ? "M-8 81 C12 62 24 68 38 49 S64 21 75 39 S92 69 109 12" : "M16 56 C30 36 39 38 50 53 S72 75 85 43"
              }
            />
            {dark && <path className="scope-path-fade" d="M70 72 C81 81 91 87 109 92" />}
            <circle cx="29" cy="30" r="0.85" />
            <circle cx="72" cy="34" r="0.85" />
            <circle cx="70" cy="72" r="0.85" />
            <circle cx="27" cy="68" r="0.85" />
          </svg>
          <span className="scope-axis axis-expression">表情</span>
          <span className="scope-axis axis-belief">信念</span>
          <span className="scope-axis axis-relation">関係性</span>
          <span className="scope-axis axis-conflict">葛藤</span>
          <span className="scope-core">嗜好</span>
        </div>
      </div>
      <p className="scope-note">{dark ? "閉じない軌道を検出" : "四つの軸を校正済み"}</p>
    </section>
  );
}

function LoginModal({ onClose, onLogin }: { onClose(): void; onLogin(user: SessionUser): void }) {
  const [username, setUsername] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await api<{ user: SessionUser; csrfToken: string }>("/api/v1/sessions", {
        method: "POST",
        body: JSON.stringify({ username, accessKey, turnstileToken }),
      });
      setCsrfToken(response.csrfToken);
      onLogin(response.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ログインできませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="観測記録を開く" onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <p className="muted">ユーザー作成時のユーザー名とログインキーを入力してください。</p>
        <label>
          <span>ユーザー名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={32}
            autoComplete="username"
            required
          />
        </label>
        <label>
          <span>ログインキー</span>
          <input
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="current-password"
            required
          />
        </label>
        <Turnstile onToken={setTurnstileToken} />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="button button-primary button-large" disabled={submitting}>
          {submitting ? "確認中…" : "ログイン"}
        </button>
      </form>
    </Modal>
  );
}

function CreateUserModal({ onClose }: { onClose(): void }) {
  const [username, setUsername] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [created, setCreated] = useState<{ user: PublicUser; accessKey: string; expiresAt: string }>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const requestKey = useRef(idempotencyKey());

  async function create(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api<{ user: PublicUser; accessKey: string; expiresAt: string }>("/api/v1/users", {
        method: "POST",
        idempotencyKey: requestKey.current,
        body: JSON.stringify({ username, turnstileToken, idempotencyKey: requestKey.current }),
      });
      setCreated(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作成できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  async function activate() {
    if (!created) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api(`/api/v1/users/${created.user.id}/activate`, {
        method: "POST",
        body: JSON.stringify({ accessKey: created.accessKey }),
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "有効化できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadKey() {
    if (!created) return;
    const blob = new Blob(
      [
        `キャラ嗜好ラボ アクセスキー\n\nユーザー名: ${created.user.username}\nユーザーID: ${created.user.id}\nアクセスキー: ${created.accessKey}\n\nこのキーは再発行・復旧できません。安全な場所に保管してください。\n`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `character-taste-key-${created.user.username}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (created) {
    return (
      <Modal title="ログインキーを保存" onClose={onClose}>
        <div className="stack-form">
          <Notice tone="warning">
            <strong>この画面を閉じると、キーは二度と表示できません。</strong>
            <br />
            紛失した場合、アカウントは復旧できません。
          </Notice>
          <div className="credential-box">
            <small>UUID ACCESS KEY</small>
            <code>{created.accessKey}</code>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(created.accessKey);
                setCopied(true);
              }}
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
            <button type="button" className="button button-secondary" onClick={downloadKey}>
              テキストで保存
            </button>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>アクセスキーを安全な場所に保存しました</span>
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          <button
            type="button"
            className="button button-primary button-large"
            disabled={!acknowledged || submitting}
            onClick={activate}
          >
            {submitting ? "有効化中…" : "保存を確認してユーザーを作成"}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="観測者を登録する" onClose={onClose}>
      <form className="stack-form" onSubmit={create}>
        <label>
          <span>ユーザー名</span>
          <input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              requestKey.current = idempotencyKey();
            }}
            maxLength={32}
            autoComplete="username"
            required
            placeholder="表示する名前"
          />
          <small>ログイン時に使います。同じユーザー名は登録できません。</small>
        </label>
        <Turnstile onToken={setTurnstileToken} />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="button button-primary button-large" disabled={submitting}>
          {submitting ? "作成中…" : "アクセスキーを発行"}
        </button>
      </form>
    </Modal>
  );
}
