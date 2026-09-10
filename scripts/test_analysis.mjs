/** analysis.js 자기검증. node scripts/test_analysis.mjs */
import assert from "node:assert/strict";
import fs from "node:fs";
import { MODEL, analyze, associations, grade, gradeRecord, passesFilters, predict, RANGES, sliceDraws } from "../site/analysis.js";

const { draws, latest } = JSON.parse(fs.readFileSync(new URL("../site/data/draws.json", import.meta.url)));

// 등수 규칙
const win = [1, 2, 3, 4, 5, 6], bonus = 7;
assert.equal(grade([1, 2, 3, 4, 5, 6], win, bonus).rank, 1);
assert.equal(grade([1, 2, 3, 4, 5, 7], win, bonus).rank, 2, "5개+보너스=2등");
assert.equal(grade([1, 2, 3, 4, 5, 8], win, bonus).rank, 3);
assert.equal(grade([1, 2, 3, 4, 8, 9], win, bonus).rank, 4);
assert.equal(grade([1, 2, 3, 8, 9, 10], win, bonus).rank, 5);
assert.equal(grade([1, 2, 8, 9, 10, 11], win, bonus).rank, 0, "2개는 낙첨");
assert.equal(grade([8, 9, 10, 11, 12, 7], win, bonus).rank, 0, "보너스만 맞아도 낙첨");

// 구간 분할
assert.equal(sliceDraws(draws, 50).length, 50);
assert.equal(sliceDraws(draws, null).length, latest);
assert.equal(sliceDraws(draws, 50)[49].e, latest, "최근 N회는 마지막 회차로 끝나야 함");
assert.equal(sliceDraws(draws, 1e9).length, latest, "구간이 전체보다 크면 전체");

// 통계 정합성
for (const r of RANGES) {
  const s = analyze(sliceDraws(draws, r.size));
  assert.equal(s.byNo.reduce((a, b) => a + b.count, 0), s.count * 6, `${r.label} 합계 불일치`);
  assert.equal(s.decades.reduce((a, b) => a + b, 0), s.count * 6);
  assert.ok(s.sum.p10 < s.sum.avg && s.sum.avg < s.sum.p90);
  assert.ok(s.byNo.every((b) => b.gap >= 0 && b.gap <= s.count));
}

// 연관성: 리프트는 대칭이고 평균이 1 근처여야 한다
const a2 = associations(draws);
for (let x = 1; x <= 45; x++) {
  for (let y = x + 1; y <= 45; y++) {
    assert.equal(a2.pairLift[x][y], a2.pairLift[y][x], `동반출현 리프트가 비대칭: ${x},${y}`);
  }
}
const lifts = a2.topPairs.map((p) => p.lift);
assert.ok(lifts[0] > 1 && lifts[0] < 3, `동반출현 리프트 상위값이 이상함: ${lifts[0]}`);
const allPair = [];
for (let x = 1; x <= 45; x++) for (let y = x + 1; y <= 45; y++) allPair.push(a2.pairLift[x][y]);
const mp = allPair.reduce((s2, v) => s2 + v, 0) / allPair.length;
assert.ok(Math.abs(mp - 1) < 0.02, `동반출현 리프트 평균이 1에서 벗어남: ${mp}`);
assert.deepEqual(a2.lastDraw, draws[draws.length - 1].n);
assert.equal(a2.recent.length, 46);
// 반감기가 짧을수록 직전 회차 번호가 차지하는 '비중'이 커져야 한다.
// 절대값은 반감기를 줄이면 전체 가중 합이 같이 줄어서 비교가 안 된다.
const shortHL = associations(draws, { halfLife: 20 });
const share = (as, no) => as.recent[no] / as.recent.slice(1).reduce((x, y) => x + y, 0);
for (const no of draws[draws.length - 1].n) {
  assert.ok(share(shortHL, no) > share(a2, no),
    `반감기를 줄였는데 직전 회차 번호 ${no}의 비중이 커지지 않음`);
}

// 예상번호: 개수·중복·필터·재현성
const stats = analyze(draws);
const a = predict(draws, { seed: 1241 });
assert.equal(a.length, 5);
assert.equal(new Set(a.map((r) => r.numbers.join())).size, 5, "세트가 중복됨");
assert.ok(a.every((r) => r.numbers.length === 6 && new Set(r.numbers).size === 6));
assert.ok(a.every((r) => r.numbers.every((v) => v >= 1 && v <= 45)));
assert.ok(a.every((r) => r.numbers.every((v, i2, arr) => i2 === 0 || arr[i2 - 1] < v)), "정렬 안 됨");
assert.ok(a.every((r) => passesFilters(r.numbers, stats)), "필터를 통과하지 못한 세트");
assert.deepEqual(predict(draws, { seed: 1241 }), a, "같은 시드인데 결과가 다름");
assert.notDeepEqual(predict(draws, { seed: 1242 }), a, "시드가 달라도 결과가 같음");
// 모델을 꺼도(temperature 0) 유효한 세트가 나와야 한다 = 필터가 모델과 독립
const flat = predict(draws, { seed: 1241, model: { ...MODEL, temperature: 0 } });
assert.equal(flat.length, 5);
assert.ok(flat.every((r) => passesFilters(r.numbers, stats)));

// 채점: 마지막 회차를 정답으로 넣고 자기 자신을 맞히면 1등
const last = draws[draws.length - 1];
const rec = gradeRecord({ target: last.e, sets: [{ numbers: last.n }, { numbers: [1, 2, 3, 4, 5, 6] }] }, last);
assert.equal(rec.result.bestRank, 1);
assert.equal(rec.result.bestMatch, 6);

console.log(`OK ${latest}회 기준 통계·연관성·예상번호·채점 검증 통과`);
