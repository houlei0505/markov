// ==UserScript==
// @name         AG 马尔科夫路单分析
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  无痕沙盒热加载 - 使用扩展底层请求，不修改任何 DOM 节点
// @author       You
// @match        *://gci.iunnc.com/*
// @match        *://*.iunnc.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      houlei0505.github.io
// ==/UserScript==

// ============================================================
// 【每次更新计算逻辑的操作步骤】
//
// 1. 修改 E:\win\ag-markov.js 里的计算代码
//
// 2. 把下面的 REMOTE_VER 版本号递增（如 '2.5' → '2.6'）
//    ★ 这一步是触发自动拉取的开关，不改版本号不会生效 ★
//
// 3. 推送到 GitHub：
//    git add ag-markov.js ag-markov-tampermonkey.js
//    git commit -m "你的描述"
//    git push origin main
//
// 4. 在 Tampermonkey 里重新安装/粘贴本文件（因为版本号改了）
//    → 下次刷新百家乐页面，脚本自动拉取新版 ag-markov.js 并缓存
//    → 之后刷新都走缓存，零网络请求，直到下次再改版本号
//
// 【指挥中心 calc.html 使用方式】
//    双击打开 E:\win\calc.html（本地 file:// 协议，不需要部署）
//    与百家乐标签页通过 BroadcastChannel 实时通信，3秒刷新一次
//    calc.html 不推 GitHub（纯本地工具，推了也没用）
// ============================================================

(function() {
  'use strict';

  // ★ 修改计算逻辑后，把这里的版本号递增，才会触发重新拉取 ★
  var REMOTE_VER = '2.5';
  var SCRIPT_URL = 'https://houlei0505.github.io/markov/ag-markov.js';

  var cachedVer  = GM_getValue('mk_script_ver', '');
  var cachedCode = GM_getValue('mk_script_code', '');

  function runCode(code) {
    try {
      // 用 Function 构造器在独立作用域执行，不污染 window
      (new Function(code))();
    } catch(e) {
      console.error('[MK] 执行错误:', e);
    }
  }

  if (cachedVer === REMOTE_VER && cachedCode) {
    // 版本一致，直接用缓存，零网络请求
    runCode(cachedCode);
  } else {
    // 版本不一致，静默拉取新版本
    // GM_xmlhttpRequest 从扩展层发出，目标网页 fetch/XHR 劫持抓不到，也不受 CSP 限制
    GM_xmlhttpRequest({
      method: 'GET',
      url: SCRIPT_URL + '?v=' + REMOTE_VER,
      onload: function(res) {
        if (res.status === 200) {
          GM_setValue('mk_script_code', res.responseText);
          GM_setValue('mk_script_ver', REMOTE_VER);
          runCode(res.responseText);
        } else {
          console.error('[MK] 拉取失败，状态码:', res.status);
          // 降级：用旧缓存
          if (cachedCode) runCode(cachedCode);
        }
      },
      onerror: function() {
        console.error('[MK] 网络异常，使用缓存版本');
        if (cachedCode) runCode(cachedCode);
      }
    });
  }

})();
