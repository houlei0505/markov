// AG 马尔科夫路单分析 - 计算核心（无 DOM 修改版）
// 部署到 GitHub Pages，由油猴 loader 通过 GM_xmlhttpRequest 静默加载
// 此脚本：① 不修改任何 DOM ② 不插入任何节点 ③ 不发任何网络请求
// 计算结果通过 localStorage 写给本地 calc.html 读取展示

(function() {
  'use strict';

  if (window.__MK_LOADED__) return;
  window.__MK_LOADED__ = true;

  // ── 配置 ──────────────────────────────────────
  var PREDICT_LEN   = 4;
  var POLL_INTERVAL = 3000;
  var pollTimer     = null;

  // BroadcastChannel 跨标签页通信（不受域名隔离限制）
  var bc = null;
  try { bc = new BroadcastChannel('mk_channel'); } catch(e) {}

  // localStorage 通信 key（同域备用，兼容不支持 BroadcastChannel 的情况）
  var LS_KEY_DATA  = 'mk_road_data';
  var LS_KEY_PING  = 'mk_ping';

  // ── 每日计算额度 ──────────────────────────────
  var DAILY_LIMIT      = 60;
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
      localStorage.setItem(STORAGE_KEY_DATE, today);
      localStorage.setItem(STORAGE_KEY_COUNT, '0');
      return 0;
    }
    return parseInt(localStorage.getItem(STORAGE_KEY_COUNT) || '0', 10);
  }

  function addDailyUsed() {
    var cur = getDailyUsed();
    var next = cur + 1;
    localStorage.setItem(STORAGE_KEY_COUNT, String(next));
    return next;
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

  function getColInfoFromProto(daLuProto) {
    var colLens  = [];
    var lastType = 0;
    if (!daLuProto) return { colLens: colLens, lastColType: 0, lastColLen: 0 };
    var flat = Array.isArray(daLuProto[0]) ? daLuProto.flat() : daLuProto;
    for (var i = 0; i < flat.length; i++) {
      var t = flat[i].winType;
      if (t !== 1 && t !== 2) continue;
      if (lastType === 0) { colLens.push(1); lastType = t; }
      else if (t === lastType) { colLens[colLens.length - 1]++; }
      else { colLens.push(1); lastType = t; }
    }
    return { colLens: colLens, lastColType: lastType, lastColLen: colLens.length > 0 ? colLens[colLens.length - 1] : 0 };
  }

  function getRoadData() {
    if (!window.GameBac) return null;
    if (!GameBac.RoadMapStore) return null;
    if (!GameBac.RoadMapStore._instance) return null;
    var rd = GameBac.RoadMapStore._instance.roadData;
    if (!rd) return null;
    var vid = '未知';
    try { vid = GameBac.RoadMapStore._instance.indexStore.validVidList[0] || '未知'; } catch(e) {}
    var colInfo = getColInfoFromProto(rd.daLuProto);
    return {
      vid: vid,
      stats: { zhuang: rd.redCount, xian: rd.blueCount, he: rd.tieCount, total: rd.totalCount },
      daLu:      toSequence(rd.daLuProto),
      daYan:     toSequence(rd.daYanLuData),
      xiaoLu:    toSequence(rd.xiaoLuData),
      xiaoQiang: toSequence(rd.xiaoQiangLuData),
      colLens:     colInfo.colLens,
      lastColType: colInfo.lastColType,
      lastColLen:  colInfo.lastColLen
    };
  }

  // ── 派生路颜色推算 ────────────────────────────
  function simulateDerivedColor(colLens, lt, ll, addType, offset) {
    var totalCols = colLens.length;
    if (addType === lt) {
      var curRow      = ll;
      var checkColIdx = totalCols - 1 - offset;
      var checkLen    = (checkColIdx >= 0 ? colLens[checkColIdx] : 0) || 0;
      var hasCur  = (curRow     < checkLen);
      var hasPrev = (curRow - 1 < checkLen);
      return (hasCur === hasPrev);
    } else {
      var prevLen  = colLens[totalCols - 1] || 0;
      var prev2Len = (totalCols - 1 - offset >= 0 ? colLens[totalCols - 1 - offset] : 0) || 0;
      return (prevLen === prev2Len);
    }
  }

  function derivedBitsToZX(predictedBits, colLens, lastColType, lastColLen, gapCols) {
    var result = '';
    var cl = colLens.slice();
    var lt = lastColType;
    var ll = lastColLen;
    for (var i = 0; i < predictedBits.length; i++) {
      var predictedRed = (predictedBits[i] === '0');
      var matched = 0;
      for (var tryType = 1; tryType <= 2; tryType++) {
        if (simulateDerivedColor(cl, lt, ll, tryType, gapCols) === predictedRed) {
          matched = tryType; break;
        }
      }
      if (matched === 0) matched = lt;
      result += (matched === 1) ? '0' : '1';
      var actual = matched === 1 ? 2 : 1;
      if (actual === lt) {
        ll++;
        cl[cl.length - 1] = ll;
      } else {
        cl.push(1); lt = actual; ll = 1;
      }
    }
    return result;
  }

  // ── 计算并写入 localStorage ───────────────────
  var _lastVid = sessionStorage.getItem('mk_session_vid') || null;

  function computeAndPublish() {
    var data = getRoadData();
    var currentVid = data ? data.vid : null;

    // 房间进入计数
    if (!currentVid || currentVid === '未知') {
      if (_lastVid) {
        _lastVid = null;
        sessionStorage.removeItem('mk_session_vid');
      }
    } else if (currentVid !== _lastVid) {
      _lastVid = currentVid;
      sessionStorage.setItem('mk_session_vid', currentVid);
      addDailyUsed();
    }

    var roads = [
      { name: '大路',  seq: data ? data.daLu      : [], type: 'daLu',    gap: 0 },
      { name: '大眼',  seq: data ? data.daYan     : [], type: 'derived', gap: 1 },
      { name: '小路',  seq: data ? data.xiaoLu    : [], type: 'derived', gap: 2 },
      { name: '小强',  seq: data ? data.xiaoQiang : [], type: 'derived', gap: 3 }
    ];

    var predictions = [];
    for (var i = 0; i < roads.length; i++) {
      var road = roads[i];
      var o1 = predictTop1Order1(road.seq);
      var o2 = predictTop1Order2(road.seq);
      var o1ZX = null, o2ZX = null;
      if (o1) {
        o1ZX = (road.type === 'daLu') ? o1.bits
          : (data ? derivedBitsToZX(o1.bits, data.colLens, data.lastColType, data.lastColLen, road.gap) : o1.bits);
      }
      if (o2) {
        o2ZX = (road.type === 'daLu') ? o2.bits
          : (data ? derivedBitsToZX(o2.bits, data.colLens, data.lastColType, data.lastColLen, road.gap) : o2.bits);
      }
      predictions.push({
        name:    road.name,
        seqLen:  road.seq.length,
        o1:      o1 ? { bits: o1.bits, p: o1.p, zx: o1ZX } : null,
        o2:      o2 ? { bits: o2.bits, p: o2.p, zx: o2ZX } : null,
        consensus: (o1ZX && o2ZX && o1ZX === o2ZX)
      });
    }

    var payload = {
      ts:        Date.now(),
      vid:       currentVid || null,
      stats:     data ? data.stats : null,
      remaining: getRemaining(),
      limitReached: isLimitReached(),
      predictions: predictions
    };

    // 通过 BroadcastChannel 广播（跨域名标签页均可收到）
    if (bc) {
      try { bc.postMessage(payload); } catch(e) {}
    }
    // 同时写 localStorage 作为兜底（同域情况）
    try {
      localStorage.setItem(LS_KEY_DATA, JSON.stringify(payload));
      localStorage.setItem(LS_KEY_PING, String(Date.now()));
    } catch(e) {}
  }

  // ── 启动轮询 ──────────────────────────────────
  function startPolling() {
    if (pollTimer) return;
    computeAndPublish();
    pollTimer = setInterval(computeAndPublish, POLL_INTERVAL);
    console.log('[MK] 数据轮询已启动（零 DOM 模式）');
  }

  function tryStart() {
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(tryStart, 500); });
  } else {
    setTimeout(tryStart, 500);
  }

})();
