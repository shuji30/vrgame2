<?php
// ベストラップのランキング（コース × 車種 × モードごと。同じ名前は自己ベストだけ残す）
// MySQL（config.php の db）があればそこへ、無ければ data/ のファイルへ保存する
declare(strict_types=1);

const LAPS_TOP = 10;
const LAP_MIN_MS = 10000;   // これより速いラップは不正とみなす
const LAP_MAX_MS = 600000;
const SUBMIT_INTERVAL = 5;  // 同じ接続元からの登録の間隔（秒）

// DB に接続する（未設定なら null）。失敗したら例外
function laps_db(array $config): ?PDO {
    $db = $config['db'] ?? null;
    if (!is_array($db) || empty($db['host']) || empty($db['name'])) return null;
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'], (int)($db['port'] ?? 3306), $db['name']);
    $pdo = new PDO($dsn, (string)($db['user'] ?? ''), (string)($db['pass'] ?? ''), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 5,
    ]);
    $pdo->exec("CREATE TABLE IF NOT EXISTS tk_laps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        track VARCHAR(32) NOT NULL,
        vehicle VARCHAR(16) NOT NULL,
        mode VARCHAR(8) NOT NULL,
        name VARCHAR(32) NOT NULL,
        lap_ms INT NOT NULL,
        created DATETIME NOT NULL,
        UNIQUE KEY uniq_driver (track, vehicle, mode, name),
        KEY idx_rank (track, vehicle, mode, lap_ms)
    ) DEFAULT CHARSET=utf8mb4");
    return $pdo;
}

// 状態（health 用）: 'ok' / 'file'（DB 未設定）/ 'error'
function laps_status(array $config): string {
    try {
        return laps_db($config) ? 'ok' : 'file';
    } catch (Throwable $e) {
        return 'error';
    }
}

function laps_key(array $in): array {
    $track = (string)($in['track'] ?? '');
    $vehicle = (string)($in['vehicle'] ?? '');
    $mode = (string)($in['mode'] ?? '');
    if (!preg_match('/^[a-z0-9-]{1,32}$/', $track)) fail('bad track');
    if (!in_array($vehicle, ['kart', 'gt3', 'formula'], true)) fail('bad vehicle');
    if (!in_array($mode, ['party', 'real'], true)) fail('bad mode');
    return [$track, $vehicle, $mode];
}

function laps_file(string $dataDir, array $key): string {
    return "$dataDir/laps-" . implode('-', $key) . '.json';
}

function laps_top(?PDO $pdo, string $dataDir, array $key): array {
    if ($pdo) {
        $st = $pdo->prepare('SELECT name, lap_ms, created FROM tk_laps WHERE track = ? AND vehicle = ? AND mode = ? ORDER BY lap_ms ASC, created ASC LIMIT ' . LAPS_TOP);
        $st->execute($key);
        return array_map(fn($r) => ['name' => $r['name'], 'ms' => (int)$r['lap_ms'], 'date' => substr((string)$r['created'], 0, 10)], $st->fetchAll());
    }
    $path = laps_file($dataDir, $key);
    $list = is_file($path) ? (json_decode((string)file_get_contents($path), true) ?: []) : [];
    return array_slice($list, 0, LAPS_TOP);
}

// 自己ベストなら記録する。返り値: 順位（トップ 10 外なら null）
function laps_submit(?PDO $pdo, string $dataDir, array $key, string $name, int $ms): ?int {
    $date = date('Y-m-d H:i:s');
    if ($pdo) {
        // 同じ名前の記録より速いときだけ更新（created を先に更新する）
        $st = $pdo->prepare('INSERT INTO tk_laps (track, vehicle, mode, name, lap_ms, created) VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE created = IF(VALUES(lap_ms) < lap_ms, VALUES(created), created), lap_ms = LEAST(lap_ms, VALUES(lap_ms))');
        $st->execute([...$key, $name, $ms, $date]);
    } else {
        $path = laps_file($dataDir, $key);
        $fh = fopen($path, 'c+');
        if (!$fh) fail('cannot save', 500);
        flock($fh, LOCK_EX);
        $list = json_decode((string)stream_get_contents($fh), true) ?: [];
        $found = false;
        foreach ($list as &$r) {
            if ($r['name'] !== $name) continue;
            $found = true;
            if ($ms < $r['ms']) { $r['ms'] = $ms; $r['date'] = substr($date, 0, 10); }
        }
        unset($r);
        if (!$found) $list[] = ['name' => $name, 'ms' => $ms, 'date' => substr($date, 0, 10)];
        usort($list, fn($a, $b) => $a['ms'] <=> $b['ms']);
        $list = array_slice($list, 0, 100);
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($list, JSON_UNESCAPED_UNICODE));
        fflush($fh);
        flock($fh, LOCK_UN);
        fclose($fh);
    }
    foreach (laps_top($pdo, $dataDir, $key) as $i => $r) if ($r['name'] === $name && $r['ms'] === $ms) return $i + 1;
    return null;
}

// 同じ接続元からの連続登録を防ぐ（IP はハッシュにして保存）
function laps_rate_ok(string $dataDir): bool {
    $ip = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|turbokart');
    $path = "$dataDir/laps-rate.json";
    $fh = fopen($path, 'c+');
    if (!$fh) return true;
    flock($fh, LOCK_EX);
    $m = json_decode((string)stream_get_contents($fh), true) ?: [];
    $now = time();
    foreach ($m as $k => $t) if ($now - $t > 3600) unset($m[$k]);
    $ok = !isset($m[$ip]) || $now - $m[$ip] >= SUBMIT_INTERVAL;
    if ($ok) $m[$ip] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($m));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $ok;
}

function laps_handle(string $action, array $in, array $config, string $dataDir): never {
    $key = laps_key($in);
    try {
        $pdo = laps_db($config);
    } catch (Throwable $e) {
        // 接続情報を漏らさないよう、詳細は返さない
        fail('database error', 500);
    }
    if ($action === 'laps') out(['ok' => true, 'top' => laps_top($pdo, $dataDir, $key), 'store' => $pdo ? 'db' : 'file']);
    // submitLap
    $ms = (int)($in['ms'] ?? 0);
    if ($ms < LAP_MIN_MS || $ms > LAP_MAX_MS) fail('bad lap time');
    $name = clean_name($in['name'] ?? '');
    if (!laps_rate_ok($dataDir)) fail('too many requests', 429);
    $rank = laps_submit($pdo, $dataDir, $key, $name, $ms);
    out(['ok' => true, 'rank' => $rank, 'top' => laps_top($pdo, $dataDir, $key)]);
}
