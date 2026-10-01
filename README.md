# 航标灯质可辨性本地 Web 预检台

供航标灯质设计人员使用的**本地** Web 工具：录入 2～20 盏灯的循环亮灭串，
穷举任意两盏灯各自独立的起始相位，计算前 n 位汉明距离，找出观测窗口上限
W 以内**最短的可辨窗口**；W 位仍不可辨时，给出混淆灯对、距离最近的相位
组合与逐位差异。全程**穷举每一对灯的全部 La×Lb 个独立相位，不抽样、不
略过任何相位**。

- 后端：Python 3.12 · FastAPI · SQLite（NumPy 向量化穷举）
- 前端：原生 HTML / CSS / JavaScript（无构建、无外部 CDN）
- 部署：Docker Compose 一键启动

## 一、启动与访问

### 方式 A：Docker Compose（推荐）

前置：已安装 Docker 与 Docker Compose 插件。

```bash
docker compose up -d --build
```

启动后浏览器访问：

- 应用页面： <http://localhost:8000/>
- 接口文档（FastAPI 自动生成）： <http://localhost:8000/docs>
- 健康检查： <http://localhost:8000/api/health>

停止：

```bash
docker compose down          # 停止，保留数据卷
docker compose down -v       # 停止并删除全部历史数据
```

SQLite 数据库保存在 Docker 命名卷 `beacon-data`（容器内 `/srv/data/beacon.db`），
容器重建不丢历史分析。

### 方式 B：本地直接运行（无 Docker）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

数据库默认位于 `app/data/beacon.db`（可用环境变量 `DB_PATH` 覆盖）。

## 二、使用流程

1. 左侧维护灯串：每盏灯一个**名称**和一条 **0/1 循环串**
   - 2～20 盏灯；每串长度 2～80 位；必须**同时含 0 和 1**
   - 每位 = **0.1 秒**；整串无限循环，亮（1）/灭（0）
2. 设置参数：
   - **W**：观测窗口上限，1～400（位），即 0.1～40 秒
   - **k**：每段最多误判位数，0～3
3. 点击 **「保存并分析（穷举全部相位）」**。
4. 中间区域查看：
   - 每盏灯的**循环波形**（橙=亮 1，灰=灭 0，虚线为循环串边界）
   - **结论**：可辨时给出最短窗口 n\*（位与秒）；无解时列出在 W 位下仍
     混淆的灯对
   - 每个灯对一张卡片：穷举全部相位后的**最小距离曲线**（n=1..W，
     红色虚线为阈值 2k），以及**决定性窗口下的逐位见证**
5. 右侧为**历史分析**。每次分析都会把当时的灯串、W、k 与完整结果整体
   冻结保存；之后无论怎样编辑灯串或参数，点开旧记录看到的始终是当时的
   结果。「保存灯串/参数」只更新当前设计，不改动任何历史记录。

## 三、判定规则

- 对灯 A（串长 La）、灯 B（串长 Lb），设各自起始相位为 i（0..La−1）、
  j（0..Lb−1）。相位定义为“观测到的第 0 位对应各自循环串中的下标”。
- 穷举全部 **La×Lb** 个独立相位组合，对每个窗口长度 n=1..W 计算前 n 位
  汉明距离 d_{i,j}(n)，取最小值

      dmin(n) = min_{i,j} d_{i,j}(n)

- 每段观测容许 k 位被误判为 0、k 位被误判为 1，因此两串在 n 位内**可辨**
  当且仅当

      dmin(n) > 2k

- 所有灯对两两可辨，n 位观测才算可辨。由于前 n 位距离随 n 只增不减，
  最短可辨窗口为

      n* = min { n ∈ [1, W] : 对所有灯对，dmin(n) > 2k }

- 若 W 位仍无解，则展示所有 dmin(W) ≤ 2k 的混淆灯对，并对每对给出其在
  W 位下距离最近的相位组合 (i,j) 与全部差异位（位置从 1 起、对应秒数）。

### 穷举是如何保证不遗漏的

两灯同时提前一位，差异序列只是整体平移一位。全部 La×Lb 个相位组合按
(i−j) mod g（g = gcd(La,Lb)）划分为 g 个等价类，每类 L = lcm(La,Lb)
个成员，同类成员的差异序列彼此恰为循环左移一位的关系。程序把
g 个类 × L 个位移 × W 个时刻一次性张成张量（元素总数恰为
La×Lb×W，与逐相位朴素枚举一一对应），用 NumPy 前缀和向量化求距离；
每张结果卡片都标注实际枚举的相位组合数 `枚举 La*Lb / La*Lb` 及 gcd
等价类数，便于核对。最坏规模（20 盏 × 80 位 × W=400）在普通机器上
数秒内完成。

## 四、分析结果数据结构

`GET /api/analyses/{id}` 返回（节选）：

```jsonc
{
  "id": 1,
  "created_at": "2026-10-01T03:00:00Z",
  "note": "备注",
  "w": 40, "k": 1,
  "snapshot": [ {"name": "灯 A", "pattern": "11100000"}, ... ], // 冻结灯串
  "result": {
    "threshold": 2,
    "solvable": true,
    "shortest_window": 6,          // n*，无解时为 null
    "shortest_seconds": 0.6,       // n* × 0.1，无解时为 null
    "bottleneck": [0, 0, 1, ...],  // 全局最易混淆灯对的 dmin 曲线
    "pairs": [{
      "a": 0, "b": 1,
      "phase_pairs_total": 64,     // La*Lb
      "phase_pairs_enumerated": 64,// 实际穷举数（= 总数，无抽样）
      "dmin": [0, 0, 1, ...],      // 每个 n 下穷举相位的最小距离
      "witness_window": 6,         // 见证所用窗口：可辨时为该对首个通过窗口，无解时为 W
      "witness": {
        "phase_a": 2, "phase_b": 0,          // 最近相位组合
        "distance": 3,                        // 该窗口下的最小距离
        "diff_positions": [0, 3, 5],          // 差异位（0 基）
        "bits_a": "101001", "bits_b": "001000",
        "diff_mark": "^ ^  ^ "                // ^ 标出差异列
      },
      "confused_at_w": false
    }]
  }
}
```

## 五、HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 当前灯串与 W、k |
| PUT | `/api/lights` | 整批替换当前灯串（不影响历史分析） |
| PUT | `/api/settings` | 更新 W、k（不影响历史分析） |
| GET | `/api/analyses` | 历史分析列表（含可辨结论与 n\*） |
| POST | `/api/analyses` | 以当前灯串/参数创建**冻结**分析 |
| GET | `/api/analyses/{id}` | 取某次分析的快照与完整结果 |
| DELETE | `/api/analyses/{id}` | 删除某次分析 |

## 六、目录结构

```
.
├── app/
│   ├── main.py          # FastAPI 路由
│   ├── engine.py        # 全相位穷举分析引擎（NumPy）
│   ├── db.py            # SQLite 持久化（灯串/参数/冻结分析）
│   ├── schemas.py       # 输入校验
│   └── static/          # 原生前端（index.html / style.css / app.js）
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```
