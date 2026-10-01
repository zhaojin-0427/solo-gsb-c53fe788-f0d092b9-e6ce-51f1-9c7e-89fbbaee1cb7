"""航标灯质可辨性分析引擎。

对任意两盏灯 A、B，穷举各自独立的起始相位 (i, j)（i 取遍 A 整串、
j 取遍 B 整串，共 La*Lb 种组合，全程不抽样、不略过任何一种），
计算前 n 位（n = 1..W）的汉明距离 d_{i,j}(n)。

穷举实现说明
------------
两位差序列满足平移性质::

    m_{i,j}(t) = m_{i+1, j+1}(t-1)

即“两灯同时提前 1 位”只是把差异序列整体平移一位。按
(i - j) mod g（g = gcd(La, Lb)）可把全部 La*Lb 个相位组合划分为
g 个等价类，每类恰有 L = lcm(La, Lb) 个成员，同类成员的差异序列
彼此是循环左移一位的关系（L 为其基本周期）。第 q 类用
``(i, j) = (s mod La, (s-q) mod Lb), s = 0..L-1`` 完整列出其 L 个
成员，g 类合计 g*L = La*Lb 个组合，覆盖所有独立相位，无一遗漏。

实现上把 g 个类、L 个位移、W 个时刻一次性张成 (g, L, W) 张量
（元素总数恰为 La*Lb*W，与逐相位朴素枚举一一对应），再用 NumPy
向量化前缀和一次性求出每个组合、每个窗口长度的汉明距离。
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

# 硬性参数边界（与 schemas 中的校验保持一致）
MIN_LIGHTS, MAX_LIGHTS = 2, 20
MIN_PATTERN_LEN, MAX_PATTERN_LEN = 2, 80
MIN_W, MAX_W = 1, 400
MIN_K, MAX_K = 0, 3
SECONDS_PER_BIT = 0.1


def analyze(patterns: list[str], w: int, k: int) -> dict[str, Any]:
    """对全部灯对执行穷举相位分析。

    参数
    ----
    patterns: 每盏灯的循环 0/1 串（长度 2~80，同时含 0、1）。
    w: 观测窗口上限（1~400）。
    k: 每段最多误判位数（0~3），可辨阈值为最小距离 > 2k。

    返回
    ----
    见 README「分析结果数据结构」。
    """
    m = len(patterns)
    if not (MIN_LIGHTS <= m <= MAX_LIGHTS):
        raise ValueError("灯的数量必须在 2~20 之间")
    if not (MIN_W <= w <= MAX_W):
        raise ValueError("W 必须在 1~400 之间")
    if not (MIN_K <= k <= MAX_K):
        raise ValueError("k 必须在 0~3 之间")

    arrs = [np.frombuffer(p.encode("ascii"), dtype=np.uint8) - ord("0") for p in patterns]
    for idx, p in enumerate(patterns):
        if not (MIN_PATTERN_LEN <= len(p) <= MAX_PATTERN_LEN) or any(c not in "01" for c in p):
            raise ValueError(f"灯 {idx + 1} 的灯串非法")
        if not (arrs[idx].any() and (~arrs[idx].astype(bool)).any()):
            raise ValueError(f"灯 {idx + 1} 的灯串必须同时含 0 和 1")

    threshold = 2 * k

    # bottleneck[n-1] = 所有灯对在窗口 n 下的最小距离的最小值
    # （全局最易混淆灯对的最近距离曲线）
    bottleneck = np.full(w, np.iinfo(np.int64).max, dtype=np.int64)

    pairs_raw: list[dict[str, Any]] = []

    for a in range(m):
        pa = arrs[a]
        la = pa.size
        for b in range(a + 1, m):
            pb = arrs[b]
            lb = pb.size
            g = math.gcd(la, lb)
            period = la // g * lb  # lcm(la, lb)

            # 相位组合 (i,j) 按 i-j (mod g) 分成 g 个等价类 q=0..g-1，
            # 每类用位移 s=0..L-1 参数化为 (i=s mod La, j=(s-q) mod Lb)，
            # 合计 g*L = La*Lb 个组合，恰好覆盖全部独立相位。
            qvec = np.arange(g, dtype=np.int64)[:, None]       # (g,1)
            uu = np.arange(period, dtype=np.int64)[None, :]    # (1,L)
            i_idx = (uu % la)                                  # (1,L)
            j_idx = (uu - qvec) % lb                           # (g,L)
            # 各类的基本逐位差异 mm_all[q, u]（u=0..L-1）
            mm_all = (pa[i_idx] != pb[j_idx]).astype(np.int8)  # (g,L)

            # 位移 s 下第 t 位差异 = mm_all[q, (t+s) mod L]
            s = np.arange(period, dtype=np.int64)
            t = np.arange(w, dtype=np.int64)
            rot_idx = (t[None, :] + s[:, None]) % period       # (L,W)
            mismatch = mm_all[:, rot_idx]                      # (g,L,W)
            # 元素总数 g*L*W = La*Lb*W，与逐相位朴素枚举完全一致（无抽样）

            # dist[q, s, n] = 该类、该位移下前 n 位汉明距离
            dist = np.zeros((g, period, w + 1), dtype=np.int32)
            np.cumsum(mismatch, axis=2, dtype=np.int32, out=dist[:, :, 1:])

            flat = dist[:, :, 1:].reshape(g * period, w)       # (La*Lb, W)
            # 每个窗口长度 n 下，穷举全部相位得到的最小距离与对应相位
            dmin = flat.min(axis=0)  # shape (W,)
            # argmin 取首个最小值：相位按 q 主序、s 次序线性展开，确定可复现
            ph_best = flat.argmin(axis=0)  # shape (W,)

            bottleneck = np.minimum(bottleneck, dmin)
            pairs_raw.append(
                {
                    "a": a,
                    "b": b,
                    "la": la,
                    "lb": lb,
                    "g": g,
                    "period": period,
                    "dmin": dmin,
                    "ph_best": ph_best,
                    "confused_at_w": bool(dmin[w - 1] <= threshold),
                }
            )

    if int(bottleneck[w - 1]) > threshold:
        # 最短可辨窗口：dmin 单调不减（前 n 位距离随 n 只增不减），
        # 找到第一个全局最小距离 > 2k 的 n 即为最短
        ok = np.nonzero(bottleneck > threshold)[0]
        n_star = int(ok[0]) + 1
        shortest = n_star
        solvable = True
    else:
        n_star = None
        shortest = None
        solvable = False

    # 第二遍：在“决定性窗口”下重放逐位见证。
    # 可辨时决定性窗口 = 最短窗口 n*（该对在 n* 下最近的相位）；
    # 无解时决定性窗口 = W（仍混淆灯对在 W 下的最近相位）。
    pairs: list[dict[str, Any]] = []
    for raw in pairs_raw:
        a, b = raw["a"], raw["b"]
        pa, pb = arrs[a], arrs[b]
        la, lb = raw["la"], raw["lb"]
        g, period = raw["g"], raw["period"]
        dmin, ph_best = raw["dmin"], raw["ph_best"]

        if solvable:
            # 该对首个 dmin > 阈值的窗口（不大于 n*）
            first_ok = int(np.nonzero(dmin > threshold)[0][0])
            win = first_ok + 1
        else:
            win = w
        ph = int(ph_best[win - 1])
        q0, s0 = divmod(ph, period)
        i0 = int(s0 % la)
        j0 = int((s0 - q0) % lb)

        # 直接重放该见证相位下前 win 位（再次穷举结果的解码，不做近似）
        mm = np.array(
            [pa[(tt + i0) % la] != pb[(tt + j0) % lb] for tt in range(win)],
            dtype=np.int8,
        )
        diff_positions = [int(pos) for pos in np.nonzero(mm)[0].tolist()]
        bits_a = "".join(str(int(pa[(tt + i0) % la])) for tt in range(win))
        bits_b = "".join(str(int(pb[(tt + j0) % lb])) for tt in range(win))
        mark = "".join("^" if tt in set(diff_positions) else " " for tt in range(win))

        pairs.append(
            {
                "a": a,
                "b": b,
                "len_a": la,
                "len_b": lb,
                "phase_pairs_total": la * lb,
                "phase_pairs_enumerated": la * lb,
                "phase_equivalence_classes": int(g),
                "dmin": [int(x) for x in dmin.tolist()],
                "witness_window": win,
                "witness": {
                    "phase_a": i0,
                    "phase_b": j0,
                    "distance": int(dmin[win - 1]),
                    "distance_at_w": int(dmin[w - 1]),
                    "diff_positions": diff_positions,
                    "diff_count": len(diff_positions),
                    "bits_a": bits_a,
                    "bits_b": bits_b,
                    "diff_mark": mark,
                },
                "confused_at_w": raw["confused_at_w"],
            }
        )

    return {
        "w": w,
        "k": k,
        "threshold": threshold,
        "threshold_rule": "min_distance > 2*k",
        "seconds_per_bit": SECONDS_PER_BIT,
        "light_count": m,
        "pair_count": len(pairs),
        "solvable": solvable,
        "shortest_window": shortest,
        "shortest_seconds": (shortest * SECONDS_PER_BIT if shortest is not None else None),
        "bottleneck": [int(x) for x in bottleneck.tolist()],
        "pairs": pairs,
        "exhaustive": True,
        "exhaustive_note": (
            "对每对灯穷举 La*Lb 个独立起始相位组合（按 gcd 等价类无遗漏枚举），"
            "不抽样、不略过任何相位"
        ),
    }
