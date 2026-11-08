/* 单张截图：node tools/snap.mjs [输出名] [页面路径] [宽度] [高度] [执行表达式] */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
const CHROME = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Bin\\chrome.exe';
const PORT = 9335;
const name = process.argv[2] || 'snap';
const file = process.argv[3] || 'index.html';
const width = parseInt(process.argv[4] || '1600', 10);
const height = parseInt(process.argv[5] || '1000', 10);
const expr = process.argv[6] || '';

mkdirSync(SHOTS, { recursive: true });
try { rmSync(path.join(ROOT, '.chrome-snap'), { recursive: true, force: true }); } catch { /* ignore */ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-crash-reporter', '--disable-breakpad', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=' + width + ',' + height,
  '--user-data-dir=' + path.join(ROOT, '.chrome-snap'),
  '--remote-debugging-port=' + PORT, 'about:blank'
], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id; this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
const waitJson = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('devtools not ready');
};

let cdp;
try {
  const list = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await cdp.send('Page.navigate', { url: 'file:///D:/dsh_ws/perspective-lab/' + file });
  for (let i = 0; i < 80; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: '!!window.__PLAB_READY__', returnByValue: true });
    if (r.result.value) break;
    await sleep(150);
  }
  if (expr) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) console.error('EXPR ERROR', JSON.stringify(r.exceptionDetails));
    await sleep(700);
  }
  await sleep(1300);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const out = path.join(SHOTS, name + '.png');
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('wrote', out);
} catch (e) {
  console.error('SNAP FAILED', e);
  process.exitCode = 1;
} finally {
  try { await cdp?.send('Browser.close'); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
}
