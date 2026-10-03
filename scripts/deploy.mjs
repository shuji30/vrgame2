// サイト一式（ゲーム + オンライン対戦サーバー）を SSH でレンタルサーバーへデプロイする
//   node scripts/deploy.mjs          … デプロイ（初回は接続先を質問して deploy.config.json に保存）
//   node scripts/deploy.mjs --dry    … 送るファイルの一覧だけ表示
//   node scripts/deploy.mjs --setup  … 接続先を設定し直す
// パスワードは保存しない（SSH が聞いてくる。SSH 鍵を設定すれば聞かれなくなる）
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = join(root, 'deploy.config.json');
const args = process.argv.slice(2);

// 公開するもの / しないもの
const INCLUDE = ['index.html', 'games', 'server'];
const EXCLUDE = [
  /(^|\/)tests\//, /(^|\/)tools\//, /analyze\.mjs$/, /(^|\/)\.snapshots\//,
  /^server\/data\//, /^server\/config\.php$/, /(^|\/)\.DS_Store$/,
];

function listFiles() {
  const out = [];
  const walk = (p) => {
    const rel = relative(root, p).split(sep).join('/');
    if (EXCLUDE.some((re) => re.test(rel + (statSync(p).isDirectory() ? '/' : '')))) return;
    if (statSync(p).isDirectory()) for (const n of readdirSync(p)) walk(join(p, n));
    else out.push(rel);
  };
  for (const i of INCLUDE) if (existsSync(join(root, i))) walk(join(root, i));
  return out;
}

async function setup(old = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def) => (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim() || def || '';
  console.log('デプロイ先（レンタルサーバー）の SSH 接続情報を入力してください。パスワードは保存しません。');
  const cfg = {
    host: await ask('SSH ホスト名（例: xxx.onamae.ne.jp）', old.host),
    port: Number(await ask('SSH ポート', String(old.port || 22))),
    user: await ask('SSH ユーザー名', old.user),
    remoteDir: await ask('アップロード先のフォルダ（例: public_html/example.com/vrgame2）', old.remoteDir),
    publicUrl: await ask('公開 URL（例: https://example.com/vrgame2/）', old.publicUrl),
    identityFile: await ask('秘密鍵のファイル（.pem など。パスワード認証なら空欄）', old.identityFile),
  };
  if (cfg.publicUrl && !cfg.publicUrl.endsWith('/')) cfg.publicUrl += '/';
  rl.close();
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`保存しました: ${CONFIG}`);
  return cfg;
}

// Windows の SSH は他のユーザーも読める鍵を拒否するので、自分の .ssh へコピーして権限を自分だけにする
function prepareKey(src) {
  if (!src) return null;
  if (!existsSync(src)) throw new Error(`秘密鍵が見つかりません: ${src}`);
  const dir = join(homedir(), '.ssh');
  mkdirSync(dir, { recursive: true });
  const dst = join(dir, 'turbokart_deploy_key');
  copyFileSync(src, dst);
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    const r = spawnSync('icacls', [dst, '/inheritance:r', '/grant:r', `${user}:R`], { encoding: 'utf8' });
    if (r.status !== 0) console.warn(`鍵の権限を変更できませんでした: ${r.stderr || r.stdout}`);
  }
  return dst;
}

function run(cmd, cmdArgs, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'] });
    if (input) {
      input.pipe(p.stdin);
    }
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} が終了コード ${code} で終了しました`))));
  });
}

async function main() {
  const files = listFiles();
  if (args.includes('--dry')) {
    console.log(files.join('\n'));
    console.log(`\n${files.length} ファイル`);
    return;
  }
  let cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : null;
  if (!cfg || args.includes('--setup')) cfg = await setup(cfg || {});
  for (const k of ['host', 'user', 'remoteDir']) if (!cfg[k]) throw new Error(`deploy.config.json の ${k} が空です（--setup で設定）`);
  for (const tool of ['ssh', 'tar']) {
    if (spawnSync(tool, ['-V'], { stdio: 'ignore' }).error && spawnSync(tool, ['--version'], { stdio: 'ignore' }).error) {
      throw new Error(`${tool} が見つかりません（Windows 10 以降は標準で入っています）`);
    }
  }

  const target = `${cfg.user}@${cfg.host}`;
  const dir = cfg.remoteDir.replace(/'/g, '');
  console.log(`\n${files.length} ファイルを ${target}:${dir} へ送ります…`);
  // tar で固めて ssh の標準入力へ流し、サーバー側で展開する（一度の接続で済む）
  const tar = spawn('tar', ['-czf', '-', ...files], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  const remote = [
    `mkdir -p '${dir}'`,
    `tar -xzf - -C '${dir}'`,
    `mkdir -p '${dir}/server/data' && chmod 700 '${dir}/server/data'`,
    `(command -v php >/dev/null && php -l '${dir}/server/api.php' || echo 'php コマンドが見つからないため構文チェックを省略')`,
  ].join(' && ');
  const key = prepareKey(cfg.identityFile);
  const sshArgs = ['-p', String(cfg.port || 22), '-o', 'StrictHostKeyChecking=accept-new'];
  if (key) sshArgs.push('-i', key, '-o', 'IdentitiesOnly=yes');
  await run('ssh', [...sshArgs, target, remote], tar.stdout);

  if (cfg.publicUrl) {
    const url = `${cfg.publicUrl}server/api.php?a=health`;
    try {
      const h = await (await fetch(url)).json();
      console.log(h.ok ? `\n動作確認 OK: PHP ${h.php}、データ保存 ${h.writable ? '可' : '不可（権限を確認）'}` : `\n動作確認でエラー: ${JSON.stringify(h)}`);
    } catch (e) {
      console.log(`\n動作確認に失敗しました（${url}）: ${e.message}`);
    }
    console.log(`\nゲーム: ${cfg.publicUrl}\nTURBO KART: ${cfg.publicUrl}games/turbo-kart/`);
  }
  console.log('\nデプロイ完了');
}

main().catch((e) => {
  console.error(`\nエラー: ${e.message}`);
  process.exit(1);
});
