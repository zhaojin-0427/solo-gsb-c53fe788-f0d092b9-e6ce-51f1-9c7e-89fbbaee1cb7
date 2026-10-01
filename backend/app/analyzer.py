"""航标灯质可辨性穷举分析核心。

判定准则（码字汉明距离的经典最近邻界）：
    两盏灯在 n 位观测下「最小汉明距离」> 2k 时，
    即使每段最多出现 k 位误判也不会被混淆，即 n 位可辨。

对每一对灯，起始相位 p∈[0,la)、q∈[0,lb) 各自独立、完整枚举，
不抽样、不跳过任何相位组合。距离是相位的函数，用 NumPy 广播
一次性对全部相位组合逐位计算，再对相位维取最小。

内存策略：逐对灯顺序处理，单对张量形状 (la, lb, W)，dtype 取
uint8/int32，处理完立即序列化为 Python 列表并释放数组，
因此总内存与灯的数量无关（最坏单对约二十余 MB）。
"""

from __future__ import annotations

from typing import Any

import numpy as np

# 规则常量（与校验层保持一致）
MIN_LIGHTS = 2
MAX_LIGHTS = 20
MIN_PERIOD = 2
MAX_PERIOD = 80
MIN_W = 1
MAX_W = 400
MIN_K = 0
MAX_K = 3


def validate_config(payload: Any) -> list[str]:
    """校验前端提交的配置，返回错误字符串列表（空列表表示通过）。"""
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["请求体必须是 JSON 对象"]

    lights = payload.get("lights")
    if not isinstance(lights, list):
        errors.append("lights 必须是数组")
        return errors

    if not (MIN_LIGHTS <= len(lights) <= MAX_LIGHTS):
        errors.append(f"灯的数量必须在 {MIN_LIGHTS}～{MAX_LIGHTS} 之间（当前 {len(lights)} 盏）")

    for i, light in enumerate(lights):
        if not isinstance(light, dict):
            errors.append(f"第 {i + 1} 盏灯格式不正确")
            continue
        name = light.get("name", "")
        label = name.strip() if isinstance(name, str) and name.strip() else f"灯 {i + 1}"
        code = light.get("code")
        if not isinstance(code, str):
            errors.append(f"「{label}」的灯串必须是字符串")
            continue
        if not (MIN_PERIOD <= len(code) <= MAX_PERIOD):
            errors.append(f"「{label}」灯串长度必须在 {MIN_PERIOD}～{MAX_PERIOD} 位（当前 {len(code)} 位）")
        if any(ch not in "01" for ch in code):
            errors.append(f"「{label}」灯串只能包含字符 0 和 1")
        if "0" not in code or "1" not in code:
            errors.append(f"「{label}」灯串必须同时包含 0 和 1")

    w = payload.get("W")
    if not isinstance(w, int) or isinstance(w, bool):
        errors.append("观测窗口上限 W 必须是整数")
    elif not (MIN_W <= w <= MAX_W):
        errors.append(f"W 必须在 {MIN_W}～{MAX_W} 之间（当前 {w}）")

    k = payload.get("k")
    if not isinstance(k, int) or isinstance(k, bool):
        errors.append("每段最多误判位数 k 必须是整数")
    elif not (MIN_K <= k <= MAX_K):
        errors.append(f"k 必须在 {MIN_K}～{MAX_K} 之间（当前 {k}）")

    return errors


def _segments(code: str) -> np.ndarray:
    """灯串转 uint8 的 0/1 数组。"""
    return np.frombuffer(code.encode("ascii"), dtype=np.uint8) - ord("0")


def _phase_windows(seg: np.ndarray, n: int) -> np.ndarray:
    """枚举全部起始相位的前 n 位循环观测，形状 (L, n)，uint8。"""
    lengths = np.arange(seg.shape[0], dtype=np.int32).reshape(-1, 1)
    offsets = np.arange(n, dtype=np.int32).reshape(1, -1)
    return seg[(lengths + offsets) % seg.shape[0]]


def _pair_tensors(seg_a: np.ndarray, seg_b: np.ndarray, w: int):
    """返回单对灯在全部独立相位组合下的逐位差异与累计距离。

    diff: (la, lb, W) uint8，逐位 0/1 差异
    cum : (la, lb, W) int32，前 n 位汉明距离
    """
    win_a = _phase_windows(seg_a, w)[:, None, :]   # (la, 1, W)
    win_b = _phase_windows(seg_b, w)[None, :, :]   # (1, lb, W)
    diff = (win_a != win_b).view(np.uint8)
    cum = np.cumsum(diff, axis=2, dtype=np.int32)
    return diff, cum


def _pair_min_dist(seg_a: np.ndarray, seg_b: np.ndarray, w: int) -> np.ndarray:
    """d_min(n)：对全部相位组合取最小后的前 n 位距离曲线，形状 (W,)。"""
    _diff, cum = _pair_tensors(seg_a, seg_b, w)
    return cum.min(axis=(0, 1))


def _witness_from_arrays(
    seg_a: np.ndarray,
    seg_b: np.ndarray,
    cum_n: np.ndarray,
    diff: np.ndarray,
    n: int,
) -> dict[str, Any]:
    """从长度 n 的全量相位结果中取「距离最近的相位组合」做逐位见证。

    并列时 NumPy argmin 取行优先（p 优先）的第一个组合，结果确定、可复现。
    """
    la, lb = cum_n.shape
    flat_idx = int(cum_n.reshape(la * lb).argmin())
    bp, bq = (int(x) for x in np.unravel_index(flat_idx, cum_n.shape))

    offsets = np.arange(n, dtype=np.int32)
    bits_a = seg_a[(bp + offsets) % la]
    bits_b = seg_b[(bq + offsets) % lb]
    mismatch = (np.nonzero(diff[bp, bq, :n])[0] + 1).tolist()
    return {
        "n": n,
        "phase_a": bp,
        "phase_b": bq,
        "phase_a_time_s": round(bp * 0.1, 1),
        "phase_b_time_s": round(bq * 0.1, 1),
        "bits_a": "".join(str(int(x)) for x in bits_a),
        "bits_b": "".join(str(int(x)) for x in bits_b),
        "mismatch_positions": [int(x) for x in mismatch],
        "distance": int(cum_n[bp, bq]),
    }


def run(payload: dict[str, Any]) -> dict[str, Any]:
    """执行完整穷举分析。payload 已通过 validate_config 校验。"""
    lights = [
        {
            "name": (lt.get("name") or "").strip() or f"灯 {i + 1}",
            "code": lt["code"],
        }
        for i, lt in enumerate(payload["lights"])
    ]
    w = int(payload["W"])
    k = int(payload["k"])
    threshold = 2 * k
    m = len(lights)
    segs = [_segments(l["code"]) for l in lights]

    # 第一遍：逐对枚举全部相位，只保留 d_min(n) 曲线（每对的大张量用完即释放）
    pair_meta: list[dict[str, Any]] = []
    total_phase_pairs = 0
    for i in range(m):
        for j in range(i + 1, m):
            min_dist = _pair_min_dist(segs[i], segs[j], w)
            ok = min_dist > threshold
            first_n = int(ok.argmax()) + 1 if bool(ok.any()) else None
            curve = [int(x) for x in min_dist]
            total_phase_pairs += len(segs[i]) * len(segs[j])
            pair_meta.append(
                {
                    "a": i,
                    "b": j,
                    "min_dist_curve": curve,
                    "min_dist_at_w": int(min_dist[w - 1]),
                    "first_n": first_n,
                    "phase_pairs": len(segs[i]) * len(segs[j]),
                }
            )

    first_ns = [p["first_n"] for p in pair_meta]
    n_star = max(first_ns) if all(n is not None for n in first_ns) else None

    # 第二遍：确定 N* 后逐对重算全量相位张量并生成见证
    # （重算依然是完整穷举，仅用于在正确的观测长度上取 argmin；
    #  内存只与单对张量相关，不随灯数累积）
    serialized_pairs: list[dict[str, Any]] = []
    confused_pairs: list[dict[str, Any]] = []
    for p in pair_meta:
        i, j = p["a"], p["b"]
        diff, cum = _pair_tensors(segs[i], segs[j], w)
        entry: dict[str, Any] = {
            "a": i,
            "b": j,
            "name_a": lights[i]["name"],
            "name_b": lights[j]["name"],
            "period_a": len(segs[i]),
            "period_b": len(segs[j]),
            "phase_pairs": p["phase_pairs"],
            "min_dist_curve": p["min_dist_curve"],
            "min_dist_at_w": p["min_dist_at_w"],
            "first_n": p["first_n"],
        }
        if n_star is not None:
            entry["witness"] = _witness_from_arrays(
                segs[i], segs[j], cum[:, :, n_star - 1], diff, n_star
            )
        elif p["min_dist_at_w"] <= threshold:
            entry["witness"] = _witness_from_arrays(
                segs[i], segs[j], cum[:, :, w - 1], diff, w
            )
            confused_pairs.append(entry)
        del diff, cum
        serialized_pairs.append(entry)

    return {
        "W": w,
        "k": k,
        "threshold": threshold,
        "light_count": m,
        "pair_count": len(pair_meta),
        "total_phase_pairs": total_phase_pairs,
        "lights": lights,
        "solvable": n_star is not None,
        "n_star": n_star,
        "pairs": serialized_pairs,
        "confused_pairs": confused_pairs,
    }
