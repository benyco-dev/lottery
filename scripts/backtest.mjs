/**
 * 과거 회차로 각 분석 구간의 성적을 되돌려 본다.
 * 목적은 "어느 구간이 낫냐"를 재는 것이고, 답은 대체로 "구별 안 된다"로 나온다.
 * 기대값과 함께 봐야 의미가 있어서 이론 확률도 같이 찍는다.
 *
 *   node scripts/backtest.mjs [회차수=100] [시드수=200]
 *
 * 시드수 1이면 사이트가 실제로 기록했을 예측과 동일하고(시드=회차×10+구간),
 * 크게 잡으면 구간별 적중률의 잡음이 줄어든다.
 */
import fs from "node:fs";
import { RANGES, analyze, grade, passesFilters, recommend, sliceDraws } from "../site/analysis.js";

const N = Number(process.argv[2] ?? 100);
const SEEDS = Number(process.argv[3] ?? 200);
const { draws } = JSON.parse(fs.readFileSync(new URL("../site/data/draws.json", import.meta.url)));
const targets = draws.slice(-N);

// 균등 대조군: 빈도 가중 없이(bias 0) 같은 구조 필터만 적용.
const STRATS = [
  { key: "unpopular", label: "비인기 가중", size: null, mode: "unpopular" },
  { key: "frequency", label: "빈도 가중", size: null, mode: "frequency" },
  { key: "flat", label: "균등 대조군", size: null, mode: "uniform" },
  ...RANGES.slice(1).map((r) => ({ ...r, mode: "frequency" })),
];

const tally = new Map(STRATS.map((s) => [s.key, { sets: 0, match: 0, ranks: [0, 0, 0, 0, 0, 0], best: null }]));

for (const target of targets) {
  const history = draws.filter((d) => d.e < target.e); // 미래 데이터 차단
  for (const [i, s] of STRATS.entries()) {
    const pool = sliceDraws(history, s.size);
    const t = tally.get(s.key);
    for (let k = 0; k < SEEDS; k++) {
      const seed = SEEDS === 1 ? target.e * 10 + i : target.e * 100003 + i * 997 + k;
      const [set] = recommend(pool, { seed, sets: 1, mode: s.mode });
      const g = grade(set.numbers, target.n, target.b);
      t.sets++;
      t.match += g.match;
      t.ranks[g.rank]++;
      if (g.rank > 0 && (!t.best || g.rank < t.best.rank)) t.best = { ...g, e: target.e, numbers: set.numbers };
    }
  }
}

const C = (n, k) => (k ? (C(n - 1, k - 1) * n) / k : 1);
const TOTAL = C(45, 6);
const THEORY = { 5: (C(6, 3) * C(39, 3)) / TOTAL, 4: (C(6, 4) * C(39, 2)) / TOTAL, 3: (6 * 38) / TOTAL, 2: 6 / TOTAL, 1: 1 / TOTAL };

console.log(`\n${targets[0].e}~${targets[targets.length - 1].e}회 (${N}회차) × 구간당 ${SEEDS}시드\n`);
console.log("구간          세트수  평균일치   5등    4등   3등  2등  1등   5등이상");
for (const s of STRATS) {
  const t = tally.get(s.key);
  const hits = t.ranks.slice(1).reduce((a, b) => a + b, 0);
  console.log(
    `${s.label.padEnd(12)}${String(t.sets).padStart(7)}${(t.match / t.sets).toFixed(3).padStart(9)}` +
    `${String(t.ranks[5]).padStart(7)}${String(t.ranks[4]).padStart(7)}${String(t.ranks[3]).padStart(6)}` +
    `${String(t.ranks[2]).padStart(5)}${String(t.ranks[1]).padStart(5)}` +
    `${(((hits / t.sets) * 100).toFixed(2) + "%").padStart(10)}`);
}
const n = N * SEEDS;
console.log(`\n이론 기대값 (세트 ${n}개 기준, 완전 무작위)`);
console.log(`  평균일치 0.800 | 5등 ${(THEORY[5] * n).toFixed(1)}건  4등 ${(THEORY[4] * n).toFixed(2)}건  ` +
  `3등 ${(THEORY[3] * n).toFixed(3)}건  2등 ${(THEORY[2] * n).toFixed(5)}건  1등 ${(THEORY[1] * n).toFixed(6)}건`);

const winners = [...tally].filter(([, t]) => t.best && t.best.rank <= 3);
console.log(winners.length
  ? `\n3등 이상: ${winners.map(([k, t]) => `${k} ${t.best.e}회 ${t.best.rank}등 [${t.best.numbers.join(",")}]`).join(", ")}`
  : `\n3등 이상 없음.`);
