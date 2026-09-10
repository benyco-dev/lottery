/**
 * 예측 기록 갱신. draws.json 을 읽어서
 *  1) 이미 추첨이 끝난 예측을 채점하고
 *  2) 다음 회차 예측이 없으면 새로 만들어 덧붙인다.
 * 멱등이라 여러 번 돌려도 결과가 같다. node scripts/update.mjs
 */
import fs from "node:fs";
import { RANGES, gradeRecord, recommend, sliceDraws } from "../site/analysis.js";

const DRAWS = new URL("../site/data/draws.json", import.meta.url);
const PREDS = new URL("../site/data/predictions.json", import.meta.url);

const { draws, latest } = JSON.parse(fs.readFileSync(DRAWS));
const byEpsd = new Map(draws.map((d) => [d.e, d]));
const store = fs.existsSync(PREDS) ? JSON.parse(fs.readFileSync(PREDS)) : { records: [] };

/** 추첨일(YYYYMMDD)에 7일을 더한다. */
function nextSaturday(ymd) {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * target 회차 예측 5세트 = 5개 분석 구간에서 각 1세트.
 * 시드가 회차번호에 묶여 있어 누구든 같은 코드로 같은 결과를 재현할 수 있다.
 */
function predict(target) {
  const history = draws.filter((d) => d.e < target); // 미래 데이터를 절대 쓰지 않는다
  return {
    target,
    basedOn: history[history.length - 1].e,
    drawDate: nextSaturday(history[history.length - 1].d),
    createdAt: new Date().toISOString().slice(0, 10),
    sets: RANGES.map((r, i) => {
      const [set] = recommend(sliceDraws(history, r.size), { seed: target * 10 + i, sets: 1 });
      return { range: r.key, label: r.label, numbers: set.numbers, sum: set.sum, odd: set.odd };
    }),
    result: null,
  };
}

let changed = 0;
store.records = store.records.map((rec) => {
  const draw = byEpsd.get(rec.target);
  if (rec.result || !draw) return rec;
  changed++;
  return gradeRecord(rec, draw);
});

const target = latest + 1;
if (!store.records.some((r) => r.target === target)) {
  store.records.push(predict(target));
  changed++;
}

store.records.sort((a, b) => b.target - a.target);
// 변경이 있을 때만 갱신한다 — 매 실행마다 타임스탬프가 바뀌면 빈 커밋이 쌓인다.
if (changed || !store.updatedAt) store.updatedAt = new Date().toISOString();

// 채점 완료된 예측들의 누적 성적
const done = store.records.filter((r) => r.result);
store.summary = {
  graded: done.length,
  sets: done.length * RANGES.length,
  wins: done.filter((r) => r.result.bestRank > 0).length,
  byRank: [1, 2, 3, 4, 5].map((rank) => ({
    rank,
    count: done.flatMap((r) => r.result.sets).filter((s) => s.rank === rank).length,
  })),
};

fs.writeFileSync(PREDS, JSON.stringify(store, null, 1));
console.log(`${target}회 예측 대기 · 채점완료 ${done.length}건 · 변경 ${changed}건`);
