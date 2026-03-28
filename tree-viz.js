/**
 * tree-viz.js
 * 전기 파워트리 시각화 엔진
 */

// ── 레이아웃 설정 ─────────────────────────────────────────────
const NODE_H  = 34;   // 노드 높이 (고정)
const H_GAP   = 24;   // 노드 간 수평 간격
const V_GAP   = 120;  // 레벨 간 수직 간격
const FONT_PX = 13;   // 노드 텍스트 폰트 크기 (엑셀 10pt ≈ 13px)
const CHAR_W  = 7.8;  // 글자 1자당 평균 픽셀 폭 (13px sans-serif 기준)
const PAD_X   = 18;   // 노드 좌우 내부 여백

let nodeMap     = {};     // 노드 좌표 저장
let labelVisible = {};
let tgt         = "";     // 현재 선택 태그
let colCount    = 4;      // 하단 열 수 (짝수)

// ── 태그 텍스트 기준 노드 너비 계산 ─────────────────────────
function nodeWidth(tag) {
    return Math.max(70, Math.ceil(tag.length * CHAR_W) + PAD_X * 2);
}

// ── EDB -XXX 패턴 추출 ───────────────────────────────────────
// 태그에 "EDB-" 뒤 3자리 숫자가 있으면 "-XXX" 반환, 없으면 null
function getEdbSuffix(tag) {
    const m = tag.match(/EDB[-_](\d{3})/i);
    return m ? `-${m[1]}` : null;
}

// ── 1. 메인 그리기 함수 ───────────────────────────────────────
function drawTree(targetTag) {
    const svg = d3.select("#tree-svg");
    svg.selectAll("*").remove();

    const hintDiv = document.getElementById("hint");
    if (hintDiv) hintDiv.classList.add("hidden");

    nodeMap = {};
    labelVisible = {};
    tgt = targetTag;

    if (!tgt && powerData.length > 0) tgt = powerData[0]["Equipment Tag(From)"];
    if (!tgt) return;

    const fromRows = powerData.filter(d => d["Equipment Tag(To)"]   === tgt);
    const toRows   = powerData.filter(d => d["Equipment Tag(From)"] === tgt);

    const fromTags = [...new Set(fromRows.map(d => d["Equipment Tag(From)"]))].filter(Boolean);
    const toTags   = [...new Set(toRows.map(d => d["Equipment Tag(To)"]))].filter(Boolean);

    const container  = document.getElementById("canvas-container");
    const containerW = container.clientWidth  || 800;
    const containerH = container.clientHeight || 600;
    const cx = containerW / 2;
    const cy = containerH / 2;

    // 최대 노드 너비를 스텝 기준으로 사용 (균등 간격 유지)
    const allTags = [tgt, ...fromTags, ...toTags];
    const maxW    = Math.max(...allTags.map(nodeWidth));
    const STEP    = maxW + H_GAP;

    // ── 노드 좌표 계산 ───────────────────────────────────────
    // 1. 중앙 노드
    nodeMap[tgt] = { x: cx, y: cy, type: "center", tag: tgt, w: nodeWidth(tgt) };

    // 2. From 노드 (위쪽)
    fromTags.forEach((tag, i) => {
        const total = fromTags.length;
        const x = cx + (i - (total - 1) / 2) * STEP;
        nodeMap[tag] = { x, y: cy - V_GAP, type: "from", tag, w: nodeWidth(tag) };
    });

    // 3. To 노드 (아래쪽, colCount 열 기준)
    toTags.forEach((tag, i) => {
        const row      = Math.floor(i / colCount);
        const col      = i % colCount;
        const rowCount = Math.min(toTags.length - row * colCount, colCount);
        const startX   = cx - ((rowCount - 1) * STEP) / 2;
        nodeMap[tag] = {
            x: startX + col * STEP,
            y: cy + V_GAP + row * (NODE_H + V_GAP * 0.6),
            type: "to",
            tag,
            w: nodeWidth(tag)
        };
    });

    // ── SVG 요소 생성 ────────────────────────────────────────
    const g = svg.append("g").attr("id", "main-g");

    const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", (e) => {
            if (event && event.type === "drag") return;
            g.attr("transform", e.transform);
        });
    svg.call(zoom);

    // 화살표 머리
    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10").attr("refX", 10).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
        .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#546e7a");

    const edgeLayer  = g.append("g").attr("class", "links");
    const labelLayer = g.append("g").attr("class", "labels");
    const nodeLayer  = g.append("g").attr("class", "nodes");

    // ── 엣지 목록 ────────────────────────────────────────────
    const edges = [];
    const addEdges = rows => {
        rows.forEach(row => {
            const ft = row["Equipment Tag(From)"];
            const tt = row["Equipment Tag(To)"];
            if (!ft || !tt || !nodeMap[ft] || !nodeMap[tt]) return;
            if (ft !== tgt && tt !== tgt) return;
            const key = `${ft}→${tt}`;
            if (!edges.find(e => e.key === key)) {
                edges.push({
                    key, fromTag: ft, toTag: tt,
                    cktFrom: row["CKT(From)"], cktTo: row["CKT(To)"]
                });
            }
        });
    };
    addEdges(fromRows);
    addEdges(toRows);

    // ── 선(Edge) + 라벨 그리기 ───────────────────────────────
    edges.forEach(edge => {
        const fn = nodeMap[edge.fromTag];
        const tn = nodeMap[edge.toTag];

        // 선
        edgeLayer.append("path")
            .attr("class", "link")
            .attr("data-from", edge.fromTag)
            .attr("data-to",   edge.toTag)
            .attr("d", getEdgePath(fn, tn))
            .attr("marker-end", "url(#arrowhead)");

        // 선 시작점(from쪽) / 끝점(to쪽) 좌표
        const x1 = fn.x;
        const y1 = fn.y + NODE_H / 2 + 2;
        const x2 = tn.x;
        const y2 = tn.y - NODE_H / 2 - 8;
        const labelY1 = y1 + 14;  // from 노드 바로 아래
        const labelY2 = y2 - 6;   // to 노드 바로 위

        // CKT(From) → 선의 왼쪽 (from 노드 쪽)
        if (edge.cktFrom) {
            labelLayer.append("text")
                .attr("class", "ckt-label")
                .attr("x", x1 - 6)
                .attr("y", labelY1)
                .attr("text-anchor", "end")
                .text(edge.cktFrom);
        }

        // EDB -XXX → 선의 오른쪽 (from 노드가 EDB일 때)
        const edbFrom = getEdbSuffix(edge.fromTag);
        if (edbFrom) {
            labelLayer.append("text")
                .attr("class", "ckt-label edb-suffix")
                .attr("x", x1 + 6)
                .attr("y", labelY1)
                .attr("text-anchor", "start")
                .text(edbFrom);
        }

        // EDB -XXX → 선의 오른쪽 (to 노드가 EDB일 때)
        const edbTo = getEdbSuffix(edge.toTag);
        if (edbTo) {
            labelLayer.append("text")
                .attr("class", "ckt-label edb-suffix")
                .attr("x", x2 + 6)
                .attr("y", labelY2)
                .attr("text-anchor", "start")
                .text(edbTo);
        }

        // CKT(To) → 화살표 끝 To 노드 위
        if (edge.cktTo) {
            labelLayer.append("text")
                .attr("class", "ckt-label")
                .attr("x", x2 - 6)
                .attr("y", labelY2)
                .attr("text-anchor", "end")
                .text(edge.cktTo);
        }
    });

    // ── 노드(장비 사각형) 그리기 ─────────────────────────────
    Object.entries(nodeMap).forEach(([tag, node]) => {
        const w  = node.w;
        const ng = nodeLayer.append("g")
            .attr("class", `node node-${node.type}`)
            .attr("transform", `translate(${node.x - w / 2}, ${node.y - NODE_H / 2})`)
            .style("cursor", "move")
            .call(d3.drag()
                .on("start", dragStarted)
                .on("drag",  dragged)
                .on("end",   dragEnded)
            );

        ng.append("rect").attr("width", w).attr("height", NODE_H).attr("rx", 5);
        ng.append("text")
            .attr("x", w / 2)
            .attr("y", NODE_H / 2 + Math.floor(FONT_PX / 2) - 1)
            .attr("text-anchor", "middle")
            .text(tag);

        setupInteractions(ng, tag);
    });

    // 1:1 스케일, 트리 전체 가운데 정렬
    requestAnimationFrame(() => {
        try {
            const bbox = g.node().getBBox();
            if (!bbox.width || !bbox.height) return;
            const tx = containerW / 2 - (bbox.x + bbox.width  / 2);
            const ty = containerH / 2 - (bbox.y + bbox.height / 2);
            svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty));
        } catch (e) { /* 무시 */ }
    });
}

// ── 2. 유틸리티 ──────────────────────────────────────────────

/** 베지어 곡선 경로 */
function getEdgePath(fn, tn) {
    const x1 = fn.x;
    const y1 = fn.y + NODE_H / 2 + 2;
    const x2 = tn.x;
    const y2 = tn.y - NODE_H / 2 - 8;
    const dy = Math.abs(y2 - y1) * 0.5;
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
}

// ── 드래그 핸들러 ─────────────────────────────────────────────
function dragStarted(event) { d3.select(this).raise().classed("active", true); }
function dragged(event) {
    const tag  = d3.select(this).select("text").text();
    const node = nodeMap[tag];
    node.x = event.x + node.w / 2;
    node.y = event.y + NODE_H / 2;
    d3.select(this).attr("transform", `translate(${event.x}, ${event.y})`);
    d3.selectAll(".link").each(function () {
        const l    = d3.select(this);
        const fTag = l.attr("data-from");
        const tTag = l.attr("data-to");
        if (fTag === tag || tTag === tag) {
            l.attr("d", getEdgePath(nodeMap[fTag], nodeMap[tTag]));
        }
    });
}
function dragEnded(event) { d3.select(this).classed("active", false); }

function setupInteractions(selection, tag) {
    // 더블클릭: 해당 장비 기준으로 재조회
    selection.on("dblclick", () => { if (tgt !== tag) drawTree(tag); });
}

// ── 열 수 조절 (짝수, 최소 2) ────────────────────────────────
function changeColCount(delta) {
    const next = colCount + delta;
    if (next < 2) return;
    colCount = next;
    document.getElementById("col-count").textContent = colCount;
    if (tgt) drawTree(tgt);
}
