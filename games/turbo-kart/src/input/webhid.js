// WebHID: ブラウザから USB の HID 機器（ハンコン・ペダル・サイドブレーキ・シフター）を直接読み、
// 標準の FFB 規格（USB HID PID）に対応したハンコンには力を出す。Chrome / Edge（PC）で使える。
// 最初に 1 回だけ機器の選択（許可）が必要。以後は自動で接続する。
const U = (page, id) => ((page << 16) | id) >>> 0;
const PAGE = { desktop: 0x01, sim: 0x02, button: 0x09, ordinal: 0x0a, pid: 0x0f };

const FILTERS = [
  { usagePage: 0x01, usage: 0x04 }, // Joystick
  { usagePage: 0x01, usage: 0x05 }, // Gamepad
  { usagePage: 0x01, usage: 0x08 }, // Multi-axis
  { usagePage: 0x02 }, // Simulation controls
  // FFB（USB HID PID）。入力とは別の窓口（インターフェース）に分かれているハンコンがある
  { usagePage: 0x0f },
];
const AXIS_USAGES = new Set([
  U(1, 0x30), U(1, 0x31), U(1, 0x32), U(1, 0x33), U(1, 0x34), U(1, 0x35), U(1, 0x36), U(1, 0x37), U(1, 0x38),
  U(2, 0xba), U(2, 0xbb), U(2, 0xc4), U(2, 0xc5), U(2, 0xc6), U(2, 0xc8),
]);
const HAT = U(1, 0x39);

function walk(collections, fn) {
  for (const c of collections || []) {
    fn(c);
    walk(c.children, fn);
  }
}

function fieldUsages(item) {
  if (item.isRange) {
    const out = [];
    for (let u = item.usageMinimum; u <= item.usageMaximum; u++) out.push(u >>> 0);
    return out;
  }
  return (item.usages || []).map((u) => u >>> 0);
}

// 論理範囲（Chrome が符号付きで返すと最大値が負になることがあるので補正）。
// 1 ビットの項目が「0〜0」と返ってくる機種（CAMMUS など）があるので、幅の無い範囲はビット幅いっぱいとみなす
function logicalRange(item) {
  let min = item.logicalMinimum, max = item.logicalMaximum;
  if (max < min) max += 2 ** item.reportSize;
  if (max === min) { min = 0; max = 2 ** item.reportSize - 1; }
  return [min, max];
}

function readBits(dv, offset, size) {
  let v = 0;
  for (let i = 0; i < size; i++) {
    const byte = (offset + i) >> 3;
    if (byte >= dv.byteLength) break;
    if ((dv.getUint8(byte) >> ((offset + i) & 7)) & 1) v += 2 ** i;
  }
  return v;
}

function writeBits(bytes, offset, size, value) {
  let v = value < 0 ? value + 2 ** size : value;
  for (let i = 0; i < size; i++) {
    const bit = Math.floor(v / 2 ** i) % 2;
    const byte = (offset + i) >> 3;
    if (byte < bytes.length && bit) bytes[byte] |= 1 << ((offset + i) & 7);
  }
}

const HAT_BITS = [1, 1 | 2, 2, 2 | 4, 4, 4 | 8, 8, 8 | 1];

// 入力レポートの解析（報告書の記述子は WebHID が解析済みの items を使う）
export class ReportParser {
  constructor(device) {
    this.device = device;
    this.byReport = new Map();
    this.axes = [];
    this.buttons = [];
    this.latch = [];
    let axisCount = 0, maxButton = 0, hats = 0;
    const seen = new Set();
    walk(device.collections, (c) => {
      for (const r of c.inputReports || []) {
        if (seen.has(r.reportId)) continue;
        seen.add(r.reportId);
        const fields = [];
        let bit = 0;
        for (const item of r.items) {
          const usages = fieldUsages(item);
          const [min, max] = logicalRange(item);
          for (let k = 0; k < item.reportCount; k++) {
            const f = { offset: bit, size: item.reportSize, min, max, signed: item.logicalMinimum < 0 };
            bit += item.reportSize;
            if (item.isConstant) continue;
            if (item.isArray) {
              fields.push({ ...f, kind: 'array', usages, base: min });
              continue;
            }
            const u = usages[Math.min(k, usages.length - 1)];
            if (u === undefined) continue;
            if (u >>> 16 === PAGE.button) {
              const idx = (u & 0xffff) - 1;
              maxButton = Math.max(maxButton, idx + 1);
              fields.push({ ...f, kind: 'button', idx });
            } else if (u === HAT) {
              fields.push({ ...f, kind: 'hat', hat: hats++ });
            } else if (AXIS_USAGES.has(u) || u >>> 16 === PAGE.desktop || u >>> 16 === PAGE.sim) {
              fields.push({ ...f, kind: 'axis', idx: axisCount++ });
            }
          }
        }
        this.byReport.set(r.reportId, fields);
      }
    });
    this.axes = new Array(axisCount).fill(0);
    this.hatBase = maxButton;
    this.buttons = new Array(maxButton + hats * 4).fill(0);
    this.latch = new Array(this.buttons.length).fill(0);
    this.lastInput = 0;
  }

  handle(ev) {
    const fields = this.byReport.get(ev.reportId);
    if (!fields) return;
    const dv = ev.data;
    for (const f of fields) {
      let v = readBits(dv, f.offset, f.size);
      if (f.signed && v >= 2 ** (f.size - 1)) v -= 2 ** f.size;
      if (f.kind === 'axis') {
        this.axes[f.idx] = f.max > f.min ? ((v - f.min) / (f.max - f.min)) * 2 - 1 : 0;
      } else if (f.kind === 'button') {
        this.set(f.idx, v ? 1 : 0);
      } else if (f.kind === 'hat') {
        const pos = v - f.min;
        const bits = pos >= 0 && pos < 8 && v <= f.max ? HAT_BITS[pos] : 0;
        for (let b = 0; b < 4; b++) this.set(this.hatBase + f.hat * 4 + b, (bits >> b) & 1);
      } else if (f.kind === 'array' && v >= f.base) {
        const u = f.usages[v - f.base];
        if (u >>> 16 === PAGE.button) this.set((u & 0xffff) - 1, 1);
      }
    }
    this.lastInput = performance.now();
  }

  set(i, v) {
    if (i < 0 || i >= this.buttons.length) return;
    this.buttons[i] = v;
    if (v) this.latch[i] = 1;
  }

  // 前回読んでから一度でも押されたボタンも押下として返す（短い押下を取りこぼさない）
  snapshot() {
    const buttons = this.buttons.map((v, i) => Math.max(v, this.latch[i]));
    this.latch.fill(0);
    return { axes: [...this.axes], buttons };
  }
}

// ---- FFB（USB HID PID）----
const P = {
  EFFECT_BLOCK_INDEX: 0x22, PARAM_BLOCK_OFFSET: 0x23, EFFECT_TYPE: 0x25,
  ET_CONSTANT: 0x26, ET_SINE: 0x31, ET_SPRING: 0x40, ET_DAMPER: 0x41,
  DURATION: 0x50, SAMPLE_PERIOD: 0x51, GAIN: 0x52, TRIGGER_BUTTON: 0x53, TRIGGER_REPEAT: 0x54, DIRECTION_ENABLE: 0x56,
  START_DELAY: 0xa7, CP_OFFSET: 0x60, POS_COEF: 0x61, NEG_COEF: 0x62, POS_SAT: 0x63, NEG_SAT: 0x64, DEAD_BAND: 0x65,
  OFFSET: 0x6f, MAGNITUDE: 0x70, PHASE: 0x71, PERIOD: 0x72,
  EFFECT_OPERATION: 0x78, OP_START: 0x79, OP_STOP: 0x7b, LOOP_COUNT: 0x7c,
  DEVICE_GAIN: 0x7e, BLOCK_LOAD_STATUS: 0x8b, BLS_SUCCESS: 0x8c,
  DC_ENABLE: 0x97, DC_STOP_ALL: 0x99, DC_RESET: 0x9a, BYTE_COUNT: 0x3b,
};
const pid = (id) => U(PAGE.pid, id);

function reportUsages(r) {
  const s = new Set();
  for (const it of r.items) for (const u of fieldUsages(it)) s.add(u);
  return s;
}

// FFB（PID）の記述があるか: PID のコレクション、または出力・機能レポートの中に PID の項目がある
export function hasPID(device) {
  let found = false;
  walk(device.collections, (c) => {
    if (c.usagePage === PAGE.pid) found = true;
    for (const r of [...(c.outputReports || []), ...(c.featureReports || [])]) {
      for (const it of r.items || []) if (fieldUsages(it).some((u) => u >>> 16 === PAGE.pid)) found = true;
    }
  });
  return found;
}

// 診断用: 窓口（最上位コレクション）とレポートの概要
export function describeDevice(device) {
  const tops = (device.collections || []).map((c) => `0x${c.usagePage.toString(16)}:0x${c.usage.toString(16)}`).join(', ');
  let inR = 0, outR = 0, featR = 0, pidItems = 0;
  walk(device.collections, (c) => {
    inR += (c.inputReports || []).length;
    outR += (c.outputReports || []).length;
    featR += (c.featureReports || []).length;
    for (const r of [...(c.outputReports || []), ...(c.featureReports || [])]) {
      for (const it of r.items || []) if (fieldUsages(it).some((u) => u >>> 16 === PAGE.pid)) pidItems++;
    }
  });
  return `窓口 ${tops || 'なし'} / 入力レポート ${inR} / 出力レポート ${outR} / 機能レポート ${featR} / FFB(PID) の項目 ${pidItems}（VID 0x${(device.vendorId || 0).toString(16)} PID 0x${(device.productId || 0).toString(16)}）`;
}

// 選択式（配列）の項目の値は、USB HID PID の規格で決まっている並び（1 から）で決める。
// Chrome が返す usages の並びと範囲は機種によって逆順・壊れていることがある（CAMMUS DDWB では種類が逆順、範囲は 12〜0）
const CANONICAL = [
  [0x26, 0x27, 0x30, 0x31, 0x32, 0x33, 0x34, 0x40, 0x41, 0x42, 0x43, 0x28], // エフェクトの種類
  [0x79, 0x7a, 0x7b], // エフェクトの操作: 開始 / 単独で開始 / 停止
  [0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c], // デバイス制御: 有効 / 無効 / 全停止 / リセット / 一時停止 / 再開
].map((list) => list.map((id) => ((0x0f << 16) | id) >>> 0));

function arrayValue(usages, select, min) {
  for (const list of CANONICAL) {
    if (!usages.some((u) => list.includes(u))) continue;
    const i = list.findIndex((u) => select.has(u));
    return i >= 0 ? i + 1 : null;
  }
  const idx = usages.findIndex((u) => select.has(u));
  return idx >= 0 ? Math.max(1, min) + idx : null;
}

// レポートの書き込み: values は usage → 正規化値 {n} / 生値 {raw}、select は選ぶ usage（配列項目の値、またはオン/オフの項目を 1 に）
function buildReport(r, values = new Map(), select = new Set()) {
  let bits = 0;
  for (const it of r.items) bits += it.reportSize * it.reportCount;
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  let bit = 0;
  for (const it of r.items) {
    const usages = fieldUsages(it);
    const [min, max] = logicalRange(it);
    for (let k = 0; k < it.reportCount; k++) {
      const off = bit;
      bit += it.reportSize;
      if (it.isConstant) continue;
      if (it.isArray) {
        const val = arrayValue(usages, select, it.logicalMinimum);
        if (val !== null) writeBits(bytes, off, it.reportSize, val);
        continue;
      }
      const u = usages[Math.min(k, usages.length - 1)];
      // オン/オフの項目（デバイス制御をビットで受け取る機種など）は、選ばれていれば 1
      const v = values.get(u) ?? (select.has(u) ? { raw: 1 } : undefined);
      if (v === undefined) continue;
      // null: 範囲外の値（0）をそのまま書く＝「指定なし」（トリガーボタン無しなど）
      if (v.null) {
        writeBits(bytes, off, it.reportSize, min > 0 ? 0 : max + 1 < 2 ** it.reportSize ? max + 1 : 0);
        continue;
      }
      let raw;
      if (v.raw !== undefined) raw = v.raw;
      else if (min < 0) raw = Math.round(Math.max(-1, Math.min(1, v.n)) * max);
      else raw = Math.round(min + Math.max(0, Math.min(1, v.n)) * (max - min));
      writeBits(bytes, off, it.reportSize, Math.max(min, Math.min(max, raw)));
    }
  }
  return bytes;
}

export class PIDForce {
  constructor(device) {
    this.device = device;
    const out = [], feat = [];
    const seen = new Set();
    walk(device.collections, (c) => {
      for (const r of c.outputReports || []) if (!seen.has('o' + r.reportId)) { seen.add('o' + r.reportId); out.push(r); }
      for (const r of c.featureReports || []) if (!seen.has('f' + r.reportId)) { seen.add('f' + r.reportId); feat.push(r); }
    });
    const find = (list, need, not = []) => list.find((r) => {
      const s = reportUsages(r);
      return need.every((u) => s.has(pid(u))) && !not.some((u) => s.has(pid(u)));
    });
    this.r = {
      setEffect: find(out, [P.EFFECT_BLOCK_INDEX, P.DURATION]),
      constant: find(out, [P.EFFECT_BLOCK_INDEX, P.MAGNITUDE], [P.PERIOD, P.OFFSET, P.DURATION]),
      periodic: find(out, [P.EFFECT_BLOCK_INDEX, P.MAGNITUDE, P.PERIOD]),
      condition: find(out, [P.EFFECT_BLOCK_INDEX, P.POS_COEF]),
      operation: find(out, [P.EFFECT_BLOCK_INDEX, P.OP_START]),
      control: find(out, [P.DC_ENABLE]),
      gain: find(out, [P.DEVICE_GAIN]),
      create: find(feat, [P.EFFECT_TYPE]) || find(feat, [P.BYTE_COUNT]),
      blockLoad: find(feat, [P.BLOCK_LOAD_STATUS]),
    };
    this.ok = !!(this.r.setEffect && this.r.constant && this.r.operation);
    this.blocks = {};
    this.ready = false;
    this.starting = null; // 初期化中（同時に何度も初期化しないように）
    this.nextTry = 0;
    this.log = []; // 診断用: 初期化の各段階の結果
    this.busy = false;
    this.last = {};
    this.lastStart = -Infinity;
    this.error = null;
  }

  async send(r, values, select) {
    const bytes = buildReport(r, values, select);
    // 診断: 各レポートを最初に送ったときの中身を記録
    this.dumped ||= new Set();
    if (!this.dumped.has(r.reportId)) {
      this.dumped.add(r.reportId);
      this.note(`送信 #${r.reportId}: ${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
    await this.device.sendReport(r.reportId, bytes);
  }

  note(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  // 診断表示用: 選択式の項目（配列）の記述をそのまま出す（機種ごとの記述の違いを調べるため）
  describeArrays() {
    const out = [];
    for (const key of ['setEffect', 'operation', 'control']) {
      const r = this.r[key];
      if (!r) continue;
      const parts = r.items.map((it) => {
        const kind = it.isConstant ? 'C' : it.isArray ? 'A' : 'V';
        const us = it.isRange
          ? `range ${(it.usageMinimum >>> 0).toString(16)}-${(it.usageMaximum >>> 0).toString(16)}`
          : (it.usages || []).map((u) => (u >>> 0).toString(16)).join(',');
        return `${kind}${it.reportSize}x${it.reportCount}[${it.logicalMinimum}..${it.logicalMaximum}]{${us}}`;
      });
      out.push(`${key}#${r.reportId}: ${parts.join(' ')}`);
    }
    return out;
  }

  // 診断表示用: 見つかったレポートと、初期化の結果
  diagnose() {
    const has = (k) => (this.r[k] ? `${k}#${this.r[k].reportId}` : `${k}:なし`);
    return {
      reports: ['setEffect', 'constant', 'periodic', 'condition', 'operation', 'control', 'gain', 'create', 'blockLoad'].map(has).join(' '),
      blocks: JSON.stringify(this.blocks),
      ready: this.ready,
      error: this.error,
      log: [...this.describeArrays(), ...this.log.slice(-24)],
    };
  }

  async control(op) {
    if (this.r.control) await this.send(this.r.control, new Map(), new Set([pid(op)]));
  }

  // 効果を 1 つ作る（Create New Effect に対応していれば番号を受け取る）
  async allocate(type, fallback) {
    const { create, blockLoad } = this.r;
    if (create && blockLoad) {
      try {
        await this.device.sendFeatureReport(create.reportId, buildReport(create, new Map([[pid(P.BYTE_COUNT), { raw: 0 }]]), new Set([pid(type)])));
        const dv = await this.device.receiveFeatureReport(blockLoad.reportId);
        // 先頭はレポート ID。次がエフェクト番号（多くの機器で 1 バイト）
        const idx = dv.getUint8(blockLoad.reportId ? 1 : 0);
        this.note(`エフェクト作成 type=0x${type.toString(16)} → 番号 ${idx}（応答 ${[...new Uint8Array(dv.buffer)].slice(0, 6).join(',')}）`);
        if (idx > 0) return idx;
      } catch (e) {
        // 非対応なら固定番号で試す
        this.note(`エフェクト作成に失敗（固定番号 ${fallback} を使う）: ${e.message || e}`);
      }
    }
    return fallback;
  }

  async setup(type, idx, durationMs) {
    const v = new Map([
      [pid(P.EFFECT_BLOCK_INDEX), { raw: idx }],
      [pid(P.DURATION), { raw: durationMs }],
      [pid(P.TRIGGER_REPEAT), { raw: 0 }],
      [pid(P.SAMPLE_PERIOD), { raw: 0 }],
      [pid(P.START_DELAY), { raw: 0 }],
      [pid(P.GAIN), { n: 1 }],
      // トリガーボタンは「無し」（範囲内の値を送ると、そのボタンを押すまで力が出ない機種がある）
      [pid(P.TRIGGER_BUTTON), { null: true }],
      [pid(P.DIRECTION_ENABLE), { raw: 1 }], // 方向（極座標）を使う。立てないと力を出さない機種がある
      [U(PAGE.desktop, 0x30), { raw: 1 }], // Axes Enable: X
      [U(PAGE.ordinal, 0x01), { n: 0.25 }], // Direction: 90°（X 軸方向）
    ]);
    await this.send(this.r.setEffect, v, new Set([pid(type)]));
  }

  // 初期化。毎フレーム呼ばれても、実行中なら同じ処理を待つだけ（並行して何度も初期化すると番号が食い違う）。
  // 失敗したら 2 秒おいてから再挑戦する
  start() {
    if (this.ready || !this.ok) return Promise.resolve(this.ready);
    if (this.starting) return this.starting;
    if (performance.now() < this.nextTry) return Promise.resolve(false);
    this.starting = this.doStart().finally(() => { this.starting = null; });
    return this.starting;
  }

  async doStart() {
    try {
      await this.control(P.DC_RESET).catch((e) => this.note(`リセット失敗: ${e.message || e}`));
      await this.control(P.DC_ENABLE);
      this.note('アクチュエーター有効');
      if (this.r.gain) await this.send(this.r.gain, new Map([[pid(P.DEVICE_GAIN), { n: 1 }]]));
      this.blocks.constant = await this.allocate(P.ET_CONSTANT, 1);
      if (this.r.condition) this.blocks.damper = await this.allocate(P.ET_DAMPER, 2);
      if (this.r.periodic) this.blocks.sine = await this.allocate(P.ET_SINE, 3);
      await this.setup(P.ET_CONSTANT, this.blocks.constant, 1000);
      if (this.blocks.damper) await this.setup(P.ET_DAMPER, this.blocks.damper, 1000);
      if (this.blocks.sine) await this.setup(P.ET_SINE, this.blocks.sine, 1000);
      this.note(`エフェクト設定完了 ${JSON.stringify(this.blocks)}`);
      this.ready = true;
      this.error = null;
    } catch (e) {
      this.error = String(e.message || e);
      this.note(`初期化に失敗: ${this.error}`);
      this.nextTry = performance.now() + 2000;
    }
    return this.ready;
  }

  // 毎フレーム呼ぶ。out = { constant: -1..1, damper: 0..1, rumble: 0..1, rumbleHz }（上限は呼び出し側で適用済み）
  async apply(out) {
    if (!this.ready || this.busy) return;
    this.busy = true;
    try {
      const B = this.blocks;
      const now = performance.now();
      const c = Math.round(out.constant * 1000) / 1000;
      if (c !== this.last.c) {
        await this.send(this.r.constant, new Map([[pid(P.EFFECT_BLOCK_INDEX), { raw: B.constant }], [pid(P.MAGNITUDE), { n: c }]]));
        this.last.c = c;
      }
      const d = Math.round(out.damper * 100) / 100;
      if (B.damper && d !== this.last.d) {
        await this.send(this.r.condition, new Map([
          [pid(P.EFFECT_BLOCK_INDEX), { raw: B.damper }], [pid(P.PARAM_BLOCK_OFFSET), { raw: 0 }],
          [pid(P.CP_OFFSET), { n: 0 }], [pid(P.POS_COEF), { n: d }], [pid(P.NEG_COEF), { n: d }],
          [pid(P.POS_SAT), { n: 1 }], [pid(P.NEG_SAT), { n: 1 }], [pid(P.DEAD_BAND), { raw: 0 }],
        ]));
        this.last.d = d;
      }
      const r = Math.round(out.rumble * 100) / 100;
      const hz = Math.max(1, Math.round(out.rumbleHz || 20));
      if (B.sine && (r !== this.last.r || hz !== this.last.hz)) {
        await this.send(this.r.periodic, new Map([
          [pid(P.EFFECT_BLOCK_INDEX), { raw: B.sine }], [pid(P.MAGNITUDE), { n: r }],
          [pid(P.OFFSET), { n: 0 }], [pid(P.PHASE), { raw: 0 }], [pid(P.PERIOD), { raw: Math.round(1000 / hz) }],
        ]));
        this.last.r = r;
        this.last.hz = hz;
      }
      // 効果は 1 秒で切れるように設定してあり、動いている間だけ 0.3 秒ごとに開始し直す
      // （ブラウザが固まったり閉じたりしても力が出っぱなしにならない）
      if (now - this.lastStart > 300) {
        this.lastStart = now;
        for (const idx of [B.constant, B.damper, B.sine]) {
          if (!idx) continue;
          await this.send(this.r.operation, new Map([[pid(P.EFFECT_BLOCK_INDEX), { raw: idx }], [pid(P.LOOP_COUNT), { raw: 1 }]]), new Set([pid(P.OP_START)]));
        }
      }
    } catch (e) {
      this.error = String(e.message || e);
      this.note(`送信に失敗: ${this.error}`);
    } finally {
      this.busy = false;
    }
  }

  // 初期化からやり直す（FFB リセット）
  async reset() {
    if (this.starting) await this.starting;
    await this.stop();
    try { await this.control(P.DC_RESET); } catch { /* 非対応 */ }
    this.ready = false;
    this.blocks = {};
    this.last = {};
    this.lastStart = -Infinity;
    this.error = null;
    return this.start();
  }

  async stop() {
    this.last = {};
    if (!this.ready) return;
    try {
      await this.send(this.r.constant, new Map([[pid(P.EFFECT_BLOCK_INDEX), { raw: this.blocks.constant }], [pid(P.MAGNITUDE), { n: 0 }]]));
      await this.control(P.DC_STOP_ALL);
    } catch {
      // 切断済みなど
    }
    this.lastStart = -Infinity;
  }
}

export class HIDManager {
  constructor() {
    this.supported = 'hid' in navigator;
    this.devices = new Map(); // HIDDevice → { parser, pid, name, index }
    this.listeners = new Set();
    this.next = 0;
    if (!this.supported) return;
    navigator.hid.addEventListener('connect', (e) => this.open(e.device));
    navigator.hid.addEventListener('disconnect', (e) => this.close(e.device));
    // 一度許可した機器は自動でつなぐ
    navigator.hid.getDevices().then((ds) => ds.forEach((d) => this.open(d)));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  // ユーザー操作から呼ぶ（機器の選択画面が出る）
  async request() {
    if (!this.supported) return;
    const ds = await navigator.hid.requestDevice({ filters: FILTERS });
    for (const d of ds) await this.open(d);
  }

  async open(device) {
    if (this.devices.has(device)) return;
    const game = FILTERS.some((f) => {
      let hit = false;
      walk(device.collections, (c) => { if (c.usagePage === f.usagePage && (f.usage === undefined || c.usage === f.usage)) hit = true; });
      return hit;
    });
    if (!game) return;
    try {
      if (!device.opened) await device.open();
    } catch {
      return;
    }
    // 1 台が複数の HID 機能を持つと同じ名前で並ぶので、主な機能の種類を名前に含めて区別する
    const top = device.collections[0];
    const kind = top ? `${top.usagePage}:${top.usage}` : '?';
    const name = device.productName || 'HID device';
    const st = { device, parser: new ReportParser(device), pid: hasPID(device) ? new PIDForce(device) : null, name, key: `${name} [${kind}]`, index: this.next++ };
    device.addEventListener('inputreport', (ev) => st.parser.handle(ev));
    this.devices.set(device, st);
    this.emit();
  }

  async close(device) {
    const st = this.devices.get(device);
    if (!st) return;
    this.devices.delete(device);
    try { await device.close(); } catch { /* 切断済み */ }
    this.emit();
  }

  list() {
    return [...this.devices.values()];
  }

  pads() {
    return this.list().map((st) => ({ id: `HID: ${st.key}`, index: 2000 + st.index, ...st.parser.snapshot() }));
  }

  // FFB を出せる機器（PID 対応）。名前の指定があればそれを優先
  pidDevice(name) {
    const c = this.list().filter((st) => st.pid?.ok);
    return c.find((st) => st.name === name) || c[0] || null;
  }
}
