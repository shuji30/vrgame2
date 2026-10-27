// バージョン番号。公開するたびに上げる (scripts/publish.mjs が、コミットと公開日時と一緒に version.json へ書き出す)
export const VERSION = '1.8.34';

// 公開した版の情報を読む。手元で開いたとき (version.json がない) は開発版として表示する
export async function loadBuildInfo() {
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const v = await r.json();
    const d = new Date(v.deployed);
    const p = (n) => String(n).padStart(2, '0');
    const when = Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    return `v${v.version || VERSION}${v.commit ? ` (${v.commit})` : ''}  公開 ${when}`;
  } catch (_) {
    return `v${VERSION}  開発版`;
  }
}
