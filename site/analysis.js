/**
 * 로또 6/45 통계·추천 도메인 로직.
 * 순수 함수만 둔다 — DOM, fetch, 전역 상태 없음. Node/브라우저 양쪽에서 그대로 돈다.
 */

/** 사용자가 요청한 5개 분석 구간. size=null 은 첫 회차부터 전부. */
export const RANGES = [
  { key: "all", label: "전체", size: null },
  { key: "r500", label: "최근 500회", size: 500 },
  { key: "r250", label: "최근 250회", size: 250 },
  { key: "r100", label: "최근 100회", size: 100 },
  { key: "r50", label: "최근 50회", size: 50 },
];

/** 동행복권 공식 볼 색상 구간. */
export const ballColor = (n) =>
  n <= 10 ? "y" : n <= 20 ? "b" : n <= 30 ? "r" : n <= 40 ? "g" : "e";

export const sliceDraws = (draws, size) => (size ? draws.slice(-size) : draws);

const sum = (a) => a.reduce((x, y) => x + y, 0);

function percentile(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

/** 한 구간의 당첨번호 통계. 보너스 번호는 제외한다(공식 통계와 동일 기준). */
export function analyze(draws) {
  const n = draws.length;
  const freq = Array(46).fill(0);
  const lastSeen = Array(46).fill(null); // 마지막 출현 이후 지난 회차 수
  const decades = Array(5).fill(0); // 1-10, 11-20, 21-30, 31-40, 41-45
  const oddCounts = Array(7).fill(0); // 세트당 홀수 개수 분포
  const sums = [];
  let consecutiveDraws = 0;

  draws.forEach((d, i) => {
    let odd = 0;
    let hasPair = false;
    d.n.forEach((v, j) => {
      freq[v]++;
      lastSeen[v] = n - 1 - i;
      decades[Math.min(4, Math.floor((v - 1) / 10))]++;
      if (v % 2) odd++;
      if (j > 0 && v === d.n[j - 1] + 1) hasPair = true;
    });
    oddCounts[odd]++;
    sums.push(sum(d.n));
    if (hasPair) consecutiveDraws++;
  });

  const expected = (n * 6) / 45; // 균등분포일 때 번호당 기대 출현 횟수
  const byNo = [];
  for (let v = 1; v <= 45; v++) {
    byNo.push({
      no: v,
      count: freq[v],
      // 기대치 대비 편차(%). 표본이 작으면 크게 흔들리는 값이라 참고용이다.
      dev: expected ? ((freq[v] - expected) / expected) * 100 : 0,
      gap: lastSeen[v] === null ? n : lastSeen[v],
    });
  }
  const ranked = [...byNo].sort((a, b) => b.count - a.count || a.no - b.no);
  const sortedSums = [...sums].sort((a, b) => a - b);

  return {
    count: n,
    from: draws[0]?.e ?? 0,
    to: draws[n - 1]?.e ?? 0,
    expected,
    byNo,
    hot: ranked.slice(0, 6),
    cold: ranked.slice(-6).reverse(),
    overdue: [...byNo].sort((a, b) => b.gap - a.gap).slice(0, 6),
    decades,
    oddCounts,
    oddRatio: sum(draws.map((d) => d.n.filter((v) => v % 2).length)) / (n * 6),
    consecutiveRate: consecutiveDraws / n,
    sum: {
      avg: sum(sums) / n,
      min: sortedSums[0],
      max: sortedSums[n - 1],
      p10: Math.round(percentile(sortedSums, 0.1)),
      p90: Math.round(percentile(sortedSums, 0.9)),
    },
  };
}

/** 시드 고정 PRNG (mulberry32). 같은 시드 → 같은 추천, 즉 결과가 재현된다. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 해당 구간의 출현 빈도에 비례해 번호 6개를 비복원 추출한다. */
function drawWeighted(weights, rand) {
  const pool = weights.map((w, i) => ({ no: i, w })).slice(1);
  const picked = [];
  for (let k = 0; k < 6; k++) {
    let total = pool.reduce((s, p) => s + p.w, 0);
    let r = rand() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) { idx = i; break; }
    }
    picked.push(pool[idx].no);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

/** 과거 당첨 조합이 실제로 가지는 구조적 성질. 여기서 크게 벗어난 조합을 걸러낸다. */
export function passesFilters(set, stats) {
  const total = sum(set);
  if (total < stats.sum.p10 || total > stats.sum.p90) return false;
  const odd = set.filter((v) => v % 2).length;
  if (odd < 2 || odd > 4) return false;
  let pairs = 0;
  for (let i = 1; i < set.length; i++) if (set[i] === set[i - 1] + 1) pairs++;
  if (pairs > 1) return false;
  const spread = new Set(set.map((v) => Math.min(4, Math.floor((v - 1) / 10))));
  return spread.size >= 3;
}

/**
 * 추천 6자리 세트를 만든다.
 * 빈도 가중 추출 + 구조 필터. 로또는 독립시행이라 이건 예측이 아니라
 * "과거 분포와 닮은 조합 뽑기"다. UI에서도 그렇게 표기한다.
 */
export function recommend(draws, { seed = 1, sets = 5, bias = 1 } = {}) {
  const stats = analyze(draws);
  const rand = rng(seed);
  // bias=0 이면 균등(완전 랜덤), 1이면 관측 빈도 그대로 반영.
  const weights = Array(46).fill(0);
  for (const { no, count } of stats.byNo) {
    weights[no] = Math.pow(count + 1, bias);
  }

  const out = [];
  const seen = new Set();
  for (let guard = 0; out.length < sets && guard < 20000; guard++) {
    const set = drawWeighted(weights, rand);
    const key = set.join(",");
    if (seen.has(key) || !passesFilters(set, stats)) continue;
    seen.add(key);
    out.push({ numbers: set, sum: sum(set), odd: set.filter((v) => v % 2).length });
  }
  return out;
}

/** 로또 6/45 등수 규칙. 0 은 낙첨. */
export function grade(picked, winning, bonus) {
  const win = new Set(winning);
  const match = picked.filter((v) => win.has(v)).length;
  const hitBonus = picked.includes(bonus);
  const rank =
    match === 6 ? 1 : match === 5 && hitBonus ? 2 : match === 5 ? 3 : match === 4 ? 4 : match === 3 ? 5 : 0;
  return { match, hitBonus, rank };
}

export const RANK_LABEL = ["낙첨", "1등", "2등", "3등", "4등", "5등"];

/** 예측 1건(5세트)을 실제 당첨번호로 채점한다. best 는 가장 높은 등수(작을수록 좋음). */
export function gradeRecord(record, draw) {
  const sets = record.sets.map((s) => ({ ...s, ...grade(s.numbers, draw.n, draw.b) }));
  const won = sets.filter((s) => s.rank > 0).map((s) => s.rank);
  return {
    ...record,
    result: {
      winning: draw.n,
      bonus: draw.b,
      date: draw.d,
      sets,
      bestRank: won.length ? Math.min(...won) : 0,
      bestMatch: Math.max(...sets.map((s) => s.match)),
    },
  };
}
