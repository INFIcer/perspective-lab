/* 把 index.html / css / js 打包成一个可双击打开的独立 HTML 文件 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const htmlPath = path.join(ROOT, 'index.html');
const cssPath = path.join(ROOT, 'css', 'style.css');
const jsDir = path.join(ROOT, 'js');
const outPath = path.join(ROOT, 'perspective-lab.html');

let html = readFileSync(htmlPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

html = html.replace(
  '<link rel="stylesheet" href="css/style.css">',
  '<style>\n' + css + '\n</style>'
);

for (const name of ['core', 'scene', 'render', 'app']) {
  const js = readFileSync(path.join(jsDir, name + '.js'), 'utf8');
  const tag = '<script src="js/' + name + '.js"></script>';
  if (!html.includes(tag)) throw new Error('script tag not found: ' + tag);
  html = html.replace(tag, '<script>\n/* ---- ' + name + '.js ---- */\n' + js + '\n</script>');
}

if (html.includes('href="css/') || html.includes('src="js/')) {
  throw new Error('standalone build still references external assets');
}

writeFileSync(outPath, html, 'utf8');
console.log('wrote', outPath, (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
