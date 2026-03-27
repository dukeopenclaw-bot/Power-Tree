/**
 * tree-viz.js
 * 전기 파워트리 시각화
 *
 * ■ 노드 배치
 *   - 선택 장비: 화면 중앙
 *   - From 장비(공급원): 중앙 위쪽 (여러 행 가능)
 *   - To 장비(부하):  중앙 아래쪽 (여러 행 가능)
 *   - 화살표: 직각 꺾은선 (수직→수평→수직)
 *
 * ■ 클릭 동작
 *   - 1클릭  : 연결 화살표에 CKT 라벨 표시 (토글)
 *              From 측 라벨: "-XXX / CKT(From)" 또는 "CKT(From)"
 *              To 측 라벨:   "CKT(To)"
 *   - 2클릭 / 길게 누름 : 해당 장비 기준으로 트리 재그리기
 */

// ── 레이아웃 상수 ─────────────────────────────────────
const NODE_W       = 140;   // 노드 너비
const NODE_H       = 46;    // 노드 높이
const H_GAP        = 36;    // 수평 노드 간격
const V_GAP        = 130;   // 수직 레벨 간격
const ITEMS_PER_ROW = 5;    // 행당 최대 노드 수

// ── 상태 ─────────────────────────────────────────────
let labelVisible = {};  // { tag: boolean } – 라벨 표시 여부 상태

// ─────────────────────────────────────────────────────
// drawTree : 메인 진입점
// ─────────────────────────────────────────────────────
function drawTree(targetTag) {
  labelVisible = {};

  const container = document.getElementById("canvas-container");
  const W = container.clientWidth  || 800;
  const H = container.clientHeight || 600;

  const svg = d3.select("#tree-svg");
  svg.selectAll("*").remove();

  // ── 화살표 마커 정의 ────────────────────────────────
  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 9)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#2a6080");

  // ── 줌/패닝 그룹 ────────────────────────────────────
  const g = svg.append("g").attr("id", "main-g");

  const zoomBehavior = d3.zoom()
    .scaleExtent([0.15, 4])
    .on("zoom", e => g.attr("transform", e.transform));

  svg.call(zoomBehavior);
  svg.on("dblclick.zoom", null); // SVG 더블클릭 줌 방지

  // ── 데이터 조회 ─────────────────────────────────────
  const norm = s => String(s || "").trim();
  const tgt  = norm(targetTag);

  /** 이 장비로 들어오는 연결 (위쪽 = 공급원) */
  const fromRows = powerData.filter(d => norm(d["Equipment Tag(To)"]) === tgt);
  /** 이 장비에서 나가는 연결 (아래쪽 = 부하) */
  const toRows   = powerData.filter(d => norm(d["Equipment Tag(From)"]) === tgt);

  const fromTags = unique(fromRows.map(d => norm(d["Equipment Tag(From)"])));
  const toTags   = unique(toRows.map(d => norm(d["Equipment Tag(To)"])));

  // ── 노드 위치 계산 ───────────────────────────────────
  const cx = W / 2;
  const cy = H / 2;

  /**
   * tags 배열을 여러 행으로 배치
   * sign = -1: 위쪽(From), +1: 아래쪽(To)
   */
  function layoutTags(tags, sign) {
    const rowCount = Math.ceil(tags.length / ITEMS_PER_ROW);
    return tags.map((tag, i) => {
      const row = Math.floor(i / ITEMS_PER_ROW);
      const col = i % ITEMS_PER_ROW;
      const totalInRow = Math.min(tags.length - row * ITEMS_PER_ROW, ITEMS_PER_ROW);
      const rowW = totalInRow * NODE_W + (totalInRow - 1) * H_GAP;
      const x = (cx - rowW / 2 + NODE_W / 2) + col * (NODE_W + H_GAP);

      // sign < 0: 상단 → 맨 위 행부터 순서대로 배치
      const levelFromCenter = sign < 0
        ? (rowCount - row)   // -rowCount ... -1
        : (row + 1);         //  1 ... rowCount

      return { tag, x, y: cy + sign * levelFromCenter * V_GAP };
    });
  }

  const fromPositions = layoutTags(fromTags, -1);
  const toPositions   = layoutTags(toTags,    1);

  // nodeMap: tag → { x, y, type }
  const nodeMap = {};
  nodeMap[tgt] = { x: cx, y: cy, type: "center" };
  fromPositions.forEach(p => { nodeMap[p.tag] = { x: p.x, y: p.y, type: "from" }; });
  toPositions.forEach(p =>   { nodeMap[p.tag] = { x: p.x, y: p.y, type: "to"   }; });

  // ── 엣지 목록 ───────────────────────────────────────
  const edges = [];
  const addEdges = rows => {
    rows.forEach(row => {
      const ft = norm(row["Equipment Tag(From)"]);
      const tt = norm(row["Equipment Tag(To)"]);
      if (!ft || !tt || !nodeMap[ft] || !nodeMap[tt]) return;
      // 중복 엣지 방지 (같은 From-To 조합)
      const key = `${ft}→${tt}`;
      if (!edges.find(e => e.key === key)) {
        edges.push({
          key,
          fromTag: ft, toTag: tt,
          cktFrom: norm(row["CKT(From)"]),
          cktTo:   norm(row["CKT(To)"])
        });
      }
    });
  };
  addEdges(fromRows);
  addEdges(toRows);

  // ── 레이어 순서: edge → label → node ────────────────
  const edgeLayer  = g.append("g").attr("class", "edge-layer");
  const labelLayer = g.append("g").attr("class", "label-layer");
  const nodeLayer  = g.append("g").attr("class", "node-layer");

  // ── 엣지 + CKT 라벨 그리기 ──────────────────────────
  edges.forEach(edge => {
    const fn = nodeMap[edge.fromTag];
    const tn = nodeMap[edge.toTag];

    // 화살표: 노드 하단 중심 → 꺾인 직각선 → 노드 상단 중심
    const x1 = fn.x,  y1 = fn.y + NODE_H / 2 + 2;
    const x2 = tn.x,  y2 = tn.y - NODE_H / 2 - 2;
    const midY = (y1 + y2) / 2;

    edgeLayer.append("path")
      .attr("class", "link")
      .attr("d", `M${x1},${y1} V${midY} H${x2} V${y2}`)
      .attr("marker-end", "url(#arrowhead)");

    // ── CKT 라벨 계산 ───────────────────────────────
    // From 측: -XXX 접미사가 있으면 "-XXX / CKT(From)", 없으면 "CKT(From)"
    const xMatch  = edge.fromTag.match(/-(\d{3})$/);
    const fromLabelText = xMatch
      ? `-${xMatch[1]} / ${edge.cktFrom}`
      : edge.cktFrom;

    // From 라벨 위치 (화살표 출발점 근처)
    labelLayer.append("text")
      .attr("class", "ckt-label")
      .attr("data-from", edge.fromTag)
      .attr("data-to",   edge.toTag)
      .attr("x", x1 + (x2 >= x1 ? 4 : -4))
      .attr("y", y1 + 13)
      .attr("text-anchor", x2 >= x1 ? "start" : "end")
      .style("display", "none")
      .text(fromLabelText);

    // To 라벨 위치 (화살표 도착점 근처)
    labelLayer.append("text")
      .attr("class", "ckt-label")
      .attr("data-from", edge.fromTag)
      .attr("data-to",   edge.toTag)
      .attr("x", x2 + (x2 >= x1 ? 4 : -4))
      .attr("y", y2 - 5)
      .attr("text-anchor", x2 >= x1 ? "start" : "end")
      .style("display", "none")
      .text(edge.cktTo);
  });

  // ── 노드 그리기 ─────────────────────────────────────
  Object.entries(nodeMap).forEach(([tag, node]) => {
    const ng = nodeLayer.append("g")
      .attr("class", `node node-${node.type}`)
      .attr("transform", `translate(${node.x - NODE_W / 2},${node.y - NODE_H / 2})`)
      .style("cursor", "pointer");

    // 노드 배경 사각형
    ng.append("rect").attr("width", NODE_W).attr("height", NODE_H).attr("rx", 5);

    // 장비 태그 텍스트 (긴 경우 줄임)
    ng.append("text")
      .attr("x", NODE_W / 2)
      .attr("y", NODE_H / 2 + 4)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("pointer-events", "none")
      .text(trimTag(tag));

    // 라벨 상태 초기화
    labelVisible[tag] = false;

    // ── 클릭 / 더블클릭 / 길게 누름 이벤트 ─────────────
    let clicks = 0;
    let clickTimer  = null;
    let pressTimer  = null;

    // 터치: 길게 누름 → 트리 재그리기
    ng.on("touchstart", e => {
      e.preventDefault();
      pressTimer = setTimeout(() => { pressTimer = null; drawTree(tag); }, 650);
    }).on("touchend", () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });

    // 마우스: 클릭 카운트로 단클릭 / 더블클릭 구분
    ng.on("click", e => {
      e.stopPropagation();
      clicks++;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        const n = clicks;
        clicks = 0;
        if (n >= 2) {
          // 더블클릭 → 트리 재그리기
          drawTree(tag);
        } else {
          // 단클릭 → CKT 라벨 토글
          labelVisible[tag] = !labelVisible[tag];
          toggleLabels(tag, labelVisible[tag]);
        }
      }, 260);
    });
  });
}

// ─────────────────────────────────────────────────────
// toggleLabels: 특정 태그에 연결된 모든 CKT 라벨 표시/숨김
// ─────────────────────────────────────────────────────
function toggleLabels(tag, show) {
  const display = show ? "block" : "none";
  d3.selectAll(".ckt-label").each(function () {
    const el = d3.select(this);
    if (el.attr("data-from") === tag || el.attr("data-to") === tag) {
      el.style("display", display);
    }
  });
}

// ─────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────
/** 중복 제거 (빈 문자열 제외) */
function unique(arr) {
  return [...new Set(arr)].filter(Boolean);
}

/** 노드 박스에 맞게 긴 태그 줄임 */
function trimTag(tag) {
  return tag.length > 18 ? tag.slice(0, 17) + "…" : tag;
}
