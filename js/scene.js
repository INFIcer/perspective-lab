/* ============================================================
   透视实验室 · Perspective Lab
   scene.js — 立方体模型、消失点 / 消失线推导、变换手柄
   ============================================================ */
(function (global) {
  'use strict';

  var PL = global.PL;
  var vAdd = PL.vAdd, vSub = PL.vSub, vScale = PL.vScale, vDot = PL.vDot;
  var vCross = PL.vCross, vNorm = PL.vNorm, vLen = PL.vLen;
  var qRotate = PL.qRotate;

  /* 轴的最小“透视有效性”：方向与画面夹角过小则视为消失于无穷远 */
  var INFINITE_COS = 0.105;

  /* ------------------------------------------------------------------
   * 立方体静态模型
   * ------------------------------------------------------------------ */
  function buildCube(half) {
    var h = half;
    var verts = [
      [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
      [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]
    ];
    var faces = [
      { idx: [0, 3, 2, 1], normal: [0, 0, -1], axis: 2, sign: -1 }, // 后
      { idx: [4, 5, 6, 7], normal: [0, 0, 1], axis: 2, sign: 1 },   // 前
      { idx: [0, 4, 7, 3], normal: [-1, 0, 0], axis: 0, sign: -1 }, // 左
      { idx: [1, 2, 6, 5], normal: [1, 0, 0], axis: 0, sign: 1 },   // 右
      { idx: [0, 1, 5, 4], normal: [0, -1, 0], axis: 1, sign: -1 }, // 下
      { idx: [3, 7, 6, 2], normal: [0, 1, 0], axis: 1, sign: 1 }    // 上
    ];
    var edges = [];
    for (var i = 0; i < 8; i++) {
      for (var j = i + 1; j < 8; j++) {
        var a = verts[i], b = verts[j];
        var diff = 0, axis = -1;
        for (var k = 0; k < 3; k++) {
          if (Math.abs(a[k] - b[k]) > 1e-9) { diff++; axis = k; }
        }
        if (diff !== 1) continue;
        var adj = [];
        for (var f = 0; f < faces.length; f++) {
          var n = faces[f].normal;
          if (Math.abs(vDot(n, a) - h) < 1e-9 && Math.abs(vDot(n, b) - h) < 1e-9) adj.push(f);
        }
        edges.push({ a: i, b: j, axis: axis, faces: adj });
      }
    }
    return { half: half, verts: verts, faces: faces, edges: edges };
  }

  function getAxes(quat) {
    return [
      qRotate(quat, [1, 0, 0]),
      qRotate(quat, [0, 1, 0]),
      qRotate(quat, [0, 0, 1])
    ];
  }

  /* 世界空间立方体 + 可见性 */
  function cubeWorld(model, position, quat) {
    var points = [];
    for (var i = 0; i < model.verts.length; i++) {
      points.push(vAdd(qRotate(quat, model.verts[i]), position));
    }
    var faces = [];
    for (var f = 0; f < model.faces.length; f++) {
      var mf = model.faces[f];
      var center = [0, 0, 0];
      for (var k = 0; k < 4; k++) {
        var p = points[mf.idx[k]];
        center[0] += p[0] * 0.25; center[1] += p[1] * 0.25; center[2] += p[2] * 0.25;
      }
      faces.push({
        idx: mf.idx,
        normal: mf.normal,
        axis: mf.axis,
        sign: mf.sign,
        normalWorld: qRotate(quat, mf.normal),
        center: center,
        visible: false,
        depth: 0
      });
    }
    var edges = [];
    for (var e = 0; e < model.edges.length; e++) {
      var me = model.edges[e];
      edges.push({
        a: me.a,
        b: me.b,
        axis: me.axis,
        faces: me.faces,
        visible: false
      });
    }
    return { points: points, faces: faces, edges: edges, position: position, quat: quat, half: model.half };
  }

  function updateVisibility(world, camPos, frame) {
    var i;
    for (i = 0; i < world.faces.length; i++) {
      var face = world.faces[i];
      face.visible = vDot(face.normalWorld, vSub(camPos, face.center)) > 1e-6;
      if (frame) {
        var d = 0;
        for (var k = 0; k < 4; k++) {
          d += frame.toCamSpace(world.points[face.idx[k]])[2];
        }
        face.depth = d * 0.25;
      }
    }
    for (i = 0; i < world.edges.length; i++) {
      var edge = world.edges[i];
      edge.visible = false;
      for (var f = 0; f < edge.faces.length; f++) {
        if (world.faces[edge.faces[f]].visible) { edge.visible = true; break; }
      }
    }
  }

  /* ------------------------------------------------------------------
   * 消失点：立方体三个轴向在屏幕上的投影
   * ------------------------------------------------------------------ */
  function computeVPs(frame, quat) {
    var axes = getAxes(quat);
    var list = [];
    var finiteCount = 0;
    for (var i = 0; i < 3; i++) {
      var d = axes[i];
      var proj = frame.projectDir(d);
      var absZ = Math.abs(proj.camZ);
      var infinite = absZ < INFINITE_COS;
      var dist = infinite ? Infinity : Math.hypot(proj.x - frame.cx, proj.y - frame.cy);
      var onScreen = !infinite && proj.x > -50 && proj.x < frame.width + 50 &&
                     proj.y > -50 && proj.y < frame.height + 50;
      if (!infinite) finiteCount++;
      list.push({
        axis: i,
        dir: d,
        x: infinite ? NaN : proj.x,
        y: infinite ? NaN : proj.y,
        infinite: infinite,
        absZ: absZ,
        dist: dist,
        onScreen: onScreen,
        /* 消失点位于摄像机前方(= 该轴朝远离视线方向延伸)？仅用于文案 */
        receding: proj.camZ < 0
      });
    }
    return {
      axes: list,
      finiteCount: finiteCount,
      type: finiteCount === 1 ? 'one' : finiteCount === 2 ? 'two' : finiteCount === 3 ? 'three' : 'free'
    };
  }

  /* ------------------------------------------------------------------
   * 消失线：从每条棱的远端延伸到对应消失点
   * ------------------------------------------------------------------ */
  function vanishingLines(frame, world, vps, opts) {
    opts = opts || {};
    var margin = 90;
    var rect = opts.safeRect;
    var xmin = rect ? rect.left + 2 : -margin;
    var ymin = rect ? rect.top + 2 : -margin;
    var xmax = rect ? rect.right - 2 : frame.width + margin;
    var ymax = rect ? rect.bottom - 2 : frame.height + margin;
    var out = [];
    for (var a = 0; a < 3; a++) {
      var vp = vps.axes[a];
      if (vp.infinite) continue;
      for (var e = 0; e < world.edges.length; e++) {
        var edge = world.edges[e];
        if (edge.axis !== a) continue;
        if (!edge.visible && !opts.showHidden) continue;

        var pa = frame.project(world.points[edge.a]);
        var pb = frame.project(world.points[edge.b]);
        if (!pa || !pb) continue;

        var da = Math.hypot(pa.x - vp.x, pa.y - vp.y);
        var db = Math.hypot(pb.x - vp.x, pb.y - vp.y);
        if (!isFinite(da) || !isFinite(db)) continue;

        var start = da >= db ? pa : pb;
        var clipped = PL.clipSegmentRect(
          [start.x, start.y], [vp.x, vp.y],
          xmin, ymin, xmax, ymax
        );
        if (!clipped) continue;
        var len = Math.hypot(clipped[1][0] - clipped[0][0], clipped[1][1] - clipped[0][1]);
        if (len < 7) continue;

        out.push({
          axis: a,
          x0: clipped[0][0],
          y0: clipped[0][1],
          x1: clipped[1][0],
          y1: clipped[1][1],
          visible: edge.visible,
          edge: e
        });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * 变换手柄（世界轴）：移动箭头 / 旋转圆环
   * ------------------------------------------------------------------ */
  function buildGizmo(frame, center, half, mode, axes) {
    var ax = axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    var handles = [];
    var length = half * 1.5;
    var radius = half * 1.34;

    if (mode === 'move') {
      var o = frame.project(center);
      if (!o) return handles;
      for (var i = 0; i < 3; i++) {
        var tip = vAdd(center, vScale(ax[i], length));
        var p = frame.project(tip);
        if (!p) continue;
        var screenLen = Math.hypot(p.x - o.x, p.y - o.y);
        if (screenLen < 9) {
          /* 该轴几乎正对镜头：退化为中心的“深度环” */
          handles.push({
            mode: 'move', axis: i, degenerate: true,
            ox: o.x, oy: o.y, tx: o.x, ty: o.y, length: 0,
            axisDir: ax[i].slice()
          });
        } else {
          handles.push({
            mode: 'move', axis: i,
            ox: o.x, oy: o.y, tx: p.x, ty: p.y,
            length: screenLen,
            axisDir: ax[i].slice()
          });
        }
      }

      /* 平面二维移动手柄（XY / YZ / ZX 三个象限方块） */
      var pairs = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
      var quad = [[0.30, 0.30], [0.58, 0.30], [0.58, 0.58], [0.30, 0.58]];
      for (var pi = 0; pi < pairs.length; pi++) {
        var pa = pairs[pi][0], pb = pairs[pi][1], pn = pairs[pi][2];
        var quadPts = [];
        var quadOk = true;
        for (var qi = 0; qi < quad.length; qi++) {
          var wp = vAdd(center, vAdd(
            vScale(ax[pa], quad[qi][0] * length),
            vScale(ax[pb], quad[qi][1] * length)
          ));
          var sp = frame.project(wp);
          if (!sp) { quadOk = false; break; }
          quadPts.push({ x: sp.x, y: sp.y });
        }
        if (!quadOk) continue;
        handles.push({
          mode: 'move-plane', axis: pn, plane: [pa, pb], normalAxis: pn,
          u: ax[pa].slice(), v: ax[pb].slice(), n: ax[pn].slice(),
          points: quadPts, label: 'XYZ'[pa] + 'XYZ'[pb]
        });
      }
    } else {
      var cenDepth = frame.toCamSpace(center)[2];
      var oc = frame.project(center);
      var ringScreenMax = 0;
      for (var j = 0; j < 3; j++) {
        var u = PL.perpendicular(ax[j]);
        var w = vCross(ax[j], u);
        var pts = [];
        var N = 64;
        for (var k = 0; k <= N; k++) {
          var t = k / N * PL.TAU;
          var p3 = [
            center[0] + (u[0] * Math.cos(t) + w[0] * Math.sin(t)) * radius,
            center[1] + (u[1] * Math.cos(t) + w[1] * Math.sin(t)) * radius,
            center[2] + (u[2] * Math.cos(t) + w[2] * Math.sin(t)) * radius
          ];
          var pp = frame.project(p3);
          pts.push(pp ? { x: pp.x, y: pp.y, depth: pp.depth } : null);
          if (pp && oc) {
            ringScreenMax = Math.max(ringScreenMax, Math.hypot(pp.x - oc.x, pp.y - oc.y));
          }
        }
        handles.push({
          mode: 'rotate', axis: j,
          points: pts, radius: radius, centerDepth: cenDepth,
          axisDir: ax[j].slice()
        });
      }

      /* 最外层白色自由旋转外环：绕摄像机 right / up 两个轴旋转 */
      if (oc) {
        var screenR = ringScreenMax > 0 ? ringScreenMax + 10 : 70;
        handles.push({
          mode: 'rotate-view', axis: -1,
          ox: oc.x, oy: oc.y, radius: screenR
        });
      }
    }
    return handles;
  }

  function hitTestGizmo(mx, my, handles) {
    var i;
    /* 优先命中屏幕退化的“深度环” */
    for (i = 0; i < handles.length; i++) {
      var hd = handles[i];
      if (hd.mode === 'move' && hd.degenerate) {
        if (Math.hypot(mx - hd.ox, my - hd.oy) < 13) return hd;
      }
    }
    /* 平面移动方块 */
    for (i = 0; i < handles.length; i++) {
      var hp = handles[i];
      if (hp.mode === 'move-plane' && PL.pointInPolygon(mx, my, hp.points.map(function (p) {
        return [p.x, p.y];
      }))) return hp;
    }
    /* 最外层白色自由旋转环：命中环带 */
    for (i = 0; i < handles.length; i++) {
      var hv = handles[i];
      if (hv.mode === 'rotate-view') {
        var hvDist = Math.hypot(mx - hv.ox, my - hv.oy);
        if (Math.abs(hvDist - hv.radius) < 11) return hv;
      }
    }
    var best = null, bestDist = 11;
    for (var h = 0; h < handles.length; h++) {
      var handle = handles[h];
      if (handle.degenerate || handle.mode === 'move-plane' || handle.mode === 'rotate-view') continue;
      if (handle.mode === 'move') {
        var d = PL.distPointSegment(mx, my, handle.ox, handle.oy, handle.tx, handle.ty);
        if (d < bestDist) { bestDist = d; best = handle; }
      } else if (handle.mode === 'rotate') {
        var pts = handle.points;
        for (i = 0; i < pts.length - 1; i++) {
          var p0 = pts[i], p1 = pts[i + 1];
          if (!p0 || !p1) continue;
          var dd = PL.distPointSegment(mx, my, p0.x, p0.y, p1.x, p1.y);
          if (dd < bestDist) { bestDist = dd; best = handle; }
        }
      }
    }
    return best;
  }

  function hitTestCube(mx, my, frame, world) {
    for (var i = 0; i < world.faces.length; i++) {
      var face = world.faces[i];
      if (!face.visible) continue;
      var poly = [];
      var ok = true;
      for (var k = 0; k < 4; k++) {
        var p = frame.project(world.points[face.idx[k]]);
        if (!p) { ok = false; break; }
        poly.push([p.x, p.y]);
      }
      if (ok && PL.pointInPolygon(mx, my, poly)) return true;
    }
    return false;
  }

  global.PLScene = {
    INFINITE_COS: INFINITE_COS,
    buildCube: buildCube,
    getAxes: getAxes,
    cubeWorld: cubeWorld,
    updateVisibility: updateVisibility,
    computeVPs: computeVPs,
    vanishingLines: vanishingLines,
    buildGizmo: buildGizmo,
    hitTestGizmo: hitTestGizmo,
    hitTestCube: hitTestCube
  };
})(typeof window !== 'undefined' ? window : globalThis);
