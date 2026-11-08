/* ============================================================
   透视实验室 · Perspective Lab
   render.js — Canvas 2D 矢量渲染：氛围 / 网格 / 地平线 / 消失线 /
               玻璃立方体 / 消失点 / 变换手柄 / 标注
   ============================================================ */
(function (global) {
  'use strict';

  var PL = global.PL;

  var AXIS_HEX = ['#d6456a', '#0a8574', '#3d6fe8'];
  var AXIS_RGB = [[214, 69, 106], [10, 133, 116], [61, 111, 232]];
  var FONT = '"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
  var FONT_MONO = '"Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, monospace';

  function rgba(rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
  }
  function mixWhite(rgb, t) {
    return [
      Math.round(rgb[0] + (255 - rgb[0]) * t),
      Math.round(rgb[1] + (255 - rgb[1]) * t),
      Math.round(rgb[2] + (255 - rgb[2]) * t)
    ];
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fmtDist(n) {
    if (!isFinite(n)) return '∞';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.safe = { left: 40, right: 1200, top: 100, bottom: 800 };
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = global.innerWidth;
    var h = global.innerHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Renderer.prototype.clear = function () {
    this.ctx.clearRect(0, 0, this.w, this.h);
  };

  /* ============================ 场景主绘制 ============================ */
  Renderer.prototype.draw = function (scene, time, safe) {
    this.clear();
    this.safe = safe || this.safe;
    this.lastScene = scene;
    this.lastStats = { lineSets: 0, vpMarkers: 0 };
    var frame = scene.frame;
    var worlds = scene.worlds || [scene.world];
    var i;

    this.drawAtmosphere(frame, scene);
    if (scene.show.grid) this.drawGrid(frame, scene);
    if (scene.show.horizon && scene.horizon) this.drawHorizon(scene.horizon, scene.show.labels);

    var views = scene.cubeViews || [{ lines: scene.lines, selected: true }];
    for (i = 0; i < views.length; i++) this.drawShadow(frame, views[i].world || scene.world);

    if (scene.show.lines) {
      var vi;
      if (scene.show.otherLines) {
        for (vi = 0; vi < views.length; vi++) {
          if (views[vi].selected !== false) continue;
          this.drawVanishingLines(views[vi].lines, -1, this.safe, 0.6);
          this.lastStats.lineSets++;
        }
      }
      for (vi = 0; vi < views.length; vi++) {
        if (!views[vi].selected) continue;
        this.drawVanishingLines(views[vi].lines, scene.highlightAxis, this.safe, 1);
        this.lastStats.lineSets++;
      }
    }

    var sorted = worlds.slice().sort(function (a, b) {
      return frame.toCamSpace(b.position)[2] - frame.toCamSpace(a.position)[2];
    });
    for (i = 0; i < sorted.length; i++) {
      this.drawCube(frame, sorted[i], time, sorted[i].selected, scene.show.hidden, scene.show.opaque);
    }
    if (worlds.length > 1) this.drawCubeBadges(scene);
    if (scene.show.points) this.lastStats.vpMarkers = this.drawVanishingPoints(scene, time);
    this.drawGizmo(scene);
    if (scene.dragInfo) this.drawDragInfo(scene.dragInfo);
  };

  /* ============================ 氛围光 ============================ */
  Renderer.prototype.drawAtmosphere = function (frame, scene) {
    var ctx = this.ctx;
    /* 地面光晕（局部绘制，避免全屏渐变开销） */
    var ground = frame.project([scene.world.position[0], 0.002, scene.world.position[2]]);
    if (!ground) return;
    var r = Math.min(frame.focal * 2.4 / Math.max(ground.depth, 0.3), Math.max(this.w, this.h) * 0.8);
    var squash = PL.clamp(Math.sin(frame.pitch) + 0.18, 0.18, 1);
    ctx.save();
    ctx.translate(ground.x, ground.y);
    ctx.scale(1, squash);
    var fg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    fg.addColorStop(0, 'rgba(96,156,232,0.10)');
    fg.addColorStop(0.5, 'rgba(96,156,232,0.04)');
    fg.addColorStop(1, 'rgba(96,156,232,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, PL.TAU);
    ctx.fill();
    ctx.restore();
  };

  /* ============================ 地面网格 ============================ */
  Renderer.prototype.drawGrid = function (frame, scene) {
    var ctx = this.ctx;
    var w = this.w, h = this.h;
    var center = scene.gridCenter;
    var R = 20;
    ctx.save();
    ctx.lineCap = 'round';

    function paint(a, b, alpha, width) {
      if (alpha < 0.006) return;
      var seg = frame.projectSegment(a, b);
      if (!seg) return;
      var clip = PL.clipSegmentRect([seg[0].x, seg[0].y], [seg[1].x, seg[1].y], -80, -80, w + 80, h + 80);
      if (!clip) return;
      ctx.strokeStyle = 'rgba(64,98,158,' + alpha.toFixed(3) + ')';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(clip[0][0], clip[0][1]);
      ctx.lineTo(clip[1][0], clip[1][1]);
      ctx.stroke();
    }

    for (var k = -R; k <= R; k++) {
      var major = k % 5 === 0;
      var fadeX = 1 - PL.smoothstep(8, R - 2, Math.abs(k - center[0]));
      var fadeZ = 1 - PL.smoothstep(8, R - 2, Math.abs(k - center[2]));
      var ax = (0.018 + 0.10 * fadeX) * (major ? 1.6 : 1);
      var az = (0.017 + 0.093 * fadeZ) * (major ? 1.6 : 1);
      paint([k, 0, -R], [k, 0, R], ax, major ? 1.25 : 1);
      paint([-R, 0, k], [R, 0, k], az, major ? 1.25 : 1);
    }

    /* 世界轴在地面上的参考线 */
    paint([-R, 0, 0], [R, 0, 0], 0.05, 1.1);
    paint([0, 0, -R], [0, 0, R], 0.05, 1.1);
    ctx.restore();
  };

  /* ============================ 地平线 ============================ */
  Renderer.prototype.drawHorizon = function (horizon, showLabels) {
    var ctx = this.ctx;
    var safe = this.safe;
    var p0 = horizon[0], p1 = horizon[1];

    var clip = PL.clipSegmentRect([p0.x, p0.y], [p1.x, p1.y],
      safe.left, safe.top, safe.right, safe.bottom);
    if (!clip) return;

    ctx.save();
    ctx.setLineDash([2, 8]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(58,82,126,0.32)';
    ctx.beginPath();
    ctx.moveTo(clip[0][0], clip[0][1]);
    ctx.lineTo(clip[1][0], clip[1][1]);
    ctx.stroke();
    ctx.restore();

    if (!showLabels) return;
    var ly = p0.y + (p1.y - p0.y) * 0.5;
    if (ly < safe.top + 18 || ly > safe.bottom - 8) return;
    ctx.save();
    ctx.font = '500 9px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(80,98,132,0.6)';
    ctx.fillText('地 平 线', safe.right - 10, ly - 22);
    ctx.restore();
  };

  /* ============================ 消失线 ============================ */
  Renderer.prototype.drawVanishingLines = function (lines, highlightAxis, safe, opacity) {
    if (opacity === 0) return;
    opacity = opacity === undefined ? 1 : opacity;
    var ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([4, 6]);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var rgb = AXIS_RGB[line.axis];
      var hot = highlightAxis === line.axis;
      var strength = (line.visible ? 1 : 0.62) * (hot ? 1.55 : 1) * opacity;
      var grad = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
      grad.addColorStop(0, rgba(rgb, 0.88 * strength));
      grad.addColorStop(0.35, rgba(rgb, 0.5 * strength));
      grad.addColorStop(1, rgba(rgb, 0.1 * strength));
      ctx.strokeStyle = grad;
      ctx.lineWidth = hot ? 2.1 : (opacity < 1 ? 1.1 : 1.45);
      ctx.beginPath();
      ctx.moveTo(line.x0, line.y0);
      ctx.lineTo(line.x1, line.y1);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ============================ 立方体阴影 ============================ */
  Renderer.prototype.drawShadow = function (frame, world) {
    var pos = world.position;
    var ground = [pos[0], 0.002, pos[2]];
    var p = frame.project(ground);
    if (!p) return;
    var vis = PL.smoothstep(0.02, 0.2, Math.abs(Math.sin(frame.pitch)));
    if (vis < 0.01) return;
    var ctx = this.ctx;
    var squash = PL.clamp(Math.sin(frame.pitch) + 0.16, 0.16, 1);
    var lift = PL.clamp(1.1 - (pos[1] - 0.9) * 0.26, 0.25, 1.15) * vis;
    var r1 = frame.focal * (world.half || 0.9) * 2.0 / Math.max(p.depth, 0.3);
    var r2 = frame.focal * (world.half || 0.9) * 1.05 / Math.max(p.depth, 0.3);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, squash);

    var soft = ctx.createRadialGradient(0, 0, 0, 0, 0, r1);
    soft.addColorStop(0, 'rgba(70,86,118,' + (0.06 * lift).toFixed(3) + ')');
    soft.addColorStop(0.6, 'rgba(70,86,118,' + (0.024 * lift).toFixed(3) + ')');
    soft.addColorStop(1, 'rgba(70,86,118,0)');
    ctx.fillStyle = soft;
    ctx.beginPath();
    ctx.arc(0, 0, r1, 0, PL.TAU);
    ctx.fill();

    var contact = ctx.createRadialGradient(0, 0, 0, 0, 0, r2);
    contact.addColorStop(0, 'rgba(62,78,108,' + (0.13 * lift).toFixed(3) + ')');
    contact.addColorStop(0.7, 'rgba(62,78,108,' + (0.045 * lift).toFixed(3) + ')');
    contact.addColorStop(1, 'rgba(62,78,108,0)');
    ctx.fillStyle = contact;
    ctx.beginPath();
    ctx.arc(0, 0, r2, 0, PL.TAU);
    ctx.fill();
    ctx.restore();
  };

  /* ============================ 立方体 ============================ */
  Renderer.prototype.drawCube = function (frame, world, time, selected, showHidden, opaque) {
    var ctx = this.ctx;
    var faces = world.faces.slice().sort(function (a, b) { return b.depth - a.depth; });
    var light = PL.vNorm([-0.38, 0.88, 0.5]);

    var i, k;
    for (i = 0; i < faces.length; i++) {
      var face = faces[i];
      if (opaque && !face.visible) continue;
      var poly = [];
      var ok = true;
      var minY = 1e9, maxY = -1e9;
      for (k = 0; k < 4; k++) {
        var pr = frame.project(world.points[face.idx[k]]);
        if (!pr) { ok = false; break; }
        poly.push([pr.x, pr.y]);
        if (pr.y < minY) minY = pr.y;
        if (pr.y > maxY) maxY = pr.y;
      }
      if (!ok) continue;

      var rgb = AXIS_RGB[face.axis];
      var lambert = 0.5 + 0.5 * Math.max(0, PL.vDot(face.normalWorld, light));
      var grad = ctx.createLinearGradient(0, minY, 0, maxY);

      if (opaque) {
        var topC = mixWhite(rgb, 0.66 + 0.16 * lambert);
        var botC = mixWhite(rgb, 0.34 + 0.16 * lambert);
        grad.addColorStop(0, 'rgb(' + topC[0] + ',' + topC[1] + ',' + topC[2] + ')');
        grad.addColorStop(0.55, 'rgb(' + Math.round((topC[0] + botC[0]) / 2) + ',' +
          Math.round((topC[1] + botC[1]) / 2) + ',' + Math.round((topC[2] + botC[2]) / 2) + ')');
        grad.addColorStop(1, 'rgb(' + botC[0] + ',' + botC[1] + ',' + botC[2] + ')');
      } else {
        var baseA = face.visible ? 0.065 + 0.135 * lambert : 0.02;
        grad.addColorStop(0, rgba(rgb, baseA * 1.55));
        grad.addColorStop(0.48, rgba(rgb, baseA));
        grad.addColorStop(1, rgba(rgb, baseA * 0.35));
      }

      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (k = 1; k < 4; k++) ctx.lineTo(poly[k][0], poly[k][1]);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      if (!opaque && face.visible) {
        var sheen = ctx.createLinearGradient(0, minY, 0, minY + (maxY - minY) * 0.75);
        sheen.addColorStop(0, 'rgba(255,255,255,0.30)');
        sheen.addColorStop(0.5, 'rgba(255,255,255,0.06)');
        sheen.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.fill();

        /* 面边缘极淡的描边，增强实体感 */
        ctx.strokeStyle = 'rgba(32,48,80,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /* 选中状态：呼吸光 */
    if (selected) {
      var pulse = 0.55 + 0.45 * Math.sin(time * 2.2);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = 'rgba(75,107,251,' + (0.06 * pulse).toFixed(3) + ')';
      for (i = 0; i < world.edges.length; i++) {
        if (!world.edges[i].visible) continue;
        var s0 = frame.projectSegment(world.points[world.edges[i].a], world.points[world.edges[i].b]);
        if (!s0) continue;
        ctx.beginPath();
        ctx.moveTo(s0[0].x, s0[0].y);
        ctx.lineTo(s0[1].x, s0[1].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 隐藏棱（按轴着色） */
    if (!opaque && showHidden) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      for (i = 0; i < world.edges.length; i++) {
        var eh = world.edges[i];
        if (eh.visible) continue;
        var sh = frame.projectSegment(world.points[eh.a], world.points[eh.b]);
        if (!sh) continue;
        ctx.strokeStyle = rgba(AXIS_RGB[eh.axis], 0.32);
        ctx.beginPath();
        ctx.moveTo(sh[0].x, sh[0].y);
        ctx.lineTo(sh[1].x, sh[1].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 可见棱：彩色光晕 + 白色亮芯 */
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (i = 0; i < world.edges.length; i++) {
      var ev = world.edges[i];
      if (!ev.visible) continue;
      var sv = frame.projectSegment(world.points[ev.a], world.points[ev.b]);
      if (!sv) continue;
      ctx.strokeStyle = rgba(AXIS_RGB[ev.axis], 0.22);
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(sv[0].x, sv[0].y);
      ctx.lineTo(sv[1].x, sv[1].y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    for (i = 0; i < world.edges.length; i++) {
      var ev1 = world.edges[i];
      if (!ev1.visible) continue;
      var sv1 = frame.projectSegment(world.points[ev1.a], world.points[ev1.b]);
      if (!sv1) continue;
      ctx.beginPath();
      ctx.moveTo(sv1[0].x, sv1[0].y);
      ctx.lineTo(sv1[1].x, sv1[1].y);
      ctx.stroke();
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(28,40,64,0.82)';
    for (i = 0; i < world.edges.length; i++) {
      var ev2 = world.edges[i];
      if (!ev2.visible) continue;
      var sv2 = frame.projectSegment(world.points[ev2.a], world.points[ev2.b]);
      if (!sv2) continue;
      ctx.beginPath();
      ctx.moveTo(sv2[0].x, sv2[0].y);
      ctx.lineTo(sv2[1].x, sv2[1].y);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ============================ 消失点 ============================ */
  /* ============================ 立方体编号 ============================ */
  Renderer.prototype.drawCubeBadges = function (scene) {
    var ctx = this.ctx;
    var frame = scene.frame;
    for (var i = 0; i < scene.worlds.length; i++) {
      var w = scene.worlds[i];
      var minX = Infinity, maxX = -Infinity, minY = Infinity, count = 0;
      for (var k = 0; k < w.points.length; k++) {
        var p = frame.project(w.points[k]);
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        count++;
      }
      if (count < 4) continue;
      var cx = (minX + maxX) * 0.5;
      var cy = minY - 17;
      if (cx < 16 || cx > this.w - 16 || cy < 16 || cy > this.h - 16) continue;
      var selected = w.selected;
      var r = 10;
      ctx.save();
      ctx.shadowColor = 'rgba(30,50,90,0.18)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, PL.TAU);
      ctx.fillStyle = selected ? 'rgba(75,107,251,0.96)' : 'rgba(255,255,255,0.95)';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = 1;
      ctx.strokeStyle = selected ? 'rgba(255,255,255,0.85)' : 'rgba(38,66,112,0.18)';
      ctx.stroke();
      ctx.fillStyle = selected ? '#ffffff' : '#41537a';
      ctx.font = '600 9.5px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cx, cy + 0.5);
      ctx.restore();
    }
  };

  Renderer.prototype.drawVanishingPoints = function (scene, time) {
    var ctx = this.ctx;
    var frame = scene.frame;
    var safe = this.safe;
    var pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
    var views = scene.cubeViews || [{ vps: scene.vps, selected: true, world: scene.world }];
    var entries = [];
    var seen = Object.create(null);
    for (var vi = 0; vi < views.length; vi++) {
      var cv = views[vi];
      if (!cv.selected && !scene.show.otherPoints) continue;
      var cpv = frame.project(cv.world ? cv.world.position : scene.world.position) ||
        { x: frame.cx, y: frame.cy };
      for (var ai = 0; ai < cv.vps.axes.length; ai++) {
        var pert = cv.vps.axes[ai];
        if (pert.infinite) continue;
        var key = ai + '|' + Math.round(pert.x) + '|' + Math.round(pert.y);
        var exist = seen[key];
        if (exist) {
          if (cv.selected) { exist.selected = true; exist.cp = cpv; }
          continue;
        }
        exist = { axis: ai, vp: pert, selected: !!cv.selected, cp: cpv };
        seen[key] = exist;
        entries.push(exist);
      }
    }
    entries.sort(function (a, b) { return (a.selected ? 1 : 0) - (b.selected ? 1 : 0); });

    for (var ei = 0; ei < entries.length; ei++) {
      var entry = entries[ei];
      var vp = entry.vp;
      var i = entry.axis;
      var cp = entry.cp;
      var isSel = entry.selected;
      var rgb = AXIS_RGB[i];
      var color = AXIS_HEX[i];
      var letter = 'XYZ'[i];
      var isHot = isSel && scene.highlightAxis === i;

      if (isSel && vp.onScreen) {
        var x = vp.x, y = vp.y;
        ctx.save();
        var glow = ctx.createRadialGradient(x, y, 0, x, y, 40);
        glow.addColorStop(0, rgba(rgb, isHot ? 0.5 : 0.34));
        glow.addColorStop(0.4, rgba(rgb, isHot ? 0.17 : 0.11));
        glow.addColorStop(1, rgba(rgb, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 40, 0, PL.TAU);
        ctx.fill();

        ctx.strokeStyle = rgba(rgb, 0.72);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x - 17, y); ctx.lineTo(x - 7, y);
        ctx.moveTo(x + 7, y); ctx.lineTo(x + 17, y);
        ctx.moveTo(x, y - 17); ctx.lineTo(x, y - 7);
        ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 17);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, 10.5 + pulse * 2.5, 0, PL.TAU);
        ctx.strokeStyle = rgba(rgb, 0.46);
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, 3.7, 0, PL.TAU);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1.7;
        ctx.stroke();
        ctx.restore();

        if (scene.show.labels) {
          var text = 'VP ' + letter;
          var tw = 0;
          ctx.save();
          ctx.font = '600 10px ' + FONT;
          tw = ctx.measureText(text).width + 16;
          ctx.restore();
          var lx = x + 17;
          if (lx + tw > safe.right - 6) lx = x - tw - 17;
          this.chip(lx, y - 27, text, rgba(rgb, 0.98), rgba(rgb, 0.38));
        }
      } else if (isSel) {
        /* 屏幕外（绘图区外）：沿方向在安全区边缘放置指示器 */
        var dx = vp.x - cp.x, dy = vp.y - cp.y;
        var len = Math.hypot(dx, dy);
        if (len < 1) continue;
        dx /= len; dy /= len;
        var tx = dx > 0 ? (safe.right - cp.x) / dx : dx < 0 ? (safe.left - cp.x) / dx : Infinity;
        var ty = dy > 0 ? (safe.bottom - cp.y) / dy : dy < 0 ? (safe.top - cp.y) / dy : Infinity;
        var t = Math.min(tx, ty);
        if (!isFinite(t) || t <= 0) continue;
        var ex = cp.x + dx * t, ey = cp.y + dy * t;
        var ang = Math.atan2(dy, dx);

        ctx.save();
        var glow2 = ctx.createRadialGradient(ex, ey, 0, ex, ey, 26);
        glow2.addColorStop(0, rgba(rgb, isHot ? 0.4 : 0.24));
        glow2.addColorStop(1, rgba(rgb, 0));
        ctx.fillStyle = glow2;
        ctx.beginPath();
        ctx.arc(ex, ey, 26, 0, PL.TAU);
        ctx.fill();

        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-6, 5.4);
        ctx.lineTo(-6, -5.4);
        ctx.closePath();
        ctx.fillStyle = rgba(rgb, 0.92);
        ctx.fill();
        ctx.restore();

        if (scene.show.labels) {
          var ctext = 'VP ' + letter + ' · ' + fmtDist(vp.dist);
          ctx.save();
          ctx.font = '600 9.5px ' + FONT;
          var cw = ctx.measureText(ctext).width + 16;
          ctx.restore();
          var cx2 = ex - dx * (cw * 0.5 + 18);
          var cy2 = ey - dy * (cw * 0.5 + 18);
          /* 保持在安全区内 */
          cx2 = PL.clamp(cx2, safe.left + cw * 0.5 + 4, safe.right - cw * 0.5 - 4);
          cy2 = PL.clamp(cy2, safe.top + 12, safe.bottom - 12);
          this.chip(cx2 - cw * 0.5, cy2 - 9, ctext, rgba(rgb, 0.98), rgba(rgb, 0.38));
        }
      } else if (vp.onScreen) {
        /* 未选中立方体：较小的消失点标记 */
        var ox = vp.x, oy = vp.y;
        ctx.save();
        var glowO = ctx.createRadialGradient(ox, oy, 0, ox, oy, 24);
        glowO.addColorStop(0, rgba(rgb, 0.22));
        glowO.addColorStop(1, rgba(rgb, 0));
        ctx.fillStyle = glowO;
        ctx.beginPath();
        ctx.arc(ox, oy, 24, 0, PL.TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ox, oy, 7, 0, PL.TAU);
        ctx.strokeStyle = rgba(rgb, 0.6);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, PL.TAU);
        ctx.fillStyle = rgba(rgb, 0.92);
        ctx.fill();
        ctx.restore();
      } else {
        /* 未选中立方体：屏幕外的小箭头 */
        var dxO = vp.x - cp.x, dyO = vp.y - cp.y;
        var lenO = Math.hypot(dxO, dyO);
        if (lenO < 1) continue;
        dxO /= lenO; dyO /= lenO;
        var txO = dxO > 0 ? (safe.right - cp.x) / dxO : dxO < 0 ? (safe.left - cp.x) / dxO : Infinity;
        var tyO = dyO > 0 ? (safe.bottom - cp.y) / dyO : dyO < 0 ? (safe.top - cp.y) / dyO : Infinity;
        var tO = Math.min(txO, tyO);
        if (!isFinite(tO) || tO <= 0) continue;
        var exO = cp.x + dxO * tO, eyO = cp.y + dyO * tO;
        var angO = Math.atan2(dyO, dxO);
        ctx.save();
        var gO = ctx.createRadialGradient(exO, eyO, 0, exO, eyO, 16);
        gO.addColorStop(0, rgba(rgb, 0.16));
        gO.addColorStop(1, rgba(rgb, 0));
        ctx.fillStyle = gO;
        ctx.beginPath();
        ctx.arc(exO, eyO, 16, 0, PL.TAU);
        ctx.fill();
        ctx.translate(exO, eyO);
        ctx.rotate(angO);
        ctx.beginPath();
        ctx.moveTo(5.5, 0);
        ctx.lineTo(-4.8, 4);
        ctx.lineTo(-4.8, -4);
        ctx.closePath();
        ctx.fillStyle = rgba(rgb, 0.62);
        ctx.fill();
        ctx.restore();
      }
    }
    return entries.length;
  };

  Renderer.prototype.chip = function (x, y, text, color, border) {
    var ctx = this.ctx;
    ctx.save();
    ctx.font = '600 9.5px ' + FONT;
    var tw = ctx.measureText(text).width;
    var padX = 8, hgt = 19;
    var w = tw + padX * 2;
    ctx.shadowColor = 'rgba(30,50,90,0.16)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, x, y, w, hgt, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = border || 'rgba(38,66,112,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w * 0.5, y + hgt * 0.5 + 0.5);
    ctx.restore();
  };

  /* ============================ 变换手柄 ============================ */
  Renderer.prototype.drawGizmo = function (scene) {
    var gizmo = scene.gizmo;
    if (!gizmo || !gizmo.length) return;
    var ctx = this.ctx;
    var hover = scene.hoverHandle;
    var active = scene.activeHandle;
    var ref = active || hover;
    var spaceCN = scene.space === 'local' ? '本地' : '全局';

    if (scene.mode === 'move') {
      /* 平面二维移动手柄（半透明方块） */
      for (var pi = 0; pi < gizmo.length; pi++) {
        var ph = gizmo[pi];
        if (ph.mode !== 'move-plane') continue;
        var prgb = AXIS_RGB[ph.axis];
        var plit = ref && ref.mode === 'move-plane' && ref.plane &&
          ref.plane[0] === ph.plane[0] && ref.plane[1] === ph.plane[1];
        var pdim = ref && !plit ? 0.35 : 1;
        var pts0 = ph.points;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts0[0].x, pts0[0].y);
        for (var pk = 1; pk < pts0.length; pk++) ctx.lineTo(pts0[pk].x, pts0[pk].y);
        ctx.closePath();
        ctx.fillStyle = rgba(prgb, (plit ? 0.22 : 0.085) * pdim);
        ctx.fill();
        ctx.strokeStyle = rgba(prgb, (plit ? 0.9 : 0.4) * pdim);
        ctx.lineWidth = plit ? 1.8 : 1.1;
        if (plit) { ctx.shadowColor = rgba(prgb, 0.8); ctx.shadowBlur = 12; }
        ctx.stroke();
        ctx.restore();
        if (plit && scene.show.labels) {
          var pcx = 0, pcy = 0;
          for (var pj = 0; pj < pts0.length; pj++) { pcx += pts0[pj].x; pcy += pts0[pj].y; }
          pcx /= pts0.length; pcy /= pts0.length;
          this.chip(pcx + 8, pcy - 30, ph.label + ' · ' + spaceCN + '平面移动', rgba(prgb, 0.98), rgba(prgb, 0.42));
        }
      }

      for (var i = 0; i < gizmo.length; i++) {
        var handle = gizmo[i];
        if (handle.mode !== 'move') continue;
        var rgb = AXIS_RGB[handle.axis];
        var lit = !!(ref && ref.mode === 'move' && ref.axis === handle.axis);
        var dim = ref && !lit ? 0.3 : 1;

        if (handle.degenerate) {
          ctx.save();
          ctx.strokeStyle = rgba(rgb, (lit ? 1 : 0.85) * dim);
          ctx.lineWidth = lit ? 2.6 : 1.9;
          if (lit) { ctx.shadowColor = rgba(rgb, 0.9); ctx.shadowBlur = 14; }
          ctx.beginPath();
          ctx.arc(handle.ox, handle.oy, 10, 0, PL.TAU);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(handle.ox, handle.oy, 3.2, 0, PL.TAU);
          ctx.fillStyle = rgba(rgb, (lit ? 1 : 0.9) * dim);
          ctx.fill();
          ctx.restore();

          ctx.save();
          ctx.font = '700 8.5px ' + FONT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = rgba(rgb, (lit ? 1 : 0.85));
          ctx.fillText('XYZ'[handle.axis], handle.ox - 16, handle.oy - 14);
          ctx.restore();

          if (lit && scene.show.labels) {
            this.chip(handle.ox + 22, handle.oy - 30, 'XYZ'[handle.axis] + ' 轴 · ' + spaceCN + '深度', rgba(rgb, 0.98), rgba(rgb, 0.42));
          }
          continue;
        }

        var dx = handle.tx - handle.ox, dy = handle.ty - handle.oy;
        if (Math.hypot(dx, dy) < 4) continue;

        ctx.save();
        ctx.lineCap = 'round';
        /* 白色描边，保证在浅色场景中清晰 */
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = lit ? 6 : 5;
        ctx.beginPath();
        ctx.moveTo(handle.ox, handle.oy);
        ctx.lineTo(handle.tx, handle.ty);
        ctx.stroke();

        ctx.strokeStyle = rgba(rgb, (lit ? 1 : 0.88) * dim);
        ctx.lineWidth = lit ? 3 : 2.4;
        if (lit) { ctx.shadowColor = rgba(rgb, 0.9); ctx.shadowBlur = 14; }
        ctx.beginPath();
        ctx.moveTo(handle.ox, handle.oy);
        ctx.lineTo(handle.tx, handle.ty);
        ctx.stroke();

        var ang = Math.atan2(dy, dx);
        var size = lit ? 12 : 10.5;
        ctx.beginPath();
        ctx.moveTo(handle.tx, handle.ty);
        ctx.lineTo(handle.tx - Math.cos(ang - 0.42) * size, handle.ty - Math.sin(ang - 0.42) * size);
        ctx.lineTo(handle.tx - Math.cos(ang + 0.42) * size, handle.ty - Math.sin(ang + 0.42) * size);
        ctx.closePath();
        ctx.fillStyle = rgba(rgb, (lit ? 1 : 0.92) * dim);
        ctx.fill();
        ctx.restore();

        if (lit && scene.show.labels) {
          this.chip(handle.tx + 11, handle.ty - 28, 'XYZ'[handle.axis] + ' 轴 · ' + spaceCN + '移动', rgba(rgb, 0.98), rgba(rgb, 0.42));
        }
      }

      /* 中心点 */
      var ox = gizmo[0] ? gizmo[0].ox : null;
      if (ox !== null) {
        ctx.save();
        ctx.fillStyle = 'rgba(35,50,80,0.85)';
        ctx.beginPath();
        ctx.arc(ox, gizmo[0].oy, 2.2, 0, PL.TAU);
        ctx.fill();
        ctx.restore();
      }
    } else {
      var passes = [0, 1]; /* 0 = 背面, 1 = 正面 */
      for (var p = 0; p < 2; p++) {
        for (var j = 0; j < gizmo.length; j++) {
          var ring = gizmo[j];
          if (ring.mode !== 'rotate') continue;
          var rgb2 = AXIS_RGB[ring.axis];
          var lit2 = !!(ref && ref.mode === 'rotate' && ref.axis === ring.axis);
          var dim2 = ref && ref.mode !== 'rotate-view' && !lit2 ? 0.26 : 1;
          ctx.save();
          ctx.lineWidth = lit2 ? 2.8 : 1.8;
          ctx.strokeStyle = rgba(rgb2, (lit2 ? 1 : p === 1 ? 0.7 : 0.22) * dim2);
          if (lit2) { ctx.shadowColor = rgba(rgb2, 0.85); ctx.shadowBlur = 12; }
          ctx.beginPath();
          var started = false;
          for (var k = 0; k < ring.points.length - 1; k++) {
            var a0 = ring.points[k], a1 = ring.points[k + 1];
            if (!a0 || !a1) { started = false; continue; }
            var front = a0.depth <= ring.centerDepth && a1.depth <= ring.centerDepth;
            if ((p === 0 && front) || (p === 1 && !front)) { started = false; continue; }
            if (!started) { ctx.moveTo(a0.x, a0.y); started = true; }
            ctx.lineTo(a1.x, a1.y);
          }
          ctx.stroke();
          ctx.restore();

          if (lit2 && scene.show.labels && p === 1) {
            var labelPt = ring.points[Math.floor(ring.points.length * 0.125)];
            if (labelPt) this.chip(labelPt.x + 12, labelPt.y - 26, 'XYZ'[ring.axis] + ' 轴 · ' + spaceCN + '旋转', rgba(rgb2, 0.98), rgba(rgb2, 0.42));
          }
        }
      }

      /* 最外层白色自由旋转外环 */
      for (var vj = 0; vj < gizmo.length; vj++) {
        var vh = gizmo[vj];
        if (vh.mode !== 'rotate-view') continue;
        var vlit = !!(ref && ref.mode === 'rotate-view');
        ctx.save();
        ctx.beginPath();
        ctx.arc(vh.ox, vh.oy, vh.radius, 0, PL.TAU);
        ctx.strokeStyle = vlit ? 'rgba(75,107,251,0.5)' : 'rgba(40,60,100,0.22)';
        ctx.lineWidth = vlit ? 5.5 : 4.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(vh.ox, vh.oy, vh.radius, 0, PL.TAU);
        ctx.strokeStyle = vlit ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.92)';
        ctx.lineWidth = vlit ? 3 : 2.1;
        ctx.shadowColor = vlit ? 'rgba(75,107,251,0.6)' : 'rgba(30,50,90,0.18)';
        ctx.shadowBlur = vlit ? 12 : 5;
        ctx.stroke();
        ctx.restore();
        if (vlit && scene.show.labels) {
          this.chip(vh.ox + vh.radius * 0.66, vh.oy - vh.radius * 0.66 - 28,
            '自由旋转 · 视角方向', rgba([40, 58, 96], 0.95), 'rgba(75,107,251,0.45)');
        }
      }
    }
  };

  Renderer.prototype.drawDragInfo = function (info) {
    var ctx = this.ctx;
    var rgb = AXIS_RGB[info.axis] || [75, 107, 251];
    ctx.save();
    ctx.font = '600 11px ' + FONT_MONO;
    var tw = ctx.measureText(info.text).width;
    var w = tw + 22, h = 26;
    var x = info.x + 18, y = info.y - 38;
    roundRect(ctx, x, y, w, h, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.strokeStyle = rgba(rgb, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = rgba(rgb, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.text, x + w * 0.5, y + h * 0.5 + 0.5);
    ctx.restore();
  };

  global.PLRenderer = Renderer;
  global.PL_AXIS_HEX = AXIS_HEX;
  global.PL_AXIS_RGB = AXIS_RGB;
})(typeof window !== 'undefined' ? window : globalThis);
