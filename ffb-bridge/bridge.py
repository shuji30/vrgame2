"""TURBO KART VR - デバイスブリッジ（FFB 出力 + 入力の中継）

ブラウザ（ゲーム）から WebSocket で受け取った力の指示を、SDL2 の Haptic API で
ハンコンに出力する。また、接続されているすべてのジョイスティック（ホイールベース・ペダル・
サイドブレーキ・シフター）の軸とボタンをゲームへ送る。ブラウザの Gamepad API は同時に 4 台までしか
扱えず、VR ヘッドセットなどに枠を取られると見えなくなるため、入力もブリッジ経由で読む。SDL2 は Windows では DirectInput の FFB を使うため、メーカーの
PC 用ドライバーが入っていれば Fanatec / Thrustmaster / CAMMUS / Logitech / MOZA /
Simagic など一般的な FFB ハンコンで動く。

安全のため:
  - 出力は --max（既定 0.8）で頭打ち
  - 1 ティックあたりの変化量を制限（ダイレクトドライブで急に振られないように）
  - ゲームから 0.25 秒指示が来なければ力を 0 にする（ウォッチドッグ）
  - 許可した Origin（ゲームの URL）からの接続だけを受け付ける

使い方:  start.bat をダブルクリック（初回は依存パッケージを自動で入れる）
         python bridge.py --list        デバイス一覧
         python bridge.py --mock        ハンコン無しで動作確認（力を表示するだけ）
"""
import argparse
import asyncio
import ctypes
import json
import math
import os
import sys
import time

try:
    from websockets.exceptions import ConnectionClosed
except ImportError:  # --list だけなら websockets は無くてもよい
    ConnectionClosed = Exception

DEFAULT_ORIGINS = [
    "https://shuji30.github.io",
    "https://2026082302062910047985.onamaeweb.jp",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:8090",
]


def extra_origins():
    """同じフォルダの origins.txt に書いた URL も許可する（1 行に 1 つ、# はコメント）"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "origins.txt")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [ln.strip().rstrip("/") for ln in f if ln.strip() and not ln.strip().startswith("#")]
WHEEL_HINTS = ("wheel", "fanatec", "thrustmaster", "cammus", "logitech", "moza", "simagic",
               "simucube", "g29", "g920", "g923", "t300", "t150", "t248", "tx", "csl", "podium", "dd")
TICK = 1 / 200
WATCHDOG = 0.25
INPUT_INTERVAL = 1 / 125


def clamp(v, a, b):
    return max(a, min(b, v))


class MockHaptic:
    """ハンコン無しでの確認用。力を一定間隔で表示する"""

    def __init__(self):
        self.name = "MOCK WHEEL"
        self.features = ["constant", "damper", "spring", "sine"]
        self.last_print = 0

    def apply(self, c, d, s, r, hz):
        now = time.time()
        if now - self.last_print > 0.5:
            self.last_print = now
            print(f"[mock] constant={c:+.2f} damper={d:.2f} spring={s:.2f} rumble={r:.2f}@{hz}Hz")

    def close(self):
        pass


class SDLHaptic:
    def __init__(self, sdl2, joystick_index):
        self.sdl2 = sdl2
        self.js = sdl2.SDL_JoystickOpen(joystick_index)
        if not self.js:
            raise RuntimeError("joystick open failed")
        self.name = sdl2.SDL_JoystickName(self.js).decode(errors="replace")
        self.h = sdl2.SDL_HapticOpenFromJoystick(self.js)
        if not self.h:
            raise RuntimeError(f"{self.name}: FFB 非対応、または開けません ({sdl2.SDL_GetError().decode()})")
        q = sdl2.SDL_HapticQuery(self.h)
        self.features = [n for n, bit in (
            ("constant", sdl2.SDL_HAPTIC_CONSTANT), ("sine", sdl2.SDL_HAPTIC_SINE),
            ("spring", sdl2.SDL_HAPTIC_SPRING), ("damper", sdl2.SDL_HAPTIC_DAMPER),
            ("gain", sdl2.SDL_HAPTIC_GAIN), ("autocenter", sdl2.SDL_HAPTIC_AUTOCENTER)) if q & bit]
        if "gain" in self.features:
            sdl2.SDL_HapticSetGain(self.h, 100)
        if "autocenter" in self.features:
            sdl2.SDL_HapticSetAutocenter(self.h, 0)
        self.ids = {}
        self.effects = {}
        if "constant" in self.features:
            self._create("constant")
        if "damper" in self.features:
            self._create("damper")
        if "spring" in self.features:
            self._create("spring")
        if "sine" in self.features:
            self._create("sine")
        self.state = {}

    def _create(self, kind):
        s = self.sdl2
        e = s.SDL_HapticEffect()
        if kind == "constant":
            e.type = s.SDL_HAPTIC_CONSTANT
            c = e.constant
            c.type = s.SDL_HAPTIC_CONSTANT
            c.direction.type = s.SDL_HAPTIC_CARTESIAN
            c.direction.dir[0] = 1
            c.length = s.SDL_HAPTIC_INFINITY
            c.level = 0
        elif kind in ("damper", "spring"):
            t = s.SDL_HAPTIC_DAMPER if kind == "damper" else s.SDL_HAPTIC_SPRING
            e.type = t
            c = e.condition
            c.type = t
            c.direction.type = s.SDL_HAPTIC_CARTESIAN
            c.direction.dir[0] = 1
            c.length = s.SDL_HAPTIC_INFINITY
            c.right_sat[0] = c.left_sat[0] = 0xFFFF
        else:
            e.type = s.SDL_HAPTIC_SINE
            c = e.periodic
            c.type = s.SDL_HAPTIC_SINE
            c.direction.type = s.SDL_HAPTIC_CARTESIAN
            c.direction.dir[0] = 1
            c.length = s.SDL_HAPTIC_INFINITY
            c.period = 50
            c.magnitude = 0
        eid = s.SDL_HapticNewEffect(self.h, ctypes.byref(e))
        if eid < 0:
            print(f"  ! {kind} を作れません: {s.SDL_GetError().decode()}")
            return
        s.SDL_HapticRunEffect(self.h, eid, s.SDL_HAPTIC_INFINITY)
        self.ids[kind] = eid
        self.effects[kind] = e

    def _update(self, kind, value):
        if kind not in self.ids or self.state.get(kind) == value:
            return
        self.state[kind] = value
        e = self.effects[kind]
        if kind == "constant":
            e.constant.level = int(clamp(value, -1, 1) * 32767)
        elif kind in ("damper", "spring"):
            coeff = int(clamp(value, 0, 1) * 32767)
            e.condition.right_coeff[0] = e.condition.left_coeff[0] = coeff
        else:
            mag, period = value
            e.periodic.magnitude = int(clamp(mag, 0, 1) * 32767)
            e.periodic.period = int(period)
        self.sdl2.SDL_HapticUpdateEffect(self.h, self.ids[kind], ctypes.byref(e))

    def apply(self, c, d, s, r, hz):
        self._update("constant", round(c, 3))
        self._update("damper", round(d, 3))
        self._update("spring", round(s, 3))
        period = 1000 / hz if hz > 0 else 50
        self._update("sine", (round(r, 3), round(period)))

    def close(self):
        try:
            self.apply(0, 0, 0, 0, 0)
            self.sdl2.SDL_HapticStopAll(self.h)
            self.sdl2.SDL_HapticClose(self.h)
        finally:
            self.sdl2.SDL_JoystickClose(self.js)


class Bridge:
    def __init__(self, args):
        self.args = args
        self.sdl2 = None
        self.dev = None
        self.devices = []
        self.error = None
        self.target = dict(c=0.0, d=0.0, s=0.0, r=0.0, hz=0)
        self.out = 0.0
        self.last_msg = 0.0
        self.test_until = 0.0
        self.test = None
        self.clients = set()
        self.input_clients = set()
        self.joysticks = {}  # instance id -> (handle, name)
        self.last_input = 0.0
        self.last_payload = None
        if args.mock:
            self.dev = MockHaptic()
            self.devices = [{"index": 0, "name": self.dev.name, "haptic": True, "features": self.dev.features}]
        else:
            import sdl2  # pysdl2
            self.sdl2 = sdl2
            sdl2.SDL_SetHint(b"SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS", b"1")
            if sdl2.SDL_Init(sdl2.SDL_INIT_JOYSTICK | sdl2.SDL_INIT_HAPTIC) != 0:
                raise RuntimeError(sdl2.SDL_GetError().decode())
            self.scan()
            self.open_all()
            if not args.no_ffb:
                self.select(args.device)

    def scan(self):
        if not self.sdl2:
            return self.devices
        s = self.sdl2
        s.SDL_JoystickUpdate()
        out = []
        for i in range(s.SDL_NumJoysticks()):
            name = (s.SDL_JoystickNameForIndex(i) or b"?").decode(errors="replace")
            js = s.SDL_JoystickOpen(i)
            haptic = bool(js and s.SDL_JoystickIsHaptic(js) == 1)
            if js:
                s.SDL_JoystickClose(js)
            out.append({"index": i, "name": name, "haptic": haptic, "features": []})
        self.devices = out
        return out

    def select(self, want=None):
        if self.args.mock or self.args.no_ffb:
            return
        if self.dev:
            self.dev.close()
            self.dev = None
        self.scan()
        cands = [d for d in self.devices if d["haptic"]]
        pick = None
        if want:
            pick = next((d for d in cands if d["name"] == want), None) or \
                next((d for d in cands if want.lower() in d["name"].lower()), None)
        if not pick:
            pick = next((d for d in cands if any(h in d["name"].lower() for h in WHEEL_HINTS)), None) or (cands[0] if cands else None)
        if not pick:
            self.error = "FFB 対応のデバイスが見つかりません（ハンコンの接続とドライバーを確認してください）"
            print("  ! " + self.error)
            return
        try:
            self.dev = SDLHaptic(self.sdl2, pick["index"])
            pick["features"] = self.dev.features
            self.error = None
            print(f"  FFB デバイス: {self.dev.name}  対応: {', '.join(self.dev.features)}")
        except RuntimeError as e:
            self.error = str(e)
            print("  ! " + self.error)

    def open_all(self):
        """入力の中継用に、すべてのジョイスティックを開いておく"""
        if not self.sdl2:
            return
        s = self.sdl2
        for i in range(s.SDL_NumJoysticks()):
            js = s.SDL_JoystickOpen(i)
            if not js:
                continue
            jid = s.SDL_JoystickInstanceID(js)
            if jid in self.joysticks:
                continue
            name = (s.SDL_JoystickName(js) or b"?").decode(errors="replace")
            self.joysticks[jid] = (js, name)

    def poll_events(self):
        """デバイスの抜き差しを処理する"""
        if not self.sdl2:
            return False
        s = self.sdl2
        ev = s.SDL_Event()
        changed = False
        while s.SDL_PollEvent(ctypes.byref(ev)):
            if ev.type == s.SDL_JOYDEVICEADDED:
                changed = True
            elif ev.type == s.SDL_JOYDEVICEREMOVED:
                jid = ev.jdevice.which
                if jid in self.joysticks:
                    s.SDL_JoystickClose(self.joysticks.pop(jid)[0])
                changed = True
        if changed:
            self.open_all()
            self.scan()
        return changed

    def read_inputs(self):
        s = self.sdl2
        pads = []
        for jid, (js, name) in sorted(self.joysticks.items()):
            axes = [round(s.SDL_JoystickGetAxis(js, a) / 32767, 4) for a in range(s.SDL_JoystickNumAxes(js))]
            buttons = [s.SDL_JoystickGetButton(js, b) for b in range(s.SDL_JoystickNumButtons(js))]
            # ハット（十字キー）は 4 つのボタンとして扱う
            for h in range(s.SDL_JoystickNumHats(js)):
                v = s.SDL_JoystickGetHat(js, h)
                buttons += [int(bool(v & 1)), int(bool(v & 2)), int(bool(v & 4)), int(bool(v & 8))]
            pads.append({"id": name, "index": jid, "axes": axes, "buttons": buttons})
        return pads

    async def send_inputs(self):
        if not self.input_clients or not self.sdl2:
            return
        now = time.monotonic()
        if now - self.last_input < INPUT_INTERVAL:
            return
        self.last_input = now
        self.sdl2.SDL_JoystickUpdate()
        payload = json.dumps({"t": "input", "pads": self.read_inputs()})
        # 変化がなければ 0.5 秒に 1 回だけ送る
        if payload == self.last_payload and now - getattr(self, "last_full", 0) < 0.5:
            return
        self.last_payload = payload
        self.last_full = now
        for ws in list(self.input_clients):
            try:
                await ws.send(payload)
            except Exception:
                self.input_clients.discard(ws)

    def status(self):
        return json.dumps({"t": "status", "devices": self.devices,
                           "selected": self.dev.name if self.dev else None, "error": self.error})

    async def broadcast(self):
        msg = self.status()
        for ws in list(self.clients):
            try:
                await ws.send(msg)
            except Exception:
                pass

    async def handler(self, ws):
        self.clients.add(ws)
        print(f"  ゲームが接続しました ({len(self.clients)})")
        try:
            await ws.send(self.status())
            async for raw in ws:
                try:
                    m = json.loads(raw)
                except ValueError:
                    continue
                t = m.get("t")
                if t == "ffb":
                    self.last_msg = time.monotonic()
                    self.target = dict(
                        c=clamp(float(m.get("c", 0)), -1, 1), d=clamp(float(m.get("d", 0)), 0, 1),
                        s=clamp(float(m.get("s", 0)), 0, 1), r=clamp(float(m.get("r", 0)), 0, 1),
                        hz=clamp(int(m.get("hz", 0)), 0, 200))
                elif t == "stop":
                    self.last_msg = 0
                elif t == "test":
                    self.test = m.get("effect")
                    self.test_gain = clamp(float(m.get("gain", 0.5)), 0, 1)
                    self.test_until = time.monotonic() + 1.0
                elif t == "select":
                    self.select(m.get("device"))
                    await self.broadcast()
                elif t in ("hello", "scan"):
                    if m.get("input"):
                        self.input_clients.add(ws)
                    self.scan()
                    await ws.send(self.status())
        except ConnectionClosed:
            pass  # ブラウザを閉じたときなど
        finally:
            self.clients.discard(ws)
            self.input_clients.discard(ws)
            print(f"  ゲームが切断しました ({len(self.clients)})")

    def tick(self):
        if not self.dev:
            return
        now = time.monotonic()
        mx = self.args.max
        if now < self.test_until and self.test:
            g = self.test_gain * mx
            phase = (self.test_until - now)
            c = d = r = s = 0.0
            hz = 0
            if self.test == "left":
                c = -0.5 * g
            elif self.test == "right":
                c = 0.5 * g
            elif self.test == "rumble":
                r, hz = 0.6 * g, 25
            elif self.test == "center":
                s = 0.8 * g
            target = dict(c=c, d=d, s=s, r=r, hz=hz)
            _ = phase
        elif now - self.last_msg < WATCHDOG:
            target = self.target
        else:
            target = dict(c=0.0, d=0.0, s=0.0, r=0.0, hz=0)
        # 急変を抑える（1 秒で最大 slew 分だけ変化）
        want = clamp(target["c"], -1, 1) * mx
        step = self.args.slew * TICK
        self.out += clamp(want - self.out, -step, step)
        self.dev.apply(self.out, target["d"] * mx, target["s"] * mx, target["r"] * mx, target["hz"])

    async def ticker(self):
        while True:
            if self.poll_events():
                await self.broadcast()
            self.tick()
            await self.send_inputs()
            await asyncio.sleep(TICK)

    def close(self):
        if self.dev:
            self.dev.close()
        for js, _ in self.joysticks.values():
            self.sdl2.SDL_JoystickClose(js)
        if self.sdl2:
            self.sdl2.SDL_Quit()


async def main_async(args):
    from websockets.asyncio.server import serve

    bridge = Bridge(args)
    origins = DEFAULT_ORIGINS + extra_origins() + args.allow_origin
    print(f"デバイスブリッジ起動: ws://127.0.0.1:{args.port}  (FFB 最大出力 {args.max:.0%})")
    for jid, (_, name) in sorted(bridge.joysticks.items()):
        print(f"  入力デバイス: {name}")
    print("  接続を許可するゲームの URL: " + ", ".join(origins))
    try:
        async with serve(bridge.handler, "127.0.0.1", args.port, origins=origins):
            await bridge.ticker()
    finally:
        bridge.close()


def main():
    # Windows のコンソールでも日本語が化けないように
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description="TURBO KART VR FFB bridge")
    p.add_argument("--port", type=int, default=18765)
    p.add_argument("--max", type=float, default=0.8, help="最大出力 0..1（既定 0.8）")
    p.add_argument("--slew", type=float, default=12.0, help="力の変化の速さの上限（1 秒あたり）")
    p.add_argument("--device", help="使うデバイス名（部分一致）")
    p.add_argument("--allow-origin", action="append", default=[], help="接続を許可するゲームの URL（例 https://example.com）")
    p.add_argument("--mock", action="store_true", help="ハンコン無しで動作確認")
    p.add_argument("--no-ffb", action="store_true", help="FFB を出さず入力の中継だけ行う")
    p.add_argument("--list", action="store_true", help="デバイス一覧を表示して終了")
    args = p.parse_args()
    args.max = clamp(args.max, 0.05, 1.0)
    if args.list:
        import sdl2
        sdl2.SDL_Init(sdl2.SDL_INIT_JOYSTICK | sdl2.SDL_INIT_HAPTIC)
        b = Bridge.__new__(Bridge)
        b.sdl2 = sdl2
        for d in Bridge.scan(b):
            print(f"  [{d['index']}] {d['name']}  FFB={'あり' if d['haptic'] else 'なし'}")
        if not b.devices:
            print("  デバイスが見つかりません")
        sdl2.SDL_Quit()
        return
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("終了します")


if __name__ == "__main__":
    sys.exit(main())
