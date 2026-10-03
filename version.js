// 画面の右下に、デプロイした日時（version.json）を小さく表示する
// version.json は scripts/deploy.mjs がデプロイのたびに作って送る。無い環境（開発中・GitHub Pages）では表示しない
(() => {
  const src = document.currentScript?.src;
  if (!src) return;
  fetch(new URL('version.json', src), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => {
      if (!v?.deployed) return;
      const d = new Date(v.deployed);
      if (Number.isNaN(d.getTime())) return;
      const p = (n) => String(n).padStart(2, '0');
      const el = document.createElement('div');
      el.id = 'deploy-version';
      el.textContent = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${v.commit ? ` (${v.commit})` : ''}`;
      el.title = 'デプロイした日時';
      el.style.cssText = 'position:fixed;right:6px;bottom:4px;z-index:9999;font:11px/1.2 system-ui,sans-serif;'
        + 'color:#fff;opacity:.45;text-shadow:0 1px 2px #000;pointer-events:none;user-select:none';
      document.body.appendChild(el);
    })
    .catch(() => {});
})();
