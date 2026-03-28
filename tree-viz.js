/**
 * tree-viz.js
 * 전기 파워트리 시각화 엔진 (확장 가능 버전)
 */

// ── 레이아웃 설정 ─────────────────────────────────────────────
const NODE_H  = 34;
const H_GAP   = 24;
const V_GAP   = 120;
const FONT_PX = 13;
const CHAR_W  = 7.8;
const PAD_X   = 18;

// ── 전역 상태 ─────────────────────────────────────────────────
let nodeMap  = {};   // tag → { x, y, type, w, expanded }
let edgeList = [];   // 표시할 모든 엣지
let tgt      = "";   // 최초 선택 태그
let colCount = 4;    // 하단 열 수 (짝수)
let svgZoom  = null; // d3 zoom 인스턴스 (renderTree 에서 초기화)

// ── 유틸 ─────────────────────────────────────────────────────
function nodeWidth(tag) {
    return Math.max(70, Math.ceil(tag.length * CHAR_W) + PAD_X * 2);
}

// 화면 표시용: EDB 포함 태그 끝 -XXX(3자리) 제거
function displayName(tag) {
    return /EDB/i.test(tag) ? tag.replace(/-\d{3}$/, "") : tag;
}

// EDB 태그 끝 -XXX 추출 (라벨 표시용)
function getEdbSuffix(tag) {
    if (!/EDB/i.test(tag)) return null;
    const m = tag.match(/-(\d{3})$/);
    return m ? `-${m[1]}` : null;
}

// ── 1. 트리 초기화 (새 장비 선택 시) ──────────────────────────
function drawTree(targetTag) {
    nodeMap  = {};
    edgeList = [];
    tgt      = targetTag;

    const hintDiv = document.getElementById("hint");
    if (hintDiv) hintDiv.classList.add("hidden");

    if (!tgt && powerData.length > 0) tgt = powerData[0]["Equipment Tag(From)"];
    if (!tgt) return;

    const container  = document.getElementById("canvas-container");
    const containerW = container.clientWidth  || 800;
    const containerH = container.clientHeight || 600;
    const cx = containerW / 2;
    const cy = containerH / 2;

    const fromRows = powerData.filter(d => d["Equipment Tag(To)"]   === tgt);
    const toRows   = powerData.filter(d => d["Equipment Tag(From)"] === tgt);
    const fromTags = [...new Set(fromRows.map(d => d["Equipment Tag(From)"]))].filter(Boolean);
    const toTags   = [...new Set(toRows.map(d =>   d["Equipment Tag(To)"]))].filter(Boolean);

    const allTags = [tgt, ...fromTags, ...toTags];
    const STEP = Math.max(...allTags.map(nodeWidth)) + H_GAP;

    // 중앙 노드
    nodeMap[tgt] = { x: cx, y: cy, type: "center", w: nodeWidth(tgt), expanded: true };

    // From 노드 (위)
    fromTags.forEach((tag, i) => {
        const total = fromTags.length;
        nodeMap[tag] = {
            x: cx + (i - (total - 1) / 2) * STEP,
            y: cy - V_GAP,
            type: "from", w: nodeWidth(tag), expanded: false
        };
    });

    // To 노드 (아래)
    toTags.forEach((tag, i) => {
        const row      = Math.floor(i / colCount);
        const col      = i % colCount;
        const rowCount = Math.min(toTags.length - row * colCount, colCount);
        const startX   = cx - ((rowCount - 1) * STEP) / 2;
        nodeMap[tag] = {
            x: startX + col * STEP,
            y: cy + V_GAP + row * (NODE_H + V_GAP * 0.6),
            type: "to", w: nodeWidth(tag), expanded: false
        };
    });

    // 엣지 수집
    _collectEdges([...fromRows, ...toRows], tgt);

    renderTree(null); // 새로 그릴 때는 중앙 정렬
}

// ── 2. 노드 확장 (더블클릭 / 길게 클릭) ───────────────────────
function expandNode(tag) {
    const node = nodeMap[tag];
    if (!node || node.expanded) return;
    node.expanded = true;

    const fromRows = powerData.filter(d => d["Equipment Tag(To)"]   === tag);
    const toRows   = powerData.filter(d => d["Equipment Tag(From)"] === tag);
    const newFromTags = [...new Set(fromRows.map(d => d["Equipment Tag(From)"]))].filter(t => t && !nodeMap[t]);
    const newToTags   = [...new Set(toRows.map(d =>   d["Equipment Tag(To)"]))].filter(t => t && !nodeMap[t]);

    // 현재 노드 기준 STEP 계산 (전체 태그 고려)
    const allTags = [...Object.keys(nodeMap), ...newFromTags, ...newToTags];
    const STEP = Math.max(...allTags.map(nodeWidth)) + H_GAP;

    // 새 From 노드: 클릭 노드 위에 배치
    newFromTags.forEach((t, i) => {
        const total = newFromTags.length;
        nodeMap[t] = {
            x: node.x + (i - (total - 1) / 2) * STEP,
            y: node.y - V_GAP,
            type: "from", w: nodeWidth(t), expanded: false
        };
    });

    // 새 To 노드: 클릭 노드 아래에 배치 (colCount 열)
    newToTags.forEach((t, i) => {
        const row      = Math.floor(i / colCount);
        const col      = i % colCount;
        const rowCount = Math.min(newToTags.length - row * colCount, colCount);
        const startX   = node.x - ((rowCount - 1) * STEP) / 2;
        nodeMap[t] = {
            x: startX + col * STEP,
            y: node.y + V_GAP + row * (NODE_H + V_GAP * 0.6),
            type: "to", w: nodeWidth(t), expanded: false
        };
    });

    // 새 엣지 수집
    _collectEdges([...fromRows, ...toRows], tag);

    // 현재 줌 상태 유지하며 재렌더
    const svg     = d3.select("#tree-svg");
    const current = svgZoom ? d3.zoomTransform(svg.node()) : null;
    renderTree(current);
}

// ── 3. 엣지 수집 헬퍼 ────────────────────────────────────────
function _collectEdges(rows, anchorTag) {
    rows.forEach(row => {
        const ft = row["Equipment Tag(From)"];
        const tt = row["Equipment Tag(To)"];
        if (!ft || !tt) return;
        if (!nodeMap[ft] || !nodeMap[tt]) return;
        if (ft !== anchorTag && tt !== anchorTag) return;
        const key = `${ft}→${tt}`;
        if (!edgeList.find(e => e.key === key)) {
            edgeList.push({ key, fromTag: ft, toTag: tt,
                cktFrom: row["CKT(From)"], cktTo: row["CKT(To)"] });
        }
    });
}

// ── 4. 렌더링 ─────────────────────────────────────────────────
function renderTree(preservedTransform) {
    const svg        = d3.select("#tree-svg");
    const container  = document.getElementById("canvas-container");
    const containerW = container.clientWidth  || 800;
    const containerH = container.clientHeight || 600;

    svg.selectAll("*").remove();

    const g = svg.append("g").attr("id", "main-g");

    svgZoom = d3.zoom()
        .scaleExtent([0.05, 8])
        .on("zoom", e => g.attr("transform", e.transform));
    svg.call(svgZoom);

    // 화살표 마커
    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10").attr("refX", 10).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
        .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#546e7a");

    const edgeLayer  = g.append("g").attr("class", "links");
    const labelLayer = g.append("g").attr("class", "labels");
    const nodeLayer  = g.append("g").attr("class", "nodes");

    // 엣지 + 라벨
    edgeList.forEach(edge => {
        const fn = nodeMap[edge.fromTag];
        const tn = nodeMap[edge.toTag];
        if (!fn || !tn) return;

        edgeLayer.append("path")
            .attr("class", "link")
            .attr("data-from", edge.fromTag)
            .attr("data-to",   edge.toTag)
            .attr("d", _bezier(fn, tn))
            .attr("marker-end", "url(#arrowhead)");

        const x1 = fn.x, y1 = fn.y + NODE_H / 2 + 2;
        const x2 = tn.x, y2 = tn.y - NODE_H / 2 - 8;

        if (edge.cktFrom) {
            labelLayer.append("text").attr("class", "ckt-label")
                .attr("x", x1 - 6).attr("y", y1 + 14)
                .attr("text-anchor", "end").text(edge.cktFrom);
        }
        const edbFrom = getEdbSuffix(edge.fromTag);
        if (edbFrom) {
            labelLayer.append("text").attr("class", "ckt-label edb-suffix")
                .attr("x", x1 + 6).attr("y", y1 + 14)
                .attr("text-anchor", "start").text(edbFrom);
        }
        const edbTo = getEdbSuffix(edge.toTag);
        if (edbTo) {
            labelLayer.append("text").attr("class", "ckt-label edb-suffix")
                .attr("x", x2 + 6).attr("y", y2 - 6)
                .attr("text-anchor", "start").text(edbTo);
        }
        if (edge.cktTo) {
            labelLayer.append("text").attr("class", "ckt-label")
                .attr("x", x2 - 6).attr("y", y2 - 6)
                .attr("text-anchor", "end").text(edge.cktTo);
        }
    });

    // 노드
    Object.entries(nodeMap).forEach(([tag, node]) => {
        const w  = node.w;
        const ng = nodeLayer.append("g")
            .attr("class", `node node-${node.type}`)
            .attr("transform", `translate(${node.x - w / 2}, ${node.y - NODE_H / 2})`)
            .style("cursor", "move")
            .call(d3.drag()
                .on("start", _dragStart)
                .on("drag",  _drag)
                .on("end",   _dragEnd)
            );

        ng.attr("data-tag", tag); // 원본 tag 보관
        ng.append("rect").attr("width", w).attr("height", NODE_H).attr("rx", 5);
        ng.append("text")
            .attr("x", w / 2)
            .attr("y", NODE_H / 2 + Math.floor(FONT_PX / 2) - 1)
            .attr("text-anchor", "middle")
            .text(displayName(tag));

        // 미확장 노드에 점선 테두리 표시 (확장 가능 표시)
        if (!node.expanded) {
            ng.select("rect").style("stroke-dasharray", "4,3");
        }

        _setupInteractions(ng, tag);
    });

    // 줌 적용
    if (preservedTransform) {
        svg.call(svgZoom.transform, preservedTransform);
    } else {
        requestAnimationFrame(() => {
            try {
                const bbox = g.node().getBBox();
                if (!bbox.width || !bbox.height) return;
                const tx = containerW / 2 - (bbox.x + bbox.width  / 2);
                const ty = containerH / 2 - (bbox.y + bbox.height / 2);
                svg.call(svgZoom.transform, d3.zoomIdentity.translate(tx, ty));
            } catch (e) { /* 무시 */ }
        });
    }
}

// ── 5. 베지어 경로 ────────────────────────────────────────────
function _bezier(fn, tn) {
    const x1 = fn.x, y1 = fn.y + NODE_H / 2 + 2;
    const x2 = tn.x, y2 = tn.y - NODE_H / 2 - 8;
    const dy = Math.abs(y2 - y1) * 0.5;
    return `M${x1},${y1} C${x1},${y1+dy} ${x2},${y2-dy} ${x2},${y2}`;
}

// ── 6. 드래그 ────────────────────────────────────────────────
function _dragStart(event) { d3.select(this).raise().classed("active", true); }
function _drag(event) {
    const tag  = d3.select(this).attr("data-tag");
    const node = nodeMap[tag];
    if (!node) return;
    node.x = event.x + node.w / 2;
    node.y = event.y + NODE_H / 2;
    d3.select(this).attr("transform", `translate(${event.x}, ${event.y})`);
    d3.selectAll(".link").each(function () {
        const l    = d3.select(this);
        const fTag = l.attr("data-from");
        const tTag = l.attr("data-to");
        if (fTag === tag || tTag === tag) {
            l.attr("d", _bezier(nodeMap[fTag], nodeMap[tTag]));
        }
    });
}
function _dragEnd(event) { d3.select(this).classed("active", false); }

// ── 7. 인터랙션 (더블클릭 / 길게 클릭 → 확장) ──────────────────
function _setupInteractions(sel, tag) {
    let pressTimer = null;

    sel
        .on("dblclick", (event) => {
            event.stopPropagation();
            expandNode(tag);
        })
        .on("mousedown touchstart", (event) => {
            pressTimer = setTimeout(() => {
                pressTimer = null;
                expandNode(tag);
            }, 600);
        })
        .on("mouseup mouseleave touchend touchcancel", () => {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        });
}

// ── 8. 열 수 조절 ────────────────────────────────────────────
function changeColCount(delta) {
    const next = colCount + delta;
    if (next < 2) return;
    colCount = next;
    document.getElementById("col-count").textContent = colCount;
    if (tgt) drawTree(tgt);
}
