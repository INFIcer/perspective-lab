/* ============================================================
   透视实验室 · Perspective Lab
   core.js — 数学 / 四元数 / 摄像机 / 透视投影 / 屏幕裁剪
   DOM-free：可在 Node 中直接测试。
   ============================================================ */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* ============================ vec3 ============================ */
  function v3(x, y, z) { return [x || 0, y || 0, z || 0]; }
  function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vCross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  function vLen(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function vNorm(a) {
    var l = vLen(a);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  }
  function vLerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function vDist(a, b) { return vLen(vSub(a, b)); }
  function vCopy(a) { return [a[0], a[1], a[2]]; }

  /* ============================ quaternion [x,y,z,w] ============================ */
  function qIdentity() { return [0, 0, 0, 1]; }
  function qFromAxisAngle(axis, angle) {
    var a = vNorm(axis), s = Math.sin(angle * 0.5);
    return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle * 0.5)];
  }
  function qMul(a, b) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = b[0], by = b[1], bz = b[2], bw = b[3];
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  }
  function qNormalize(q) {
    var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  }
  function qRotate(q, v) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var vx = v[0], vy = v[1], vz = v[2];
    var tx = 2 * (y * vz - z * vy);
    var ty = 2 * (z * vx - x * vz);
    var tz = 2 * (x * vy - y * vx);
    return [
      vx + w * tx + (y * tz - z * ty),
      vy + w * ty + (z * tx - x * tz),
      vz + w * tz + (x * ty - y * tx)
    ];
  }
  function qSlerp(a, b, t) {
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    var bb = b.slice();
    if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (d > 0.9995) {
      return qNormalize([
        lerp(a[0], bb[0], t), lerp(a[1], bb[1], t),
        lerp(a[2], bb[2], t), lerp(a[3], bb[3], t)
      ]);
    }
    var theta = Math.acos(clamp(d, -1, 1));
    var s = Math.sin(theta);
    var wa = Math.sin((1 - t) * theta) / s;
    var wb = Math.sin(t * theta) / s;
    return qNormalize([
      a[0] * wa + bb[0] * wb,
      a[1] * wa + bb[1] * wb,
      a[2] * wa + bb[2] * wb,
      a[3] * wa + bb[3] * wb
    ]);
  }
  /* Euler XYZ（与 three.js 约定一致），返回角度制 [x,y,z] */
  function qToEuler(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var m00 = 1 - 2 * (y * y + z * z);
    var m01 = 2 * (x * y - z * w);
    var m02 = 2 * (x * z + y * w);
    var m12 = 2 * (y * z - x * w);
    var m22 = 1 - 2 * (x * x + y * y);
    var m11 = 1 - 2 * (x * x + z * z);
    var m21 = 2 * (x * y + z * w);
    var ey = Math.asin(clamp(m02, -1, 1));
    var ex, ez;
    if (Math.abs(m02) < 0.9999999) {
      ex = Math.atan2(-m12, m22);
      ez = Math.atan2(-m01, m00);
    } else {
      ex = Math.atan2(m21, m11);
      ez = 0;
    }
    return [ex / DEG, ey / DEG, ez / DEG];
  }

  /* ============================ camera frame ============================ */
  /**
   * 摄像机参数：
   *   target   [x,y,z] 观察目标
   *   yaw      绕世界 Y 的方位角（0 = 摄像机位于目标 +Z 方向）
   *   pitch    俯仰角（>0 表示摄像机高于目标、向下看）
   *   distance 摄像机到目标距离
   *   fov      垂直视场角（弧度）
   */
  function makeCamera(opts) {
    opts = opts || {};
    return {
      target: opts.target ? vCopy(opts.target) : [0, 0.9, 0],
      yaw: opts.yaw || 0,
      pitch: opts.pitch || 0,
      distance: opts.distance || 8,
      fov: opts.fov || 45 * DEG
    };
  }

  function makeFrame(cam, width, height) {
    var yaw = cam.yaw, pitch = cam.pitch;
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var toCam = [Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp];
    var distance = cam.distance;
    var pos = [
      cam.target[0] + toCam[0] * distance,
      cam.target[1] + toCam[1] * distance,
      cam.target[2] + toCam[2] * distance
    ];
    var forward = [-toCam[0], -toCam[1], -toCam[2]];
    var right = vCross(forward, [0, 1, 0]);
    if (vLen(right) < 1e-6) right = [1, 0, 0];
    right = vNorm(right);
    var up = vCross(right, forward);

    var focal = (height * 0.5) / Math.tan(cam.fov * 0.5);
    var cx = width * 0.5;
    var cy = height * 0.5;
    var near = 0.06;

    function projectCam(cc) {
      var invZ = 1 / cc[2];
      return { x: cx + focal * cc[0] * invZ, y: cy - focal * cc[1] * invZ, depth: cc[2] };
    }
    function toCamSpace(p) {
      var dx = p[0] - pos[0], dy = p[1] - pos[1], dz = p[2] - pos[2];
      return [
        right[0] * dx + right[1] * dy + right[2] * dz,
        up[0] * dx + up[1] * dy + up[2] * dz,
        forward[0] * dx + forward[1] * dy + forward[2] * dz
      ];
    }
    function dirToCam(d) {
      return [
        right[0] * d[0] + right[1] * d[1] + right[2] * d[2],
        up[0] * d[0] + up[1] * d[1] + up[2] * d[2],
        forward[0] * d[0] + forward[1] * d[1] + forward[2] * d[2]
      ];
    }

    var frame = {
      width: width,
      height: height,
      cx: cx,
      cy: cy,
      focal: focal,
      near: near,
      pos: pos,
      target: vCopy(cam.target),
      forward: forward,
      right: right,
      up: up,
      fov: cam.fov,
      distance: distance,
      yaw: yaw,
      pitch: pitch,
      toCamSpace: toCamSpace,
      dirToCam: dirToCam,
      projectCam: projectCam,

      project: function (p) {
        var cc = toCamSpace(p);
        if (cc[2] <= near) return null;
        return projectCam(cc);
      },

      /* 方向 d 的消失点（齐次投影）。infinite=true 表示方向平行于画面。 */
      projectDir: function (d) {
        var cc = dirToCam(d);
        if (Math.abs(cc[2]) < 1e-6) {
          return { x: NaN, y: NaN, infinite: true, camZ: cc[2], camX: cc[0], camY: cc[1] };
        }
        return {
          x: cx + focal * cc[0] / cc[2],
          y: cy - focal * cc[1] / cc[2],
          infinite: false,
          camZ: cc[2],
          camX: cc[0],
          camY: cc[1]
        };
      },

      /* 世界线段 → 屏幕线段（对近裁剪面裁剪） */
      projectSegment: function (a, b) {
        var ca = toCamSpace(a), cb = toCamSpace(b);
        if (ca[2] <= near && cb[2] <= near) return null;
        if (ca[2] <= near) {
          var t1 = (near - ca[2]) / (cb[2] - ca[2]);
          ca = [ca[0] + (cb[0] - ca[0]) * t1, ca[1] + (cb[1] - ca[1]) * t1, near];
        } else if (cb[2] <= near) {
          var t2 = (near - cb[2]) / (ca[2] - cb[2]);
          cb = [cb[0] + (ca[0] - cb[0]) * t2, cb[1] + (ca[1] - cb[1]) * t2, near];
        }
        return [projectCam(ca), projectCam(cb)];
      },

      /* 地平面消失线（地平线）。摄像机水平时经过画面中心。 */
      horizon: function () {
        var n = [0, 1, 0];
        var nc = dirToCam(n);
        if (Math.abs(nc[1]) < 1e-4) return null;
        function yAt(x) {
          var X = x - cx;
          var Y = -(nc[0] * X + nc[2] * focal) / nc[1];
          return cy - Y;
        }
        return [{ x: 0, y: yAt(0) }, { x: width, y: yAt(width) }];
      },

      /* 屏幕点 → 世界射线 {origin, dir} */
      unproject: function (sx, sy) {
        var a = (sx - cx) / focal;
        var b = -(sy - cy) / focal;
        var d = [
          right[0] * a + up[0] * b + forward[0],
          right[1] * a + up[1] * b + forward[1],
          right[2] * a + up[2] * b + forward[2]
        ];
        return { origin: pos, dir: vNorm(d) };
      }
    };
    return frame;
  }

  /* ============================ geometry helpers ============================ */
  function distPointSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy;
    if (l2 < 1e-9) return Math.hypot(px - ax, py - ay);
    var t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  function pointInPolygon(px, py, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* Liang–Barsky 裁剪 */
  function clipSegmentRect(p0, p1, xmin, ymin, xmax, ymax) {
    var t0 = 0, t1 = 1;
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var p = [-dx, dx, -dy, dy];
    var q = [p0[0] - xmin, xmax - p0[0], p0[1] - ymin, ymax - p0[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        var r = q[i] / p[i];
        if (p[i] < 0) {
          if (r > t1) return null;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return null;
          if (r < t1) t1 = r;
        }
      }
    }
    return [
      [p0[0] + dx * t0, p0[1] + dy * t0],
      [p0[0] + dx * t1, p0[1] + dy * t1]
    ];
  }

  /* 射线与直线最近点：返回直线参数 t（P = lineA + t·lineDir） */
  function rayLineParam(rayO, rayD, lineA, lineDir) {
    var u = vNorm(lineDir), v = rayD;
    var w0 = vSub(lineA, rayO);
    var a = vDot(u, u), b = vDot(u, v), c = vDot(v, v);
    var d = vDot(u, w0), e = vDot(v, w0);
    var den = a * c - b * b;
    if (Math.abs(den) < 1e-7) return null;
    return (b * e - c * d) / den;
  }

  /* 射线与平面求交 */
  function rayPlane(rayO, rayD, planeNormal, planePoint) {
    var den = vDot(planeNormal, rayD);
    if (Math.abs(den) < 1e-7) return null;
    var t = vDot(planeNormal, vSub(planePoint, rayO)) / den;
    return vAdd(rayO, vScale(rayD, t));
  }

  function perpendicular(v) {
    var ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
    var axis = ax < ay ? (ax < az ? [1, 0, 0] : [0, 0, 1]) : (ay < az ? [0, 1, 0] : [0, 0, 1]);
    return vNorm(vCross(v, axis));
  }

  var PL = {
    DEG: DEG,
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    easeInOut: easeInOut,
    damp: damp,
    smoothstep: smoothstep,

    v3: v3, vAdd: vAdd, vSub: vSub, vScale: vScale, vDot: vDot, vCross: vCross,
    vLen: vLen, vNorm: vNorm, vLerp: vLerp, vDist: vDist, vCopy: vCopy,

    qIdentity: qIdentity, qFromAxisAngle: qFromAxisAngle, qMul: qMul,
    qNormalize: qNormalize, qRotate: qRotate, qSlerp: qSlerp, qToEuler: qToEuler,

    makeCamera: makeCamera,
    makeFrame: makeFrame,

    distPointSegment: distPointSegment,
    pointInPolygon: pointInPolygon,
    clipSegmentRect: clipSegmentRect,
    rayLineParam: rayLineParam,
    rayPlane: rayPlane,
    perpendicular: perpendicular
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PL;
  global.PL = PL;
})(typeof window !== 'undefined' ? window : globalThis);
