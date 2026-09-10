#!/usr/bin/env python3
"""수집 데이터 자기검증. 동행복권 자체 통계 API와 번호별 출현횟수를 대조한다."""
import collections
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fetch_draws import BASE, OUT, RESULT_PAGE, get_json, opener

data = json.loads(OUT.read_text(encoding="utf-8"))
draws, latest = data["draws"], data["latest"]

assert len(draws) == latest, f"회차 수 불일치: {len(draws)} != {latest}"
assert [d["e"] for d in draws] == list(range(1, latest + 1)), "회차 번호가 연속이 아님"

prev_date = ""
for d in draws:
    assert len(d["n"]) == 6 and len(set(d["n"])) == 6, f"{d['e']}회 번호 6개 아님: {d['n']}"
    assert d["n"] == sorted(d["n"]), f"{d['e']}회 정렬 안 됨"
    assert all(1 <= n <= 45 for n in d["n"]), f"{d['e']}회 범위 이탈: {d['n']}"
    assert 1 <= d["b"] <= 45 and d["b"] not in d["n"], f"{d['e']}회 보너스 오류: {d['b']}"
    assert d["d"] > prev_date, f"{d['e']}회 추첨일 역순: {d['d']}"
    prev_date = d["d"]

# 동행복권 공식 집계와 대조 (보너스 제외, 전 회차)
opener.open(RESULT_PAGE, timeout=20).read()
official = {r["wnNo"]: r["cnt"] for r in get_json(
    f"{BASE}/lt645/selectLt645NoStats.do",
    srchStrLtEpsd=1, srchEndLtEpsd=latest, srchBnsYn="N")["result"]}
mine = collections.Counter(n for d in draws for n in d["n"])
diff = {n: (mine[n], official[n]) for n in range(1, 46) if mine[n] != official[n]}
assert not diff, f"공식 집계와 불일치 (번호: 내집계/공식): {diff}"

print(f"OK 1~{latest}회, 번호별 출현횟수 45개 전부 공식 통계와 일치")
