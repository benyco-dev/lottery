/**
 * 예상번호 기록 갱신. draws.json 을 읽어서
 *  1) 이미 추첨이 끝난 예상번호를 채점하고
 *  2) 다음 회차 예상번호가 없으면 새로 만들어 덧붙인다.
 * 멱등이라 여러 번 돌려도 결과가 같다. node scripts/update.mjs
 */
import fs from "node:fs";
import { associations, analyze, gradeRecord, predict } from "../site/analysis.js";

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
 * target 회차 예상번호 5세트.
 *
 * target 회차 이전 데이터만으로 연관성을 다시 뽑아 생성한다 — 미래 데이터를 쓰지 않는다.
 * 시드가 회차번호라 같은 코드로 누구나 같은 결과를 재현할 수 있다.
 */
function makeRecord(target) {
  const history = draws.filter((d) => d.e < target);
  const assoc = associations(history);
  const stats = analyze(history);
  return {
    target,
    basedOn: history[history.length - 1].e,
    drawDate: nextSaturday(history[history.length - 1].d),
    createdAt: new Date().toISOString().slice(0, 10),
    sets: predict(history, { seed: target, sets: 5, assoc, stats }).map((s, i) => ({
      label: `세트 ${i + 1}`,
      numbers: s.numbers,
      sum: s.sum,
      odd: s.odd,
    })),
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
  store.records.push(makeRecord(target));
  changed++;
}

store.records.sort((a, b) => b.target - a.target);
// 변경이 있을 때만 갱신한다 — 매 실행마다 타임스탬프가 바뀌면 빈 커밋이 쌓인다.
if (changed || !store.updatedAt) store.updatedAt = new Date().toISOString();

// 채점 완료된 예상번호의 누적 성적
const done = store.records.filter((r) => r.result);
store.summary = {
  graded: done.length,
  sets: done.reduce((a, r) => a + r.result.sets.length, 0),
  wins: done.filter((r) => r.result.bestRank > 0).length,
  byRank: [1, 2, 3, 4, 5].map((rank) => ({
    rank,
    count: done.flatMap((r) => r.result.sets).filter((s) => s.rank === rank).length,
  })),
};

fs.writeFileSync(PREDS, JSON.stringify(store, null, 1));
console.log(`${target}회 예상번호 대기 · 채점완료 ${done.length}건 · 변경 ${changed}건`);
