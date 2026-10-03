<?php
// このファイルを config.php という名前でコピーすると設定を上書きできる（無くても動く）
// config.php は Git に入らない（.gitignore）。デプロイ（deploy.bat）のときにサーバーへだけ送られる
return [
    // ゲームを開いてよいサイト（CORS）。'*' ですべて許可
    'allowed_origins' => ['https://shuji30.github.io', 'https://2026082302062910047985.onamaeweb.jp', 'http://localhost:8080'],
    // データの保存先（公開ディレクトリの外にすると、より安全）
    // 'data_dir' => '/home/xxxx/turbokart-data',

    // ベストラップのランキング（トップ 10）を保存する MySQL。
    // お名前.com のコントロールパネル「データベース」に表示される値を書く。空のままならファイルに保存する
    'db' => [
        'host' => '',      // 例: mysql1234.onamae.ne.jp
        'port' => 3306,
        'name' => '',      // データベース名
        'user' => '',      // ユーザー名
        'pass' => '',      // パスワード
    ],
];
