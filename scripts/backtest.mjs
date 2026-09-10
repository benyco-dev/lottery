/**
 * 과거 회차로 모델 성적을 되돌려 본다.
 *   node scripts/backtest.mjs [회차수=100] [시드수=200]
 * 시드수 1이면 사이트가 실제로 기록했을 예상번호와 동일하다(시드=회차번호).
 */
import fs from "node:fs";
import { analyze, associations, grade, predict } from "../site/analysis.js";

const N = Number(process.argv[2] ?? 100);
const SEEDS = Number(process.argv[3] ?? 200);
const { draws } = JSON.parse(fs.readFileSync(new URL("../site/data/draws.json", import.meta.url)));
const targets = draws.slice(-N);

const STRATS = [
  { key: "model", label: "연관성 모델" },
  { key: "flat", label: "균등 대조군", flat: true },
];
const tally = new Map(STRATS.map((s) => [s.key, { sets: 0, match: 0, ranks: [0, 0, 0, 0, 0, 0] }]));

for (const target of targets) {
  const history = draws.filter((d) => d.e < target.e); // 미래 데이터 차단
  const assoc = associations(history);
  const stats = analyze(history);
  // 대조군은 같은 구조 필터를 쓰되 연관성 가중을 끈다 (temperature 0).
  const flatModel = { halfLife: 300, recent: 0, gap: 0, transition: 0, pair: 0, temperature: 0 };
  for (const s of STRATS) {
    const t = tally.get(s.key);
    for (let k = 0; k < SEEDS; k++) {
      const seed = SEEDS === 1 ? target.e : target.e * 100003 + k;
      const [set] = predict(history, { seed, sets: 1, assoc, stats, ...(s.flat ? { model: flatModel } : {}) });
      const g = grade(set.numbers, target.n, target.b);
      t.sets++; t.match += g.match; t.ranks[g.rank]++;
    }
  }
}

const C = (n, k) => (k ? (C(n - 1, k - 1) * n) / k : 1);
const TOTAL = C(45, 6);
const TH = { 5: (C(6, 3) * C(39, 3)) / TOTAL, 4: (C(6, 4) * C(39, 2)) / TOTAL, 3: (6 * 38) / TOTAL, 2: 6 / TOTAL, 1: 1 / TOTAL };

console.log(`\n${targets[0].e}~${targets[targets.length - 1].e}회 (${N}회차) × 전략당 ${SEEDS}시드\n`);
console.log("전략            세트수  평균일치   5등   4등  3등  2등  1등   5등이상");
for (const s of STRATS) {
  const t = tally.get(s.key);
  const hits = t.ranks.slice(1).reduce((a, b) => a + b, 0);
  console.log(`${s.label.padEnd(14)}${String(t.sets).padStart(7)}${(t.match / t.sets).toFixed(3).padStart(9)}` +
    `${String(t.ranks[5]).padStart(6)}${String(t.ranks[4]).padStart(6)}${String(t.ranks[3]).padStart(5)}` +
    `${String(t.ranks[2]).padStart(5)}${String(t.ranks[1]).padStart(5)}${(((hits / t.sets) * 100).toFixed(2) + "%").padStart(10)}`);
}
const n = N * SEEDS;
console.log(`\n이론 기대값 (세트 ${n}개, 완전 무작위)`);
console.log(`  평균일치 0.800 | 5등 ${(TH[5] * n).toFixed(1)}건  4등 ${(TH[4] * n).toFixed(2)}건  3등 ${(TH[3] * n).toFixed(3)}건  ` +
  `2등 ${(TH[2] * n).toFixed(5)}건  1등 ${(TH[1] * n).toFixed(6)}건`);
