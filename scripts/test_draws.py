#!/usr/bin/env python3
"""수집 데이터 자기검증. 동행복권 자체 통계 API와 번호별 출현횟수를 대조한다."""
import collections
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fetch_draws import BASE, OUT, RESULT_PAGE, get_json, load_existing, opener

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

# 증분 수집: 회차가 1부터 연속으로 이어질 때만 재사용하고, 구멍이 있으면 전량 재수집해야 한다
import tempfile, unittest.mock  # noqa: E402

def existing_from(payload):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        tmp = pathlib.Path(f.name)
    try:
        with unittest.mock.patch("fetch_draws.OUT", tmp):
            return load_existing()
    finally:
        tmp.unlink()

ok = {"latest": 3, "draws": [{"e": i, "d": "x", "n": [1, 2, 3, 4, 5, 6], "b": 7} for i in (1, 2, 3)]}
assert len(existing_from(ok)) == 3, "연속된 파일을 재사용하지 못함"
gap = {"latest": 3, "draws": [ok["draws"][0], ok["draws"][2]]}
assert existing_from(gap) == {}, "중간이 빈 파일을 그대로 재사용함 — 누락이 영구히 남는다"
head = {"latest": 3, "draws": ok["draws"][1:]}
assert existing_from(head) == {}, "1회부터 시작하지 않는 파일을 재사용함"
assert existing_from({"nope": 1}) == {}, "형식이 깨진 파일에서 예외가 나가야 하는데 통과함"

print(f"OK 1~{latest}회, 번호별 출현횟수 45개 전부 공식 통계와 일치 · 증분 갭 감지 정상")
