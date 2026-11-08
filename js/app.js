/* ============================================================
   透视实验室 · Perspective Lab
   app.js — 状态、自由摄像机、立方体变换、预设动画、交互与 HUD
   ============================================================ */
(function () {
  'use strict';

  var PL = window.PL;
  var S = window.PLScene;
  var Renderer = window.PLRenderer;
  var DEG = PL.DEG;

  var CUBE_HALF = 0.9;
  var AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  var AXIS_LETTER = ['X', 'Y', 'Z'];
  var HOME_POS = [0, 0.9, 0];
  var HOME_QUAT = PL.qIdentity();
  var DEFAULT_YAW = 30 * DEG;
  var DEFAULT_PITCH = 0.02;
  var DEFAULT_FOV = 90 * DEG;
  /* 预设相机距离：让立方体始终占画面高度的固定比例（与视场角无关） */
  var FRAME_RATIO = 0.10;
  function presetDistance(fov) {
    return CUBE_HALF / (2 * FRAME_RATIO * Math.tan(fov * 0.5));
  }
  var TYPE_TEXT = { one: '一点透视', two: '两点透视', three: '三点透视', free: '自由视角' };
  var TYPE_META = { one: '1 VP', two: '2 VP', three: '3 VP', free: '0 VP' };
  var TYPE_NOTE = {
    one: '正对立方体：深度方向汇聚于一点，其余两组棱与画面平行',
    two: '两组水平棱分别向两侧消失 · 竖直棱保持平行',
    three: '三组棱同时收缩，三个消失点共同决定画面空间',
    free: '转动摄像机或立方体，观察消失点如何随之移动'
  };

  /* ------------------------------------------------------------------
   * DOM
   * ------------------------------------------------------------------ */
  var canvas = document.getElementById('stage');
  var renderer = new Renderer(canvas);
  var cubeModel = S.buildCube(CUBE_HALF);

  var ui = {
    fps: document.getElementById('fps'),
    badge: document.getElementById('badge'),
    badgeText: document.getElementById('badgeText'),
    badgeMeta: document.getElementById('badgeMeta'),
    badgeNote: document.getElementById('badgeNote'),
    presetButtons: Array.prototype.slice.call(document.querySelectorAll('.preset')),
    vpRows: Array.prototype.slice.call(document.querySelectorAll('.vp-row')),
    modeSeg: document.getElementById('modeSeg'),
    segThumb: document.getElementById('segThumb'),
    modeButtons: Array.prototype.slice.call(document.querySelectorAll('#modeSeg .seg')),
    spaceSeg: document.getElementById('spaceSeg'),
    spaceButtons: Array.prototype.slice.call(document.querySelectorAll('#spaceSeg .seg')),
    cubePos: document.getElementById('cubePos'),
    cubeRot: document.getElementById('cubeRot'),
    fovValue: document.getElementById('fovValue'),
    focalValue: document.getElementById('focalValue'),
    eyeValue: document.getElementById('eyeValue'),
    fovRange: document.getElementById('fovRange'),
    tgLines: document.getElementById('tgLines'),
    tgPoints: document.getElementById('tgPoints'),
    tgOtherLines: document.getElementById('tgOtherLines'),
    tgOtherPoints: document.getElementById('tgOtherPoints'),
    tgHorizon: document.getElementById('tgHorizon'),
    tgGrid: document.getElementById('tgGrid'),
    tgOpaque: document.getElementById('tgOpaque'),
    tgHidden: document.getElementById('tgHidden'),
    tgLabels: document.getElementById('tgLabels'),
    tgSpin: document.getElementById('tgSpin'),
    btnAlign: document.getElementById('btnAlign'),
    btnResetCube: document.getElementById('btnResetCube'),
    btnFocus: document.getElementById('btnFocus'),
    btnResetView: document.getElementById('btnResetView'),
    panelToggle: document.getElementById('panelToggle'),
    panelLeft: document.getElementById('panelLeft'),
    panelRight: document.getElementById('panelRight'),
    collapseLeft: document.getElementById('collapseLeft'),
    collapseRight: document.getElementById('collapseRight'),
    tabLeft: document.getElementById('tabLeft'),
    tabRight: document.getElementById('tabRight'),
    cubeList: document.getElementById('cubeList'),
    btnAddCube: document.getElementById('btnAddCube'),
    btnDeleteCube: document.getElementById('btnDeleteCube')
  };

  /* ------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------ */
  var state = {
    mode: 'move',
    space: 'local',
    show: { lines: true, points: true, otherLines: true, otherPoints: true, horizon: true, grid: true, hidden: true, opaque: true, labels: true },
    selected: true,
    spin: false,
    hover: null,
    hoverCube: -1,
    active: null,
    dragInfo: null,
    rowAxis: -1,
    pinAxis: -1,
    anim: null,
    time: 0,
    fps: 60
  };
  var cubes = [{ position: HOME_POS.slice(), quat: HOME_QUAT.slice() }];
  var selectedIndex = 0;
  var cube = cubes[0];
  var camD = {
    target: cube.position.slice(), yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH,
    distance: presetDistance(DEFAULT_FOV), fov: DEFAULT_FOV
  };
  var camNow = {
    target: camD.target.slice(), yaw: camD.yaw, pitch: camD.pitch,
    distance: camD.distance, fov: camD.fov
  };

  var view = null;
  var safeRect = computeSafe(renderer.w, renderer.h);
  var lastHud = 0;
  var ready = false;

  /* ------------------------------------------------------------------
   * 工具
   * ------------------------------------------------------------------ */
  function clampPitch(p) { return PL.clamp(p, -1.45, 1.45); }
  function shortestAngle(a) {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  }
  function copyCam(dst, src) {
    dst.target = src.target.slice();
    dst.yaw = src.yaw;
    dst.pitch = src.pitch;
    dst.distance = src.distance;
    dst.fov = src.fov;
  }
  function fmtK(n) {
    if (!isFinite(n)) return '∞';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function panelCollapsed(side) {
    var p = side === 'left' ? ui.panelLeft : ui.panelRight;
    return !!(p && p.classList.contains('is-collapsed'));
  }

  function computeSafe(w, h) {
    if (w > 1080) {
      return {
        left: panelCollapsed('left') ? 26 : 292,
        right: w - (panelCollapsed('right') ? 26 : 292),
        top: 98,
        bottom: h - 96
      };
    }
    if (w > 900) {
      return {
        left: panelCollapsed('left') ? 26 : 264,
        right: w - (panelCollapsed('right') ? 26 : 264),
        top: 96,
        bottom: h - 92
      };
    }
    if (w > 640) return { left: 30, right: w - 30, top: 92, bottom: h - 96 };
    return { left: 26, right: w - 26, top: 84, bottom: h - 64 };
  }

  /* ------------------------------------------------------------------
   * 场景计算
   * ------------------------------------------------------------------ */
  function updateScene() {
    safeRect = computeSafe(renderer.w, renderer.h);
    var frame = PL.makeFrame(camNow, renderer.w, renderer.h);
    var worlds = [];
    var cubeViews = [];
    var selectedView = null;
    for (var i = 0; i < cubes.length; i++) {
      var w = S.cubeWorld(cubeModel, cubes[i].position, cubes[i].quat);
      S.updateVisibility(w, frame.pos, frame);
      w.index = i;
      w.selected = i === selectedIndex;
      worlds.push(w);
      var vps = S.computeVPs(frame, cubes[i].quat);
      for (var j = 0; j < vps.axes.length; j++) {
        var a = vps.axes[j];
        a.onScreen = !a.infinite &&
          a.x > safeRect.left + 12 && a.x < safeRect.right - 12 &&
          a.y > safeRect.top + 12 && a.y < safeRect.bottom - 12;
      }
      var lines = S.vanishingLines(frame, w, vps, {
        showHidden: state.show.hidden && !state.show.opaque,
        safeRect: safeRect
      });
      var cv = { world: w, vps: vps, lines: lines, selected: i === selectedIndex, index: i };
      cubeViews.push(cv);
      if (i === selectedIndex) selectedView = cv;
    }
    if (!selectedView) selectedView = cubeViews[0];
    var world = selectedView.world;
    var vps = selectedView.vps;
    var lines = selectedView.lines;
    var horizon = frame.horizon();
    var gizmoAxes = state.space === 'local' ? S.getAxes(cube.quat) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    var gizmo = state.mode === 'none' ? [] : S.buildGizmo(frame, cube.position, CUBE_HALF, state.mode, gizmoAxes);
    view = {
      frame: frame, worlds: worlds, world: world, vps: vps, lines: lines,
      cubeViews: cubeViews, horizon: horizon, gizmo: gizmo, space: state.space
    };
  }

  /* ------------------------------------------------------------------
   * 摄像机平滑 & 动画
   * ------------------------------------------------------------------ */
  function smoothCamera(dt) {
    if (state.anim) return;
    var k = 1 - Math.exp(-16 * dt);
    camNow.target = PL.vLerp(camNow.target, camD.target, k);
    camNow.yaw += shortestAngle(camD.yaw - camNow.yaw) * k;
    camNow.pitch = PL.lerp(camNow.pitch, camD.pitch, k);
    camNow.distance = PL.lerp(camNow.distance, camD.distance, k);
    camNow.fov = PL.lerp(camNow.fov, camD.fov, k);
  }

  function animateTo(target, dur) {
    var toCam = target.cam ? {
      target: target.cam.target.slice(), yaw: target.cam.yaw, pitch: target.cam.pitch,
      distance: target.cam.distance, fov: target.cam.fov
    } : null;
    var toPos = target.pos ? target.pos.slice() : null;
    var toQuat = target.quat ? target.quat.slice() : null;
    if (!toCam && !toPos && !toQuat) return;

    state.anim = {
      t: 0,
      dur: dur || 1.0,
      fromCam: {
        target: camNow.target.slice(), yaw: camNow.yaw, pitch: camNow.pitch,
        distance: camNow.distance, fov: camNow.fov
      },
      toCam: toCam,
      fromPos: cube.position.slice(),
      toPos: toPos,
      fromQuat: cube.quat.slice(),
      toQuat: toQuat
    };
  }

  function cancelAnim() {
    if (!state.anim) return;
    state.anim = null;
    copyCam(camD, camNow);
  }

  function updateAnim(dt) {
    var a = state.anim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    var e = PL.easeInOut(a.t);
    if (a.toCam) {
      var yawTo = a.fromCam.yaw + shortestAngle(a.toCam.yaw - a.fromCam.yaw);
      camNow.target = PL.vLerp(a.fromCam.target, a.toCam.target, e);
      camNow.yaw = PL.lerp(a.fromCam.yaw, yawTo, e);
      camNow.pitch = PL.lerp(a.fromCam.pitch, a.toCam.pitch, e);
      camNow.distance = PL.lerp(a.fromCam.distance, a.toCam.distance, e);
      camNow.fov = PL.lerp(a.fromCam.fov, a.toCam.fov, e);
      copyCam(camD, camNow);
    }
    if (a.toPos) cube.position = PL.vLerp(a.fromPos, a.toPos, e);
    if (a.toQuat) cube.quat = PL.qSlerp(a.fromQuat, a.toQuat, e);
    if (a.t >= 1) {
      if (a.toCam) copyCam(camNow, camD);
      if (a.toPos) cube.position = a.toPos.slice();
      if (a.toQuat) cube.quat = a.toQuat.slice();
      state.anim = null;
    }
  }

  /* ------------------------------------------------------------------
   * 预设
   * ------------------------------------------------------------------ */
  /* 预设视角只改变摄像机：方向定义在立方体本地坐标系中，
     因此立方体被移动 / 旋转后，预设依然以它为中心并保持相同的透视类型。 */
  var PRESETS = {
    one: { dir: [0, 0, 1] },
    two: {
      dir: [Math.sin(35 * DEG), 0, Math.cos(35 * DEG)]
    },
    three: {
      dir: [
        Math.sin(28 * DEG) * Math.cos(20 * DEG),
        Math.sin(20 * DEG),
        Math.cos(28 * DEG) * Math.cos(20 * DEG)
      ]
    },
    aerial: {
      dir: [
        Math.sin(32 * DEG) * Math.cos(50 * DEG),
        Math.sin(50 * DEG),
        Math.cos(32 * DEG) * Math.cos(50 * DEG)
      ]
    }
  };

  function cameraFromLocalDir(localDir, fov) {
    var d = PL.vNorm(PL.qRotate(cube.quat, localDir));
    var yaw = Math.atan2(d[0], d[2]);
    var pitch = Math.asin(PL.clamp(d[1], -1, 1));
    return {
      target: cube.position.slice(),
      yaw: yaw,
      pitch: pitch,
      distance: presetDistance(fov),
      fov: fov
    };
  }

  function setPresetActive(name) {
    ui.presetButtons.forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-preset') === name);
    });
  }
  function clearPreset() { setPresetActive(null); }

  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    if (state.spin) { state.spin = false; ui.tgSpin.checked = false; }
    setPresetActive(name);
    animateTo({ cam: cameraFromLocalDir(p.dir, camD.fov) }, 1.05);
  }

  /* ------------------------------------------------------------------
   * 视角操作
   * ------------------------------------------------------------------ */
  function focusCube() {
    clearPreset();
    animateTo({
      cam: {
        target: cube.position.slice(),
        yaw: camNow.yaw,
        pitch: camNow.pitch,
        distance: PL.clamp(camNow.distance, 1.6, 24),
        fov: camNow.fov
      }
    }, 0.6);
  }

  function resetView() {
    clearPreset();
    var dir = [
      Math.sin(DEFAULT_YAW) * Math.cos(DEFAULT_PITCH),
      Math.sin(DEFAULT_PITCH),
      Math.cos(DEFAULT_YAW) * Math.cos(DEFAULT_PITCH)
    ];
    animateTo({ cam: cameraFromLocalDir(dir, DEFAULT_FOV) }, 0.8);
  }

  function resetCube() {
    clearPreset();
    animateTo({ pos: HOME_POS, quat: HOME_QUAT }, 0.7);
  }

  function alignCube() {
    clearPreset();
    animateTo({ quat: PL.qIdentity() }, 0.7);
  }

  /* ------------------------------------------------------------------
   * 多立方体
   * ------------------------------------------------------------------ */
  function updateCubeUI() {
    if (!ui.cubeList) return;
    ui.cubeList.innerHTML = '';
    cubes.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cube-chip' + (i === selectedIndex ? ' is-active' : '');
      b.textContent = String(i + 1);
      b.title = '选择立方体 ' + (i + 1);
      b.setAttribute('aria-pressed', i === selectedIndex ? 'true' : 'false');
      b.addEventListener('click', function () { selectCube(i); });
      ui.cubeList.appendChild(b);
    });
    if (ui.btnDeleteCube) ui.btnDeleteCube.disabled = cubes.length <= 1;
  }

  function selectCube(index) {
    if (index < 0 || index >= cubes.length || index === selectedIndex) return;
    cancelAnim();
    clearPreset();
    selectedIndex = index;
    cube = cubes[index];
    state.hover = null;
    state.hoverCube = -1;
    canvas.classList.remove('is-cube-hover');
    updateCubeUI();
  }

  function addCube() {
    cancelAnim();
    clearPreset();
    var base = cube;
    var right = view ? view.frame.right : [1, 0, 0];
    var pos = [
      base.position[0] + right[0] * 2.8,
      base.position[1],
      base.position[2] + right[2] * 2.8
    ];
    cubes.push({ position: pos, quat: PL.qIdentity() });
    selectedIndex = cubes.length - 1;
    cube = cubes[selectedIndex];
    state.hover = null;
    state.hoverCube = -1;
    updateCubeUI();

    /* 把所有立方体纳入取景范围：目标点取中心，必要时拉远镜头 */
    var cx = 0, cy = 0, cz = 0;
    for (var i = 0; i < cubes.length; i++) {
      cx += cubes[i].position[0];
      cy += cubes[i].position[1];
      cz += cubes[i].position[2];
    }
    cx /= cubes.length; cy /= cubes.length; cz /= cubes.length;
    var maxR = 0;
    for (i = 0; i < cubes.length; i++) {
      var dx = cubes[i].position[0] - cx;
      var dy = cubes[i].position[1] - cy;
      var dz = cubes[i].position[2] - cz;
      maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
    }
    maxR += CUBE_HALF * 1.5;
    camD.target = [cx, cy, cz];
    camD.distance = Math.max(camD.distance, maxR / Math.tan(camD.fov * 0.5) * 1.25);
  }

  function deleteCube() {
    if (cubes.length <= 1) return;
    cancelAnim();
    clearPreset();
    cubes.splice(selectedIndex, 1);
    selectedIndex = Math.min(selectedIndex, cubes.length - 1);
    cube = cubes[selectedIndex];
    state.hover = null;
    state.hoverCube = -1;
    canvas.classList.remove('is-cube-hover');
    updateCubeUI();
  }

  /* ------------------------------------------------------------------
   * 指针交互
   * ------------------------------------------------------------------ */
  var pointers = new Map();
  var drag = null;

  function pickCubeAt(x, y) {
    if (!view) return -1;
    var best = -1, bestDepth = Infinity;
    for (var i = 0; i < view.worlds.length; i++) {
      var w = view.worlds[i];
      if (S.hitTestCube(x, y, view.frame, w)) {
        var d = view.frame.toCamSpace(w.position)[2];
        if (d < bestDepth) { bestDepth = d; best = i; }
      }
    }
    return best;
  }

  function hitTest(x, y, radius) {
    if (!view) return null;
    var handle = S.hitTestGizmo(x, y, view.gizmo);
    if (handle) return { type: 'gizmo', handle: handle };
    var index = pickCubeAt(x, y);
    if (index >= 0) return { type: 'cube', index: index };
    return null;
  }

  function beginTransform(handle, e) {
    var frame = view.frame;
    var ray = frame.unproject(e.clientX, e.clientY);
    var center = cube.position.slice();
    var axisDir = handle.axisDir ? handle.axisDir.slice() : null;

    if (handle.mode === 'move') {
      if (!axisDir) axisDir = AXES[handle.axis].slice();
      if (handle.degenerate) {
        state.active = {
          mode: 'move', axis: handle.axis, handle: handle, degenerate: true,
          axisDir: axisDir, startPos: center, startQuat: cube.quat.slice(), startY: e.clientY
        };
      } else {
        var t = PL.rayLineParam(ray.origin, ray.dir, center, axisDir);
        if (t === null) return;
        state.active = {
          mode: 'move', axis: handle.axis, handle: handle,
          axisDir: axisDir, startT: t, startPos: center, startQuat: cube.quat.slice()
        };
      }
    } else if (handle.mode === 'move-plane') {
      var planeHit = PL.rayPlane(ray.origin, ray.dir, handle.n, center);
      if (!planeHit) return;
      state.active = {
        mode: 'move-plane', axis: handle.axis, handle: handle,
        startPos: center, startQuat: cube.quat.slice(), startHit: planeHit,
        u: handle.u.slice(), v: handle.v.slice(), n: handle.n.slice(), label: handle.label
      };
    } else if (handle.mode === 'rotate-view') {
      state.active = {
        mode: 'rotate-view', axis: -1, handle: handle,
        startQuat: cube.quat.slice(),
        right: frame.right.slice(), up: frame.up.slice(),
        startX: e.clientX, startY: e.clientY
      };
    } else {
      if (!axisDir) axisDir = AXES[handle.axis].slice();
      var hit = PL.rayPlane(ray.origin, ray.dir, axisDir, center);
      if (!hit) return;
      var v = PL.vNorm(PL.vSub(hit, center));
      if (PL.vLen(v) < 0.5) return;
      state.active = {
        mode: 'rotate', axis: handle.axis, handle: handle,
        axisDir: axisDir, startVec: v, startQuat: cube.quat.slice(), center: center
      };
    }
    drag = { kind: 'transform', mode: state.active.mode, axis: state.active.axis, lastX: e.clientX, lastY: e.clientY };
    canvas.classList.add('is-grabbing');
  }

  function updateTransform(e) {
    var frame = view.frame;
    var ray = frame.unproject(e.clientX, e.clientY);
    var act = state.active;
    var spaceTag = state.space === 'local' ? ' · 本地' : '';

    if (act.mode === 'move') {
      var axisDir = act.axisDir;
      var delta;
      if (act.degenerate) {
        var k = 2 * camD.distance * Math.tan(camD.fov * 0.5) / Math.max(1, renderer.h) * 1.15;
        delta = (act.startY - e.clientY) * k;
      } else {
        var t = PL.rayLineParam(ray.origin, ray.dir, act.startPos, axisDir);
        if (t === null) return;
        delta = t - act.startT;
      }
      if (e.shiftKey) delta = Math.round(delta / 0.25) * 0.25;
      cube.position = [
        act.startPos[0] + axisDir[0] * delta,
        act.startPos[1] + axisDir[1] * delta,
        act.startPos[2] + axisDir[2] * delta
      ];
      state.dragInfo = {
        text: AXIS_LETTER[act.axis] + '  ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + spaceTag,
        x: e.clientX, y: e.clientY, axis: act.axis
      };
    } else if (act.mode === 'move-plane') {
      var ph = PL.rayPlane(ray.origin, ray.dir, act.n, act.startPos);
      if (!ph) return;
      var diff = PL.vSub(ph, act.startHit);
      var du = PL.vDot(diff, act.u);
      var dv = PL.vDot(diff, act.v);
      if (e.shiftKey) {
        du = Math.round(du / 0.25) * 0.25;
        dv = Math.round(dv / 0.25) * 0.25;
      }
      cube.position = [
        act.startPos[0] + act.u[0] * du + act.v[0] * dv,
        act.startPos[1] + act.u[1] * du + act.v[1] * dv,
        act.startPos[2] + act.u[2] * du + act.v[2] * dv
      ];
      state.dragInfo = {
        text: act.label + '  ' + (du >= 0 ? '+' : '') + du.toFixed(2) +
          ' / ' + (dv >= 0 ? '+' : '') + dv.toFixed(2) + spaceTag,
        x: e.clientX, y: e.clientY, axis: act.axis
      };
    } else if (act.mode === 'rotate-view') {
      var dx = e.clientX - act.startX;
      var dy = e.clientY - act.startY;
      var angY = dx * 0.006;
      var angX = dy * 0.006;
      var qr = PL.qFromAxisAngle(act.right, angX);
      var qu = PL.qFromAxisAngle(act.up, angY);
      cube.quat = PL.qNormalize(PL.qMul(qu, PL.qMul(qr, act.startQuat)));
      state.dragInfo = {
        text: '自由旋转  ' + Math.round(dx * 0.006 / DEG) + '° / ' + Math.round(dy * 0.006 / DEG) + '°',
        x: e.clientX, y: e.clientY, axis: -1
      };
    } else {
      var hit = PL.rayPlane(ray.origin, ray.dir, act.axisDir, act.center);
      if (!hit) return;
      var v = PL.vNorm(PL.vSub(hit, act.center));
      if (PL.vLen(v) < 0.5) return;
      var ang = Math.atan2(
        PL.vDot(PL.vCross(act.startVec, v), act.axisDir),
        PL.vDot(act.startVec, v)
      );
      if (e.shiftKey) ang = Math.round(ang / (15 * DEG)) * (15 * DEG);
      cube.quat = PL.qNormalize(PL.qMul(PL.qFromAxisAngle(act.axisDir, ang), act.startQuat));
      var deg = Math.round(ang / DEG);
      state.dragInfo = {
        text: AXIS_LETTER[act.axis] + '  ' + (deg >= 0 ? '+' : '') + deg + '°' + spaceTag,
        x: e.clientX, y: e.clientY, axis: act.axis
      };
    }
  }

  function updateHover(x, y) {
    if (!view) return;
    var hit = hitTest(x, y);
    state.hover = hit && hit.type === 'gizmo' ? hit.handle : null;
    state.hoverCube = hit && hit.type === 'cube' ? hit.index : -1;
    var hm = state.hover ? state.hover.mode : null;
    canvas.classList.toggle('is-handle', hm === 'move' || hm === 'move-plane');
    canvas.classList.toggle('is-rotate-handle', hm === 'rotate' || hm === 'rotate-view');
    canvas.classList.toggle('is-cube-hover', state.hoverCube >= 0 && !state.hover);
  }

  function beginPinch() {
    var pts = Array.from(pointers.values());
    if (pts.length < 2) return;
    var a = pts[0], b = pts[1];
    var dx = a.x - b.x, dy = a.y - b.y;
    drag = {
      kind: 'pinch',
      startDist: Math.max(30, Math.hypot(dx, dy)),
      startMid: { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 },
      startDistance: camD.distance,
      startTarget: camD.target.slice(),
      right: view ? view.frame.right.slice() : [1, 0, 0],
      up: view ? view.frame.up.slice() : [0, 1, 0],
      k: 2 * camD.distance * Math.tan(camD.fov * 0.5) / Math.max(1, renderer.h)
    };
    state.active = null;
    state.dragInfo = null;
  }

  function updatePinch() {
    var pts = Array.from(pointers.values());
    if (pts.length < 2) return;
    var a = pts[0], b = pts[1];
    var dist = Math.max(30, Math.hypot(a.x - b.x, a.y - b.y));
    var mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    var scale = drag.startDist / dist;
    camD.distance = PL.clamp(drag.startDistance * scale, 2.4, 28);
    var dx = mid.x - drag.startMid.x;
    var dy = mid.y - drag.startMid.y;
    var k = drag.k;
    camD.target = [
      drag.startTarget[0] - drag.right[0] * dx * k + drag.up[0] * dy * k,
      drag.startTarget[1] - drag.right[1] * dx * k + drag.up[1] * dy * k,
      drag.startTarget[2] - drag.right[2] * dx * k + drag.up[2] * dy * k
    ];
  }

  function onPointerDown(e) {
    if (e.button > 2) return;
    e.preventDefault();
    cancelAnim();
    clearPreset();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });

    if (pointers.size === 2) {
      beginPinch();
      return;
    }
    if (pointers.size > 2) return;

    /* 右键：旋转视角 */
    if (e.button === 2) {
      drag = {
        kind: 'orbit', lastX: e.clientX, lastY: e.clientY,
        startX: e.clientX, startY: e.clientY, clickCube: -1, canSelect: false
      };
      canvas.classList.add('is-grabbing');
      state.hover = null;
      canvas.classList.remove('is-handle', 'is-rotate-handle');
      return;
    }

    var hit = hitTest(e.clientX, e.clientY, 12);
    if (e.button === 0 && hit && hit.type === 'gizmo') {
      beginTransform(hit.handle, e);
      return;
    }

    /* 触屏 / 手写笔：单指旋转；鼠标：左键或中键平移 */
    var touchLike = e.pointerType && e.pointerType !== 'mouse';
    drag = {
      kind: (e.button === 0 && touchLike) ? 'orbit' : 'pan',
      lastX: e.clientX, lastY: e.clientY,
      startX: e.clientX, startY: e.clientY,
      clickCube: hit && hit.type === 'cube' ? hit.index : -1,
      canSelect: e.button === 0
    };
    canvas.classList.add('is-grabbing');
    state.hover = null;
    canvas.classList.remove('is-handle', 'is-rotate-handle');
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) {
      if (e.target === canvas && !drag) updateHover(e.clientX, e.clientY);
      return;
    }
    var p = pointers.get(e.pointerId);
    p.x = e.clientX;
    p.y = e.clientY;

    if (!drag) { updateHover(e.clientX, e.clientY); return; }

    if (drag.kind === 'pinch') { updatePinch(); return; }

    if (drag.kind === 'orbit') {
      var dx = e.clientX - drag.lastX;
      var dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      camD.yaw -= dx * 0.0042;
      camD.pitch = clampPitch(camD.pitch + dy * 0.0042);
      return;
    }

    if (drag.kind === 'pan') {
      var pdx = e.clientX - drag.lastX;
      var pdy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      var frame = view.frame;
      var k = 2 * camD.distance * Math.tan(camD.fov * 0.5) / Math.max(1, renderer.h);
      camD.target = [
        camD.target[0] - frame.right[0] * pdx * k + frame.up[0] * pdy * k,
        camD.target[1] - frame.right[1] * pdx * k + frame.up[1] * pdy * k,
        camD.target[2] - frame.right[2] * pdx * k + frame.up[2] * pdy * k
      ];
      return;
    }

    if (drag.kind === 'transform' && state.active) {
      updateTransform(e);
      return;
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    var finished = drag;
    if (state.active && drag && drag.kind === 'transform') {
      state.active = null;
      state.dragInfo = null;
    }
    if (pointers.size === 0) {
      if (finished && finished.canSelect && finished.clickCube >= 0) {
        var moved = Math.hypot(e.clientX - finished.startX, e.clientY - finished.startY);
        if (moved < 6) selectCube(finished.clickCube);
      }
      drag = null;
      canvas.classList.remove('is-grabbing');
      updateHover(e.clientX, e.clientY);
    } else if (pointers.size === 1) {
      var p = Array.from(pointers.values())[0];
      drag = {
        kind: 'orbit', lastX: p.x, lastY: p.y,
        startX: p.x, startY: p.y, clickCube: -1, canSelect: false
      };
    } else {
      drag = null;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    cancelAnim();
    clearPreset();
    var delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 18;
    else if (e.deltaMode === 2) delta *= 400;
    camD.distance = PL.clamp(camD.distance * Math.exp(delta * 0.00115), 2.4, 28);
  }

  /* ------------------------------------------------------------------
   * 键盘
   * ------------------------------------------------------------------ */
  var keys = Object.create(null);

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (el.isContentEditable) return true;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      var type = (el.type || 'text').toLowerCase();
      return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button';
    }
    return false;
  }

  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;
    var k = e.key.toLowerCase();
    keys[k] = true;
    if (e.repeat) return;
    if (k === 'g') setMode('move');
    else if (k === 'r') setMode('rotate');
    else if (k === 'h') setMode('none');
    else if (k === 'l') setSpace(state.space === 'local' ? 'global' : 'local');
    else if (k === 'f') focusCube();
    else if (k === '1') applyPreset('one');
    else if (k === '2') applyPreset('two');
    else if (k === '3') applyPreset('three');
    else if (k === '4') applyPreset('aerial');
    else if (k === 'delete' || k === 'backspace') {
      if (cubes.length > 1) { deleteCube(); e.preventDefault(); }
    }
    else if (k === 'escape') { cancelAnim(); state.dragInfo = null; }
    else if (k === ' ') {
      state.spin = !state.spin;
      ui.tgSpin.checked = state.spin;
      if (state.spin) clearPreset();
      e.preventDefault();
      return;
    }
    if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'q' || k === 'e') {
      cancelAnim();
      clearPreset();
    }
  }

  function onKeyUp(e) {
    keys[e.key.toLowerCase()] = false;
  }

  function updateMovement(dt) {
    if (!view) return;
    var f = view.frame;
    var fx = f.forward[0], fz = f.forward[2];
    var fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    var rx = f.right[0], rz = f.right[2];
    var rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    var speed = camD.distance * 0.9 * ((keys['shift']) ? 2.2 : 1) * dt;
    var mx = 0, mz = 0, my = 0;
    if (keys['w']) { mx += fx; mz += fz; }
    if (keys['s']) { mx -= fx; mz -= fz; }
    if (keys['d']) { mx += rx; mz += rz; }
    if (keys['a']) { mx -= rx; mz -= rz; }
    if (keys['e']) my += 1;
    if (keys['q']) my -= 1;
    if (mx || mz || my) {
      camD.target[0] += mx * speed;
      camD.target[1] += my * speed;
      camD.target[2] += mz * speed;
    }
  }

  /* ------------------------------------------------------------------
   * 模式 / 显示
   * ------------------------------------------------------------------ */
  function setMode(mode) {
    state.mode = mode === 'rotate' || mode === 'none' ? mode : 'move';
    ui.modeSeg.classList.toggle('is-rotate', state.mode === 'rotate');
    ui.modeSeg.classList.toggle('is-none', state.mode === 'none');
    ui.modeButtons.forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-mode') === state.mode);
    });
    state.hover = null;
    state.active = null;
    state.dragInfo = null;
  }

  function setSpace(space) {
    state.space = space === 'local' ? 'local' : 'global';
    ui.spaceSeg.classList.toggle('is-second', state.space === 'local');
    ui.spaceButtons.forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-space') === state.space);
    });
    state.hover = null;
  }

  function setPanelCollapsed(side, collapsed) {
    var panel = side === 'left' ? ui.panelLeft : ui.panelRight;
    var tab = side === 'left' ? ui.tabLeft : ui.tabRight;
    var btn = side === 'left' ? ui.collapseLeft : ui.collapseRight;
    if (!panel) return;
    if (collapsed) panel.style.animation = 'none';
    panel.classList.toggle('is-collapsed', collapsed);
    if (tab) tab.classList.toggle('is-visible', collapsed);
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  /* 不透明模式下隐藏棱线没有意义，置灰对应开关 */
  function syncOpaqueUI() {
    if (!ui.tgHidden) return;
    ui.tgHidden.disabled = !!state.show.opaque;
    var row = ui.tgHidden.closest('.toggle-row');
    if (row) row.classList.toggle('is-disabled', !!state.show.opaque);
  }

  /* ------------------------------------------------------------------
   * HUD
   * ------------------------------------------------------------------ */
  function updateHud(force) {
    if (!view) return;
    var vps = view.vps;
    var frame = view.frame;

    ui.badge.setAttribute('data-type', vps.finiteCount === 1 ? '1' : vps.finiteCount === 2 ? '2' : vps.finiteCount === 3 ? '3' : '0');
    ui.badgeText.textContent = TYPE_TEXT[vps.type] || '自由视角';
    ui.badgeMeta.textContent = TYPE_META[vps.type] || '0 VP';
    if (ui.badgeNote) ui.badgeNote.textContent = TYPE_NOTE[vps.type] || '';

    for (var i = 0; i < ui.vpRows.length; i++) {
      var vp = vps.axes[i];
      var row = ui.vpRows[i];
      var stateEl = row.querySelector('.state');
      var txt;
      if (vp.infinite) {
        txt = '∞ 无穷远';
        row.classList.remove('is-finite', 'is-out');
        row.classList.add('is-out');
      } else {
        row.classList.add('is-finite');
        row.classList.toggle('is-out', !vp.onScreen);
        if (!vp.onScreen) txt = '屏外 · ' + fmtK(vp.dist) + 'px';
        else if (vp.dist < 6) txt = '屏内 · 中心';
        else txt = '屏内 · ' + fmtK(vp.dist) + 'px';
      }
      if (stateEl.textContent !== txt) stateEl.textContent = txt;
      row.classList.toggle('is-hot', state.rowAxis === i || state.pinAxis === i);
      row.classList.toggle('is-finite', !vp.infinite);
    }

    var p = cube.position;
    ui.cubePos.textContent = p[0].toFixed(2) + '  ' + p[1].toFixed(2) + '  ' + p[2].toFixed(2);
    var e = PL.qToEuler(cube.quat);
    function deg(v) { var r = Math.round(v); return (r === -0 ? 0 : r) + '°'; }
    ui.cubeRot.textContent = deg(e[0]) + '  ' + deg(e[1]) + '  ' + deg(e[2]);

    var fovDeg = Math.round(camNow.fov / DEG);
    ui.fovValue.textContent = fovDeg + '°';
    if (document.activeElement !== ui.fovRange) ui.fovRange.value = String(fovDeg);
    ui.focalValue.textContent = Math.round(12 / Math.tan(camNow.fov * 0.5)) + ' mm';
    var eyeY = frame.pos[1];
    ui.eyeValue.textContent = (eyeY >= 0 ? '' : '−') + Math.abs(eyeY).toFixed(2) + ' m';
    ui.fps.textContent = String(Math.round(state.fps));
  }

  /* ------------------------------------------------------------------
   * 主循环
   * ------------------------------------------------------------------ */
  var lastTime = 0;

  function tick(now) {
    requestAnimationFrame(tick);
    if (!lastTime) lastTime = now;
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (dt <= 0) dt = 0.0001;
    state.time += dt;
    state.fps = state.fps * 0.92 + (1 / dt) * 0.08;

    updateAnim(dt);
    smoothCamera(dt);
    updateMovement(dt);
    if (state.spin && !state.anim && !state.active) {
      cube.quat = PL.qNormalize(PL.qMul(PL.qFromAxisAngle([0, 1, 0], 0.42 * dt), cube.quat));
    }
    updateScene();

    var highlight = state.rowAxis >= 0 ? state.rowAxis : state.pinAxis >= 0 ? state.pinAxis :
      (state.hover ? state.hover.axis : -1);

    renderer.draw({
      frame: view.frame,
      worlds: view.worlds,
      world: view.world,
      cubeViews: view.cubeViews,
      vps: view.vps,
      lines: view.lines,
      horizon: view.horizon,
      gizmo: view.gizmo,
      show: state.show,
      selected: state.selected,
      mode: state.mode,
      space: state.space,
      hoverHandle: state.hover,
      activeHandle: state.active ? state.active.handle : null,
      highlightAxis: highlight,
      dragInfo: state.dragInfo,
      gridCenter: [cube.position[0], 0, cube.position[2]]
    }, state.time, safeRect);

    if (now - lastHud > 90) {
      lastHud = now;
      updateHud();
    }

    if (!ready) {
      ready = true;
      window.__PLAB_READY__ = true;
    }
  }

  /* ------------------------------------------------------------------
   * 初始化
   * ------------------------------------------------------------------ */
  function bindEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('contextmenu', function (e) {
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
    });
    canvas.addEventListener('dblclick', function (e) {
      e.preventDefault();
      var index = pickCubeAt(e.clientX, e.clientY);
      if (index >= 0) selectCube(index);
      focusCube();
    });
    canvas.addEventListener('pointerleave', function () {
      if (!drag) {
        state.hover = null;
        state.hoverCube = -1;
        canvas.classList.remove('is-handle', 'is-rotate-handle', 'is-cube-hover');
      }
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () {
      keys = Object.create(null);
      pointers.clear();
      drag = null;
      canvas.classList.remove('is-grabbing');
    });
    window.addEventListener('resize', function () {
      renderer.resize();
      safeRect = computeSafe(renderer.w, renderer.h);
      if (renderer.w <= 900) {
        setPanelCollapsed('left', false);
        setPanelCollapsed('right', false);
      }
    });

    ui.presetButtons.forEach(function (b) {
      b.addEventListener('click', function () { applyPreset(b.getAttribute('data-preset')); });
    });

    ui.modeButtons.forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });

    ui.spaceButtons.forEach(function (b) {
      b.addEventListener('click', function () { setSpace(b.getAttribute('data-space')); });
    });

    ui.vpRows.forEach(function (row, i) {
      row.addEventListener('pointerenter', function () { state.rowAxis = i; });
      row.addEventListener('pointerleave', function () {
        if (state.rowAxis === i) state.rowAxis = -1;
      });
      row.addEventListener('click', function () {
        state.pinAxis = state.pinAxis === i ? -1 : i;
      });
    });

    ui.fovRange.addEventListener('input', function () {
      cancelAnim();
      clearPreset();
      camD.fov = PL.clamp(parseFloat(ui.fovRange.value) || 90, 24, 100) * DEG;
    });

    ui.tgLines.addEventListener('change', function () { state.show.lines = ui.tgLines.checked; });
    ui.tgPoints.addEventListener('change', function () { state.show.points = ui.tgPoints.checked; });
    ui.tgOtherLines.addEventListener('change', function () { state.show.otherLines = ui.tgOtherLines.checked; });
    ui.tgOtherPoints.addEventListener('change', function () { state.show.otherPoints = ui.tgOtherPoints.checked; });
    ui.tgHorizon.addEventListener('change', function () { state.show.horizon = ui.tgHorizon.checked; });
    ui.tgGrid.addEventListener('change', function () { state.show.grid = ui.tgGrid.checked; });
    ui.tgOpaque.addEventListener('change', function () {
      state.show.opaque = ui.tgOpaque.checked;
      syncOpaqueUI();
    });
    ui.tgHidden.addEventListener('change', function () { state.show.hidden = ui.tgHidden.checked; });
    ui.tgLabels.addEventListener('change', function () { state.show.labels = ui.tgLabels.checked; });
    ui.tgSpin.addEventListener('change', function () {
      state.spin = ui.tgSpin.checked;
      if (state.spin) clearPreset();
    });

    ui.btnAlign.addEventListener('click', alignCube);
    ui.btnResetCube.addEventListener('click', resetCube);
    ui.btnFocus.addEventListener('click', focusCube);
    ui.btnResetView.addEventListener('click', resetView);
    if (ui.btnAddCube) ui.btnAddCube.addEventListener('click', addCube);
    if (ui.btnDeleteCube) ui.btnDeleteCube.addEventListener('click', deleteCube);

    if (ui.panelToggle) {
      ui.panelToggle.addEventListener('click', function () {
        var open = document.querySelector('.panel-right').classList.toggle('is-open');
        ui.panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    if (ui.collapseLeft) {
      ui.collapseLeft.addEventListener('click', function () { setPanelCollapsed('left', true); });
      ui.tabLeft.addEventListener('click', function () { setPanelCollapsed('left', false); });
    }
    if (ui.collapseRight) {
      ui.collapseRight.addEventListener('click', function () { setPanelCollapsed('right', true); });
      ui.tabRight.addEventListener('click', function () { setPanelCollapsed('right', false); });
    }
  }

  function start() {
    setMode('move');
    setSpace('local');
    bindEvents();
    syncOpaqueUI();
    updateCubeUI();
    updateScene();
    updateHud(true);
    requestAnimationFrame(tick);
  }

  /* 调试 / 自动化接口 */
  window.__PLAB__ = {
    state: state,
    cubes: cubes,
    get cube() { return cube; },
    get selectedIndex() { return selectedIndex; },
    get safeRect() { return safeRect; },
    camera: camNow,
    cameraDesired: camD,
    renderer: renderer,
    get view() { return view; },
    setPreset: applyPreset,
    setMode: setMode,
    setSpace: setSpace,
    addCube: addCube,
    deleteCube: deleteCube,
    selectCube: selectCube,
    focus: focusCube,
    resetView: resetView,
    resetCube: resetCube,
    align: alignCube,
    setCamera: function (o) {
      cancelAnim();
      clearPreset();
      if (o.target) camD.target = o.target.slice();
      if (o.yaw !== undefined) camD.yaw = o.yaw;
      if (o.pitch !== undefined) camD.pitch = o.pitch;
      if (o.distance !== undefined) camD.distance = o.distance;
      if (o.fov !== undefined) camD.fov = o.fov;
      copyCam(camNow, camD);
    },
    setCube: function (position, quat) {
      cancelAnim();
      clearPreset();
      if (position) cube.position = position.slice();
      if (quat) cube.quat = quat.slice();
    },
    show: function (patch) { Object.assign(state.show, patch); },
    fps: function () { return state.fps; }
  };

  start();
})();
