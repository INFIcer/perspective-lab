/* Node 自测：投影 / 消失点 / 地平线 / 立方体可见性 */
'use strict';

const PL = require('../js/core.js');
require('../js/scene.js');
const S = globalThis.PLScene;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }
function nearV(a, b, eps = 1e-6) { return a.every((v, i) => Math.abs(v - b[i]) <= eps); }

const W = 1440, H = 900;
const DEG = PL.DEG;

/* ---------------- 摄像机 / 投影 ---------------- */
const cam = PL.makeCamera({ target: [0, 0.9, 0], yaw: 0, pitch: 0, distance: 8, fov: 46 * DEG });
const frame = PL.makeFrame(cam, W, H);
check('摄像机位置', nearV(frame.pos, [0, 0.9, 8], 1e-9), frame.pos);
check('forward', nearV(frame.forward, [0, 0, -1], 1e-9), frame.forward);
check('right', nearV(frame.right, [1, 0, 0], 1e-9), frame.right);
check('up', nearV(frame.up, [0, 1, 0], 1e-9), frame.up);

const center = frame.project([0, 0.9, 0]);
check('目标点投影在画面中心', center && near(center.x, W / 2, 1e-6) && near(center.y, H / 2, 1e-6), center);

const rightPt = frame.project([1, 0.9, 0]);
check('+X 点投影在右侧', rightPt && rightPt.x > W / 2 && near(rightPt.y, H / 2, 1e-6), rightPt);

const behind = frame.project([0, 0.9, 12]);
check('摄像机后方点不可见', behind === null, behind);

const vpForward = frame.projectDir([0, 0, -1]);
check('视线方向消失点居中', !vpForward.infinite && near(vpForward.x, W / 2, 1e-6) && near(vpForward.y, H / 2, 1e-6), vpForward);
const vpRight = frame.projectDir([1, 0, 0]);
check('平行画面方向 → 无穷远', vpRight.infinite, vpRight);
const vpBack = frame.projectDir([0, 0, 1]);
check('反方向具有同一投影位置', !vpBack.infinite && near(vpBack.x, W / 2, 1e-6), vpBack);

/* 地平线：俯仰为 0 时穿过画面中心；抬头/低头时位置正确 */
const horizon0 = frame.horizon();
check('水平视线地平线过中心', near(horizon0[0].y, H / 2, 1e-6), horizon0);
const camDown = PL.makeCamera({ target: [0, 0.9, 0], yaw: 0, pitch: 10 * DEG, distance: 8, fov: 46 * DEG });
const frameDown = PL.makeFrame(camDown, W, H);
const horizon1 = frameDown.horizon();
const expectY = H / 2 - frameDown.focal * Math.tan(10 * DEG);
check('俯视时地平线上移', near(horizon1[0].y, expectY, 1e-6), { got: horizon1[0].y, expectY });
check('俯视地平线水平', near(horizon1[0].y, horizon1[1].y, 1e-9));

/* 射线反投影 */
const ray = frame.unproject(W / 2 + 100, H / 2);
check('反投影方向指向右侧', ray.dir[0] > 0 && near(ray.dir[1], 0, 1e-9) && ray.dir[2] < 0, ray.dir);

/* ---------------- 四元数 ---------------- */
const q90 = PL.qFromAxisAngle([0, 1, 0], Math.PI / 2);
check('绕 Y 旋转 90°：+X → -Z', nearV(PL.qRotate(q90, [1, 0, 0]), [0, 0, -1], 1e-9), PL.qRotate(q90, [1, 0, 0]));
check('四元数归一', near(Math.hypot.apply(null, PL.qNormalize([1, 2, 3, 4])), 1, 1e-9));
const euler = PL.qToEuler(q90);
check('欧拉角 Y=90', near(euler[1], 90, 1e-9), euler);
const q45 = PL.qSlerp(PL.qIdentity(), q90, 0.5);
check('四元数插值中点 ≈ 45°', near(PL.qToEuler(q45)[1], 45, 1e-6), PL.qToEuler(q45));
check('反向插值走短路', near(PL.qToEuler(PL.qSlerp(PL.qIdentity(), PL.qFromAxisAngle([0, 1, 0], -Math.PI / 2), 0.5))[1], -45, 1e-6));

/* ---------------- 几何工具 ---------------- */
check('点到线段距离', near(PL.distPointSegment(5, 5, 0, 0, 10, 0), 5, 1e-9));
const clipped = PL.clipSegmentRect([-10, 5], [10, 5], 0, 0, 100, 100);
check('线段裁剪左端', clipped && near(clipped[0][0], 0, 1e-9) && near(clipped[0][1], 5, 1e-9), clipped);
const clipped2 = PL.clipSegmentRect([-5, -5], [-1, -1], 0, 0, 10, 10);
check('完全在外返回 null', clipped2 === null, clipped2);
check('点在多边形内', PL.pointInPolygon(5, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]));
check('点在多边形外', !PL.pointInPolygon(15, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]));

const tLine = PL.rayLineParam([5, 5, 0], PL.vNorm([0, -1, 0]), [0, 0, 0], [1, 0, 0]);
check('射线与直线最近参数', near(tLine, 5, 1e-9), tLine);
const hitPlane = PL.rayPlane([0, 0, 5], [0, 0, -1], [0, 0, 1], [0, 0, 0]);
check('射线与平面求交', nearV(hitPlane, [0, 0, 0], 1e-9), hitPlane);

/* ---------------- 立方体模型 ---------------- */
const model = S.buildCube(0.9);
check('8 个顶点', model.verts.length === 8);
check('6 个面', model.faces.length === 6);
check('12 条棱', model.edges.length === 12);
check('每条棱邻接 2 个面', model.edges.every(e => e.faces.length === 2), model.edges.map(e => e.faces.length));
check('每条棱只沿一个轴向', model.edges.every(e => {
  const a = model.verts[e.a], b = model.verts[e.b];
  return a.filter((v, i) => Math.abs(v - b[i]) > 1e-9).length === 1;
}));

/* ---------------- 消失点识别 ---------------- */
const identity = PL.qIdentity();
const world = S.cubeWorld(model, [0, 0.9, 0], identity);
S.updateVisibility(world, frame.pos, frame);
check('正面可见', world.faces[1].visible);
check('背面不可见', !world.faces[0].visible);
check('顶面在视线高度时不可见', !world.faces[5].visible);

const vpsOne = S.computeVPs(frame, identity);
check('一点透视：仅 1 个有限消失点', vpsOne.finiteCount === 1, vpsOne.finiteCount);
check('一点透视：Z 轴消失点居中', !vpsOne.axes[2].infinite && near(vpsOne.axes[2].x, W / 2, 1e-6), vpsOne.axes[2]);
check('一点透视：X 轴无穷远', vpsOne.axes[0].infinite && vpsOne.axes[1].infinite);

const camTwo = PL.makeCamera({ target: [0, 0.9, 0], yaw: 0, pitch: 0.03, distance: 8.6, fov: 46 * DEG });
const frameTwo = PL.makeFrame(camTwo, W, H);
const qTwo = PL.qFromAxisAngle([0, 1, 0], 34 * DEG);
const vpsTwo = S.computeVPs(frameTwo, qTwo);
check('两点透视：2 个有限消失点', vpsTwo.finiteCount === 2, vpsTwo.finiteCount);

const camThree = PL.makeCamera({ target: [0, 1, 0], yaw: -16 * DEG, pitch: 19 * DEG, distance: 9.4, fov: 46 * DEG });
const frameThree = PL.makeFrame(camThree, W, H);
const qThree = PL.qMul(PL.qFromAxisAngle([0, 1, 0], 30 * DEG), PL.qFromAxisAngle([1, 0, 0], -12 * DEG));
const vpsThree = S.computeVPs(frameThree, qThree);
check('三点透视：3 个有限消失点', vpsThree.finiteCount === 3, vpsThree.finiteCount);

/* ---------------- 消失线 ---------------- */
const linesOne = S.vanishingLines(frame, world, vpsOne, { showHidden: true });
check('一点透视生成 4 条 Z 向消失线', linesOne.length === 4, linesOne.length);
check('消失线终止于 Z 消失点', linesOne.every(l => near(l.x1, W / 2, 1) && near(l.y1, H / 2, 1)), linesOne.map(l => [l.x1, l.y1]));
const linesVisibleOnly = S.vanishingLines(frame, world, vpsOne, { showHidden: false });
check('一点透视中 Z 棱全部被正面遮挡 → 仅可见棱无消失线', linesVisibleOnly.length === 0, linesVisibleOnly.length);
check('隐藏棱开启时仍保留 4 条构造线', linesOne.length === 4, linesOne.length);

/* ---------------- 手柄拾取 ---------------- */
const gizmo = S.buildGizmo(frame, [0, 0.9, 0], 0.9, 'move');
check('移动手柄 3 个轴', gizmo.filter(g => g.mode === 'move').length === 3, gizmo.filter(g => g.mode === 'move').length);
check('移动手柄 3 个平面', gizmo.filter(g => g.mode === 'move-plane').length === 3, gizmo.filter(g => g.mode === 'move-plane').length);
const g0 = gizmo.filter(g => g.mode === 'move')[0];
const hitMid = S.hitTestGizmo((g0.ox + g0.tx) / 2, (g0.oy + g0.ty) / 2, gizmo);
check('命中 X 轴手柄', hitMid && hitMid.axis === 0, hitMid && hitMid.axis);
const gizmoRot = S.buildGizmo(frame, [0, 0.9, 0], 0.9, 'rotate');
check('旋转手柄 3 个环', gizmoRot.filter(g => g.mode === 'rotate').length === 3, gizmoRot.filter(g => g.mode === 'rotate').length);
check('旋转手柄包含视角自由旋转盘', gizmoRot.some(g => g.mode === 'rotate-view'));
check('旋转环采样点数量', gizmoRot.filter(g => g.mode === 'rotate')[0].points.length === 65, gizmoRot.filter(g => g.mode === 'rotate')[0].points.length);

/* ---------------- 屏幕外消失点方向 ---------------- */
const qFar = PL.qFromAxisAngle([0, 1, 0], 34 * DEG);
const vpsFar = S.computeVPs(frameTwo, qFar);
check('两点透视消失点在屏幕外', vpsFar.axes[0].dist > 0 && vpsFar.axes[2].dist > 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
