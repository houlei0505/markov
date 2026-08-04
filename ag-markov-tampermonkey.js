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

(function() {
  'use strict';

  // 版本号：与 GitHub 上的 ag-markov.js 保持同步，不同则拉取新版本
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
