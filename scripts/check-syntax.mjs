// すべての JS ファイルの構文を確認する（three.js を読むファイルは node では実行できないため構文だけ見る）
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['games', 'scripts'];
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(n)) files.push(p);
  }
};
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.error(`構文エラー: ${f}\n${e.stderr}`);
  }
}
console.log(`構文チェック: ${files.length} ファイル, エラー ${bad}`);
process.exit(bad ? 1 : 0);
