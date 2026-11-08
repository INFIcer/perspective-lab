/* 交互 / 状态自动化验收 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
const CHROME = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Bin\\chrome.exe';
const PORT = 9334;
const URL = 'file:///D:/dsh_ws/perspective-lab/index.html';
const VIEWPORT = { width: 1600, height: 1000 };

mkdirSync(SHOTS, { recursive: true });
try { rmSync(path.join(ROOT, '.chrome-verify'), { recursive: true, force: true }); } catch { /* ignore */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

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
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
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
  on(method, fn) { (this.listeners.get(method) || this.listeners.set(method, []).get(method)).push(fn); }
}

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('devtools endpoint not reachable');
}

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-crash-reporter', '--disable-breakpad', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=' + VIEWPORT.width + ',' + VIEWPORT.height,
  '--user-data-dir=' + path.join(ROOT, '.chrome-verify'),
  '--remote-debugging-port=' + PORT,
  'about:blank'
], { stdio: 'ignore' });

let cdp;
const logs = [];

async function connect() {
  const list = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  cdp = new CDP(ws);
  cdp.on('Runtime.consoleAPICalled', (p) => logs.push(p.args.map((a) => a.value ?? a.description).join(' ')));
  cdp.on('Runtime.exceptionThrown', (p) => logs.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false });
}

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}
async function waitReady() {
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!!window.__PLAB_READY__')) return;
    await sleep(120);
  }
  throw new Error('not ready');
}
async function shot(name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(res.data, 'base64'));
  console.log('shot', name);
}
async function moveMouse(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
}
async function mouseDown(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
}
async function mouseUp(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
async function drag(x0, y0, x1, y1, steps = 14) {
  await moveMouse(x0, y0);
  await mouseDown(x0, y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await moveMouse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    await sleep(16);
  }
  await mouseUp(x1, y1);
}
async function dragRight(x0, y0, x1, y1, steps = 14) {
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
async function press(key, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
  });
  await sleep(120);
}

const getInfo = () => evaluate(`(() => {
  const A = window.__PLAB__, v = A.view, c = A.camera, d = A.cameraDesired;
  return {
    type: v.vps.type, finite: v.vps.finiteCount,
    vps: v.vps.axes.map(a => ({ inf: a.infinite, onScreen: a.onScreen, dist: Math.round(a.dist) })),
    lines: v.lines.length,
    cubePos: A.cube.position.map(n => +n.toFixed(3)),
    quat: A.cube.quat.map(n => +n.toFixed(3)),
    mode: A.state.mode,
    space: A.state.space,
    cubeCount: A.cubes.length,
    selectedIndex: A.selectedIndex,
    cubePositions: A.cubes.map(c => c.position.map(n => +n.toFixed(3))),
    cubeListCount: document.querySelectorAll('#cubeList .cube-chip').length,
    safeLeft: A.safeRect.left,
    show: A.state.show,
    opaque: A.state.show.opaque,
    cubeViewCount: v.cubeViews ? v.cubeViews.length : 0,
    annotationLines: A.state.show.otherLines
      ? (v.cubeViews || []).reduce((n, cv) => n + cv.lines.length, 0)
      : v.lines.length,
    planeCount: v.gizmo.filter(g => g.mode === 'move-plane').length,
    hasViewRotate: v.gizmo.some(g => g.mode === 'rotate-view'),
    viewRotateRadius: (v.gizmo.find(g => g.mode === 'rotate-view') || {}).radius || 0,
    gizmoCount: v.gizmo.length,
    renderLineSets: A.renderer && A.renderer.lastStats ? A.renderer.lastStats.lineSets : -1,
    renderVpMarkers: A.renderer && A.renderer.lastStats ? A.renderer.lastStats.vpMarkers : -1,
    spin: A.state.spin,
    cam: { target: c.target.map(n => +n.toFixed(3)), yaw: +c.yaw.toFixed(3), pitch: +c.pitch.toFixed(3), distance: +c.distance.toFixed(3), fov: +(c.fov * 180 / Math.PI).toFixed(1) },
    desired: { target: d.target.map(n => +n.toFixed(3)), distance: +d.distance.toFixed(3), fov: +(d.fov * 180 / Math.PI).toFixed(1) },
    degenerate: v.gizmo.filter(g => g.mode === 'move' && g.degenerate).map(g => ({ axis: g.axis, x: g.ox, y: g.oy })),
    axisDirs: v.gizmo.filter(g => g.mode === 'move' || g.mode === 'rotate')
      .map(g => g.axisDir ? g.axisDir.map(n => +n.toFixed(4)) : null),
    gizmoMove: v.gizmo.filter(g => g.mode === 'move' && !g.degenerate).map(g => ({ axis: g.axis, ox: g.ox, oy: g.oy, tx: g.tx, ty: g.ty }))
  };
})()`);

async function main() {
  await connect();
  await cdp.send('Page.navigate', { url: URL });
  await waitReady();
  await sleep(1000);

  let info = await getInfo();
  check('默认视图为两点透视', info.type === 'two', info.type);
  check('默认存在屏内消失点', info.vps.some((v) => !v.inf && v.onScreen), info.vps);
  check('默认视场角为 90°', Math.abs(info.cam.fov - 90) < 0.2, info.cam.fov);
  check('默认立方体与世界轴对齐', info.quat.every((v, i) => Math.abs(v - [0, 0, 0, 1][i]) < 0.001), info.quat);
  check('默认使用本地坐标系', info.space === 'local', info.space);
  check('默认立方体不透明', info.opaque === true, info.opaque);
  check('默认无控制台报错', logs.length === 0, logs);
  await shot('20-default-new');

  /* ---------------- 界面整理：提示条右下、面板折叠 ---------------- */
  const layoutInfo = await evaluate(`(() => {
    const bar = document.getElementById('hintbar');
    const cs = getComputedStyle(bar);
    return {
      cornerNote: !!document.querySelector('.corner-note'),
      right: cs.right,
      bottom: cs.bottom,
      hintbarVisible: cs.display !== 'none'
    };
  })()`);
  check('左下角操作说明已移除', layoutInfo.cornerNote === false, layoutInfo.cornerNote);
  check('操作说明锚定界面右下角', layoutInfo.right === '24px' && layoutInfo.bottom === '22px', layoutInfo);

  await evaluate("document.getElementById('collapseLeft').click()");
  await sleep(500);
  const collapsed = await evaluate(`(() => {
    const p = document.getElementById('panelLeft');
    const t = document.getElementById('tabLeft');
    return { panel: p.classList.contains('is-collapsed'), tab: t.classList.contains('is-visible'), safe: window.__PLAB__.safeRect.left };
  })()`);
  check('左侧面板可折叠', collapsed.panel === true, collapsed);
  check('折叠后出现展开标签并扩大绘图区', collapsed.tab === true && collapsed.safe <= 30, collapsed);
  await shot('29-panel-collapsed');
  await evaluate("document.getElementById('tabLeft').click()");
  await sleep(500);
  const expanded = await evaluate(`(() => ({
    panel: document.getElementById('panelLeft').classList.contains('is-collapsed'),
    tab: document.getElementById('tabLeft').classList.contains('is-visible'),
    safe: window.__PLAB__.safeRect.left
  }))()`);
  check('左侧面板可恢复展开', expanded.panel === false && expanded.tab === false && expanded.safe > 250, expanded);

  await evaluate("document.getElementById('collapseRight').click()");
  await sleep(500);
  const collapsedR = await evaluate("document.getElementById('panelRight').classList.contains('is-collapsed')");
  check('右侧面板可折叠', collapsedR === true, collapsedR);
  await evaluate("document.getElementById('tabRight').click()");
  await sleep(500);

  /* ---------------- 平面移动 / 自由旋转 / 无操作 ---------------- */
  info = await getInfo();
  check('移动模式包含三个平面移动手柄', info.planeCount === 3, info.planeCount);
  const plane = await evaluate(`(() => {
    const A = window.__PLAB__;
    const g = A.view.gizmo.find(h => h.mode === 'move-plane' && h.plane[0] === 0 && h.plane[1] === 1);
    if (!g) return null;
    const cx = (g.points[0].x + g.points[1].x + g.points[2].x + g.points[3].x) / 4;
    const cy = (g.points[0].y + g.points[1].y + g.points[2].y + g.points[3].y) / 4;
    return { cx, cy, n: g.n };
  })()`);
  if (plane) {
    await drag(plane.cx, plane.cy, plane.cx + 42, plane.cy + 26);
    await sleep(350);
    info = await getInfo();
    const disp = [info.cubePos[0], info.cubePos[1] - 0.9, info.cubePos[2]];
    const normalMove = Math.abs(disp[0] * plane.n[0] + disp[1] * plane.n[1] + disp[2] * plane.n[2]);
    const len = Math.hypot(disp[0], disp[1], disp[2]);
    check('平面手柄可进行二维移动', len > 0.1 && normalMove < 0.06, { disp, normalMove, len });
    await shot('31-plane-move');
  } else {
    check('平面手柄可进行二维移动', false, 'plane handle not found');
  }
  await evaluate("window.__PLAB__.resetCube()");
  await sleep(900);

  await evaluate("window.__PLAB__.setMode('rotate')");
  await sleep(250);
  info = await getInfo();
  check('旋转模式包含最外层白色自由旋转环', info.hasViewRotate === true && info.viewRotateRadius > 40, info);
  const disc = await evaluate(`(() => {
    const g = window.__PLAB__.view.gizmo.find(h => h.mode === 'rotate-view');
    return g ? { x: g.ox + g.radius, y: g.oy, radius: g.radius } : null;
  })()`);
  const beforeViewRot = info.quat;
  if (disc) {
    await drag(disc.x, disc.y, disc.x + 65, disc.y);
    await sleep(350);
    info = await getInfo();
    check('外环可进行视角二维旋转', info.quat.some((v, i) => Math.abs(v - beforeViewRot[i]) > 0.01), { before: beforeViewRot, after: info.quat });
    const localX = await evaluate(`(() => window.PL.qRotate(window.__PLAB__.cube.quat, [1,0,0]).map(n => +n.toFixed(4)))()`);
    check('水平拖动旋转方向正确', localX[2] < -0.01, localX);
    await shot('32-view-rotate');
  } else {
    check('外环可进行视角二维旋转', false, 'rotate-view handle not found');
  }
  await evaluate("window.__PLAB__.resetCube()");
  await sleep(900);

  await press('h', 'KeyH', 72);
  await sleep(250);
  info = await getInfo();
  check('无操作模式隐藏所有控制柄', info.mode === 'none' && info.gizmoCount === 0, { mode: info.mode, gizmo: info.gizmoCount });
  await shot('33-no-handles');
  await press('g', 'KeyG', 71);
  await sleep(250);

  /* 其他立方体标注的两个独立开关 */
  await evaluate("window.__PLAB__.addCube()");
  await sleep(600);
  await evaluate(`window.__PLAB__.setCube(
    window.__PLAB__.cubes[window.__PLAB__.selectedIndex].position,
    window.PL.qFromAxisAngle([0,1,0], 25 * Math.PI / 180)
  ); window.__PLAB__.selectCube(0)`);
  await sleep(700);
  info = await getInfo();
  check('多立方体场景包含多组标注数据', info.cubeViewCount === 2, info.cubeViewCount);
  check('其他立方体消失线已实际绘制', info.renderLineSets === 2, { lineSets: info.renderLineSets });
  const annotationsOn = info.annotationLines;
  const vpMarkersOn = info.renderVpMarkers;
  check('其他立方体消失点已实际绘制', vpMarkersOn > 0, { markers: vpMarkersOn });
  await evaluate("document.getElementById('tgOtherLines').click()");
  await sleep(250);
  info = await getInfo();
  check('可单独关闭其他立方体消失线',
    info.show.otherLines === false && info.show.otherPoints === true &&
    info.renderLineSets === 1 && info.annotationLines < annotationsOn,
    { lineSets: info.renderLineSets, on: annotationsOn, off: info.annotationLines, show: info.show });
  await evaluate("document.getElementById('tgOtherLines').click()");
  await sleep(250);
  await evaluate("document.getElementById('tgOtherPoints').click()");
  await sleep(250);
  info = await getInfo();
  check('可单独关闭其他立方体消失点',
    info.show.otherPoints === false && info.show.otherLines === true &&
    info.renderVpMarkers < vpMarkersOn && info.renderLineSets === 2,
    { markers: info.renderVpMarkers, on: vpMarkersOn, lineSets: info.renderLineSets, show: info.show });
  await evaluate("document.getElementById('tgOtherPoints').click()");
  await sleep(250);
  info = await getInfo();
  check('两个其他立方体标注开关可恢复',
    info.show.otherLines === true && info.show.otherPoints === true &&
    info.annotationLines === annotationsOn && info.renderVpMarkers === vpMarkersOn,
    info.annotationLines);
  await evaluate("document.getElementById('btnDeleteCube').click()");
  await sleep(500);
  await evaluate("window.__PLAB__.resetCube(); window.__PLAB__.resetView()");
  await sleep(900);

  /* ---------------- 全局 / 本地坐标系 ---------------- */
  /* 先把立方体旋转，使本地轴与世界轴不同 */
  await evaluate(`window.__PLAB__.setCube([0, 0.9, 0], window.PL.qMul(
    window.PL.qFromAxisAngle([0, 1, 0], 35 * Math.PI / 180),
    window.PL.qFromAxisAngle([1, 0, 0], 12 * Math.PI / 180)
  ))`);
  await sleep(250);
  const localAxes = await evaluate(`(() => {
    const q = window.__PLAB__.cube.quat;
    return [0,1,2].map(i => {
      const e = [0,0,0]; e[i] = 1;
      return window.PL.qRotate(q, e).map(n => +n.toFixed(4));
    });
  })()`);
  info = await getInfo();
  check('本地坐标系下手柄轴向 = 立方体本地轴',
    info.axisDirs.every((d, i) => d && d.every((v, j) => Math.abs(v - localAxes[i][j]) < 0.01)),
    { axisDirs: info.axisDirs, localAxes });

  const hx = info.gizmoMove.find((g) => g.axis === 0);
  const len = Math.hypot(hx.tx - hx.ox, hx.ty - hx.oy);
  const ux = (hx.tx - hx.ox) / len, uy = (hx.ty - hx.oy) / len;
  const sx = hx.ox + ux * 18, sy = hx.oy + uy * 18;
  await drag(sx, sy, sx + ux * 70, sy + uy * 70);
  await sleep(350);
  info = await getInfo();
  const disp = [info.cubePos[0], info.cubePos[1] - 0.9, info.cubePos[2]];
  const dl = Math.hypot(disp[0], disp[1], disp[2]);
  const align = dl > 0.05 ? Math.abs((disp[0] * localAxes[0][0] + disp[1] * localAxes[0][1] + disp[2] * localAxes[0][2]) / dl) : 0;
  check('本地坐标系下沿 X 轴移动', dl > 0.15 && align > 0.95, { cubePos: info.cubePos, dl, align });
  await shot('26-local-move');

  await evaluate("document.getElementById('btnResetCube').click()");
  await sleep(1000);
  await evaluate(`window.__PLAB__.setCube([0, 0.9, 0], window.PL.qMul(
    window.PL.qFromAxisAngle([0, 1, 0], 35 * Math.PI / 180),
    window.PL.qFromAxisAngle([1, 0, 0], 10 * Math.PI / 180)
  ))`);
  await sleep(250);
  await press('r', 'KeyR', 82);
  await sleep(250);
  info = await getInfo();
  const localAxes2 = await evaluate(`(() => {
    const q = window.__PLAB__.cube.quat;
    return [0,1,2].map(i => {
      const e = [0,0,0]; e[i] = 1;
      return window.PL.qRotate(q, e).map(n => +n.toFixed(4));
    });
  })()`);
  check('本地坐标系下旋转环轴向 = 立方体本地轴',
    info.axisDirs.every((d, i) => d && d.every((v, j) => Math.abs(v - localAxes2[i][j]) < 0.01)),
    { axisDirs: info.axisDirs, localAxes2 });
  await shot('27-local-rotate');

  /* 拖动本地 Y 轴旋转环：本地 Y 轴在世界中的方向应保持不变 */
  const ringPt = await evaluate(`(() => {
    const g = window.__PLAB__.view.gizmo.find(h => h.mode === 'rotate' && h.axis === 1);
    const p = g.points[16], q = g.points[20];
    return { x: p.x, y: p.y, tx: q.x - p.x, ty: q.y - p.y };
  })()`);
  const tlen = Math.hypot(ringPt.tx, ringPt.ty) || 1;
  const beforeRotate = await evaluate(`(() => {
    const q = window.__PLAB__.cube.quat;
    return { quat: q, localY: window.PL.qRotate(q, [0,1,0]).map(n => +n.toFixed(4)) };
  })()`);
  await drag(ringPt.x, ringPt.y, ringPt.x + ringPt.tx / tlen * 55, ringPt.y + ringPt.ty / tlen * 55);
  await sleep(300);
  const after = await evaluate(`(() => {
    const q = window.__PLAB__.cube.quat;
    return { quat: q, localY: window.PL.qRotate(q, [0,1,0]).map(n => +n.toFixed(4)) };
  })()`);
  check('拖动本地旋转环改变立方体姿态', after.quat.some((v, i) => Math.abs(v - beforeRotate.quat[i]) > 0.01), { before: beforeRotate.quat, after: after.quat });
  const yDot = after.localY[0] * beforeRotate.localY[0] + after.localY[1] * beforeRotate.localY[1] + after.localY[2] * beforeRotate.localY[2];
  check('绕本地 Y 轴旋转后本地 Y 方向保持不变', yDot > 0.999, { before: beforeRotate.localY, after: after.localY, yDot });

  /* 全局 / 本地按钮与快捷键 */
  await evaluate("document.querySelector('#spaceSeg [data-space=\"global\"]').click()");
  await sleep(250);
  info = await getInfo();
  const worldAxes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  check('点击切到全局坐标系', info.space === 'global', info.space);
  check('全局坐标系下手柄轴为世界轴',
    info.axisDirs.every((d, i) => d && d.every((v, j) => Math.abs(v - worldAxes[i][j]) < 0.01)),
    info.axisDirs);

  await press('l', 'KeyL', 76);
  await sleep(250);
  info = await getInfo();
  const localAxes3 = await evaluate(`(() => {
    const q = window.__PLAB__.cube.quat;
    return [0,1,2].map(i => {
      const e = [0,0,0]; e[i] = 1;
      return window.PL.qRotate(q, e).map(n => +n.toFixed(4));
    });
  })()`);
  check('按 L 切回本地坐标系', info.space === 'local', info.space);
  check('切回本地后手柄轴重新贴合立方体轴',
    info.axisDirs.every((d, i) => d && d.every((v, j) => Math.abs(v - localAxes3[i][j]) < 0.01)),
    { axisDirs: info.axisDirs, localAxes3 });

  await press('g', 'KeyG', 71);
  await evaluate("document.getElementById('btnResetCube').click()");
  await sleep(950);

  /* 预设只改变摄像机，且以立方体当前位置为中心 */
  await evaluate(`window.__PLAB__.setCube([1.1, 0.9, -0.5],
    window.PL.qFromAxisAngle([0, 1, 0], 20 * Math.PI / 180))`);
  await sleep(200);
  const beforePreset = await getInfo();
  await evaluate("document.querySelector('#presetGrid [data-preset=\"two\"]').click()");
  await sleep(1500);
  info = await getInfo();
  check('预设不修改立方体位置',
    info.cubePos.every((v, i) => Math.abs(v - beforePreset.cubePos[i]) < 0.001), { before: beforePreset.cubePos, after: info.cubePos });
  check('预设不修改立方体姿态',
    info.quat.every((v, i) => Math.abs(v - beforePreset.quat[i]) < 0.001), { before: beforePreset.quat, after: info.quat });
  check('预设以立方体当前位置为观察目标',
    info.cam.target.every((v, i) => Math.abs(v - info.cubePos[i]) < 0.05), { target: info.cam.target, cube: info.cubePos });
  check('预设不修改视场角', Math.abs(info.cam.fov - beforePreset.cam.fov) < 0.2, { before: beforePreset.cam.fov, after: info.cam.fov });
  check('相对预设视角类型正确', info.type === 'two', info.type);
  await shot('28-preset-relative');

  await evaluate("document.getElementById('btnResetCube').click()");
  await sleep(800);
  await evaluate("document.getElementById('btnResetView').click()");
  await sleep(900);

  /* 键盘切预设 */
  await press('1', 'Digit1', 49);
  await sleep(1400);
  info = await getInfo();
  check('按 1 切换到一点透视', info.type === 'one', info.type);
  check('一点透视 Z 轴退化为中心深度手柄', info.degenerate.length === 1 && info.degenerate[0].axis === 2, info.degenerate);
  await shot('21-one-point-new');

  /* 拖动深度手柄 */
  const dh = info.degenerate[0];
  await drag(dh.x, dh.y, dh.x, dh.y - 70);
  await sleep(300);
  info = await getInfo();
  check('拖动深度手柄改变 Z 位置', Math.abs(info.cubePos[2]) > 0.15, info.cubePos);
  await shot('22-depth-drag');

  /* 立方体复位按钮 */
  await evaluate("document.getElementById('btnResetCube').click()");
  await sleep(1000);
  info = await getInfo();
  check('复位立方体回到初始位置', info.cubePos.every((v, i) => Math.abs(v - [0, 0.9, 0][i]) < 0.02), info.cubePos);

  /* 键盘模式切换 */
  await press('r', 'KeyR', 82);
  info = await getInfo();
  check('按 R 切换旋转模式', info.mode === 'rotate', info.mode);
  await press('g', 'KeyG', 71);
  info = await getInfo();
  check('按 G 切换移动模式', info.mode === 'move', info.mode);

  /* 滚轮缩放 */
  const before = await getInfo();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 500, deltaX: 0, deltaY: -320 });
  await sleep(500);
  info = await getInfo();
  check('滚轮缩小镜头距离', info.desired.distance < before.desired.distance - 0.2, { before: before.desired.distance, after: info.desired.distance });

  /* FOV 滑杆 */
  await evaluate(`(() => { const el = document.getElementById('fovRange'); el.value = '70'; el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(600);
  info = await getInfo();
  check('视场角滑杆生效', Math.abs(info.desired.fov - 70) < 0.6, info.desired.fov);
  await shot('23-fov');

  /* 显示开关 */
  await evaluate("document.getElementById('tgLines').click()");
  info = await getInfo();
  check('消失线开关关闭', info.show.lines === false, info.show);
  await evaluate("document.getElementById('tgLines').click()");

  await evaluate("document.getElementById('tgOpaque').click()");
  await sleep(250);
  info = await getInfo();
  check('可切换为半透明玻璃立方体', info.opaque === false, info.opaque);
  await shot('34-glass');
  await evaluate("document.getElementById('tgOpaque').click()");
  await sleep(250);
  info = await getInfo();
  check('可恢复方块不透明', info.opaque === true, info.opaque);

  /* 自动旋转 */
  await evaluate("document.getElementById('tgSpin').click()");
  const q0 = (await getInfo()).quat;
  await sleep(700);
  const q1 = (await getInfo()).quat;
  check('自动旋转改变立方体朝向', q0.some((v, i) => Math.abs(v - q1[i]) > 0.002), { q0, q1 });
  await shot('24-spin');
  await evaluate("document.getElementById('tgSpin').click()");

  /* 聚焦 / 重置视角 */
  await evaluate("window.__PLAB__.setCamera({target:[0,0.9,0], yaw: -0.9, pitch: 0.5, distance: 12, fov: 0.9})");
  await evaluate("window.__PLAB__.setCube([2.2, 0.9, 0.4], window.PL.qIdentity())");
  await sleep(200);
  await evaluate("document.getElementById('btnFocus').click()");
  await sleep(1100);
  info = await getInfo();
  check('聚焦立方体使目标点接近立方体', Math.abs(info.cam.target[0] - 2.2) < 0.2 && Math.abs(info.cam.target[2] - 0.4) < 0.2, info.cam.target);

  await evaluate("document.getElementById('btnResetView').click()");
  await sleep(1100);
  info = await getInfo();
  check('重置视角回到默认参数',
    Math.abs(info.cam.yaw - 30 * Math.PI / 180) < 0.03 &&
    Math.abs(info.cam.distance - 4.5) < 0.15 &&
    Math.abs(info.cam.fov - 90) < 0.2, info.cam);
  check('重置视角仍以立方体为目标',
    Math.abs(info.cam.target[0] - 2.2) < 0.1 && Math.abs(info.cam.target[2] - 0.4) < 0.1, info.cam.target);

  /* 右键拖动旋转摄像机 */
  const yaw0 = info.cam.yaw;
  await dragRight(600, 700, 760, 660);
  await sleep(500);
  info = await getInfo();
  check('右键拖动旋转摄像机', Math.abs(info.cam.yaw - yaw0) > 0.05, { before: yaw0, after: info.cam.yaw });
  await shot('25-orbit-new');

  /* 左键拖动平移摄像机 */
  const t0 = info.cam.target.slice();
  await drag(420, 820, 520, 820);
  await sleep(400);
  info = await getInfo();
  check('左键拖动平移摄像机', Math.abs(info.cam.target[0] - t0[0]) > 0.05, { t0, now: info.cam.target });

  /* 自动旋转关闭状态 */
  check('自动旋转已关闭', info.spin === false, info.spin);

  /* ---------------- 多立方体 ---------------- */
  await evaluate("window.__PLAB__.setCube([0, 0.9, 0], window.PL.qIdentity()); window.__PLAB__.resetView()");
  await sleep(1100);
  const baseMulti = await getInfo();
  check('初始只有一个立方体', baseMulti.cubeCount === 1 && baseMulti.cubeListCount === 1, baseMulti);

  await evaluate("document.getElementById('btnAddCube').click()");
  await sleep(250);
  await evaluate("document.getElementById('btnAddCube').click()");
  await sleep(1100);
  info = await getInfo();
  check('可以添加多个立方体', info.cubeCount === 3 && info.cubeListCount === 3, info);
  check('新添加的立方体自动被选中', info.selectedIndex === 2, info.selectedIndex);
  check('添加立方体不移动已有立方体', info.cubePositions[0].every((v, i) => Math.abs(v - [0, 0.9, 0][i]) < 0.001), info.cubePositions);
  const centroid = [0, 1, 2].reduce((acc, i) => [acc[0] + info.cubePositions[i][0] / 3, acc[1] + info.cubePositions[i][1] / 3, acc[2] + info.cubePositions[i][2] / 3], [0, 0, 0]);
  check('多立方体自动纳入取景', Math.hypot(info.cam.target[0] - centroid[0], info.cam.target[1] - centroid[1], info.cam.target[2] - centroid[2]) < 0.25, { target: info.cam.target, centroid });
  await shot('30-multi-cubes');

  /* 列表选中 */
  await evaluate("document.querySelectorAll('#cubeList .cube-chip')[0].click()");
  await sleep(250);
  info = await getInfo();
  check('立方体列表可以切换选择', info.selectedIndex === 0, info.selectedIndex);
  check('切换选择后操作目标同步', Math.abs(info.cubePos[0] - info.cubePositions[0][0]) < 0.001, { cubePos: info.cubePos, list: info.cubePositions });

  /* 点击画布中的另一个立方体进行选择 */
  const cube2Pt = await evaluate(`(() => {
    const A = window.__PLAB__;
    const f = window.PL.makeFrame(A.camera, innerWidth, innerHeight);
    const p = f.project(A.cubes[1].position);
    return p ? { x: p.x, y: p.y } : null;
  })()`);
  if (cube2Pt) {
    await mouseDown(cube2Pt.x, cube2Pt.y);
    await mouseUp(cube2Pt.x, cube2Pt.y);
    await sleep(350);
    info = await getInfo();
    check('点击画布中的立方体可切换选择', info.selectedIndex === 1, { selected: info.selectedIndex, pt: cube2Pt });
  } else {
    check('点击画布中的立方体可切换选择', false, 'projection failed');
  }

  await evaluate("document.getElementById('btnDeleteCube').click()");
  await sleep(500);
  info = await getInfo();
  check('可以删除选中的立方体', info.cubeCount === 2 && info.cubeListCount === 2, info);
  await evaluate("document.getElementById('btnDeleteCube').click()");
  await sleep(500);
  info = await getInfo();
  const deleteDisabled = await evaluate("document.getElementById('btnDeleteCube').disabled");
  check('只剩一个立方体时删除按钮禁用', info.cubeCount === 1 && deleteDisabled === true, { count: info.cubeCount, deleteDisabled });
  await evaluate("window.__PLAB__.resetCube(); window.__PLAB__.resetView()");
  await sleep(900);

  const errors = logs.filter((m) => /EXCEPTION|error/i.test(m));
  check('无控制台异常', errors.length === 0, logs);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  console.error('VERIFY CRASH', e);
  process.exitCode = 1;
} finally {
  try { await cdp?.send('Browser.close'); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
}
