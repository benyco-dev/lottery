/**
 * 로또 6/45 - 과거 1등 당첨번호의 연관성 분석과 다음 회차 번호 생성.
 * 순수 함수만 둔다: DOM, fetch, 전역 상태 없음. Node/브라우저 양쪽에서 그대로 돈다.
 */

/** 통계 탭의 분석 구간. size=null 은 첫 회차부터 전부. */
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
const mean = (a) => sum(a) / a.length;

function percentile(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

/** 값 배열을 평균 0, 표준편차 1로. 편차가 없으면 전부 0. */
function zscore(values) {
  const m = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2))) || 1;
  return values.map((v) => (v - m) / sd);
}

/** 한 구간의 당첨번호 통계. 보너스는 제외한다(공식 통계와 같은 기준). */
export function analyze(draws) {
  const n = draws.length;
  const freq = Array(46).fill(0);
  const lastSeen = Array(46).fill(null);
  const decades = Array(5).fill(0);
  const oddCounts = Array(7).fill(0);
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

  const expected = (n * 6) / 45;
  const byNo = [];
  for (let v = 1; v <= 45; v++) {
    byNo.push({
      no: v,
      count: freq[v],
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
      avg: mean(sums),
      min: sortedSums[0],
      max: sortedSums[n - 1],
      p10: Math.round(percentile(sortedSums, 0.1)),
      p90: Math.round(percentile(sortedSums, 0.9)),
    },
  };
}

/**
 * 모델 가중치. 네 가지 연관성을 어떤 비율로 섞을지.
 * temperature 가 클수록 점수 높은 번호에 몰아준다.
 */
export const MODEL = {
  halfLife: 300, // 최근 가중 빈도의 반감기 (회차)
  recent: 1.0,   // 최근 얼마나 자주 나왔나
  gap: 0.6,      // 얼마나 오래 안 나왔나
  transition: 0.8, // 직전 회차 번호에서 이어질 확률
  pair: 1.4,     // 이미 고른 번호와 얼마나 자주 같이 나왔나
  temperature: 0.35,
};

/**
 * 과거 1등 번호에서 네 가지 연관성을 뽑는다. 전부 '리프트'(관측/기대) 형태라 1.0 이 기준선이다.
 *
 *  pairLift[a][b]  두 번호가 같은 회차에 함께 나온 정도
 *  transLift[a][b] a 가 나온 다음 회차에 b 가 나온 정도
 *  recent[n]       반감기 가중 출현 빈도
 *  gap[n]          마지막 출현 이후 지난 회차 수 / 기대 간격(7.5)
 */
export function associations(draws, { halfLife = MODEL.halfLife } = {}) {
  const n = draws.length;
  const latest = draws[n - 1].e;

  const freq = Array(46).fill(0);
  const recent = Array(46).fill(0);
  const pair = Array.from({ length: 46 }, () => Array(46).fill(0));
  const trans = Array.from({ length: 46 }, () => Array(46).fill(0));

  draws.forEach((d, i) => {
    const w = Math.pow(0.5, (latest - d.e) / halfLife);
    for (const a of d.n) {
      freq[a]++;
      recent[a] += w;
      for (const b of d.n) if (a !== b) pair[a][b]++;
    }
    const next = draws[i + 1];
    if (next) for (const a of d.n) for (const b of next.n) trans[a][b]++;
  });

  // 리프트로 정규화한다. 기대 동반출현 = n * (6*5)/(45*44), 기대 전이 = freq[a] * 6/45.
  const pairExp = (n * 30) / (45 * 44);
  const pairLift = Array.from({ length: 46 }, () => Array(46).fill(1));
  const transLift = Array.from({ length: 46 }, () => Array(46).fill(1));
  for (let a = 1; a <= 45; a++) {
    const tExp = (freq[a] * 6) / 45;
    for (let b = 1; b <= 45; b++) {
      if (a !== b) pairLift[a][b] = pair[a][b] / pairExp;
      if (tExp > 0) transLift[a][b] = trans[a][b] / tExp;
    }
  }

  const gapRaw = analyze(draws).byNo.map((b) => b.gap / 7.5);

  const flat = [];
  for (let a = 1; a <= 45; a++) for (let b = a + 1; b <= 45; b++) flat.push({ a, b, lift: pairLift[a][b], count: pair[a][b] });
  flat.sort((x, y) => y.lift - x.lift);

  const tflat = [];
  for (let a = 1; a <= 45; a++) for (let b = 1; b <= 45; b++) tflat.push({ a, b, lift: transLift[a][b], count: trans[a][b] });
  tflat.sort((x, y) => y.lift - x.lift);

  return {
    count: n,
    latest,
    freq,
    recent,
    gap: gapRaw,
    pairLift,
    transLift,
    topPairs: flat.slice(0, 10),
    topTransitions: tflat.slice(0, 10),
    lastDraw: draws[n - 1].n,
  };
}

/** 시드 고정 PRNG (mulberry32). 같은 시드 → 같은 결과, 즉 재현된다. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 이미 고른 번호와 무관한 부분의 점수 (z 점수 합).
 * 최근 빈도 + 미출현 기간 + 직전 회차로부터의 전이.
 */
export function baseScore(assoc, model = MODEL) {
  const idx = [...Array(45)].map((_, i) => i + 1);
  const zRecent = zscore(idx.map((n) => assoc.recent[n]));
  const zGap = zscore(idx.map((n) => assoc.gap[n - 1]));
  const zTrans = zscore(idx.map((n) => mean(assoc.lastDraw.map((a) => assoc.transLift[a][n]))));
  const out = Array(46).fill(0);
  idx.forEach((n, i) => {
    out[n] = model.recent * zRecent[i] + model.gap * zGap[i] + model.transition * zTrans[i];
  });
  return out;
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

/** 점수 배열에서 가중 추출로 번호 하나를 고른다. */
function pick(scores, taken, rand, temperature) {
  const cand = [];
  let total = 0;
  for (let n = 1; n <= 45; n++) {
    if (taken.has(n)) continue;
    const w = Math.exp(temperature * scores[n]);
    cand.push([n, w]);
    total += w;
  }
  let r = rand() * total;
  for (const [n, w] of cand) {
    r -= w;
    if (r <= 0) return n;
  }
  return cand[cand.length - 1][0];
}

/**
 * 다음 회차 예상번호를 만든다.
 *
 * 번호를 하나씩 뽑되, 뽑을 때마다 '이미 고른 번호와의 동반출현 리프트'를 점수에 더한다.
 * 그래서 세트 안의 6개가 서로 연관된 조합이 된다. 마지막에 구조 필터를 통과한 것만 남긴다.
 */
export function predict(draws, { seed = 1, sets = 5, model = MODEL, assoc, stats } = {}) {
  assoc ??= associations(draws, model);
  stats ??= analyze(draws);
  const base = baseScore(assoc, model);
  const rand = rng(seed);

  const out = [];
  const seen = new Set();
  for (let guard = 0; out.length < sets && guard < 20000; guard++) {
    const taken = new Set();
    for (let k = 0; k < 6; k++) {
      const scores = Array(46).fill(-Infinity);
      const picked = [...taken];
      // 동반출현 리프트도 z 로 맞춰야 base 와 같은 축척에서 더할 수 있다.
      const affinity = [...Array(45)].map((_, i) =>
        picked.length ? mean(picked.map((p) => assoc.pairLift[p][i + 1])) : 0);
      const zAff = picked.length ? zscore(affinity) : affinity;
      for (let n = 1; n <= 45; n++) scores[n] = base[n] + model.pair * zAff[n - 1];
      taken.add(pick(scores, taken, rand, model.temperature));
    }
    const set = [...taken].sort((a, b) => a - b);
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

/** 예상번호 1건(5세트)을 실제 당첨번호로 채점한다. */
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
