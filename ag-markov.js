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

  // ── 派生路红蓝转庄闲（正确规则） ─────────────
  // 基于大路列结构，模拟下一步大路出庄/闲时会产生什么红/蓝
  // 然后反推：预测的红/蓝对应哪个庄/闲
  //
  // 大眼路规则：
  //   新列(row=0): 前1列长 == 前2列长 → 红, 否则 → 蓝
  //   续列(row>0): row < 前1列长 → 红
  //                row == 前1列长 → 蓝(第1个空格)
  //                row > 前1列长 → 红(第2个空格起)
  //
  // 关键：每产生一个新的大路结果，大路列结构会变化
  // 如果出跟当前列一样的结果 → 续列(当前列长度+1)
  // 如果出跟当前列不一样的结果 → 新列(长度1)

  function derivedBitsToZX(predictedBits, colLens, lastColType, lastColLen, gapCols) {
    // gapCols: 大眼路=1, 小路=2, 小强路=3 (对比间隔)
    // 返回庄闲序列字符串
    var result = '';
    
    // 模拟大路列结构
    var simColLens = colLens.slice(); // 拷贝
    var simLastColType = lastColType;
    var simLastColLen = lastColLen;
    var simTotalCols = simColLens.length;

    for (var i = 0; i < predictedBits.length; i++) {
      var predictedRedBlue = predictedBits[i]; // '0'=红 '1'=蓝

      // 尝试两种情况：大路出庄(1)或闲(2)
      // 对每种情况模拟产生的红蓝，看哪个匹配预测
      var matched = null;

      for (var tryType = 1; tryType <= 2; tryType++) {
        // 模拟大路出 tryType
        var newColLen, newColType, newIsNewCol;
        if (tryType === simLastColType) {
          // 续列
          newColLen = simLastColLen + 1;
          newColType = simLastColType;
          newIsNewCol = false;
        } else {
          // 新列
          newColLen = 1;
          newColType = tryType;
          newIsNewCol = true;
        }

        // 计算这步会产生什么红蓝（大眼路规则）
        var genRedBlue;
        var curColIdx = newIsNewCol ? simTotalCols : simTotalCols - 1;
        var curRow = newIsNewCol ? 0 : (newColLen - 1);

        // 需要对比的列（前gapCols列）
        var compareColIdx = curColIdx - gapCols;
        var compareColLen = (compareColIdx >= 0 && compareColIdx < simColLens.length) ? simColLens[compareColIdx] : 0;
        // 如果是新列还没push，当前列的前gapCols列
        if (newIsNewCol) {
          // curColIdx = simTotalCols (新列还没加入)
          compareColIdx = simTotalCols - gapCols;
          compareColLen = (compareColIdx >= 0 && compareColIdx < simColLens.length) ? simColLens[compareColIdx] : 0;
        } else {
          // curColIdx = simTotalCols - 1 (当前列)
          compareColIdx = simTotalCols - 1 - gapCols;
          compareColLen = (compareColIdx >= 0 && compareColIdx < simColLens.length) ? simColLens[compareColIdx] : 0;
        }

        if (curRow === 0) {
          // 新列：比较前1列和前(1+gapCols)列的长度
          // 大眼路: 比较 curCol-1 和 curCol-2
          // 小路: 比较 curCol-1 和 curCol-3
          // 小强路: 比较 curCol-1 和 curCol-4
          var prevLen, prev2Len;
          if (newIsNewCol) {
            prevLen = simColLens[simTotalCols - 1] || 0;
            prev2Len = simColLens[simTotalCols - 1 - gapCols] || 0;
          } else {
            prevLen = simColLens[simTotalCols - 2] || 0;
            prev2Len = simColLens[simTotalCols - 2 - gapCols] || 0;
          }
          genRedBlue = (prevLen === prev2Len) ? '0' : '1'; // 齐脚=红(0) 不齐脚=蓝(1)
        } else {
          // 续列：看对比列在同行是否有
          if (curRow < compareColLen) {
            genRedBlue = '0'; // 有 → 红
          } else if (curRow === compareColLen) {
            genRedBlue = '1'; // 第1个空格 → 蓝
          } else {
            genRedBlue = '0'; // 第2个空格起 → 红
          }
        }

        if (genRedBlue === predictedRedBlue) {
          matched = tryType;
          break;
        }
      }

      // 如果两种都不匹配或都匹配，默认取续列的那个
      if (matched === null) {
        matched = simLastColType; // 默认续列
      }

      // 记录结果: 1=庄→'0', 2=闲→'1'
      result += (matched === 1) ? '0' : '1';

      // 更新模拟状态
      if (matched === simLastColType) {
        simLastColLen++;
        simColLens[simColLens.length - 1] = simLastColLen;
      } else {
        simColLens.push(1);
        simLastColType = matched;
        simLastColLen = 1;
        simTotalCols++;
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
        '<span>\u{1F52E} \u9A6C\u5C14\u79D1\u592B\u9884\u6D4B</span>' +
        '<span id="mk-minimize" style="cursor:pointer;font-size:14px;">\u2014</span>' +
      '</div>' +
      '<div id="mk-body" style="padding:10px 12px;">' +
        '<div id="mk-status" style="font-size:11px;color:#94a3b8;margin-bottom:8px;">\u7B49\u5F85\u8FDB\u5165\u623F\u95F4...</div>' +
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
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      this.textContent = hidden ? '\u2014' : '\uFF0B';
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
    if (!statusEl || !resultsEl) return;
    if (!data) { statusEl.textContent = '\u7B49\u5F85\u8FDB\u5165\u623F\u95F4...'; resultsEl.innerHTML = ''; return; }

    statusEl.textContent = '\u623F\u95F4 ' + data.vid + ' | \u5E84' + data.stats.zhuang + ' \u95F2' + data.stats.xian + ' \u548C' + data.stats.he + ' | \u5171' + data.stats.total + '\u5C40';

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
      if (o1ZX) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding-left:8px;">';
        html += '<span style="font-size:10px;color:#6b6b8a;">1\u9636</span>';
        html += '<span>';
        html += '<span style="font-family:Courier New,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;">' + colorZX(o1ZX) + '</span>';
        html += '<span style="font-size:9px;margin-left:3px;">' + zxLabel(o1ZX) + '</span>';
        html += '<span style="font-size:10px;color:#34d399;margin-left:5px;">' + (top1_o1.p * 100).toFixed(2) + '%</span>';
        html += '</span></div>';
      } else {
        html += '<div style="padding-left:8px;font-size:10px;color:#6b6b8a;">1\u9636 \u6570\u636E\u4E0D\u8DB3</div>';
      }

      // 二阶
      if (o2ZX) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding-left:8px;">';
        html += '<span style="font-size:10px;color:#6b6b8a;">2\u9636</span>';
        html += '<span>';
        html += '<span style="font-family:Courier New,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;">' + colorZX(o2ZX) + '</span>';
        html += '<span style="font-size:9px;margin-left:3px;">' + zxLabel(o2ZX) + '</span>';
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
  function poll() {
    if (!panelCreated) createPanel();
    if (!document.getElementById('mk-float-panel')) { panelCreated = false; createPanel(); }
    var data = getRoadData();
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
