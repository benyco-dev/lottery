/** analysis.js 자기검증. node scripts/test_analysis.mjs */
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyze, grade, gradeRecord, passesFilters, recommend, RANGES, sliceDraws } from "../site/analysis.js";

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

// 추천: 개수·중복·필터·재현성
const stats = analyze(draws);
const a = recommend(draws, { seed: 1241 });
assert.equal(a.length, 5);
assert.equal(new Set(a.map((r) => r.numbers.join())).size, 5, "세트가 중복됨");
assert.ok(a.every((r) => r.numbers.length === 6 && new Set(r.numbers).size === 6));
assert.ok(a.every((r) => passesFilters(r.numbers, stats)), "필터를 통과하지 못한 세트");
assert.deepEqual(recommend(draws, { seed: 1241 }), a, "같은 시드인데 결과가 다름");
assert.notDeepEqual(recommend(draws, { seed: 1242 }), a, "시드가 달라도 결과가 같음");

// 채점: 마지막 회차를 정답으로 넣고 자기 자신을 맞히면 1등
const last = draws[draws.length - 1];
const rec = gradeRecord({ target: last.e, sets: [{ numbers: last.n }, { numbers: [1, 2, 3, 4, 5, 6] }] }, last);
assert.equal(rec.result.bestRank, 1);
assert.equal(rec.result.bestMatch, 6);

console.log(`OK ${latest}회 기준 통계·추천·채점 검증 통과`);
