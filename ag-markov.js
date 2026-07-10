// AG 马尔科夫路单分析 - 远程逻辑脚本
// 部署到 GitHub Pages，由油猴 loader 动态加载
// 更新此文件并推送即可生效，无需重装油猴脚本

(function() {
  'use strict';

  // 防止重复执行
  if (window.__MK_LOADED__) return;
  window.__MK_LOADED__ = true;

  // ── 配置 ──────────────────────────────────────
  var PREDICT_LEN = 4;
  var POLL_INTERVAL = 3000;

  var pollTimer = null;
  var panelCreated = false;

  // ── 马尔科夫核心算法 ──────────────────────────
  function buildMarkov1(seq) {
    var counts = { '0': { '0': 0, '1': 0 }, '1': { '0': 0, '1': 0 } };
    for (var i = 0; i < seq.length - 1; i++) {
      counts[seq[i]][seq[i + 1]]++;
    }
    var prob = {};
    var states = ['0', '1'];
    for (var si = 0; si < states.length; si++) {
      var from = states[si];
      var total = counts[from]['0'] + counts[from]['1'];
      prob[from] = {
        '0': total ? counts[from]['0'] / total : 0.5,
        '1': total ? counts[from]['1'] / total : 0.5
      };
    }
    return prob;
  }

  function predictTop1(seq) {
    if (seq.length < 3) return null;
    var prob = buildMarkov1(seq);
    var lastBit = seq[seq.length - 1];
    var n = PREDICT_LEN;
    var total = Math.pow(2, n);
    var bestBits = '';
    var bestP = -1;

    for (var mask = 0; mask < total; mask++) {
      var bits = mask.toString(2).padStart(n, '0');
      var p = 1;
      var cur = lastBit;
      for (var j = 0; j < bits.length; j++) {
        p *= prob[cur][bits[j]];
        cur = bits[j];
      }
      if (p > bestP) {
        bestP = p;
        bestBits = bits;
      }
    }
    return { bits: bestBits, p: bestP };
  }

  // ── 数据提取 ──────────────────────────────────
  function toSequence(list) {
    if (!list || list.length === 0) return [];
    var flat = Array.isArray(list[0]) ? list.flat() : list;
    return flat
      .filter(function(b) { return b.winType === 1 || b.winType === 2; })
      .map(function(b) { return b.winType === 1 ? '0' : '1'; });
  }

  function getRoadData() {
    if (!window.GameBac) return null;
    if (!GameBac.RoadMapStore) return null;
    if (!GameBac.RoadMapStore._instance) return null;
    var rd = GameBac.RoadMapStore._instance.roadData;
    if (!rd) return null;

    var vid = '\u672A\u77E5';
    try {
      vid = GameBac.RoadMapStore._instance.indexStore.validVidList[0] || '\u672A\u77E5';
    } catch(e) {}

    return {
      vid: vid,
      stats: { zhuang: rd.redCount, xian: rd.blueCount, he: rd.tieCount, total: rd.totalCount },
      daLu: toSequence(rd.daLuProto),
      daYan: toSequence(rd.daYanLuData),
      xiaoLu: toSequence(rd.xiaoLuData),
      xiaoQiang: toSequence(rd.xiaoQiangLuData)
    };
  }

  // ── 浮窗UI ────────────────────────────────────
  function createPanel() {
    if (panelCreated) return;
    if (!document.body) return;

    var old = document.getElementById('mk-float-panel');
    if (old) old.remove();

    var panel = document.createElement('div');
    panel.id = 'mk-float-panel';
    panel.innerHTML =
      '<div id="mk-header" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(124,58,237,0.2);border-radius:10px 10px 0 0;font-weight:600;font-size:12px;cursor:move;">' +
        '<span>\u{1F52E} \u9A6C\u5C14\u79D1\u592B\u9884\u6D4B</span>' +
        '<span id="mk-minimize" style="cursor:pointer;font-size:14px;">\u2014</span>' +
      '</div>' +
      '<div id="mk-body" style="padding:10px 12px;">' +
        '<div id="mk-status" style="font-size:11px;color:#94a3b8;margin-bottom:8px;">\u7B49\u5F85\u8FDB\u5165\u623F\u95F4...</div>' +
        '<div id="mk-results"></div>' +
      '</div>';

    panel.style.cssText = 'position:fixed;top:10px;left:10px;z-index:2147483647;background:rgba(15,15,26,0.95);border:2px solid #7c3aed;border-radius:10px;font-family:"Microsoft YaHei","Segoe UI",sans-serif;font-size:13px;color:#e0e0f0;min-width:220px;box-shadow:0 4px 20px rgba(124,58,237,0.4);pointer-events:auto;display:block;visibility:visible;opacity:1;';

    document.body.appendChild(panel);
    panelCreated = true;

    // 拖拽
    var header = document.getElementById('mk-header');
    var dragging = false, offsetX = 0, offsetY = 0;
    header.addEventListener('mousedown', function(e) {
      dragging = true;
      offsetX = e.clientX - panel.offsetLeft;
      offsetY = e.clientY - panel.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      panel.style.left = (e.clientX - offsetX) + 'px';
      panel.style.top = (e.clientY - offsetY) + 'px';
    });
    document.addEventListener('mouseup', function() { dragging = false; });

    // 最小化
    document.getElementById('mk-minimize').addEventListener('click', function() {
      var body = document.getElementById('mk-body');
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      this.textContent = hidden ? '\u2014' : '\uFF0B';
    });

    console.log('[MK] \u6D6E\u7A97\u5DF2\u521B\u5EFA');
  }

  function colorBits(bits) {
    return bits.split('').map(function(b) {
      var color = b === '0' ? '#ff4d4f' : '#4da6ff';
      return '<span style="color:' + color + '">' + b + '</span>';
    }).join('');
  }

  function colorLabel(bits, type) {
    return '(' + bits.split('').map(function(b) {
      if (type === 'daLu') {
        if (b === '0') return '<span style="color:#ff4d4f">\u5E84</span>';
        return '<span style="color:#4da6ff">\u95F2</span>';
      } else {
        if (b === '0') return '<span style="color:#ff4d4f">\u7EA2</span>';
        return '<span style="color:#4da6ff">\u84DD</span>';
      }
    }).join('') + ')';
  }

  function updatePanel(data) {
    var statusEl = document.getElementById('mk-status');
    var resultsEl = document.getElementById('mk-results');
    if (!statusEl || !resultsEl) return;

    if (!data) {
      statusEl.textContent = '\u7B49\u5F85\u8FDB\u5165\u623F\u95F4...';
      resultsEl.innerHTML = '';
      return;
    }

    statusEl.textContent = '\u623F\u95F4 ' + data.vid + ' | \u5E84' + data.stats.zhuang + ' \u95F2' + data.stats.xian + ' \u548C' + data.stats.he + ' | \u5171' + data.stats.total + '\u5C40';

    var roads = [
      { name: '\u5927\u8DEF', seq: data.daLu, type: 'daLu' },
      { name: '\u5927\u773C', seq: data.daYan, type: 'other' },
      { name: '\u5C0F\u8DEF', seq: data.xiaoLu, type: 'other' },
      { name: '\u5C0F\u5F3A', seq: data.xiaoQiang, type: 'other' }
    ];

    var html = '';
    for (var i = 0; i < roads.length; i++) {
      var road = roads[i];
      var top1 = predictTop1(road.seq);
      if (top1) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(42,42,74,0.6);">' +
          '<span style="font-size:11px;color:#818cf8;font-weight:600;">' + road.name + '</span>' +
          '<span>' +
            '<span style="font-family:Courier New,monospace;font-size:13px;font-weight:700;letter-spacing:0.1em;">' + colorBits(top1.bits) + '</span>' +
            '<span style="font-size:10px;margin-left:4px;">' + colorLabel(top1.bits, road.type) + '</span>' +
            '<span style="font-size:11px;color:#34d399;margin-left:6px;">' + (top1.p * 100).toFixed(2) + '%</span>' +
          '</span>' +
        '</div>';
      } else {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(42,42,74,0.6);">' +
          '<span style="font-size:11px;color:#818cf8;font-weight:600;">' + road.name + '</span>' +
          '<span style="font-size:11px;color:#6b6b8a;">\u6570\u636E\u4E0D\u8DB3</span>' +
        '</div>';
      }
    }
    resultsEl.innerHTML = html;
  }

  // ── 轮询逻辑 ──────────────────────────────────
  function poll() {
    if (!panelCreated) createPanel();
    if (!document.getElementById('mk-float-panel')) {
      panelCreated = false;
      createPanel();
    }
    var data = getRoadData();
    updatePanel(data);
  }

  function startPolling() {
    if (pollTimer) return;
    createPanel();
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
    console.log('[MK] \u8F6E\u8BE2\u5DF2\u542F\u52A8');
  }

  // ── 启动 ──────────────────────────────────────
  function tryStart() {
    if (document.body) {
      startPolling();
    } else {
      setTimeout(tryStart, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(tryStart, 500);
    });
  } else {
    setTimeout(tryStart, 500);
  }

})();
