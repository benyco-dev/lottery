/**
 * 화면 렌더링 전담. 통계·추천·채점 계산은 전부 analysis.js 에 있고 여기서는 그리기만 한다.
 */
import { RANGES, RANK_LABEL, analyze, ballColor, recommend, sliceDraws } from "./analysis.js";

const $ = (id) => document.getElementById(id);
const fmtDate = (ymd) => `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6)}`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function ball(n, { small, missed, bonus } = {}) {
  const el = document.createElement("span");
  el.className = `ball ${ballColor(n)}${small ? " sm" : ""}${missed ? " miss" : ""}${bonus ? " bonus" : ""}`;
  el.textContent = n;
  return el;
}

function balls(nums, opts) {
  const f = document.createDocumentFragment();
  nums.forEach((n) => f.append(ball(n, opts)));
  return f;
}

/** 추천 세트 한 줄. hit 가 있으면 맞은 번호만 진하게 표시한다. */
function setRow(set, hit) {
  const row = document.createElement("div");
  row.className = "set";
  if (set.label) row.insertAdjacentHTML("beforeend", `<span class="label">${set.label}</span>`);
  const win = hit ? new Set(hit.winning) : null;
  set.numbers.forEach((n) =>
    row.append(ball(n, { missed: win ? !win.has(n) : false, bonus: hit && n === hit.bonus })));
  const meta = document.createElement("span");
  if (hit) {
    row.classList.toggle("hit", set.rank > 0);
    meta.className = set.rank > 0 ? "rank" : "meta";
    meta.textContent = set.rank > 0 ? `${RANK_LABEL[set.rank]} · ${set.match}개` : `${set.match}개 일치`;
  } else {
    meta.className = "meta";
    meta.textContent = `합 ${set.sum} · 홀 ${set.odd}`;
  }
  row.append(meta);
  return row;
}

function renderSets(host, sets, hit) {
  host.replaceChildren(...sets.map((s) => setRow(s, hit)));
}

function bars(host, rows) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  host.replaceChildren(...rows.map((r) => {
    const el = document.createElement("div");
    el.className = "bar";
    el.innerHTML = `<span>${r.label}</span><span class="t"><span class="f" style="width:${(r.value / max) * 100}%"></span></span><span class="v">${r.text}</span>`;
    return el;
  }));
}

function rankList(host, items, unit) {
  host.replaceChildren(...items.map((it) => {
    const li = document.createElement("li");
    li.append(ball(it.no, { small: true }));
    li.insertAdjacentHTML("beforeend", `<span>${unit(it)}</span>`);
    return li;
  }));
}

function renderStats(stats) {
  $("metrics").innerHTML = [
    ["분석 회차", `${stats.count}<small>회</small>`, `${stats.from}~${stats.to}회`],
    ["번호당 평균 출현", stats.expected.toFixed(1) + "<small>회</small>", "균등분포 기대치"],
    ["번호합 평균", stats.sum.avg.toFixed(1), `${stats.sum.p10}~${stats.sum.p90} 구간에 80%`],
    ["홀수 비율", pct(stats.oddRatio), "이론값 51.1%"],
    ["연속번호 포함", pct(stats.consecutiveRate), "연속 2개 이상 나온 회차"],
  ].map(([k, v, s]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div><div class="k">${s}</div></div>`).join("");

  const maxDev = Math.max(...stats.byNo.map((b) => Math.abs(b.dev)), 1);
  $("numberGrid").replaceChildren(...stats.byNo.map((b) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.title = `${b.no}번 · ${b.count}회 · 기대치 대비 ${b.dev >= 0 ? "+" : ""}${b.dev.toFixed(1)}% · ${b.gap}회 전 출현`;
    const h = Math.max(2, (Math.abs(b.dev) / maxDev) * 30);
    cell.innerHTML = `<div class="track"><div class="fill ${b.dev >= 0 ? "over" : "under"}" style="height:${h}px"></div></div>`;
    cell.append(ball(b.no, { small: true }));
    cell.insertAdjacentHTML("beforeend", `<div class="n">${b.count}</div>`);
    return cell;
  }));

  rankList($("hot"), stats.hot, (i) => `${i.count}회`);
  rankList($("cold"), stats.cold, (i) => `${i.count}회`);
  rankList($("overdue"), stats.overdue, (i) => (i.gap === 0 ? "직전 회차" : `${i.gap}회 전`));

  bars($("decades"), ["1–10", "11–20", "21–30", "31–40", "41–45"].map((label, i) => ({
    label, value: stats.decades[i], text: `${stats.decades[i]}회`,
  })));
  bars($("oddDist"), stats.oddCounts.map((v, i) => ({
    label: `홀 ${i}개`, value: v, text: v ? `${((v / stats.count) * 100).toFixed(1)}%` : "0%",
  })));
}

/** 채점이 끝난 가장 최근 예측을 메인 배너에 띄운다. */
function renderScorecard(records, nextTarget) {
  const rec = records.find((r) => r.result);
  const body = $("scoreBody");
  if (!rec) {
    body.innerHTML = `<p class="empty">아직 채점된 예측이 없습니다. ${nextTarget}회 추첨 결과가 나오면 여기에 성적이 표시됩니다.</p>`;
    return;
  }
  const { result } = rec;
  const won = result.bestRank > 0;
  body.innerHTML = `<p class="headline${won ? " win" : ""}">${
    won ? `${rec.target}회 ${RANK_LABEL[result.bestRank]} 당첨` : `${rec.target}회 낙첨 — 최고 ${result.bestMatch}개 일치`
  }</p><p class="note" style="margin:0">${fmtDate(result.date)} 추첨</p><div class="winning"></div>`;
  const w = body.querySelector(".winning");
  w.append(balls(result.winning));
  w.insertAdjacentHTML("beforeend", `<span class="plus">+ 보너스</span>`);
  w.append(ball(result.bonus, { bonus: true }));
  const list = document.createElement("div");
  list.className = "sets";
  renderSets(list, result.sets, result);
  body.append(list);
}

function renderHistory(records) {
  const done = records.filter((r) => r.result);
  const host = $("history");
  if (!done.length) {
    host.innerHTML = `<p class="empty">채점된 회차가 쌓이면 여기에 누적됩니다.</p>`;
    return;
  }
  host.replaceChildren(...done.map((rec) => {
    const el = document.createElement("div");
    el.className = "hrec";
    const r = rec.result;
    el.innerHTML = `<div class="h"><b>${rec.target}회</b><span>${fmtDate(r.date)}</span><span>${
      r.bestRank > 0 ? `<b>${RANK_LABEL[r.bestRank]}</b>` : `최고 ${r.bestMatch}개 일치`}</span></div>`;
    r.sets.forEach((s) => {
      const line = document.createElement("div");
      line.className = "line";
      line.innerHTML = `<span class="label">${s.label}</span>`;
      const win = new Set(r.winning);
      s.numbers.forEach((n) => line.append(ball(n, { small: true, missed: !win.has(n) })));
      line.insertAdjacentHTML("beforeend",
        `<span class="res${s.rank > 0 ? " win" : ""}">${s.rank > 0 ? RANK_LABEL[s.rank] : `${s.match}개`}</span>`);
      el.append(line);
    });
    return el;
  }));
}

async function main() {
  const [draws, preds] = await Promise.all([
    fetch("data/draws.json").then((r) => r.json()),
    fetch("data/predictions.json").then((r) => r.json()),
  ]);

  const latestDraw = draws.draws[draws.draws.length - 1];
  $("coverage").textContent =
    `1~${draws.latest}회 · 최신 추첨 ${fmtDate(latestDraw.d)} · 당첨번호 ${latestDraw.n.join(", ")} + ${latestDraw.b}`;
  $("updated").textContent = `${preds.updatedAt.slice(0, 10)} 갱신`;

  const pending = preds.records.find((r) => !r.result);
  $("predTarget").textContent = pending ? `${pending.target}회` : "";
  renderSets($("predSets"), pending ? pending.sets : []);
  if (!pending) $("predSets").innerHTML = `<p class="empty">다음 회차 예측이 아직 생성되지 않았습니다.</p>`;
  renderScorecard(preds.records, pending?.target ?? draws.latest + 1);
  renderHistory(preds.records);

  let active = RANGES[0];
  const select = (range) => {
    active = range;
    [...$("tabs").children].forEach((b) => b.setAttribute("aria-selected", String(b.dataset.key === range.key)));
    renderStats(analyze(sliceDraws(draws.draws, range.size)));
    $("rerollSets").replaceChildren();
  };
  $("tabs").replaceChildren(...RANGES.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.key = r.key;
    b.textContent = r.label;
    b.setAttribute("role", "tab");
    b.onclick = () => select(r);
    return b;
  }));
  $("reroll").onclick = () => renderSets($("rerollSets"),
    recommend(sliceDraws(draws.draws, active.size), { seed: (Math.random() * 2 ** 31) | 0 }));

  select(RANGES[0]);
  $("main").hidden = false;
}

main().catch((e) => {
  $("error").textContent = `데이터를 불러오지 못했습니다: ${e.message}`;
  $("error").hidden = false;
});
