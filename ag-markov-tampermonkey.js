// ==UserScript==
// @name         AG 马尔科夫路单分析
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  直接内联执行，unsafeWindow访问GameBac，BroadcastChannel发送数据
// @author       You
// @match        *://gci.iunnc.com/*
// @match        *://*.iunnc.com/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

// ============================================================
// 【架构说明 v4.0】
//   所有计算逻辑直接内联在本文件，不再动态加载 ag-markov.js。
//   用 unsafeWindow 直接访问游戏的 GameBac 对象。
//   用 BroadcastChannel 把预测数据发给同浏览器的 calc.html 标签页。
//
// 【更新代码的步骤】
//   1. 直接修改本文件的计算逻辑
//   2. 在 Tampermonkey 里重新粘贴保存
//   3. 刷新百家乐页面生效
//   （不再需要推 GitHub 和等待拉取）
//
// 【指挥中心使用方式】
//   打开 https://houlei0505.github.io/markov/calc.html
//   必须与百家乐页面在同一个浏览器，不同标签页
// ============================================================

(function() {
  'use strict';

  // unsafeWindow = 百家乐页面真实的 window，能访问 GameBac 等游戏对象
  var W = unsafeWindow;

  // ── 配置 ────────────────────────────────────────
  var PREDICT_LEN   = 4;
  var POLL_INTERVAL = 3000;
  var pollTimer     = null;

  // ── 通信：postMessage 到 calc.html 子窗口 ──────────
  // BroadcastChannel 受同源限制，跨域标签页收不到消息。
  // 改用 window.open 打开 calc.html，通过 postMessage 跨域发送数据。
  var CALC_URL = 'https://houlei0505.github.io/markov/calc.html';
  var calcWin  = null;

  function openCalcWin() {
    if (calcWin && !calcWin.closed) return;
    calcWin = W.open(CALC_URL, 'mk_calc_panel',
      'width=480,height=800,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes');
  }

  function sendToCalc(payload) {
    if (!calcWin || calcWin.closed) return;
    try { calcWin.postMessage(payload, '*'); } catch(e) {}
  }

  // 启动时自动打开面板
  openCalcWin();

  // ── 每日计算额度 ──────────────────────────────
  var DAILY_LIMIT = 60;

  function getTodayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
  }
  function getDailyUsed() {
    var today = getTodayStr();
    if (GM_getValue('mk_date', '') !== today) {
      GM_setValue('mk_date', today);
      GM_setValue('mk_count', 0);
      return 0;
    }
    return GM_getValue('mk_count', 0);
  }
  function addDailyUsed() {
    var next = getDailyUsed() + 1;
    GM_setValue('mk_count', next);
    return next;
  }
  function isLimitReached() { return getDailyUsed() >= DAILY_LIMIT; }
  function getRemaining()   { return Math.max(0, DAILY_LIMIT - getDailyUsed()); }

  // ── 一阶马尔科夫 ────────────────────────────────
  function buildMarkov1(seq) {
    var counts = { '0':{'0':0,'1':0}, '1':{'0':0,'1':0} };
    for (var i = 0; i < seq.length-1; i++) counts[seq[i]][seq[i+1]]++;
    var prob = {}, states = ['0','1'];
    for (var si = 0; si < states.length; si++) {
      var f = states[si], t = counts[f]['0']+counts[f]['1'];
      prob[f] = { '0': t ? counts[f]['0']/t : 0.5, '1': t ? counts[f]['1']/t : 0.5 };
    }
    return prob;
  }
  function predictTop1Order1(seq) {
    if (seq.length < 3) return null;
    var prob = buildMarkov1(seq), last = seq[seq.length-1];
    var n = PREDICT_LEN, total = Math.pow(2,n), bestBits='', bestP=-1;
    for (var mask=0; mask<total; mask++) {
      var bits = mask.toString(2).padStart(n,'0'), p=1, cur=last;
      for (var j=0; j<bits.length; j++) { p *= prob[cur][bits[j]]; cur = bits[j]; }
      if (p > bestP) { bestP=p; bestBits=bits; }
    }
    return { bits:bestBits, p:bestP };
  }

  // ── 二阶马尔科夫 ────────────────────────────────
  function buildMarkov2(seq) {
    var states=['00','01','10','11'], counts={};
    for (var si=0; si<states.length; si++) counts[states[si]]={'0':0,'1':0};
    for (var i=0; i<seq.length-2; i++) { var f=seq[i]+seq[i+1]; if(counts[f]) counts[f][seq[i+2]]++; }
    var prob={};
    for (var si2=0; si2<states.length; si2++) {
      var s=states[si2], t=counts[s]['0']+counts[s]['1'];
      prob[s]={'0': t?counts[s]['0']/t:0.5, '1': t?counts[s]['1']/t:0.5};
    }
    return prob;
  }
  function predictTop1Order2(seq) {
    if (seq.length < 5) return null;
    var prob=buildMarkov2(seq), lastTwo=seq[seq.length-2]+seq[seq.length-1];
    var n=PREDICT_LEN, total=Math.pow(2,n), bestBits='', bestP=-1;
    for (var mask=0; mask<total; mask++) {
      var bits=mask.toString(2).padStart(n,'0'), p=1, cur=lastTwo;
      for (var j=0; j<bits.length; j++) { p *= (prob[cur]?prob[cur][bits[j]]:0.5); cur=cur[1]+bits[j]; }
      if (p > bestP) { bestP=p; bestBits=bits; }
    }
    return { bits:bestBits, p:bestP };
  }

  // ── 数据提取 ────────────────────────────────────
  function toSequence(list) {
    if (!list || !list.length) return [];
    var flat = Array.isArray(list[0]) ? list.flat() : list;
    return flat.filter(function(b){return b.winType===1||b.winType===2;})
               .map(function(b){return b.winType===1?'0':'1';});
  }
  function getColInfoFromProto(daLuProto) {
    var colLens=[], lastType=0;
    if (!daLuProto) return {colLens:colLens,lastColType:0,lastColLen:0};
    var flat = Array.isArray(daLuProto[0]) ? daLuProto.flat() : daLuProto;
    for (var i=0; i<flat.length; i++) {
      var t=flat[i].winType; if(t!==1&&t!==2) continue;
      if (!lastType) { colLens.push(1); lastType=t; }
      else if (t===lastType) { colLens[colLens.length-1]++; }
      else { colLens.push(1); lastType=t; }
    }
    return {colLens:colLens, lastColType:lastType, lastColLen:colLens.length?colLens[colLens.length-1]:0};
  }
  function getRoadData() {
    try {
      if (!W.GameBac || !W.GameBac.RoadMapStore || !W.GameBac.RoadMapStore._instance) return null;
      var rd = W.GameBac.RoadMapStore._instance.roadData;
      if (!rd) return null;
      var vid = '未知';
      try { vid = W.GameBac.RoadMapStore._instance.indexStore.validVidList[0] || '未知'; } catch(e){}
      var ci = getColInfoFromProto(rd.daLuProto);
      return {
        vid: vid,
        stats: {zhuang:rd.redCount, xian:rd.blueCount, he:rd.tieCount, total:rd.totalCount},
        daLu: toSequence(rd.daLuProto), daYan: toSequence(rd.daYanLuData),
        xiaoLu: toSequence(rd.xiaoLuData), xiaoQiang: toSequence(rd.xiaoQiangLuData),
        colLens:ci.colLens, lastColType:ci.lastColType, lastColLen:ci.lastColLen
      };
    } catch(e) { return null; }
  }

  // ── 派生路颜色推算 ──────────────────────────────
  function simulateDerivedColor(colLens,lt,ll,addType,offset) {
    var tc=colLens.length;
    if (addType===lt) {
      var cr=ll, ci=tc-1-offset, cl=(ci>=0?colLens[ci]:0)||0;
      return ((cr<cl) === (cr-1<cl));
    } else {
      var pl=colLens[tc-1]||0, p2=(tc-1-offset>=0?colLens[tc-1-offset]:0)||0;
      return pl===p2;
    }
  }
  function derivedBitsToZX(bits,colLens,lastColType,lastColLen,gap) {
    var result='', cl=colLens.slice(), lt=lastColType, ll=lastColLen;
    for (var i=0; i<bits.length; i++) {
      var pRed=(bits[i]==='0'), matched=0;
      for (var t=1;t<=2;t++) { if(simulateDerivedColor(cl,lt,ll,t,gap)===pRed){matched=t;break;} }
      if (!matched) matched=lt;
      result += (matched===1)?'0':'1';
      // 假设本把未中（对立面出现），用对立面更新大路状态推算下一把
      var actual=matched===1?2:1;
      if (actual===lt) { ll++; cl[cl.length-1]=ll; } else { cl.push(1); lt=actual; ll=1; }
    }
    return result;
  }

  // ── 主循环 ──────────────────────────────────────
  var _lastVid = null;
  try { _lastVid = GM_getValue('mk_session_vid', null) || null; } catch(e){}

  function computeAndPublish() {
    var data = getRoadData();
    var vid  = data ? data.vid : null;

    if (!vid || vid==='未知') {
      if (_lastVid) { _lastVid=null; try{ GM_setValue('mk_session_vid', ''); }catch(e){} }
    } else if (vid !== _lastVid) {
      _lastVid = vid;
      try{ GM_setValue('mk_session_vid', vid); }catch(e){}
      addDailyUsed();
    }

    var roads = [
      {name:'大路',  seq:data?data.daLu:[],      type:'daLu',    gap:0},
      {name:'大眼',  seq:data?data.daYan:[],     type:'derived', gap:1},
      {name:'小路',  seq:data?data.xiaoLu:[],    type:'derived', gap:2},
      {name:'小强',  seq:data?data.xiaoQiang:[], type:'derived', gap:3}
    ];
    var predictions = [];
    for (var i=0; i<roads.length; i++) {
      var r=roads[i], o1=predictTop1Order1(r.seq), o2=predictTop1Order2(r.seq);
      var o1ZX=null, o2ZX=null;
      if (o1) o1ZX = r.type==='daLu' ? o1.bits : (data?derivedBitsToZX(o1.bits,data.colLens,data.lastColType,data.lastColLen,r.gap):o1.bits);
      if (o2) o2ZX = r.type==='daLu' ? o2.bits : (data?derivedBitsToZX(o2.bits,data.colLens,data.lastColType,data.lastColLen,r.gap):o2.bits);
      predictions.push({
        name:r.name, seqLen:r.seq.length,
        o1: o1?{bits:o1.bits,p:o1.p,zx:o1ZX}:null,
        o2: o2?{bits:o2.bits,p:o2.p,zx:o2ZX}:null,
        consensus: !!(o1ZX&&o2ZX&&o1ZX===o2ZX)
      });
    }

    var payload = {
      ts: Date.now(), vid: vid||null, stats: data?data.stats:null,
      remaining: getRemaining(), limitReached: isLimitReached(),
      predictions: predictions
    };

    sendToCalc(payload);
  }

  function startPolling() {
    if (pollTimer) return;
    openCalcWin();
    setTimeout(function() {
      computeAndPublish();
      pollTimer = setInterval(computeAndPublish, POLL_INTERVAL);
    }, 2000);
  }

  // 延迟启动，等游戏引擎加载完
  setTimeout(startPolling, 1500);

})();
