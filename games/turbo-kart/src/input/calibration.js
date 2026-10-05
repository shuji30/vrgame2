import { describeDevice } from './webhid.js';
// キャリブレーション画面（HTML）。割り当て学習・範囲測定・ハンドル設定・FFB 設定とテスト
import { ACTIONS, snapshotPads, findPad, defaultConfig } from './devices.js';
import { detectChange, mapSteer, mapPedal } from '../core/inputmap.js';

const $ = (root, sel) => root.querySelector(sel);

export class CalibrationUI {
  constructor(root, input, ffb, hid = null) {
    this.root = root;
    this.input = input;
    this.ffb = ffb;
    this.hid = hid;
    this.learning = null;
    this.raf = 0;
    this.build();
    ffb.onStatus(() => this.renderFFBStatus());
    // ハンコンが替わって FFB の設定が切り替わったら、スライダーなどを合わせ直す
    ffb.onProfile?.(() => { if (!this.root.hidden) this.syncForm(); this.renderFFBStatus(); });
    // 機器が変わると出力先（と反転の設定）が変わるので、フォームも合わせる
    hid?.onChange(() => { this.renderHid(); this.renderFFBStatus(); this.syncForm(); });
  }

  get cfg() {
    return this.input.config;
  }

  build() {
    const r = this.root;
    const rows = ACTIONS.map((a) => `
      <tr data-action="${a.key}">
        <th>${a.label}</th>
        <td class="bind"></td>
        <td><div class="meter"><i></i></div></td>
        <td class="ops"><button data-learn="${a.key}">割り当て</button><button data-clear="${a.key}" class="ghost">クリア</button></td>
      </tr>`).join('');
    $(r, '[data-calib=rows]').innerHTML = rows;
    r.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.hid === 'add') {
        this.hid?.request().catch(() => {}).finally(() => this.renderHid());
        return;
      }
      if (t.dataset.learn) this.startLearn(t.dataset.learn);
      else if (t.dataset.clear) { delete this.cfg.bindings[t.dataset.clear]; this.commit(); }
      else if (t.dataset.test) this.ffb.test(t.dataset.test);
      else if (t.dataset.calib === 'done') this.finishLearn();
      else if (t.dataset.calib === 'cancel') this.cancelLearn();
      else if (t.dataset.calib === 'reset') {
        if (confirm('入力の割り当てとキャリブレーションをすべて初期化しますか？')) {
          this.input.config = defaultConfig();
          this.commit();
          this.syncForm();
        }
      }
    });
    // ハンドル設定
    for (const el of r.querySelectorAll('[data-steer]')) {
      el.addEventListener('input', () => {
        const k = el.dataset.steer;
        this.cfg.steer[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
        this.commit(false);
      });
    }
    for (const el of r.querySelectorAll('[name=transmission]')) {
      el.addEventListener('change', () => { this.cfg.transmission = el.value; this.commit(false); });
    }
    // FFB 設定
    for (const el of r.querySelectorAll('[data-ffb]')) {
      el.addEventListener('input', () => {
        // 力の向きの反転は、出力先（WebHID / ブリッジ）ごとに別々に持つ
        const k = el.dataset.ffb === 'invert' ? this.ffb.invertKey() : el.dataset.ffb;
        if (k === 'enabled') this.ffb.setEnabled(el.checked);
        else if (el.tagName === 'SELECT') { this.ffb.stop(); this.ffb.settings[k] = el.value; this.renderFFBStatus(); }
        else this.ffb.settings[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
        this.ffb.save();
        this.syncLabels();
      });
    }
    $(r, '[data-ffb-device]').addEventListener('change', (e) => this.ffb.selectDevice(e.target.value));
    this.syncForm();
  }

  syncForm() {
    const r = this.root;
    for (const el of r.querySelectorAll('[data-steer]')) {
      const v = this.cfg.steer[el.dataset.steer];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    }
    for (const el of r.querySelectorAll('[name=transmission]')) el.checked = el.value === this.cfg.transmission;
    for (const el of r.querySelectorAll('[data-ffb]')) {
      const key = el.dataset.ffb === 'invert' ? this.ffb.invertKey() : el.dataset.ffb;
      const v = key === 'enabled' ? this.ffb.settings.enabled : this.ffb.settings[key];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    }
    this.syncLabels();
    this.renderBindings();
  }

  syncLabels() {
    for (const el of this.root.querySelectorAll('[data-show]')) {
      const [group, key] = el.dataset.show.split('.');
      const v = Number(group === 'steer' ? this.cfg.steer[key] : this.ffb.settings[key]);
      if (Number.isNaN(v)) continue;
      if (key === 'wheelDeg' || key === 'lockDeg') el.textContent = `${v}°`;
      else if (key === 'gamma') el.textContent = v.toFixed(2);
      else el.textContent = `${Math.round(v * 100)}%`;
    }
  }

  commit(render = true) {
    this.input.save();
    if (render) this.renderBindings();
    this.syncLabels();
  }

  describe(b) {
    if (!b) return '<span class="muted">未割り当て</span>';
    const name = b.pad.replace(/\(.*?Vendor.*?\)/i, '').trim();
    return `${b.kind === 'axis' ? '軸' : 'ボタン'} ${b.control} <small>${escapeHtml(name)}</small>`;
  }

  renderBindings() {
    for (const tr of this.root.querySelectorAll('[data-action]')) {
      tr.querySelector('.bind').innerHTML = this.describe(this.cfg.bindings[tr.dataset.action]);
    }
  }

  renderHid() {
    const el = $(this.root, '[data-hid=list]');
    if (!el) return;
    if (!this.hid?.supported) {
      el.innerHTML = '<p class="muted">このブラウザは WebHID に対応していません（PC の Chrome / Edge を使ってください）</p>';
      $(this.root, '[data-hid=add]').disabled = true;
      return;
    }
    const list = this.hid.list();
    el.innerHTML = list.length
      ? list.map((st) => `<div class="pad"><b>${escapeHtml(st.name)}</b>入力: 軸 ${st.parser.axes.length} / ボタン ${st.parser.buttons.length}　FFB: ${st.pid?.ok ? '<span style="color:var(--ok)">対応（HID PID）</span>' : st.pid ? 'PID の記述はあるが必要なレポートが不足' : 'なし'}${st.pid?.error ? ` <span class="muted">${escapeHtml(st.pid.error)}</span>` : ''}${st.pid ? pidDiag(st.pid, st.index) : ''}<details style="margin-top:2px"><summary class="muted">機器の情報</summary><pre style="white-space:pre-wrap;font-size:11px;margin:4px 0">${escapeHtml(describeDevice(st.device))}</pre></details></div>`).join('')
      : '<p class="muted">まだ追加されていません</p>';
  }

  renderFFBStatus() {
    const st = this.ffb.status;
    const el = $(this.root, '[data-ffb-status]');
    if (!el) return;
    const target = this.ffb.outputName;
    el.className = target ? 'ok' : 'ng';
    el.textContent = target
      ? `FFB 出力先: ${target}`
      : st.connected
        ? `ブリッジ接続中 — ${st.error || 'FFB デバイスなし'}`
        : 'FFB の出力先がありません（下の「USB 機器を追加」でハンコンを追加するか、デバイスブリッジを起動してください）';
    const prof = $(this.root, '[data-ffb-profile]');
    if (prof) {
      const w = this.ffb.settings.wheel;
      prof.textContent = w
        ? `下の強さ・反転などは「${w}」用の設定です（ハンコンごとに自動で保存し、つなぎ替えると切り替わります）`
        : 'FFB の強さ・反転などはハンコンごとに自動で保存され、つなぎ替えると切り替わります';
    }
    const sel = $(this.root, '[data-ffb-device]');
    const haptic = st.devices.filter((d) => d.haptic);
    sel.innerHTML = haptic.length
      ? haptic.map((d) => `<option ${d.name === st.selected ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')
      : '<option>（なし）</option>';
  }

  open() {
    this.root.hidden = false;
    this.syncForm();
    this.renderFFBStatus();
    this.renderHid();
    const loop = () => {
      this.frame();
      // FFB 診断の中身は 0.5 秒ごとに書き換える（開いた状態を保ったまま）
      const now = performance.now();
      if (now - (this.diagAt || 0) > 500) {
        this.diagAt = now;
        for (const st of this.hid?.list() || []) {
          const pre = st.pid && this.root.querySelector(`[data-diag="${st.index}"]`);
          if (pre) pre.textContent = pidDiagText(st.pid);
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    loop();
  }

  close() {
    this.cancelLearn();
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
  }

  // ---- 学習 ----

  startLearn(action) {
    const a = ACTIONS.find((x) => x.key === action);
    const hint = a.kind === 'steer'
      ? 'ハンドルを<b>中央</b>にした状態から、ゆっくり左右に回してください'
      : a.kind === 'pedal'
        ? `${a.label}を<b>いっぱいまで</b>踏んで（引いて）ください`
        : `${a.label}に使うボタン／パドルを押してください`;
    this.learning = { action: a, phase: 'detect', baseline: snapshotPads(), min: Infinity, max: -Infinity, rest: 0 };
    this.showLearn(`<h3>${a.label} の割り当て</h3><p>${hint}</p><p class="muted">反応しない場合は、いったんデバイスのボタンを押してから再度お試しください（ブラウザの仕様で、操作するまでデバイスが見えないことがあります）</p>`, false);
  }

  showLearn(html, canFinish) {
    const box = $(this.root, '[data-calib=learn]');
    box.hidden = false;
    $(box, '[data-calib=msg]').innerHTML = html;
    $(box, '[data-calib=done]').hidden = !canFinish;
  }

  cancelLearn() {
    this.learning = null;
    $(this.root, '[data-calib=learn]').hidden = true;
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
    this.cfg.bindings[L.action.key] = b;
    this.commit();
    this.cancelLearn();
  }

  frame() {
    const pads = snapshotPads();
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
      if (ch.kind === 'button' || L.action.kind === 'button') {
        if (L.action.kind === 'steer') return; // ハンドルは軸のみ
        if (ch.kind === 'axis') {
          const base = L.baseline.find((p) => p.id === ch.id && p.index === ch.index);
          binding.cal = { rest: base.axes[ch.control] };
        }
        this.cfg.bindings[L.action.key] = binding;
        this.commit();
        this.cancelLearn();
        return;
      }
      const base = L.baseline.find((p) => p.id === ch.id && p.index === ch.index);
      L.rest = base.axes[ch.control];
      L.binding = binding;
      L.phase = 'range';
      L.min = L.max = L.rest;
      const msg = L.action.kind === 'steer'
        ? '<h3>ハンドルの範囲を測定中</h3><p>左いっぱい → 右いっぱいまで回してから、中央に戻して「完了」を押してください</p>'
        : `<h3>${L.action.label} の範囲を測定中</h3><p>いっぱいまで踏み切ってから離し、「完了」を押してください</p>`;
      this.showLearn(msg + '<div class="meter wide"><i data-calib="live"></i></div>', true);
    } else if (L.phase === 'range') {
      const pad = findPad(pads, L.binding);
      if (!pad) return;
      const v = pad.axes[L.binding.control];
      L.min = Math.min(L.min, v);
      L.max = Math.max(L.max, v);
      const live = $(this.root, '[data-calib=live]');
      if (live) live.style.width = `${((v + 1) / 2) * 100}%`;
    }
  }

  renderMeters(pads) {
    const B = this.cfg.bindings;
    for (const tr of this.root.querySelectorAll('[data-action]')) {
      const key = tr.dataset.action;
      const b = B[key];
      const bar = tr.querySelector('.meter i');
      let v = 0;
      const pad = findPad(pads, b);
      if (b && pad) {
        const raw = b.kind === 'button' ? pad.buttons[b.control] : pad.axes[b.control];
        if (key === 'steer') v = (mapSteer(raw, { ...b.cal, ...this.cfg.steer }).value + 1) / 2;
        else if (b.kind === 'button') v = raw > 0.5 ? 1 : 0;
        else v = mapPedal(raw, b.cal || { rest: -1, full: 1 });
      } else if (key === 'steer') v = 0.5;
      bar.style.width = `${v * 100}%`;
      bar.classList.toggle('center', key === 'steer');
    }
  }

  renderPads(pads) {
    const el = $(this.root, '[data-calib=pads]');
    const key = pads.map((p) => `${p.index}:${p.id}:${p.axes.length}:${p.buttons.length}`).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = pads.length
        ? pads.map((p) => `<div class="pad" data-pad="${p.index}"><b>${escapeHtml(p.id)}</b>
            <div class="axes">${p.axes.map((_, i) => `<span title="軸 ${i}"><i></i><em>${i}</em></span>`).join('')}</div>
            <div class="btns">${p.buttons.map((_, i) => `<span title="ボタン ${i}">${i}</span>`).join('')}</div></div>`).join('')
        : '<p class="muted">デバイスが見つかりません。ハンコンやペダルのボタンを一度押してください。</p>';
    }
    for (const p of pads) {
      const box = el.querySelector(`[data-pad="${p.index}"]`);
      if (!box) continue;
      box.querySelectorAll('.axes i').forEach((i, n) => { i.style.height = `${((p.axes[n] + 1) / 2) * 100}%`; });
      box.querySelectorAll('.btns span').forEach((s, n) => s.classList.toggle('on', p.buttons[n] > 0.5));
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// WebHID の FFB 診断（うまく力が出ないときに、どこまで進んだかを確認する）
function pidDiagText(p) {
  const d = p.diagnose();
  return [`レポート: ${d.reports}`, `エフェクト番号: ${d.blocks}`, `準備: ${d.ready ? 'OK' : 'まだ'}`, d.error ? `エラー: ${d.error}` : '', ...d.log].filter(Boolean).join('\n');
}

function pidDiag(p, index) {
  return `<details style="margin-top:4px"><summary class="muted">FFB 診断（テストボタンを押すと更新。うまく動かないときはこの文字を送ってください）</summary><pre data-diag="${index}" style="white-space:pre-wrap;font-size:11px;margin:4px 0;user-select:text">${escapeHtml(pidDiagText(p))}</pre></details>`;
}
