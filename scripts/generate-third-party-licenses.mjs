import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const lockPath = new URL("../package-lock.json", import.meta.url);
const outputPath = new URL("../public/third-party-licenses.html", import.meta.url);
const checkOnly = process.argv.includes("--check");

const escapeHtml = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const packageName = (path) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

const lock = JSON.parse(await readFile(lockPath, "utf8"));
const lockedPackages = Object.entries(lock.packages)
  .filter(([path]) => path.includes("node_modules/"))
  .map(([path, metadata]) => ({
    name: packageName(path),
    version: metadata.version,
    license: metadata.license,
    development: metadata.dev === true,
  }))
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

// A public OSS notice describes code incorporated into the deployed application.
// Build, test, and platform-specific optional packages marked `dev` in the lockfile
// are intentionally excluded because they are not shipped in the deployment output.
const deployedPackages = lockedPackages.filter(({ development }) => !development);
const licenseIds = [...new Set(deployedPackages.flatMap(({ license }) => license.split(/\s+(?:AND|OR)\s+/)))].sort();
const rows = deployedPackages
  .map(
    ({ name, version, license }) => `          <tr>
            <td><a href="https://www.npmjs.com/package/${encodeURIComponent(name)}">${escapeHtml(name)}</a></td>
            <td><code>${escapeHtml(version)}</code></td>
            <td>${escapeHtml(license)}</td>
          </tr>`,
  )
  .join("\n");
const licenseLinks = licenseIds
  .map((id) => `<a href="https://spdx.org/licenses/${encodeURIComponent(id)}.html">${escapeHtml(id)}</a>`)
  .join(" / ");

const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>サードパーティライセンス | キャラ好みラボ</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #12100f; color: #f2e9df; }
      body { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 72px; line-height: 1.7; }
      header { padding-bottom: 24px; border-bottom: 1px solid #766350; }
      h1 { font-family: Georgia, "Yu Mincho", serif; font-weight: 500; }
      a { color: #e7bd78; text-underline-offset: 3px; }
      .summary { color: #cfc1b4; }
      .table-wrap { margin-top: 28px; overflow-x: auto; border-block: 1px solid #766350; }
      table { width: 100%; border-collapse: collapse; font-size: .9rem; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #342d29; text-align: left; white-space: nowrap; }
      th { position: sticky; top: 0; background: #1d1917; color: #e7bd78; }
      footer { margin-top: 28px; color: #a99b8e; font-size: .85rem; }
      :focus-visible { outline: 3px solid #f2e9df; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <header>
      <p><a href="/">← キャラ好みラボへ戻る</a></p>
      <h1>サードパーティライセンス</h1>
      <p class="summary">
        Webサイトとしてデプロイされる成果物に組み込まれるオープンソースソフトウェア
        ${deployedPackages.length}件を、固定済みの <code>package-lock.json</code> に基づいて掲載しています。
        ライセンス識別子から各ライセンスの条文を、パッケージ名から配布元の情報を確認できます。
      </p>
      <p class="summary">
        ビルド、テスト、ローカル開発だけで使用し、デプロイ成果物へ組み込まれない開発依存は
        この表示の対象外です。各ソフトウェアの著作権は、それぞれの権利者に帰属します。
      </p>
      <p><strong>ライセンス:</strong> ${licenseLinks}</p>
    </header>
    <main>
      <div class="table-wrap">
        <table>
          <thead><tr><th>オープンソースソフトウェア</th><th>バージョン</th><th>ライセンス</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>
    </main>
    <footer>
      <p>この一覧は依存関係のライセンス表示であり、キャラ好みラボ自体のライセンスを示すものではありません。</p>
    </footer>
  </body>
</html>
`;

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== html) {
    console.error(`サードパーティライセンス一覧が最新ではありません: ${outputPath.pathname}`);
    console.error(`\`${root}scripts/generate-third-party-licenses.mjs\` を実行してください。`);
    process.exitCode = 1;
  } else {
    console.log(`${deployedPackages.length} 件のデプロイ対象ライセンス一覧は最新です。`);
  }
} else {
  await writeFile(outputPath, html);
  console.log(`${deployedPackages.length} 件のデプロイ対象ライセンス一覧を生成しました。`);
}
