<?php
// TURBO KART VR - オンライン対戦の接続仲介（シグナリング）サーバー
// ルームの作成・参加と、WebRTC の offer / answer / ICE をプレイヤー間で受け渡す。
// レース中のデータはプレイヤー同士が WebRTC で直接やり取りするので、ここは軽い。
// 保存はファイル（data/ 以下）。データベースは不要。PHP 8.1 以上。
declare(strict_types=1);

const VERSION = '1.0.0';
const MAX_PLAYERS = 5;
const ROOM_TTL = 1800;          // 最後のアクセスからこの秒数でルームを消す
const PLAYER_TTL = 20;          // この秒数ポーリングが無ければ退出扱い
const MAX_BODY = 65536;         // 1 リクエストの最大サイズ
const MAX_QUEUE = 400;          // 1 人あたりの未読メッセージ上限

$config = [];
if (is_file(__DIR__ . '/config.php')) $config = require __DIR__ . '/config.php';
$allowed = $config['allowed_origins'] ?? ['https://shuji30.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:8090'];
$dataDir = $config['data_dir'] ?? (__DIR__ . '/data');

// ---- CORS（ゲームを別のドメイン、例えば GitHub Pages から開いても使えるように）----
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && (in_array('*', $allowed, true) || in_array($origin, $allowed, true))) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(string $msg, int $code = 400): never { out(['ok' => false, 'error' => $msg], $code); }

$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1) ?: '';
if (strlen($raw) > MAX_BODY) fail('too large', 413);
$in = $raw !== '' ? json_decode($raw, true) : [];
if (!is_array($in)) $in = [];
$in = array_merge($_GET, $in);
$action = (string)($in['a'] ?? '');

if (!is_dir($dataDir) && !mkdir($dataDir, 0700, true) && !is_dir($dataDir)) fail('data dir not writable', 500);
// データディレクトリへの直接アクセスを禁止（Apache）
if (!is_file("$dataDir/.htaccess")) @file_put_contents("$dataDir/.htaccess", "Require all denied\nDeny from all\n");

require __DIR__ . '/laps.php';

if ($action === 'health') {
    // db: 'ok'（MySQL に接続できた）/ 'file'（DB 未設定。ファイルに保存）/ 'error'（接続できない）
    out(['ok' => true, 'version' => VERSION, 'php' => PHP_VERSION, 'writable' => is_writable($dataDir), 'db' => laps_status($config), 'time' => microtime(true)]);
}

function code_ok(string $c): bool { return (bool)preg_match('/^[A-Z2-9]{4}$/', $c); }
function new_code(): string {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $s = '';
    for ($i = 0; $i < 4; $i++) $s .= $chars[random_int(0, strlen($chars) - 1)];
    return $s;
}
function clean_name(mixed $n): string {
    $n = trim(preg_replace('/[\x00-\x1F\x7F<>"\'&]/u', '', (string)$n) ?? '');
    return mb_substr($n !== '' ? $n : 'Player', 0, 16);
}

// ルームファイルを排他ロックして読み書きする。$fn は [新しいルーム, 返す値] を返す（ルーム null で削除）
function with_room(string $dir, string $code, callable $fn, bool $create = false): mixed {
    $path = "$dir/room-$code.json";
    if (!$create && !is_file($path)) fail('room not found', 404);
    $fh = fopen($path, 'c+');
    if (!$fh) fail('cannot open room', 500);
    flock($fh, LOCK_EX);
    $txt = stream_get_contents($fh);
    $room = $txt ? json_decode($txt, true) : null;
    $now = time();
    if (is_array($room)) {
        // 期限切れのプレイヤーを外す
        foreach ($room['players'] as $id => $p) {
            if ($now - $p['seen'] > PLAYER_TTL) unset($room['players'][$id], $room['queues'][$id]);
        }
        if ($room['players'] && !isset($room['players'][$room['host']])) $room['host'] = array_key_first($room['players']);
    }
    [$room, $result] = $fn($room, $now);
    if ($room === null || !$room['players']) {
        ftruncate($fh, 0);
        flock($fh, LOCK_UN);
        fclose($fh);
        @unlink($path);
    } else {
        $room['touched'] = $now;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($room, JSON_UNESCAPED_UNICODE));
        fflush($fh);
        flock($fh, LOCK_UN);
        fclose($fh);
    }
    return $result;
}

function auth(array $room, array $in): string {
    $id = (string)($in['peer'] ?? '');
    $tok = (string)($in['token'] ?? '');
    if (!isset($room['players'][$id]) || !hash_equals($room['players'][$id]['token'], $tok)) fail('unauthorized', 403);
    return $id;
}

function public_players(array $room): array {
    $list = [];
    foreach ($room['players'] as $id => $p) $list[] = ['id' => (string)$id, 'name' => $p['name'], 'joined' => $p['joined']];
    usort($list, fn($a, $b) => $a['joined'] <=> $b['joined']);
    return $list;
}

// 古いルームの掃除（ときどき）
if (random_int(1, 20) === 1) {
    foreach (glob("$dataDir/room-*.json") ?: [] as $f) if (time() - filemtime($f) > ROOM_TTL) @unlink($f);
}

// ベストラップのランキング
if ($action === 'laps' || $action === 'submitLap') laps_handle($action, $in, $config, $dataDir);

$code = strtoupper((string)($in['room'] ?? ''));
switch ($action) {
    case 'create': {
        for ($i = 0; $i < 20; $i++) { $code = new_code(); if (!is_file("$dataDir/room-$code.json")) break; }
        $peer = 'p' . bin2hex(random_bytes(4));
        $token = bin2hex(random_bytes(16));
        $name = clean_name($in['name'] ?? '');
        out(with_room($dataDir, $code, function ($room, $now) use ($peer, $token, $name, $code) {
            $room = ['code' => $code, 'host' => $peer, 'created' => $now, 'settings' => new stdClass(), 'state' => 'lobby',
                     'players' => [$peer => ['name' => $name, 'token' => $token, 'joined' => microtime(true), 'seen' => $now]],
                     'queues' => [$peer => []]];
            return [$room, ['ok' => true, 'room' => $code, 'peer' => $peer, 'token' => $token, 'host' => $peer]];
        }, true));
    }
    case 'join': {
        if (!code_ok($code)) fail('bad room code');
        $peer = 'p' . bin2hex(random_bytes(4));
        $token = bin2hex(random_bytes(16));
        $name = clean_name($in['name'] ?? '');
        out(with_room($dataDir, $code, function ($room, $now) use ($peer, $token, $name) {
            if (!$room) fail('room not found', 404);
            if (count($room['players']) >= MAX_PLAYERS) fail('room is full', 409);
            if ($room['state'] !== 'lobby') fail('race in progress', 409);
            $room['players'][$peer] = ['name' => $name, 'token' => $token, 'joined' => microtime(true), 'seen' => $now];
            $room['queues'][$peer] = [];
            return [$room, ['ok' => true, 'room' => $room['code'], 'peer' => $peer, 'token' => $token, 'host' => $room['host']]];
        }));
    }
    case 'poll': {
        if (!code_ok($code)) fail('bad room code');
        out(with_room($dataDir, $code, function ($room, $now) use ($in) {
            if (!$room) fail('room not found', 404);
            $id = auth($room, $in);
            $room['players'][$id]['seen'] = $now;
            $msgs = $room['queues'][$id] ?? [];
            $room['queues'][$id] = [];
            return [$room, ['ok' => true, 'host' => $room['host'], 'players' => public_players($room), 'state' => $room['state'],
                            'settings' => (object)$room['settings'], 'msgs' => $msgs, 'time' => microtime(true)]];
        }));
    }
    case 'send': {
        if (!code_ok($code)) fail('bad room code');
        out(with_room($dataDir, $code, function ($room, $now) use ($in) {
            if (!$room) fail('room not found', 404);
            $id = auth($room, $in);
            $room['players'][$id]['seen'] = $now;
            $to = (string)($in['to'] ?? '');
            $data = $in['data'] ?? null;
            $targets = $to === '*' ? array_keys($room['players']) : [$to];
            foreach ($targets as $t) {
                $t = (string)$t;
                if ($t === $id || !isset($room['players'][$t])) continue;
                if (count($room['queues'][$t]) >= MAX_QUEUE) array_shift($room['queues'][$t]);
                $room['queues'][$t][] = ['from' => $id, 'data' => $data];
            }
            return [$room, ['ok' => true]];
        }));
    }
    case 'update': { // ホストだけ: レース設定や状態（lobby / racing）を更新
        if (!code_ok($code)) fail('bad room code');
        out(with_room($dataDir, $code, function ($room, $now) use ($in) {
            if (!$room) fail('room not found', 404);
            $id = auth($room, $in);
            if ($id !== $room['host']) fail('host only', 403);
            if (isset($in['settings']) && is_array($in['settings'])) $room['settings'] = $in['settings'];
            if (isset($in['state']) && in_array($in['state'], ['lobby', 'racing'], true)) $room['state'] = $in['state'];
            $room['players'][$id]['seen'] = $now;
            return [$room, ['ok' => true]];
        }));
    }
    case 'leave': {
        if (!code_ok($code)) fail('bad room code');
        if (!is_file("$dataDir/room-$code.json")) out(['ok' => true]);
        out(with_room($dataDir, $code, function ($room, $now) use ($in) {
            if (!$room) return [null, ['ok' => true]];
            $id = auth($room, $in);
            unset($room['players'][$id], $room['queues'][$id]);
            if ($room['players'] && $room['host'] === $id) $room['host'] = array_key_first($room['players']);
            return [$room, ['ok' => true]];
        }));
    }
    default:
        fail('unknown action');
}
