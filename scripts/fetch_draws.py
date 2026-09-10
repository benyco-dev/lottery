#!/usr/bin/env python3
"""동행복권 로또6/45 전 회차 당첨번호를 수집해 site/data/draws.json 으로 저장한다.

공개 API(구 common.do?method=getLottoNumber)는 폐지됐고, 새 사이트가 쓰는
/lt645/selectPstLt645InfoNew.do 커서 페이지네이션(1페이지 10건)을 그대로 사용한다.
"""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

BASE = "https://www.dhlottery.co.kr"
RESULT_PAGE = f"{BASE}/lt645/result"
DRAW_API = f"{BASE}/lt645/selectPstLt645InfoNew.do"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
OUT = pathlib.Path(__file__).resolve().parent.parent / "site" / "data" / "draws.json"

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
opener.addheaders = [
    ("User-Agent", UA),
    ("Referer", RESULT_PAGE),
    ("X-Requested-With", "XMLHttpRequest"),
]


def get_json(url, **params):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    with opener.open(url, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))["data"]


def slim(row):
    """당첨번호 + 1~3등 당첨자 수 + 판매액만 남긴다.

    당첨자 수는 상금 표시용이 아니라 번호 인기도 추정에 쓴다.
    5개를 맞춘 티켓의 나머지 한 개가 보너스일 확률은 이론상 1/39로 고정이므로,
    w2/(w2+w3) 가 1/39 보다 크면 그 보너스 번호를 사람들이 더 많이 골랐다는 뜻이다.
    """
    return {
        "e": row["ltEpsd"],
        "d": row["ltRflYmd"],
        "n": sorted(row[f"tm{i}WnNo"] for i in range(1, 7)),
        "b": row["bnsWnNo"],
        "w1": row["rnk1WnNope"],
        "w2": row["rnk2WnNope"],
        "w3": row["rnk3WnNope"],
        "sales": row["rlvtEpsdSumNtslAmt"],
    }


def main():
    opener.open(RESULT_PAGE, timeout=20).read()  # 세션 쿠키 확보
    latest = get_json(f"{BASE}/lt645/selectLtEpsdInfo.do")["list"][0]["ltEpsd"]

    # srchCursorLtEpsd 는 실존 회차만 받으므로 최신 회차는 center 로 시드한다.
    draws = {}
    rows = get_json(DRAW_API, srchDir="center", srchLtEpsd=latest)["list"]
    while rows:
        for row in rows:
            draws[row["ltEpsd"]] = slim(row)
        cursor = min(r["ltEpsd"] for r in rows)
        print(f"\r{len(draws)}/{latest} (…{cursor}회)", end="", file=sys.stderr, flush=True)
        if cursor <= 1:
            break
        time.sleep(0.15)  # 서버 배려
        rows = get_json(DRAW_API, srchDir="older", srchCursorLtEpsd=cursor)["list"]

    missing = sorted(set(range(1, latest + 1)) - draws.keys())
    if missing:
        sys.exit(f"\n누락 회차 {len(missing)}개: {missing[:20]}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"latest": latest, "draws": [draws[e] for e in range(1, latest + 1)]},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"\n{OUT} <- 1~{latest}회 ({OUT.stat().st_size // 1024}KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
