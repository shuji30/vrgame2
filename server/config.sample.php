<?php
// このファイルを config.php という名前でコピーすると設定を上書きできる（無くても動く）
return [
    // ゲームを開いてよいサイト（CORS）。'*' ですべて許可
    'allowed_origins' => ['https://shuji30.github.io', 'https://example.com'],
    // データの保存先（公開ディレクトリの外にすると、より安全）
    // 'data_dir' => '/home/xxxx/turbokart-data',
];
