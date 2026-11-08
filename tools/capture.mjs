/* 无头 Chrome 截图 / 交互自检（通过 CDP，无第三方依赖） */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
const CHROME = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Bin\\chrome.exe';
const PORT = 9333;
const URL = 'file:///D:/dsh_ws/perspective-lab/index.html';
const VIEWPORT = { width: 1600, height: 1000 };

mkdirSync(SHOTS, { recursive: true });
try { rmSync(path.join(ROOT, '.chrome-cdp'), { recursive: true, force: true }); } catch { /* ignore */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const list = this.listeners.get(msg.method);
        if (list) list.forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function waitForJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint not reachable: ' + url);
}

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=' + VIEWPORT.width + ',' + VIEWPORT.height,
  '--user-data-dir=' + path.join(ROOT, '.chrome-cdp'),
  '--remote-debugging-port=' + PORT,
  'about:blank'
], { stdio: 'ignore' });

let cdp;
let targetId;
const consoleMessages = [];

async function connect() {
  const list = await waitForJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  targetId = page.id;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  cdp = new CDP(ws);
  cdp.on('Runtime.consoleAPICalled', (p) => {
    consoleMessages.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    consoleMessages.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false
  });
}

async function evaluate(expression, awaitPromise = false) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise, userGesture: true
  });
  if (res.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  return res.result.value;
}

async function waitReady(timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await evaluate('!!window.__PLAB_READY__');
    if (ok) return;
    await sleep(120);
  }
  throw new Error('app did not become ready');
}

async function shot(name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(SHOTS, name + '.png');
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('shot', name, file);
}

async function moveMouse(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
}
async function mouseDown(x, y, button = 'left') {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4, clickCount: 1
  });
}
async function mouseUp(x, y, button = 'left') {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1
  });
}
async function drag(x0, y0, x1, y1, steps = 12) {
  await moveMouse(x0, y0);
  await mouseDown(x0, y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await moveMouse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    await sleep(16);
  }
  await mouseUp(x1, y1);
}
async function dragRight(x0, y0, x1, y1, steps = 12) {
  await moveMouse(x0, y0);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'right', buttons: 2, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'right', buttons: 2 });
    await sleep(16);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'right', buttons: 0, clickCount: 1 });
}

async function info(label) {
  const data = await evaluate(`(() => {
    const v = window.__PLAB__.view;
    const s = window.__PLAB__.state;
    return {
      type: v.vps.type,
      finite: v.vps.finiteCount,
      vps: v.vps.axes.map(a => ({ inf: a.infinite, x: Math.round(a.x), y: Math.round(a.y), dist: Math.round(a.dist), onScreen: a.onScreen })),
      lines: v.lines.length,
      gizmo: v.gizmo.map(g => ({ mode: g.mode, axis: g.axis, ox: Math.round(g.ox), oy: Math.round(g.oy), tx: Math.round(g.tx), ty: Math.round(g.ty) })),
      cube: window.__PLAB__.cube.position.map(n => +n.toFixed(2)),
      quat: window.__PLAB__.cube.quat.map(n => +n.toFixed(3)),
      mode: s.mode,
      fps: Math.round(s.fps)
    };
  })()`);
  console.log('INFO', label, JSON.stringify(data));
  return data;
}

async function main() {
  await connect();
  await cdp.send('Page.navigate', { url: URL });
  await waitReady(20000);
  await sleep(1200);

  await shot('01-default');
  await info('default');

  /* 一点透视 */
  await evaluate("window.__PLAB__.setPreset('one')");
  await sleep(1500);
  await shot('02-one-point');
  await info('one-point');

  /* 两点透视 */
  await evaluate("window.__PLAB__.setPreset('two')");
  await sleep(1500);
  await shot('03-two-point');
  await info('two-point');

  /* 三点透视 */
  await evaluate("window.__PLAB__.setPreset('three')");
  await sleep(1500);
  await shot('04-three-point');
  await info('three-point');

  /* 俯瞰 */
  await evaluate("window.__PLAB__.setPreset('aerial')");
  await sleep(1500);
  await shot('05-aerial');
  await info('aerial');

  /* 旋转模式 hover 环 */
  await evaluate("window.__PLAB__.setPreset('three'), window.__PLAB__.setMode('rotate')");
  await sleep(1500);
  const g = await evaluate("(() => { const g = window.__PLAB__.view.gizmo[0].points; const p = g[16]; return {x: p.x, y: p.y}; })()");
  await moveMouse(g.x, g.y);
  await sleep(350);
  await shot('06-rotate-hover');

  /* 拖动旋转环 */
  await drag(g.x, g.y, g.x + 90, g.y + 50);
  await sleep(400);
  await shot('07-rotate-dragged');
  await info('rotated');

  /* 移动模式拖动 Y 轴箭头 */
  await evaluate("window.__PLAB__.setMode('move')");
  await sleep(250);
  const tip = await evaluate("(() => { const g = window.__PLAB__.view.gizmo[1]; return {x: g.tx, y: g.ty}; })()");
  await moveMouse(tip.x, tip.y);
  await sleep(200);
  await shot('08-move-hover');
  await drag(tip.x, tip.y, tip.x, tip.y - 80);
  await sleep(500);
  await shot('09-moved');
  await info('moved');

  /* 键盘自由移动 + 右键环绕 */
  await evaluate("window.__PLAB__.resetCube()");
  await sleep(900);
  await dragRight(760, 620, 900, 560);
  await sleep(600);
  await shot('10-orbit');
  await info('orbit');

  /* 面板/悬停消失点行 */
  await evaluate("window.__PLAB__.setPreset('two')");
  await sleep(1400);
  const row = await evaluate("(() => { const r = document.querySelector('.vp-row[data-axis=\"0\"]').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()");
  await moveMouse(row.x, row.y);
  await sleep(400);
  await shot('11-vp-highlight');

  /* 多立方体 */
  await evaluate(`window.__PLAB__.setCube([0, 0.9, 0], window.PL.qIdentity()); window.__PLAB__.resetView();
    window.__PLAB__.addCube(); window.__PLAB__.addCube(); window.__PLAB__.addCube();
    window.__PLAB__.selectCube(3);
    window.__PLAB__.setCube(window.__PLAB__.cubes[3].position, window.PL.qFromAxisAngle([0, 1, 0], 22 * Math.PI / 180));
    window.__PLAB__.selectCube(0)`);
  await sleep(1400);
  await shot('19-multi-cubes');

  /* 折叠左右面板 */
  await evaluate("document.getElementById('collapseLeft').click(); document.getElementById('collapseRight').click()");
  await sleep(800);
  await shot('20-panels-collapsed');
  await evaluate("document.getElementById('tabLeft').click(); document.getElementById('tabRight').click()");
  await sleep(800);

  /* 清理多余立方体 */
  await evaluate(`(() => {
    const A = window.__PLAB__;
    while (A.cubes.length > 1) A.deleteCube();
    A.resetCube(); A.resetView();
  })()`);
  await sleep(1200);

  /* 本地坐标系 */
  await evaluate(`window.__PLAB__.setCube([0, 0.9, 0], window.PL.qMul(
    window.PL.qFromAxisAngle([0, 1, 0], 30 * Math.PI / 180),
    window.PL.qFromAxisAngle([1, 0, 0], -12 * Math.PI / 180)
  )); window.__PLAB__.setPreset('three'); window.__PLAB__.setSpace('local'); window.__PLAB__.setMode('move')`);
  await sleep(1500);
  await shot('17-local-space');
  await evaluate("window.__PLAB__.setMode('rotate')");
  await sleep(400);
  await shot('18-local-rotate');
  await evaluate("window.__PLAB__.setSpace('global'); window.__PLAB__.setMode('move')");
  await sleep(300);

  /* 小屏响应式检查（先回到默认状态） */
  await evaluate(`window.__PLAB__.setCube([0, 0.9, 0], window.PL.qIdentity());
    window.__PLAB__.setSpace('local'); window.__PLAB__.setMode('move'); window.__PLAB__.resetView()`);
  await sleep(1300);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await shot('12-1280');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await shot('13-1024');

  /* 手机竖屏 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(800);
  await shot('14-mobile');
  await evaluate("document.getElementById('panelToggle').click()");
  await sleep(700);
  await shot('16-mobile-panel');
  await evaluate("document.getElementById('panelToggle').click()");
  await sleep(500);
  await evaluate("window.__PLAB__.setPreset('three')");
  await sleep(1500);
  await shot('15-mobile-three');

  const errors = consoleMessages.filter((m) => /EXCEPTION|error/i.test(m));
  console.log('CONSOLE:', JSON.stringify(consoleMessages.slice(-12)));
  console.log('ERRORS:', errors.length);
  if (errors.length) process.exitCode = 1;
}

try {
  await main();
} catch (err) {
  console.error('CAPTURE FAILED:', err);
  process.exitCode = 1;
} finally {
  try { await cdp?.send('Browser.close'); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
  await sleep(400);
}
