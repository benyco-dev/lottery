#!/usr/bin/env python3
"""동행복권 로또6/45 전 회차 당첨번호를 수집해 site/data/draws.json 으로 저장한다.

공개 API(구 common.do?method=getLottoNumber)는 폐지됐고, 새 사이트가 쓰는
/lt645/selectPstLt645InfoNew.do 커서 페이지네이션(1페이지 10건)을 그대로 사용한다.
"""
import http.client
import json
import pathlib
import sys
import time
import urllib.error
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


TRANSIENT = (urllib.error.URLError, TimeoutError, http.client.HTTPException)


def get_json(url, _retries=4, **params):
    """일시적 네트워크 오류는 지수 백오프로 재시도한다. CI 러너에서 간헐적으로 타임아웃이 난다."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(_retries):
        try:
            with opener.open(url, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))["data"]
        except TRANSIENT as e:
            if attempt == _retries - 1:
                raise
            print(f"\n재시도 {attempt + 1}/{_retries - 1}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


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


def load_existing():
    """이미 받아둔 회차를 읽는다. 1회부터 연속으로 이어지지 않으면 증분을 포기하고 전량 수집한다."""
    if not OUT.exists():
        return {}
    try:
        draws = json.loads(OUT.read_text(encoding="utf-8"))["draws"]
    except (ValueError, KeyError):
        return {}
    if [d["e"] for d in draws] != list(range(1, len(draws) + 1)):
        return {}
    return {d["e"]: d for d in draws}


def main():
    opener.open(RESULT_PAGE, timeout=20).read()  # 세션 쿠키 확보
    latest = get_json(f"{BASE}/lt645/selectLtEpsdInfo.do")["list"][0]["ltEpsd"]

    draws = load_existing()
    have = max(draws, default=0)
    if have >= latest:
        print(f"이미 최신 (1~{latest}회). 받을 회차 없음.", file=sys.stderr)
        return

    # srchCursorLtEpsd 는 실존 회차만 받으므로 최신 회차는 center 로 시드한다.
    rows = get_json(DRAW_API, srchDir="center", srchLtEpsd=latest)["list"]
    while rows:
        for row in rows:
            draws[row["ltEpsd"]] = slim(row)
        cursor = min(r["ltEpsd"] for r in rows)
        print(f"\r{len(draws)}/{latest} (…{cursor}회)", end="", file=sys.stderr, flush=True)
        if cursor <= have + 1:  # 이미 가진 구간에 닿으면 멈춘다
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
    print(f"\n{OUT} <- 1~{latest}회 (신규 {latest - have}회, {OUT.stat().st_size // 1024}KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
