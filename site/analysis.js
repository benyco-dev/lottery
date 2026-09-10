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

/**
 * 번호별 인기지수. 1.0 = 평균, 1보다 크면 사람들이 더 많이 고르는 번호다.
 *
 * 5개를 맞힌 티켓의 나머지 한 개가 보너스일 확률은 이론상 1/39 로 고정이다(남은 39개 중 1개).
 * 따라서 w2/(w2+w3) 가 1/39 를 넘으면 그 회차 보너스 번호가 평균보다 인기 있었다는 뜻이다.
 * 이건 당첨 확률과 무관하다 — 당첨됐을 때 몇 명과 나눠 갖는지만 바꾼다.
 *
 * 회차별 지수의 중앙값을 쓴다. 통합비율은 이상 회차 하나에 끌려간다
 * (1057회는 2등이 664명으로 평상시의 9배였고, 그 회차 하나가 12번 지수를 1.05 → 1.47 로 올렸다).
 */
export function popularity(draws) {
  const P = 1 / 39;
  const per = new Map();
  for (const d of draws) {
    const tot = (d.w2 ?? 0) + (d.w3 ?? 0);
    if (!tot || d.b == null) continue;
    if (!per.has(d.b)) per.set(d.b, []);
    per.get(d.b).push(d.w2 / tot / P);
  }
  const out = Array(46).fill(1);
  for (const [no, v] of per) {
    v.sort((a, b) => a - b);
    const m = v.length >> 1;
    out[no] = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  return out; // 보너스로 한 번도 안 나온 번호는 1(평균)로 둔다
}

/**
 * 번호별 추출 가중치.
 *  - "unpopular": 인기지수의 역수. 당첨 확률은 그대로고 당첨 시 배당이 올라간다. (기본)
 *  - "frequency": 과거 출현 빈도. 백테스트에서 효과가 없다고 확인됐고 비교용으로만 남긴다.
 *  - "uniform"  : 대조군.
 */
export function weights(draws, mode = "unpopular", strength = 3) {
  const w = Array(46).fill(1);
  if (mode === "uniform") return w;
  if (mode === "frequency") {
    for (const { no, count } of analyze(draws).byNo) w[no] = count + 1;
    return w;
  }
  const pop = popularity(draws);
  for (let n = 1; n <= 45; n++) w[n] = Math.pow(1 / pop[n], strength);
  return w;
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

/**
 * 조합 필터. 두 종류가 섞여 있다.
 *  - 구조 필터: 과거 당첨 조합이 실제로 가지는 성질에서 크게 벗어난 조합을 뺀다.
 *  - 혼잡 필터: 1~12 를 최대 2개로 제한한다. 사람들이 생일 월에 몰리기 때문이다.
 *
 * 1~12 제한은 실측이다. 이 조건을 만족한 회차(1024회)는 위반한 회차보다
 * 1등 당첨자가 평균 12.7% 적었다 (부트스트랩 95% CI +3.7~22.4%, 판매액 정규화 기준).
 * 당첨 확률은 바뀌지 않는다 — 당첨됐을 때 나눠 갖는 인원만 줄어든다.
 */
export const MAX_BIRTHDAY_MONTH = 2;

export function passesFilters(set, stats) {
  if (set.filter((v) => v <= 12).length > MAX_BIRTHDAY_MONTH) return false;
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
 *
 * 당첨 확률은 어떤 조합이든 8,145,060분의 1로 같다 — 이건 예측이 아니다.
 * 기본 모드는 사람들이 덜 고르는 번호에 가중치를 줘서, 1등이 됐을 때
 * 나눠 갖는 인원을 줄이는 것을 목표로 한다. 여기에 과거 조합의 구조 필터를 얹는다.
 */
export function recommend(draws, { seed = 1, sets = 5, mode = "unpopular", strength = 3, stats, w } = {}) {
  stats ??= analyze(draws);
  w ??= weights(draws, mode, strength);
  const rand = rng(seed);
  const out = [];
  const seen = new Set();
  for (let guard = 0; out.length < sets && guard < 20000; guard++) {
    const set = drawWeighted(w, rand);
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
