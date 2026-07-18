  // AG 马尔科夫路单分析 - 远程逻辑脚本
  // 部署到 GitHub Pages，由油猴 loader 动态加载
  // 更新此文件并推送即可生效，无需重装油猴脚本

  (function() {
    'use strict';

    if (window.__MK_LOADED__) return;
    window.__MK_LOADED__ = true;

    // ── 配置 ──────────────────────────────────────
    var PREDICT_LEN = 4;
    var POLL_INTERVAL = 3000;
    var pollTimer = null;
    var panelCreated = false;

    // ── 每日计算额度 ──────────────────────────────
    var DAILY_LIMIT = 60;
    var STORAGE_KEY_COUNT = 'mk_daily_count';
    var STORAGE_KEY_DATE  = 'mk_daily_date';

    function getTodayStr() {
      var d = new Date();
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function getDailyUsed() {
      var today = getTodayStr();
      var savedDate = localStorage.getItem(STORAGE_KEY_DATE);
      if (savedDate !== today) {
        // 新的一天，重置计数
        localStorage.setItem(STORAGE_KEY_DATE, today);
        localStorage.setItem(STORAGE_KEY_COUNT, '0');
        return 0;
      }
      return parseInt(localStorage.getItem(STORAGE_KEY_COUNT) || '0', 10);
    }

    function addDailyUsed() {
      var today = getTodayStr();
      localStorage.setItem(STORAGE_KEY_DATE, today);
      var cur = getDailyUsed();
      var next = cur + 1;
      localStorage.setItem(STORAGE_KEY_COUNT, String(next));
      return next;
    }

    // 每次进入房间调用一次，返回当前已用次数（含本次）
    function onEnterRoom() {
      return addDailyUsed();
    }

    function isLimitReached() {
      return getDailyUsed() >= DAILY_LIMIT;
    }

    function getRemaining() {
      return Math.max(0, DAILY_LIMIT - getDailyUsed());
    }

    // ── 一阶马尔科夫 ──────────────────────────────
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

    function predictTop1Order1(seq) {
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
        if (p > bestP) { bestP = p; bestBits = bits; }
      }
      return { bits: bestBits, p: bestP };
    }

    // ── 二阶马尔科夫 ──────────────────────────────
    function buildMarkov2(seq) {
      var states = ['00', '01', '10', '11'];
      var counts = {};
      for (var si = 0; si < states.length; si++) counts[states[si]] = { '0': 0, '1': 0 };
      for (var i = 0; i < seq.length - 2; i++) {
        var from = seq[i] + seq[i + 1];
        if (counts[from]) counts[from][seq[i + 2]]++;
      }
      var prob = {};
      for (var si2 = 0; si2 < states.length; si2++) {
        var s = states[si2];
        var total = counts[s]['0'] + counts[s]['1'];
        prob[s] = {
          '0': total ? counts[s]['0'] / total : 0.5,
          '1': total ? counts[s]['1'] / total : 0.5
        };
      }
      return prob;
    }

    function predictTop1Order2(seq) {
      if (seq.length < 5) return null;
      var prob = buildMarkov2(seq);
    var lastTwo = seq[seq.length - 2] + seq[seq.length - 1];
    var n = PREDICT_LEN;
    var total = Math.pow(2, n);
    var bestBits = '';
    var bestP = -1;
    for (var mask = 0; mask < total; mask++) {
      var bits = mask.toString(2).padStart(n, '0');
      var p = 1;
      var cur = lastTwo;
      for (var j = 0; j < bits.length; j++) {
        p *= (prob[cur] ? prob[cur][bits[j]] : 0.5);
        cur = cur[1] + bits[j];
      }
      if (p > bestP) { bestP = p; bestBits = bits; }
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

  function getColLens(daLuData) {
    var colLens = [];
    if (!daLuData) return colLens;
    for (var c = 0; c < daLuData.length; c++) {
      var col = daLuData[c];
      var count = 0;
      if (Array.isArray(col)) {
        for (var r = 0; r < col.length; r++) {
          if (col[r].winType === 1 || col[r].winType === 2) count++;
        }
      }
      colLens.push(count);
    }
    return colLens;
  }

  function getRoadData() {
    if (!window.GameBac) return null;
    if (!GameBac.RoadMapStore) return null;
    if (!GameBac.RoadMapStore._instance) return null;
    var rd = GameBac.RoadMapStore._instance.roadData;
    if (!rd) return null;

    var vid = '\u672A\u77E5';
    try { vid = GameBac.RoadMapStore._instance.indexStore.validVidList[0] || '\u672A\u77E5'; } catch(e) {}

    // 大路列结构信息
    var colLens = getColLens(rd.daLuData);
    var lastColType = 0; // 最后一列的类型 1=庄 2=闲
    var lastColLen = 0;
    if (rd.daLuData && rd.daLuData.length > 0) {
      for (var c = rd.daLuData.length - 1; c >= 0; c--) {
        var col = rd.daLuData[c];
        if (Array.isArray(col)) {
          for (var r = 0; r < col.length; r++) {
            if (col[r].winType === 1 || col[r].winType === 2) {
              if (lastColType === 0) lastColType = col[r].winType;
              lastColLen++;
            }
          }
          if (lastColLen > 0) break;
        }
      }
    }

    return {
      vid: vid,
      stats: { zhuang: rd.redCount, xian: rd.blueCount, he: rd.tieCount, total: rd.totalCount },
      daLu: toSequence(rd.daLuProto),
      daYan: toSequence(rd.daYanLuData),
      xiaoLu: toSequence(rd.xiaoLuData),
      xiaoQiang: toSequence(rd.xiaoQiangLuData),
      colLens: colLens,
      lastColType: lastColType, // 1=庄 2=闲
      lastColLen: lastColLen    // 当前最后一列的长度
    };
  }

  // ── 派生路红蓝转庄闲（验证通过版本） ──────────
  // offset: 大眼路=1, 小路=2, 小强路=3
  //
  // 规则：
  //   续列(row>0): 检查「当前列往前offset列」在同行是否有格 → 有=红，无=蓝
  //   新列(row=0): 比较「前1列长」vs「前(1+offset)列长」，相等=红，不等=蓝
  //
  // 关键：更新列结构时用「本把预测结果的反面」
  //   因为继续下一把的前提是本把没中，没中=实际出了反面

  function simulateDerivedColor(colLens, lastType, lastLen, addType, offset) {
    var totalCols = colLens.length;
    if (addType === lastType) {
      // 续列：新格行号 = lastLen，检查前offset列在该行是否有格
      var curRow      = lastLen;
      var checkColIdx = totalCols - 1 - offset;
      var checkLen    = (checkColIdx >= 0 ? colLens[checkColIdx] : 0) || 0;
      return (curRow < checkLen); // true=红, false=蓝
    } else {
      // 新列：比较前1列长 vs 前(1+offset)列长
      var prevLen  = colLens[totalCols - 1] || 0;
      var prev2Len = (totalCols - 1 - offset >= 0 ? colLens[totalCols - 1 - offset] : 0) || 0;
      return (prevLen === prev2Len); // 相等=红, 不等=蓝
    }
  }

  function derivedBitsToZX(predictedBits, colLens, lastColType, lastColLen, gapCols) {
    // 返回庄闲序列字符串，1=庄→'0', 2=闲→'1'
    var result      = '';
    var simColLens  = colLens.slice();
    var simLastType = lastColType;
    var simLastLen  = lastColLen;

    for (var i = 0; i < predictedBits.length; i++) {
      var predictedRed = (predictedBits[i] === '0'); // true=红, false=蓝

      // 试庄(1)和闲(2)，看哪个产生匹配颜色
      var matched = 0;
      for (var tryType = 1; tryType <= 2; tryType++) {
        var genRed = simulateDerivedColor(simColLens, simLastType, simLastLen, tryType, gapCols);
        if (genRed === predictedRed) { matched = tryType; break; }
      }
      if (matched === 0) matched = simLastType; // 兜底

      result += (matched === 1) ? '0' : '1';

      // 用反面更新列结构（本把没中才继续，实际出了反面）
      var actualType = (matched === 1) ? 2 : 1;
      if (actualType === simLastType) {
        simLastLen++;
        simColLens[simColLens.length - 1] = simLastLen;
      } else {
        simColLens.push(1);
        simLastType = actualType;
        simLastLen  = 1;
      }
    }

    return result;
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
        '<span>🔮 马尔科夫预测</span>' +
        '<span id="mk-minimize" style="cursor:pointer;font-size:14px;">—</span>' +
      '</div>' +
      '<div id="mk-quota" style="padding:4px 12px;background:rgba(124,58,237,0.08);border-bottom:1px solid rgba(124,58,237,0.2);font-size:11px;color:#94a3b8;text-align:right;">今日剩余 <span style="color:#34d399;font-weight:700;">60</span> 次</div>' +
      '<div id="mk-body" style="padding:10px 12px;">' +
        '<div id="mk-status" style="font-size:11px;color:#94a3b8;margin-bottom:8px;">等待进入房间...</div>' +
        '<div id="mk-results"></div>' +
      '</div>';
    panel.style.cssText = 'position:fixed;top:10px;left:10px;z-index:2147483647;background:rgba(15,15,26,0.95);border:2px solid #7c3aed;border-radius:10px;font-family:"Microsoft YaHei","Segoe UI",sans-serif;font-size:13px;color:#e0e0f0;min-width:260px;box-shadow:0 4px 20px rgba(124,58,237,0.4);pointer-events:auto;display:block;visibility:visible;opacity:1;';
    document.body.appendChild(panel);
    panelCreated = true;

    var header = document.getElementById('mk-header');
    var dragging = false, offsetX = 0, offsetY = 0;
    header.addEventListener('mousedown', function(e) {
      dragging = true; offsetX = e.clientX - panel.offsetLeft; offsetY = e.clientY - panel.offsetTop; e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) { if (!dragging) return; panel.style.left = (e.clientX - offsetX) + 'px'; panel.style.top = (e.clientY - offsetY) + 'px'; });
    document.addEventListener('mouseup', function() { dragging = false; });
    document.getElementById('mk-minimize').addEventListener('click', function() {
      var body = document.getElementById('mk-body');
      var quota = document.getElementById('mk-quota');
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      if (quota) quota.style.display = hidden ? '' : 'none';
      this.textContent = hidden ? '—' : '＋';
    });
    console.log('[MK] \u6D6E\u7A97\u5DF2\u521B\u5EFA');
  }

  function colorZX(bits) {
    return bits.split('').map(function(b) {
      var color = b === '0' ? '#ff4d4f' : '#4da6ff';
      return '<span style="color:' + color + '">' + b + '</span>';
    }).join('');
  }

  function zxLabel(bits) {
    return '(' + bits.split('').map(function(b) {
      if (b === '0') return '<span style="color:#ff4d4f">\u5E84</span>';
      return '<span style="color:#4da6ff">\u95F2</span>';
    }).join('') + ')';
  }

  function updatePanel(data) {
    var statusEl = document.getElementById('mk-status');
    var resultsEl = document.getElementById('mk-results');
    var quotaEl   = document.getElementById('mk-quota');
    if (!statusEl || !resultsEl) return;
    if (!data) { statusEl.textContent = '等待进入房间...'; resultsEl.innerHTML = ''; return; }

    statusEl.textContent = '房间 ' + data.vid + ' | 庄' + data.stats.zhuang + ' 闲' + data.stats.xian + ' 和' + data.stats.he + ' | 共' + data.stats.total + '局';

    // 更新剩余次数
    var remaining = getRemaining();
    if (quotaEl) {
      if (remaining > 10) {
        quotaEl.innerHTML = '今日剩余 <span style="color:#34d399;font-weight:700;">' + remaining + '</span> 次';
      } else if (remaining > 0) {
        quotaEl.innerHTML = '今日剩余 <span style="color:#fbbf24;font-weight:700;">' + remaining + '</span> 次';
      } else {
        quotaEl.innerHTML = '<span style="color:#f87171;font-weight:700;">今日额度已用完</span>';
      }
    }

    // 额度用完，隐藏预测内容，显示提示
    if (isLimitReached()) {
      resultsEl.innerHTML =
        '<div style="text-align:center;padding:16px 8px;">' +
        '<div style="font-size:20px;margin-bottom:8px;">🚫</div>' +
        '<div style="color:#f87171;font-size:13px;font-weight:700;margin-bottom:6px;">今日计算额度已用完</div>' +
        '<div style="color:#6b7280;font-size:11px;line-height:1.6;">每日限额 60 次，明天零点自动恢复<br>感谢使用马尔科夫预测系统</div>' +
        '</div>';
      return;
    }

    var roads = [
      { name: '\u5927\u8DEF', seq: data.daLu, type: 'daLu', gap: 0 },
      { name: '\u5927\u773C', seq: data.daYan, type: 'derived', gap: 1 },
      { name: '\u5C0F\u8DEF', seq: data.xiaoLu, type: 'derived', gap: 2 },
      { name: '\u5C0F\u5F3A', seq: data.xiaoQiang, type: 'derived', gap: 3 }
    ];

    var html = '';
    for (var i = 0; i < roads.length; i++) {
      var road = roads[i];
      var top1_o1 = predictTop1Order1(road.seq);
      var top1_o2 = predictTop1Order2(road.seq);

      // 转换为庄闲
      var o1ZX = null, o2ZX = null;
      if (top1_o1) {
        if (road.type === 'daLu') {
          o1ZX = top1_o1.bits;
        } else {
          o1ZX = derivedBitsToZX(top1_o1.bits, data.colLens, data.lastColType, data.lastColLen, road.gap);
        }
      }
      if (top1_o2) {
        if (road.type === 'daLu') {
          o2ZX = top1_o2.bits;
        } else {
          o2ZX = derivedBitsToZX(top1_o2.bits, data.colLens, data.lastColType, data.lastColLen, road.gap);
        }
      }

      var consensus = '';
      if (o1ZX && o2ZX && o1ZX === o2ZX) {
        consensus = '<span style="font-size:9px;color:#34d399;margin-left:4px;">\u2705</span>';
      }

      html += '<div style="padding:5px 0;border-bottom:1px solid rgba(42,42,74,0.6);">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">';
      html += '<span style="font-size:11px;color:#818cf8;font-weight:600;">' + road.name + consensus + '</span>';
      html += '</div>';

      // 一阶
      if (top1_o1) {
        // 数字部分：原始派生路红蓝 bits（0=红，1=蓝）
        // 括号部分：反推大路庄闲（大路直接用bits，下三路用derivedBitsToZX转换）
        var o1Bits = top1_o1.bits;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding-left:8px;">';
        html += '<span style="font-size:10px;color:#6b6b8a;">1\u9636</span>';
        html += '<span>';
        html += '<span style="font-family:Courier New,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;">' + colorZX(o1Bits) + '</span>';
        html += '<span style="font-size:9px;margin-left:3px;">' + (o1ZX ? zxLabel(o1ZX) : '') + '</span>';
        html += '<span style="font-size:10px;color:#34d399;margin-left:5px;">' + (top1_o1.p * 100).toFixed(2) + '%</span>';
        html += '</span></div>';
      } else {
        html += '<div style="padding-left:8px;font-size:10px;color:#6b6b8a;">1\u9636 \u6570\u636E\u4E0D\u8DB3</div>';
      }

      // 二阶
      if (top1_o2) {
        // 数字部分：原始派生路红蓝 bits（0=红，1=蓝）
        // 括号部分：反推大路庄闲（大路直接用bits，下三路用derivedBitsToZX转换）
        var o2Bits = top1_o2.bits;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding-left:8px;">';
        html += '<span style="font-size:10px;color:#6b6b8a;">2\u9636</span>';
        html += '<span>';
        html += '<span style="font-family:Courier New,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;">' + colorZX(o2Bits) + '</span>';
        html += '<span style="font-size:9px;margin-left:3px;">' + (o2ZX ? zxLabel(o2ZX) : '') + '</span>';
        html += '<span style="font-size:10px;color:#34d399;margin-left:5px;">' + (top1_o2.p * 100).toFixed(2) + '%</span>';
        html += '</span></div>';
      } else {
        html += '<div style="padding-left:8px;font-size:10px;color:#6b6b8a;">2\u9636 \u6570\u636E\u4E0D\u8DB3</div>';
      }

      html += '</div>';
    }
    resultsEl.innerHTML = html;
  }

  // ── 轮询逻辑 ──────────────────────────────────
  var _lastVid = null; // 上一次的房间ID，用于检测进入新房间

  function poll() {
    if (!panelCreated) createPanel();
    if (!document.getElementById('mk-float-panel')) { panelCreated = false; createPanel(); }

    var data = getRoadData();

    // 检测是否进入了房间（vid 从无到有，或 vid 发生变化）
    var currentVid = data ? data.vid : null;
    if (currentVid && currentVid !== '未知' && currentVid !== _lastVid) {
      _lastVid = currentVid;
      onEnterRoom();
    }

    updatePanel(data);
  }

  function startPolling() {
    if (pollTimer) return;
    createPanel(); poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
    console.log('[MK] \u8F6E\u8BE2\u5DF2\u542F\u52A8');
  }

  function tryStart() {
    if (document.body) { startPolling(); } else { setTimeout(tryStart, 300); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(tryStart, 500); });
  } else {
    setTimeout(tryStart, 500);
  }
})();
