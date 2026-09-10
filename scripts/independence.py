#!/usr/bin/env python3
"""회차 간 예측 가능성이 있는지 전수 검정하고 site/data/independence.json 으로 저장한다.

로또가 독립시행이라는 주장을 사이트에서 말로만 하지 않고 매주 다시 계산해 보여주기 위한 것이다.
scipy 없이 표준 근사(Wilson-Hilferty, 정규 근사)와 몬테카를로만 쓴다.
"""
import itertools
import json
import math
import pathlib
import random
import statistics

ROOT = pathlib.Path(__file__).resolve().parent.parent
DRAWS = ROOT / "site" / "data" / "draws.json"
OUT = ROOT / "site" / "data" / "independence.json"
MC = 1000  # 번호쌍 검정의 몬테카를로 반복수

norm_two_sided = lambda z: math.erfc(abs(z) / math.sqrt(2))


def chi2_upper_p(x, k):
    """카이제곱 상단 꼬리. 적합도 검정은 '기대보다 큰 편차'만 의미가 있으므로 양측을 쓰면 안 된다."""
    z = ((x / k) ** (1 / 3) - (1 - 2 / (9 * k))) / math.sqrt(2 / (9 * k))
    return 0.5 * math.erfc(z / math.sqrt(2))


def pair_chi(draws):
    c = {}
    for s in draws:
        for pair in itertools.combinations(sorted(s), 2):
            c[pair] = c.get(pair, 0) + 1
    e = len(draws) * 15 / 990
    return sum((c.get(k, 0) - e) ** 2 / e for k in itertools.combinations(range(1, 46), 2))


def main():
    random.seed(0)
    data = json.loads(DRAWS.read_text())
    rows, n = data["draws"], len(data["draws"])
    sets = [set(d["n"]) for d in rows]
    tests = []

    def add(name, desc, obs, exp, p):
        tests.append({"name": name, "desc": desc, "obs": round(obs, 4), "exp": round(exp, 4), "p": round(p, 4)})

    rep = sum(len(sets[i] & sets[i - 1]) for i in range(1, n))
    mu = (n - 1) * 36 / 45
    sd = math.sqrt((n - 1) * 6 * (6 / 45) * (39 / 45) * (39 / 44))
    add("직전 회차 번호 재출현", "직전 회차 번호가 이번에 다시 나온 총 개수", rep, mu, norm_two_sided((rep - mu) / sd))

    hit = sum(1 for i in range(1, n) if rows[i - 1]["b"] in sets[i])
    mu = (n - 1) * 6 / 45
    sd = math.sqrt((n - 1) * (6 / 45) * (39 / 45))
    add("직전 보너스 → 이번 본번호", "직전 회차 보너스가 이번 본번호에 포함된 횟수", hit, mu, norm_two_sided((hit - mu) / sd))

    cnt = [0] * 46
    for s in sets:
        for v in s:
            cnt[v] += 1
    exp = n * 6 / 45
    chi = sum((c - exp) ** 2 / exp for c in cnt[1:])
    add("번호별 출현 균등성", "45개 번호 출현 횟수의 카이제곱 (df=44)", chi, 44, chi2_upper_p(chi, 44))

    obs = pair_chi(sets)
    null = [pair_chi([random.sample(range(1, 46), 6) for _ in range(n)]) for _ in range(MC)]
    add("번호쌍 동반출현", f"990개 번호쌍의 카이제곱, 몬테카를로 B={MC}", obs, statistics.mean(null),
        (sum(1 for x in null if x >= obs) + 1) / (MC + 1))

    def acf1(v):
        m = statistics.mean(v)
        return sum((v[i] - m) * (v[i - 1] - m) for i in range(1, len(v))) / sum((x - m) ** 2 for x in v)

    for label, desc, series in [
        ("번호합 자기상관", "회차별 번호합의 lag-1 자기상관", [sum(d["n"]) for d in rows]),
        ("홀수개수 자기상관", "회차별 홀수 개수의 lag-1 자기상관", [sum(1 for x in d["n"] if x % 2) for d in rows]),
    ]:
        a = acf1(series)
        add(label, desc, a, 0, norm_two_sided(a * math.sqrt(n)))

    gaps, last = [], {}
    for i, s in enumerate(sets):
        for v in s:
            if v in last:
                gaps.append(i - last[v])
            last[v] = i
    z = (statistics.mean(gaps) - 45 / 6) / (statistics.pstdev(gaps) / math.sqrt(len(gaps)))
    add("재출현 간격", "같은 번호가 다시 나오기까지의 평균 회차 간격", statistics.mean(gaps), 45 / 6, norm_two_sided(z))

    alpha = 0.05 / len(tests)
    OUT.write_text(json.dumps({
        "draws": n, "alpha": round(alpha, 5),
        "anySignificant": any(t["p"] < alpha for t in tests), "tests": tests,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    for t in tests:
        print(f"{t['name']:<24}{t['obs']:>12}{t['exp']:>12}{t['p']:>9.4f}  {'유의' if t['p'] < alpha else '무의미'}")
    print(f"\n본페로니 α={alpha:.4f} · 유의한 검정 {'있음' if any(t['p'] < alpha for t in tests) else '없음'} → {OUT.name}")


if __name__ == "__main__":
    main()
