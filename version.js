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
      // ページを開いたまま新しい版がデプロイされたら知らせる（1 分ごとに確認）
      setInterval(() => {
        fetch(new URL('version.json', src), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((n) => {
            if (!n?.deployed || n.deployed === v.deployed || document.getElementById('deploy-update')) return;
            const b = document.createElement('button');
            b.id = 'deploy-update';
            b.textContent = '🔄 新しい版があります（クリックで更新）';
            b.style.cssText = 'position:fixed;right:12px;bottom:24px;z-index:10000;padding:10px 14px;border:0;border-radius:12px;'
              + 'background:#ff8a1f;color:#fff;font:700 14px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer';
            b.onclick = () => location.reload();
            document.body.appendChild(b);
          })
          .catch(() => {});
      }, 60000);
    })
    .catch(() => {});
})();
