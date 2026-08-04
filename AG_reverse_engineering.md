# AG 娱乐城 PC 端逆向工程文档

> 目标地址：`https://gci.iunnc.com/pc/pcv1/index.jsp`
> 研究日期：2026-07-10
> 状态：已验证可行

---

## 一、技术架构

| 项目 | 内容 |
|---|---|
| 前端引擎 | **Egret 白鹭引擎 v2.2.x**，所有 UI 渲染在 Canvas 上 |
| 通信协议 | **WebSocket + Protobuf 二进制** |
| JS 命名空间 | `PCPlaza`、`GlobalPlaza`、`GameBac`、`GameCommon`、`Core` |
| Proto 命名空间 | `BacProto`、`CommonProto`、`DataServerProto`、`LbacProto` 等 |
| 登录方式 | 必须从外部平台带 token 跳入，直接访问会提示"登录过期" |
| pid | `TST`（当前测试环境） |
| CDN | `gc.ckrkg.com/pccdn/` |

---

## 二、WebSocket 连接信息

### 连接地址
```
wss://et165.mmxxpp.com.cn:7101/
```
（游戏房间内另有独立连接，如：`wss://ng3112.mmxxpp.com.cn:7101`）

### 连接对象路径（JS）
```javascript
// 大厅 socket
PCPlaza.SingleSocketStore._instance.singleSocket.singleSocket.socket
// → 返回原生 WebSocket 对象，state=1（已连接）
```

### 包头结构（二进制）
```
offset 0-1 : 版本/标志 (00 02)
offset 2-3 : cmdId (2字节 big-endian)
offset 4-7 : totalLen (4字节 big-endian)
offset 8-11: seq (4字节 big-endian)
offset 12+ : protobuf payload
```

### 已知 cmdId
| cmdId | 用途 |
|---|---|
| `0x400a` | 房间心跳/状态更新，payload 含房间ID ASCII（如 "D066"） |
| `0xb021` | 大包数据（约517字节），具体类型待确认 |

### 管道架构（F 数组，共8个）
```
innerSock.F[0] → ByteArray 原始字节层
innerSock.F[1] → 协议/心跳层（ucgateBeatCMD）
innerSock.F[2] → 压缩/解压层
innerSock.F[3] → 基础处理层
innerSock.F[4] → 加解密层（encryptList, userDecryptKey 等）
innerSock.F[5] → 配置层
innerSock.F[6] → 重连/URL 切换层（sortedUrlList）
innerSock.F[7] → 解码层（responseMap，70个 protobuf 解码器）
```

---

## 三、核心数据读取方法（已验证）

### 进入游戏房间后直接读路单

```javascript
// 一行拿全部路单数据
const roadData = GameBac.RoadMapStore._instance.roadData;
```

### roadData 完整字段说明

```javascript
roadData = {
  redCount:       Number,  // 庄赢次数
  blueCount:      Number,  // 闲赢次数
  tieCount:       Number,  // 和局次数
  redPairCount:   Number,  // 庄对次数
  bluePairCount:  Number,  // 闲对次数
  totalCount:     Number,  // 总局数（含和）
  lucky6Count:    Number,  // Lucky6 次数

  beadList:       Array,   // 珠盘路（每局顺序，最原始）
  zhuZaiLuData:   Array,   // 住在路
  daLuProto:      Array,   // 大路原始数据（二维，按列分组）
  daLuData:       Array,   // 大路（二维，按列分组）
  daYanLuData:    Array,   // 大眼路（二维，按列分组）
  xiaoLuData:     Array,   // 小路（二维，按列分组）
  xiaoQiangLuData:Array,   // 小强路（二维，按列分组）
}
```

### 每个 bead 对象的字段

```javascript
{
  winType:    Number,   // 1=庄(红), 2=闲(蓝), 3=和(绿)
  tieNum:     Number,   // 连续和局数
  winNum:     Number,   // 庄或闲的点数（牌面值）
  redPair:    Boolean,  // 庄对
  bluePair:   Boolean,  // 闲对
  gmcode:     String,   // 游戏局号
  isNewBead:      Boolean,
  isNewTieBead:   Boolean,
}
```

### 转成 0/1 序列（红庄=0，蓝闲=1）

```javascript
function toSequence(list) {
  const flat = Array.isArray(list[0]) ? list.flat() : list;
  return flat
    .filter(b => b.winType === 1 || b.winType === 2)
    .map(b => b.winType === 1 ? 0 : 1);
}

const beadSeq    = toSequence(roadData.beadList);        // 珠盘路序列
const daLuSeq    = toSequence(roadData.daLuProto);       // 大路序列
const daYanSeq   = toSequence(roadData.daYanLuData);     // 大眼路序列
const xiaoLuSeq  = toSequence(roadData.xiaoLuData);      // 小路序列
const xiaoQSeq   = toSequence(roadData.xiaoQiangLuData); // 小强路序列
```

---

## 四、当前房间数据示例（D066，2026-07-10 实测）

### 统计
- 庄赢 20 次，闲赢 22 次，和局 1 次，共 43 局

### 4组路单数据（0=庄/红，1=闲/蓝，和局已过滤）

**① 大路**（空心大圆，29列，56个结果）
```
1,1,1,0,0,0,1,1,1,0,0,1,0,0,1,1,0,0,0,1,0,1,0,1,0,1,1,1,0,1,0,0,1,0,1,1,1,0,1,0,0,1,0,1,1,1,1,0,0,0,0,0,0,0,1,1
```

**② 大眼路**（小空心圆，25列，52个结果）
```
0,0,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,0,0,0,0,0,1,0,1,1,0,1,1,1,0,1,0,1,1,0,1,1,1,0,1,0,0,1,0,0,0,1,0,0,1,0
```

**③ 小路**（实心小点，25列，49个结果）
```
0,0,0,0,1,1,0,0,1,1,0,1,1,1,1,0,0,0,0,1,0,1,0,1,1,1,0,1,1,0,1,0,1,1,1,0,1,1,0,0,1,1,0,0,0,0,0,1,0
```

**④ 小强路**（斜线格，24列，46个结果）
```
0,1,1,0,1,0,0,1,0,1,1,1,1,0,0,0,1,0,1,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0,0,1,0,1,1,0,0,0,0,0,1,1
```

> 规律：大路最全（所有局），大眼路、小路、小强路是派生路，数据量依次略少。

---

## 五、其他可用 Store

```javascript
// 当前房间 vid
GameBac.RoadMapStore._instance.indexStore.validVidList[0]
// → "D066"

// 下注数据
GameBac.BetStore._instance

// 游戏快照（当局状态）
GameBac.GameStore._instance

// 牌面数据
GameBac.PokerStore._instance

// 桌台状态
GameBac.TableStore._instance
```

---

## 六、Protobuf 类型参考

```javascript
// 路单原型
BacProto.FullResultList   // 字段: vid, seqno, gmtype, version, wininfo, extrainfo, dealercardlists, mrouresult, goodroad
BacProto.MultiRouResult   // 字段: number, multiplier
BacProto.CardList         // 字段: cards, point

// 游戏快照
CommonProto.GameSnapshot  // 字段: gmtype, gmcode, gmstatus, bval, pval, bcard, pcard, maxtimeout, prevres, wintypes...
CommonProto.EnterTable    // 进桌请求
CommonProto.LeaveTable    // 离桌请求
CommonProto.Bet / BetR    // 下注/下注响应
```

---

## 七、大厅路单（未进房间时）

大厅里每个房间卡片的路单由 `PCPlaza.BacTableItem` 渲染，数据通过同一条 WebSocket 推送，
全部缓存在 `VideoGameCore.PlazaRoadStore._instance.roadDataMap.dataObj` 中。

### 7.1 数据路径（已实测验证，2026-07-22）

```javascript
// 大厅路单总仓库（所有房间，51 个 VID）
const roadDataMap = VideoGameCore.PlazaRoadStore._instance.roadDataMap.dataObj;

// 取某一房间的路单（以 D056 = 百家乐D56 为例）
const data = roadDataMap['D056'];
```

### 7.2 VID 命名规律

| 前缀 | 厅别 | 举例 |
|------|------|------|
| `D0xx` | 百家乐 D 厅（截图中的 D51~D60） | D051, D052 ... D069 |
| `N0xx` | 百家乐 N 厅 | N006, N007 ... N033 |
| `M0xx` | 百家乐 M 厅 | M090, M091 |
| `P0xx` | 百家乐 P 厅（极速/其他） | P001~P021 |

当前大厅共 51 个百家乐房间（含各厅）。

### 7.3 roadData 字段说明（与房间内完全一致）

```javascript
data = {
  // 统计计数
  redCount:        Number,  // 庄赢次数
  blueCount:       Number,  // 闲赢次数
  tieCount:        Number,  // 和局次数
  redPairCount:    Number,  // 庄对次数
  bluePairCount:   Number,  // 闲对次数
  totalCount:      Number,  // 总局数
  lucky6Count:     Number,  // Lucky6 次数

  // 路单数据（二维数组，外层按列，内层每列最多6行）
  beadList:        Array,   // 珠盘路（一维，顺序排列）
  zhuZaiLuData:    Array,   // 住在路（一维）
  daLuProto:       Array,   // 大路（二维，原始proto）
  daLuData:        Array,   // 大路（二维，含空格占位）
  daYanLuData:     Array,   // 大眼路（二维）
  xiaoLuData:      Array,   // 小路（二维）
  xiaoQiangLuData: Array,   // 小强路（二维）
}
```

### 7.4 bead 元素结构

```javascript
{
  winType:      Number,   // 1=庄(红), 2=闲(蓝), 3=和(绿), 0=空占位
  tieNum:       Number,   // 该格连续和局数（>0 时显示绿色数字）
  winNum:       Number,   // 庄或闲的点数（珠盘路有值，派生路为0）
  redPair:      Boolean,  // 庄对
  bluePair:     Boolean,  // 闲对
  gmcode:       String,   // 游戏局号（空占位时无此字段）
  isNewBead:    Boolean,
  isNewTieBead: Boolean,
}
```

### 7.5 提取所有百家乐房间路单（完整代码）

```javascript
function getAllBacRoadData() {
  const store = window.VideoGameCore.PlazaRoadStore._instance;
  if (!store) return null;
  const dataObj = store.roadDataMap.dataObj;

  function toSeq(data) {
    // 二维数组展平，过滤空占位，映射为 0=庄 / 1=闲
    const flat = Array.isArray(data[0]) ? data.flat() : data;
    return flat
      .filter(b => b.winType === 1 || b.winType === 2)
      .map(b => b.winType === 1 ? 0 : 1);
  }

  const result = {};
  for (const [vid, d] of Object.entries(dataObj)) {
    result[vid] = {
      stats: {
        banker: d.redCount,
        player: d.blueCount,
        tie:    d.tieCount,
        bPair:  d.redPairCount,
        pPair:  d.bluePairCount,
        total:  d.totalCount,
      },
      bead:      toSeq(d.beadList),       // 珠盘路序列
      daLu:      toSeq(d.daLuData),       // 大路序列
      daYan:     toSeq(d.daYanLuData),    // 大眼路序列
      xiaoLu:    toSeq(d.xiaoLuData),     // 小路序列
      xiaoQiang: toSeq(d.xiaoQiangLuData),// 小强路序列
    };
  }
  return result;
}

// 使用：
const allRoads = getAllBacRoadData();
console.log(allRoads['D056']); // 百家乐D56 的路单
```

### 7.6 轮询更新（Playwright / Tampermonkey）

```javascript
// 每 3 秒读一次大厅所有百家乐路单
setInterval(() => {
  const data = getAllBacRoadData();
  if (data) console.log(JSON.stringify(data, null, 2));
}, 3000);
```

> **注意**：大厅路单数据实时由 WebSocket 更新，无需额外订阅，直接读内存即可。
> 若某房间数据为空（`total=0`），说明该房间正在换靴或维护中。

---

## 八、Playwright 接入方案

进入房间后，用以下代码实时轮询路单：

```javascript
// 在 Playwright page.evaluate() 中执行
function getRoadData() {
  if (!window.GameBac || !GameBac.RoadMapStore._instance) return null;
  
  const rd = GameBac.RoadMapStore._instance.roadData;
  const vid = GameBac.RoadMapStore._instance.indexStore.validVidList[0];
  
  function toSeq(list) {
    const flat = Array.isArray(list[0]) ? list.flat() : list;
    return flat.filter(b => b.winType === 1 || b.winType === 2).map(b => b.winType === 1 ? 0 : 1);
  }
  
  return {
    vid,
    stats: { 庄: rd.redCount, 闲: rd.blueCount, 和: rd.tieCount, 总: rd.totalCount },
    bead:     toSeq(rd.beadList),
    daLu:     toSeq(rd.daLuProto),
    daYan:    toSeq(rd.daYanLuData),
    xiaoLu:   toSeq(rd.xiaoLuData),
    xiaoQiang:toSeq(rd.xiaoQiangLuData),
    timestamp: Date.now()
  };
}
```

轮询示例（Node.js Playwright）：
```javascript
setInterval(async () => {
  const data = await page.evaluate(getRoadData);
  console.log(JSON.stringify(data));
}, 3000); // 每3秒读一次
```

---

## 九、注意事项

1. **GameBac 只有在进入游戏房间后才存在**，大厅状态下无此命名空间
2. **路单数据不实时推送到内存**，需要轮询或 hook `RoadMapStore` 的更新事件
3. **和局不计入序列**，`winType=3` 需过滤
4. **多台模式**下可能有多个 Store 实例，通过 `indexStore.validVidList` 确认当前 vid
5. **连接地址可能轮换**，备用地址列表在 `innerSock.sortedUrlList`（6个备用 WSS 地址）
6. **加密层存在**（`F[4]` 有 userDecryptKey），服务端推送数据已在管道内解密，读内存不受影响
7. **`daLuData` 存储的是物理视觉坐标（含拐角），不能直接用来计算逻辑列长度**，应使用 `daLuProto` 按时间顺序推算逻辑列结构（见下方第十二节）

---

## 十、大路拐角规则（真实游戏实测验证，2026-07-23）

> 通过对比 `daLuProto`（时间顺序）与 `daLuData`（物理布局），完整验证了大路拐角机制。

### 10.1 三条核心规则

**规则一：满行拐角 — 行号永远锁在 row5**
- 同色填满6行（row0~row5）后，下一格放到 `physCol+1` 的 **row5**
- 继续同色则 `physCol+2, row5`...行号始终是5，不会变

**规则二：换色新列 — 永远从 row0 开始**
- 无论上一列是否发生过拐角，无论上一列结束在哪一行
- 换色后新列一律从 `physCol+1, row0` 开始

**规则三：同一物理列允许共存两种格子**
- `row0`：换色新列的起始格
- `row5`：另一逻辑列的拐角延续格
- 两者完全独立，互不干扰

### 10.2 实测数据验证

**场景一**（逻辑列16=闲x7，逻辑列17=庄x1，逻辑列18=闲x1）：
```
col16 r0~r5: 闲x6 (满格)
col17 r5:    闲   (第7格拐角)        ← 行号锁5
col17 r0:    庄   (换色从row0开始)   ← 与r5拐角格共存
col18 r0:    闲   (换色从row0开始)
```

**场景二**（逻辑列5=闲x8，逻辑列6=庄x1，逻辑列7=闲x2）：
```
col5  r0~r5: 闲x6  (满格)
col6  r5:    闲    (第7格拐角)
col7  r5:    闲    (第8格拐角)        ← 继续在row5往右
col6  r0:    庄    (换色从row0开始)   ← 与r5拐角格共存
col7  r0:    闲    (换色从row0开始)
col7  r1:    闲    (同色续列往下)
```

### 10.3 拐角对马尔科夫脚本的影响

**大路序列**：使用 `daLuProto` 扁平时间序列，**不受拐角影响**。

**`colLens` / `lastColType` / `lastColLen`**：原来从 `daLuData` 物理坐标提取，拐角格和换色格共用同一物理列会导致列长统计错误。

**修复方案**：改用 `daLuProto` 按时间顺序重建逻辑列：
```javascript
function getColInfoFromProto(daLuProto) {
  var colLens = [], lastType = 0;
  var flat = Array.isArray(daLuProto[0]) ? daLuProto.flat() : daLuProto;
  for (var i = 0; i < flat.length; i++) {
    var t = flat[i].winType;
    if (t !== 1 && t !== 2) continue;
    if (lastType === 0) { colLens.push(1); lastType = t; }
    else if (t === lastType) { colLens[colLens.length-1]++; }
    else { colLens.push(1); lastType = t; }
  }
  return {
    colLens:     colLens,
    lastColType: lastType,
    lastColLen:  colLens.length > 0 ? colLens[colLens.length-1] : 0
  };
}
```
> ✅ 此修复已在 `ag-markov.js` 中应用（2026-07-23）

---

## 十、大厅余额读取（2026-07-17 新增）

### 背景

大厅页面（`index.jsp`）是 Egret Canvas 全量渲染，**DOM 里没有任何余额文本节点**，
无法通过 `document.querySelector` 等方式读取。必须通过 Egret 运行时的 DisplayObject 树访问。

### 验证环境

- 页面：`https://gci.iunnc.com/pc/pcv2/index.jsp`
- 引擎版本：`v2.46.8`
- 实测余额：`0.2`，登录用户：`proag888888_mm2`

### 余额节点路径

```
egret.lifecycle.stage          ← Egret 舞台根节点
  └─ getChildAt(0)             ← 主容器
       └─ getChildAt(0)        ← 页面层
            └─ getChildAt(0)   ← 大厅页面（PCPlaza 主页）
                 └─ getChildAt(1)   ← 用户信息区（左侧面板）
                      └─ .balanceLabel   ← Egret TextField 对象
                           └─ .text      ← 字符串，例如 "0.2"
```

### 读取代码

```javascript
// 直接路径版（快速，依赖层级结构不变）
function getBalance() {
  try {
    return parseFloat(
      egret.lifecycle.stage
        .getChildAt(0).getChildAt(0).getChildAt(0).getChildAt(1)
        .balanceLabel.text
    );
  } catch (e) {
    return null;
  }
}
```

```javascript
// 健壮版（递归搜索，版本升级层级变化时仍有效）
function getBalance() {
  function find(node, depth) {
    if (depth > 8 || !node) return null;
    try {
      if (node.balanceLabel && node.balanceLabel.text !== undefined) {
        return parseFloat(node.balanceLabel.text);
      }
      for (var i = 0; i < (node.numChildren || 0); i++) {
        var r = find(node.getChildAt(i), depth + 1);
        if (r !== null) return r;
      }
    } catch (e) {}
    return null;
  }
  try { return find(egret.lifecycle.stage, 0); } catch(e) { return null; }
}
```

### 触发时机

- Egret 初始化需要约 3~5 秒，页面刚加载时 `stage` 子节点还未挂载
- 建议在 `document.readyState === 'complete'` 后再延迟 3 秒读取，或轮询直到返回非 null

---

## 十一、余额监控方案设计

### 需求说明

监控账户是否有未告知的提现行为，每天记录：

| 字段 | 说明 |
|------|------|
| `first` | 当天**第一次**进入大厅时的余额 + 时间 |
| `last` | 当天**最后一次**进入大厅时的余额 + 时间 |
| `diff` | `last.balance - first.balance`，**负值说明有资金净流出** |

### 数据文件格式

文件名：`data/balance-YYYY-MM-DD.json`，每天一个文件，每次进入大厅覆盖 `last`，`first` 只写一次。

```json
{
  "date": "2026-07-17",
  "username": "proag888888_mm2",
  "first": {
    "balance": 5000.00,
    "time": "2026-07-17T08:32:11+08:00"
  },
  "last": {
    "balance": 3200.00,
    "time": "2026-07-17T22:15:44+08:00"
  },
  "diff": -1800.00
}
```

### 上报方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **GitHub API**（PUT contents） | 纯静态，数据直接存仓库，无需服务器 | 必须携带 Token，有泄露风险 |
| **自有服务器接口** | Token 在服务端，脚本里无需鉴权 | 需要部署 HTTP 服务 |
| **GitHub Gist API** | 同 GitHub API，Gist 更独立，权限更小 | 同样需要 Token |
| **第三方 Webhook**（Pipedream/n8n） | 脚本只发 POST，无 Token 暴露 | 依赖第三方平台稳定性 |

### Token 安全建议（如选 GitHub API）

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens**
2. 只授权 `houlei0505/markov` 仓库
3. 权限只勾选 **Contents: Read and Write**
4. 即使 token 泄露，对方也只能往这一个仓库写文件，无法操作其他仓库或账户设置


---

## 十三、自动扫描 + 倍投策略方案（2026-07-22 设计）

### 13.1 方案概述

无需进入任何房间，在大厅页面实时监控所有百家乐房间的下三路（大眼路 / 小路 / 小强路），
发现目标组合后自动进入该房间，结合已有马尔科夫预测结果执行 1-2-4 倍投，
命中或满 3 注后退出房间，循环扫描。

### 13.2 完整流程图

```
┌─────────────────────────────────────────────────────┐
│                    【大厅扫描阶段】                    │
│  每 3 秒轮询全部 51 个房间的下三路                     │
│  （daYanLuData / xiaoLuData / xiaoQiangLuData）      │
│                                                     │
│  对每个房间，将三条路各自转成 0/1 序列                  │
│  检查末尾是否匹配任意目标组合（十几种，先到先得）          │
└───────────────┬─────────────────────────────────────┘
                │ 发现匹配
                ▼
┌─────────────────────────────────────────────────────┐
│                  【进入房间阶段】                      │
│  1. 记录命中的 VID + 命中的路名 + 命中的组合            │
│  2. 调用进入房间 API（已有实现）                        │
│  3. 等待马尔科夫预测完成（已有实现，进房间自动给出4步预测）│
│  4. 取预测第 1 步结果作为本轮下注方向（庄/闲）           │
└───────────────┬─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────┐
│                  【倍投执行阶段】                      │
│                                                     │
│  round = 1，betMultiplier = [1, 2, 4]               │
│                                                     │
│  循环（最多 3 轮）：                                   │
│    等待下注窗口开启（betEnabled = true）               │
│    下注金额 = 基础筹码 × betMultiplier[round-1]       │
│    等待本局结算                                       │
│                                                     │
│    if 结果 == 预测方向：                              │
│      ✅ 命中 → 退出房间 → 回到扫描                    │
│    else：                                            │
│      round++                                        │
│      if round > 3：                                  │
│        ❌ 止损 → 退出房间 → 回到扫描                  │
│      else：                                          │
│        继续下一轮（方向不变，金额翻倍）                 │
└─────────────────────────────────────────────────────┘
```

### 13.3 关键技术点

#### 下三路匹配

```javascript
// 目标组合列表（十几种，到时候补充具体内容）
const TARGET_PATTERNS = [
  '001100110011',
  // ... 其他组合
];

function toSeq(data2d) {
  return data2d.flat()
    .filter(b => b.winType === 1 || b.winType === 2)
    .map(b => b.winType === 1 ? 0 : 1)
    .join('');
}

function checkRoom(vid) {
  const d = VideoGameCore.PlazaRoadStore._instance.roadDataMap.dataObj[vid];
  if (!d || d.totalCount < 12) return null; // 局数不够，跳过

  const roads = {
    daYan:     toSeq(d.daYanLuData),
    xiaoLu:    toSeq(d.xiaoLuData),
    xiaoQiang: toSeq(d.xiaoQiangLuData),
  };

  for (const [roadName, seq] of Object.entries(roads)) {
    for (const pattern of TARGET_PATTERNS) {
      // 检查序列末尾是否匹配目标组合
      if (seq.endsWith(pattern)) {
        return { vid, roadName, pattern, seq };
      }
    }
  }
  return null;
}
```

#### 扫描循环

```javascript
let scanning = true;
let inRoom = false;

function scan() {
  if (!scanning || inRoom) return;

  const dataObj = VideoGameCore.PlazaRoadStore._instance.roadDataMap.dataObj;
  for (const vid of Object.keys(dataObj)) {
    const hit = checkRoom(vid);
    if (hit) {
      console.log('命中！', hit.vid, hit.roadName, hit.pattern);
      inRoom = true;
      enterRoomAndBet(hit);
      return; // 先到先得，进一个就停止扫描
    }
  }
}

setInterval(scan, 3000);
```

#### 倍投执行

```javascript
async function enterRoomAndBet(hit) {
  // 1. 进入房间（已有 API）
  await enterRoom(hit.vid);

  // 2. 等马尔科夫预测结果（已有实现，进房间后自动计算）
  await waitForPrediction();
  const prediction = getMarkovPrediction()[0]; // 取第1步预测（0=庄, 1=闲）
  const playType = prediction === 0 ? 1 : 2;  // 转换为 playType

  // 3. 倍投循环（最多3轮）
  const multipliers = [1, 2, 4];
  for (let round = 0; round < 3; round++) {
    const amount = getSelectedChipValue() * multipliers[round];

    // 等下注窗口
    await waitForBetEnabled();

    // 下注
    const bs = GameBac.BetStore._instance;
    bs.addChipByPlayType(playType, amount);
    bs.confirmBet();

    // 等结算
    const result = await waitForResult();

    if (result === prediction) {
      console.log(`第${round + 1}轮命中，退出房间`);
      break;
    }

    if (round === 2) {
      console.log('3轮未中，止损退出');
    }
  }

  // 4. 退出房间，回到大厅继续扫描
  await exitRoom();
  inRoom = false;
}
```

### 13.4 方案可行性确认

| 环节 | 状态 | 依赖 |
|------|------|------|
| 大厅获取所有房间路单 | ✅ 已验证 | `PlazaRoadStore._instance` |
| 下三路组合匹配 | ✅ 纯 JS 字符串操作 | 无额外依赖 |
| 进入/退出房间 | ✅ 已有 API | 已有实现 |
| 马尔科夫预测 | ✅ 已有实现 | 进房间自动触发 |
| 下注执行 | ✅ 已验证 | `GameBac.BetStore._instance` |
| 倍投逻辑 | ✅ 纯逻辑控制 | 无额外依赖 |
| 结果监听 | ✅ 可轮询 `gmstatus` | `GameBac.GameStore._instance` |

### 13.5 注意事项

1. **先到先得**：同时多个房间命中时，取第一个发现的房间进入，其余忽略
2. **方向锁定**：倍投期间方向固定为进房间时马尔科夫预测的第 1 步，不随轮次改变
3. **最多 3 轮**：无论中没中，第 3 轮结束后必须退出，不追加
4. **组合末尾匹配**：只看序列最新的末尾 N 位，历史老数据不重复触发
5. **冷却机制**：同一房间触发后，退出房间至少等待 1 轮（约 60 秒）才能再次被扫描到，避免刚退出又被同一房间命中
6. **目标组合配置化**：`TARGET_PATTERNS` 数组可随时增删，不影响其他逻辑

---

## 十二、自动下注 API（2026-07-19 实测验证）

### 背景

游戏为 Canvas 渲染（白鹭引擎），下注区无 DOM 节点，**不能用 click 模拟**。
必须直接调用 `GameBac.BetStore._instance` 暴露的 JS 方法。

---

### 核心入口

```javascript
var bs = GameBac.BetStore._instance;        // 下注 Store
var gs = bs.getGameStoreList()[0];          // GameStore（游戏状态/倒计时）
```

---

### 游戏状态判断

#### gmstatus 含义

```javascript
gs.gameSnapshot.gmstatus
// 1 → 正常下注期（已验证）
// 6 → 补充下注期（isCountDownState 源码显示 [1,6] 均为下注期，待实测确认）
// 其他 → 非下注期（开牌/结算阶段）
```

#### 是否可下注（最可靠判断）

```javascript
gs.isBetEnabled()
// 源码：gameSocket.connected && isCountDownState() && _timeoutEndDateTime > 0
// 三个条件同时满足才返回 true

bs.betEnabled
// 源码：gameStore.isBetEnabled() && !gameStore.betPending
// 多一个 betPending 检查（防止上一笔未完成时重复提交）
```

---

### 倒计时读取

```javascript
// 方式1：精确毫秒计算（推荐）
var remainingSec = Math.floor((gs._timeoutEndDateTime - Date.now()) / 1000);
if (remainingSec < 0) remainingSec = 0;

// 方式2：引擎内置 getter（同等效果）
var remainingSec = gs.timeout;
// 源码：Math.floor((_timeoutEndDateTime - getNewDateTime()) / 1000)

// 本局总时长
var maxTimeout = gs.gameSnapshot.maxtimeout;  // 实测为 25（秒）
```

> 每局约 60 秒，其中下注期约 25 秒（maxtimeout=25）。
> 目标：在剩余 **3 ~ 22 秒**之间（即进入下注期后的第 3 秒到倒计时剩 3 秒前）执行下注。

---

### playType 常量（下注类型）

| playType | 常量名 | 含义 |
|----------|--------|------|
| `1` | `PLAYTYPE_BANKER` | **庄** |
| `2` | `PLAYTYPE_PLAYER` | **闲** |
| `3` | `PLAYTYPE_TIE` | 和 |
| `4` | `PLAYTYPE_BANKER_PAIR` | 庄对 |
| `5` | `PLAYTYPE_PLAYER_PAIR` | 闲对 |
| `11` | `PLAYTYPE_BANKER_NO_COMMISSION` | 免佣庄 |

> 自动下注主要用 `1`（庄）和 `2`（闲）。

---

### 下注调用流程

```javascript
var bs = GameBac.BetStore._instance;

// 第一步：加注（不传 amount 则自动使用玩家当前在界面选中的筹码）
bs.addChipByPlayType(2);        // 下闲，用当前选中筹码
bs.addChipByPlayType(1);        // 下庄，用当前选中筹码
bs.addChipByPlayType(2, 200);   // 下闲，指定金额 200

// 第二步：确认下注（发到服务器）
bs.confirmBet();
```

#### confirmEnabled 条件（confirmBet 内部检查）

```javascript
// 源码还原：
bs.confirmEnabled
// = betEnabled
//   && stakePool.totalAmount > donePool.totalAmount   ← 有新增下注才允许确认
//   && gameStore.gameSnapshot
//   && gameStore.gameSnapshot.gmcode !== ''
```

> 调用 `addChipByPlayType` 之后 `confirmEnabled` 会自动变 true，无需手动判断，直接 `confirmBet()` 即可。

---

### 当前筹码

```javascript
bs.getSelectedChipValue()   // 当前界面选中的筹码，实测返回 200
```

> `addChipByPlayType(playType)` 省略 amount 时，源码会自动调用 `getSelectedChipValue()`，**不需要脚本控制筹码选择**，由用户在界面上选好即可。

---

### 已下注状态查询

```javascript
bs.stakePool.getAllStakeData()
  .filter(d => d.amount > 0)
  .map(d => ({ playType: d.playType, amount: d.amount }))
// 返回本局已在各区域下注的金额

bs.getTotalBetAmount()       // 本局总下注额

gs.betPending                // true = 上一笔下注请求正在处理中，此时勿重复提交
```

---

### 自动下注逻辑设计（供实现参考）

```
每 3 秒轮询时：

  1. GameBac 不存在 → 跳过（在大厅）
  2. bs.betEnabled !== true → 跳过（非下注期 或 betPending）
  3. remainingSec > maxTimeout - 3 → 跳过（刚进入下注期前 3 秒，等稳定）
  4. remainingSec < 3 → 跳过（倒计时后 3 秒，太晚了）
  5. bs.getTotalBetAmount() > 0 → 跳过（本局已下过注）
  6. 以上条件都通过 → 执行下注：
       bs.addChipByPlayType(predictedPlayType);
       bs.confirmBet();
```

> `predictedPlayType` 由马尔科夫预测结果（大路下三路一致时）决定：
> - 预测结果为庄（`'0'`）→ `playType = 1`
> - 预测结果为闲（`'1'`）→ `playType = 2`

---

### 注意事项

1. **GameBac 只在房间内存在**，大厅下 `_instance` 为 null，需做 null 检查
2. **`betPending`** 为 true 时不能下注，需等上一笔响应回来
3. **每局只下一次**：用 `getTotalBetAmount() > 0` 或记录 gmcode 来防止重复
4. **gmstatus=6** 的具体含义待下次实测确认（源码显示与 1 同为下注期）
5. **筹码由用户自行在界面选择**，脚本不需要控制筹码选择逻辑
