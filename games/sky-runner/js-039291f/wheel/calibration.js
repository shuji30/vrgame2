// ハンコン設定の画面 (タイトル画面の折りたたみ欄)。TURBO KART VR (vrgame2/games/turbo-kart/src/input/calibration.js) から流用して手直し
// ブリッジの接続状態・機種・割り当ての学習 (範囲の測定)・ハンドルの設定・FFB の設定とテストを行う
import { ACTIONS, snapshotPads, findPad, defaultConfig } from './devices.js';
import { detectChange, mapSteer, mapPedal } from './inputmap.js';

const $ = (root, sel) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortName = (id) => String(id).replace(/\s*\(.*?Vendor.*?\)\s*$/i, '').trim();

// 「順番に割り当てる」で聞いていく順番
const WIZARD = ['steer', 'throttle', 'brake', 'clutch', 'up', 'down', 'fire', 'missile', 'view', 'pause'];

export class WheelPanel {
  // root: <details id="wheelPanel">、wheel: WheelInput
  constructor(root, wheel) {
    this.root = root;
    this.wheel = wheel;
    this.learning = null;
    this.wizard = null;
    this.raf = 0;
    this.build();
    wheel.bridge.onStatus(() => this.renderStatus());
    root.addEventListener('toggle', () => (root.open ? this.open() : this.close()));
    this.renderSummary();
  }

  get cfg() {
    return this.wheel.config;
  }

  build() {
    const r = this.root;
    $(r, '[data-wheel=rows]').innerHTML = ACTIONS.map((a) => `
      <div class="wh-row" data-action="${a.key}">
        <div class="wh-name"><b>${a.label}</b>${a.optional ? '<em>任意</em>' : ''}<small class="bind"></small></div>
        <div class="wh-meter"><i></i></div>
        <div class="wh-ops"><button type="button" data-learn="${a.key}">割り当て</button><button type="button" class="ghost" data-clear="${a.key}">クリア</button></div>
      </div>`).join('');
    r.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || !r.contains(t)) return;
      const w = t.dataset.wheel;
      if (t.dataset.learn) { this.wizard = null; this.startLearn(t.dataset.learn); }
      else if (t.dataset.clear) { delete this.cfg.bindings[t.dataset.clear]; this.commit(); }
      else if (t.dataset.test) this.wheel.bridge.test(t.dataset.test, t.dataset.test === 'rumble' ? this.cfg.ffb.rumble : Math.max(0.2, this.cfg.ffb.spring));
      else if (w === 'wizard') this.startWizard();
      else if (w === 'done') this.finishLearn();
      else if (w === 'skip') this.next();
      else if (w === 'cancel') { this.wizard = null; this.cancelLearn(); }
      else if (w === 'reconnect') this.wheel.bridge.connect();
      else if (w === 'reset' && confirm('ハンコンの割り当てと設定をすべて初期化しますか？')) {
        this.wheel.config = defaultConfig();
        this.commit();
        this.syncForm();
      }
    });
    // ハンドル・FFB の設定 (data-cfg="steer.lockDeg" のように書く)
    for (const el of r.querySelectorAll('[data-cfg]')) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const [group, key] = el.dataset.cfg.split('.');
        this.cfg[group][key] = el.type === 'checkbox' ? el.checked : Number(el.value);
        if (group === 'ffb' && !this.cfg.ffb.enabled) this.wheel.bridge.stop();
        this.commit(false);
      });
    }
    this.syncForm();
  }

  syncForm() {
    for (const el of this.root.querySelectorAll('[data-cfg]')) {
      const [group, key] = el.dataset.cfg.split('.');
      const v = this.cfg[group][key];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = String(v);
    }
    this.syncLabels();
    this.renderBindings();
  }

  syncLabels() {
    for (const el of this.root.querySelectorAll('[data-show]')) {
      const [group, key] = el.dataset.show.split('.');
      const v = Number(this.cfg[group][key]);
      if (Number.isNaN(v)) continue;
      el.textContent = key === 'lockDeg' ? `左右 ${v / 2}°` : `${Math.round(v * 100)}%`;
    }
  }

  commit(render = true) {
    this.wheel.save();
    if (render) this.renderBindings();
    this.syncLabels();
    this.renderSummary();
  }

  describe(b) {
    if (!b) return '未割り当て';
    const via = b.pad.startsWith('SDL: ') ? 'ブリッジ' : 'ブラウザ';
    return `${b.kind === 'axis' ? '軸' : 'ボタン'} ${b.control} — ${shortName(b.pad.replace(/^SDL: /, ''))} (${via})`;
  }

  renderBindings() {
    for (const row of this.root.querySelectorAll('[data-action]')) {
      const b = this.cfg.bindings[row.dataset.action];
      const el = row.querySelector('.bind');
      el.textContent = this.describe(b);
      el.classList.toggle('none', !b);
    }
    this.renderModel();
  }

  // 機種 (割り当てたハンドルの名前) と、ペダルの数
  renderModel() {
    const el = $(this.root, '[data-wheel=model]');
    const B = this.cfg.bindings;
    if (!B.steer && !B.throttle) {
      el.textContent = '機種: まだ割り当てていません (「順番に割り当てる」から始めてください)';
      return;
    }
    const name = shortName((B.steer || B.throttle).pad.replace(/^SDL: /, ''));
    const pedals = B.clutch
      ? '3 ペダル (クラッチで高さ)'
      : B.up || B.down ? '2 ペダル (パドルで上昇・下降)' : '2 ペダル (上昇・下降のパドルが未割り当て)';
    el.textContent = `機種: ${name} / ${pedals}`;
  }

  renderStatus() {
    const st = this.wheel.bridge.status;
    const el = $(this.root, '[data-wheel=status]');
    if (this.wheel.bridge.disabled) {
      el.className = 'wh-status ng';
      el.textContent = 'この機器ではデバイスブリッジを使えません (PC の Chrome / Edge で使えます)';
    } else if (st.connected) {
      el.className = 'wh-status ok';
      const ffb = st.selected ? `FFB: ${st.selected}` : `FFB: ${st.error || 'FFB デバイスなし'}`;
      el.textContent = `ブリッジ接続中 (入力 ${st.devices.length} 台) — ${ffb}`;
    } else {
      el.className = 'wh-status ng';
      el.textContent = 'ブリッジ未接続 — ブラウザが直接読めるハンコンだけ使えます (VR の最中に読むには ffb-bridge を起動してください)';
    }
    $(this.root, '[data-wheel=reconnect]').hidden = st.connected || this.wheel.bridge.disabled;
    this.renderSummary();
  }

  renderSummary() {
    const el = $(this.root, '[data-wheel=summary]');
    if (!el) return;
    const n = Object.keys(this.cfg.bindings).length;
    const br = this.wheel.bridge.status.connected ? '・ブリッジ接続中' : '';
    el.textContent = n ? `(${n} 項目を割り当て済み${br})` : `(未設定${br})`;
  }

  open() {
    this.wheel.panelOpen = true;
    this.wheel.bridge.setKeepTrying(true);
    this.syncForm();
    this.renderStatus();
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  close() {
    this.wizard = null;
    this.cancelLearn();
    this.wheel.panelOpen = false;
    this.wheel.bridge.setKeepTrying(false);
    cancelAnimationFrame(this.raf);
  }

  // ---- 順番に割り当てる (ハンドル → ペダル → パドル → ボタン)

  startWizard() {
    this.wizard = [...WIZARD];
    this.next();
  }

  next() {
    if (!this.wizard) return this.cancelLearn();
    // クラッチがあれば、上昇・下降のパドルは聞かない (2 ペダルの機種だけ)
    while (this.wizard.length && ['up', 'down'].includes(this.wizard[0]) && this.cfg.bindings.clutch) this.wizard.shift();
    const key = this.wizard.shift();
    if (!key) {
      this.wizard = null;
      this.cancelLearn();
      return;
    }
    this.startLearn(key);
  }

  // ---- 割り当ての学習

  startLearn(action) {
    const a = ACTIONS.find((x) => x.key === action);
    const hint = a.kind === 'steer'
      ? 'ハンドルを<b>中央</b>にした状態から、ゆっくり左右に回してください'
      : a.kind === 'pedal'
        ? `${a.label.replace(/ \(.*/, '')}を<b>いっぱいまで</b>踏んでください`
        : `${a.label}に使うボタン / パドルを押してください`;
    const skip = a.key === 'clutch' ? 'クラッチの無い機種は「スキップ」 (パドルで上昇・下降)' : a.optional ? '使わないときは「スキップ」' : '';
    this.learning = { action: a, phase: 'detect', baseline: snapshotPads(this.wheel.bridge), min: Infinity, max: -Infinity, rest: 0 };
    this.wheel.busy = true;
    this.showLearn(`<b>${a.label} の割り当て</b>${this.wizard ? ` <small>(順番に割り当て中)</small>` : ''}<p>${hint}</p>${a.note ? `<p class="muted">${a.note}</p>` : ''}${skip ? `<p class="muted">${skip}</p>` : ''}<p class="muted">反応しないときは、いったんデバイスのボタンを押してから、もう一度試してください (ブラウザの仕様で、操作するまでデバイスが見えないことがあります)</p>`, false);
  }

  showLearn(html, canFinish) {
    const box = $(this.root, '[data-wheel=learn]');
    box.hidden = false;
    $(box, '[data-wheel=msg]').innerHTML = html;
    $(box, '[data-wheel=done]').hidden = !canFinish;
    $(box, '[data-wheel=skip]').hidden = !this.wizard;
  }

  cancelLearn() {
    this.learning = null;
    this.wheel.busy = false;
    $(this.root, '[data-wheel=learn]').hidden = true;
  }

  // 学習した割り当てを保存して、順番に割り当て中なら次へ
  store(key, binding) {
    this.cfg.bindings[key] = binding;
    this.commit();
    this.learning = null;
    if (this.wizard) this.next();
    else this.cancelLearn();
  }

  finishLearn() {
    const L = this.learning;
    if (!L || L.phase !== 'range') return this.cancelLearn();
    const b = L.binding;
    if (L.action.kind === 'steer') {
      const span = L.max - L.min;
      b.cal = span > 0.3 ? { min: L.min, max: L.max, center: L.rest } : { min: -1, max: 1, center: L.rest };
    } else {
      const full = Math.abs(L.max - L.rest) > Math.abs(L.min - L.rest) ? L.max : L.min;
      b.cal = { rest: L.rest, full, deadzone: 0.04 };
    }
    this.store(L.action.key, b);
  }

  frame() {
    const pads = snapshotPads(this.wheel.bridge);
    this.renderPads(pads);
    this.renderMeters(pads);
    const L = this.learning;
    if (!L) return;
    if (L.phase === 'detect') {
      const ch = detectChange(L.baseline, pads);
      if (!ch) {
        // 新しく見えたデバイスは基準に足す
        for (const p of pads) if (!L.baseline.some((b) => b.id === p.id && b.index === p.index)) L.baseline.push(p);
        return;
      }
      const binding = { kind: ch.kind, pad: ch.id, padIndex: ch.index, control: ch.control };
      const base = L.baseline.find((p) => p.id === ch.id && p.index === ch.index);
      if (ch.kind === 'button' || L.action.kind === 'button') {
        if (L.action.kind === 'steer') return; // ハンドルは軸だけ
        if (ch.kind === 'axis') binding.cal = { rest: base.axes[ch.control] };
        this.store(L.action.key, binding);
        return;
      }
      L.rest = base.axes[ch.control];
      L.binding = binding;
      L.phase = 'range';
      L.min = L.max = L.rest;
      const msg = L.action.kind === 'steer'
        ? '<b>ハンドルの範囲を測定中</b><p>左いっぱい → 右いっぱいまで回してから<b>中央に戻して</b>、「完了」を押してください</p>'
        : `<b>${L.action.label} の範囲を測定中</b><p>いっぱいまで踏み切ってから離し、「完了」を押してください</p>`;
      this.showLearn(msg + '<div class="wh-meter wide"><i data-wheel="live"></i></div>', true);
    } else if (L.phase === 'range') {
      const pad = findPad(pads, L.binding);
      if (!pad) return;
      const v = pad.axes[L.binding.control] ?? 0;
      L.min = Math.min(L.min, v);
      L.max = Math.max(L.max, v);
      const live = $(this.root, '[data-wheel=live]');
      if (live) live.style.width = `${((v + 1) / 2) * 100}%`;
    }
  }

  renderMeters(pads) {
    const B = this.cfg.bindings;
    for (const row of this.root.querySelectorAll('[data-action]')) {
      const key = row.dataset.action;
      const b = B[key];
      const bar = row.querySelector('.wh-meter i');
      let v = key === 'steer' ? 0.5 : 0;
      const pad = findPad(pads, b);
      if (b && pad) {
        const raw = (b.kind === 'button' ? pad.buttons[b.control] : pad.axes[b.control]) ?? 0;
        if (key === 'steer') v = (mapSteer(raw, { ...b.cal, ...this.cfg.steer }).value + 1) / 2;
        else if (b.kind === 'button') v = raw > 0.5 ? 1 : 0;
        else if (b.cal?.full === undefined) v = Math.abs(raw - (b.cal?.rest ?? 0)) > 0.5 ? 1 : 0; // ボタンの操作を軸に割り当てたもの
        else v = mapPedal(raw, b.cal);
      }
      bar.style.width = `${v * 100}%`;
      bar.classList.toggle('center', key === 'steer');
    }
  }

  // デバイスの生の値 (軸のバーとボタン)
  renderPads(pads) {
    const el = $(this.root, '[data-wheel=pads]');
    const key = pads.map((p) => `${p.index}:${p.id}:${p.axes.length}:${p.buttons.length}`).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = pads.length
        ? pads.map((p) => `<div class="wh-pad" data-pad="${p.index}"><b>${esc(p.id)}</b>
            <div class="wh-axes">${p.axes.map((_, i) => `<span title="軸 ${i}"><i></i><em>${i}</em></span>`).join('')}</div>
            <div class="wh-btns">${p.buttons.map((_, i) => `<span title="ボタン ${i}">${i}</span>`).join('')}</div></div>`).join('')
        : '<p class="muted">デバイスが見つかりません。ハンコンやペダルのボタンを一度押してください。</p>';
    }
    for (const p of pads) {
      const box = el.querySelector(`[data-pad="${p.index}"]`);
      if (!box) continue;
      box.querySelectorAll('.wh-axes i').forEach((i, n) => { i.style.height = `${(((p.axes[n] ?? 0) + 1) / 2) * 100}%`; });
      box.querySelectorAll('.wh-btns span').forEach((s, n) => s.classList.toggle('on', p.buttons[n] > 0.5));
    }
  }
}
