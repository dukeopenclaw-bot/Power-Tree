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
let nodeMap          = {};
let edgeList         = [];
let tgt              = "";   // 베이스 태그 (EDB-001 → EDB)
let colCount         = 4;
let svgZoom          = null;
let _dragging        = false;
let _tooltipHideTimer = null;

let moveSubeq           = false;   // 상위 이동 시 하위 장치 동반 이동
function setMoveSubeq(val) { moveSubeq = val; }

// ── 모바일 탭/롱프레스 전역 상태 ───────────────────────────────
let _mobilePressTimer   = null;
let _mobileLongFired    = false;
let _mobileLastTapTag   = null;
let _mobileLastTapTime  = 0;
let _mobileTapX         = 0;
let _lastSelectedTag    = null;

// ── 유틸 ─────────────────────────────────────────────────────
function nodeWidth(tag) {
    return Math.max(70, Math.ceil(tag.length * CHAR_W) + PAD_X * 2);
}

// EDB-XXX → 베이스 태그 (EDB). 그 외는 그대로.
function getBaseName(tag) {
    if (!tag) return tag;
    return /EDB/i.test(tag) ? tag.replace(/-\d{3}$/, "") : tag;
}

// EDB 끝 -XXX 추출 (엣지 라벨용)
function getEdbSuffix(tag) {
    if (!/EDB/i.test(tag)) return null;
    const m = tag.match(/-(\d{3})$/);
    return m ? `-${m[1]}` : null;
}

// ── 1. 트리 초기화 ────────────────────────────────────────────
function drawTree(targetTag) {
    nodeMap  = {};
    edgeList = [];
    tgt      = getBaseName(targetTag); // 베이스 태그로 정규화

    const hintDiv = document.getElementById("hint");
    if (hintDiv) hintDiv.classList.add("hidden");

    if (!tgt && powerData.length > 0) tgt = getBaseName(powerData[0]["Equipment Tag(From)"]);
    if (!tgt) return;

    const container  = document.getElementById("canvas-container");
    const containerW = container.clientWidth  || 800;
    const containerH = container.clientHeight || 600;
    const cx = containerW / 2;
    const cy = containerH / 2;

    // 베이스 태그 기준으로 데이터 필터 (EDB-001, EDB-002 모두 "EDB"로 매칭)
    const fromRows = powerData.filter(d => getBaseName(d["Equipment Tag(To)"])   === tgt);
    const toRows   = powerData.filter(d => getBaseName(d["Equipment Tag(From)"]) === tgt);

    // 베이스 태그 기준으로 중복 제거
    const fromTags = [...new Set(fromRows.map(d => getBaseName(d["Equipment Tag(From)"])))]
        .filter(t => t && t !== tgt)
        .filter(t => showSpare || !/spare/i.test(t));
    const toTags   = [...new Set(toRows.map(d =>   getBaseName(d["Equipment Tag(To)"])))]
        .filter(t => t && t !== tgt)
        .filter(t => showSpare || !/spare/i.test(t));

    // 상호 공급 관계 분리 (fromTags ∩ toTags)
    const mutualSet    = new Set(fromTags.filter(t => toTags.includes(t)));
    const onlyFromTags = fromTags.filter(t => !mutualSet.has(t));
    const mutualTags   = [...mutualSet];

    const allTags = [tgt, ...mutualTags];
    const STEP = Math.max(...allTags.map(nodeWidth)) + H_GAP;

    // 초기 표시: center + 상호 노드만.
    // 상위/하위는 왼쪽/오른쪽 더블클릭으로 각각 확장.
    nodeMap[tgt] = {
        x: cx, y: cy, type: "center", w: nodeWidth(tgt),
        expanded: false, expandedUp: false, expandedDown: false
    };

    // 상호 노드 → 수평 배치 (center 오른쪽)
    mutualTags.forEach((tag, i) => {
        nodeMap[tag] = {
            x: cx + (i + 1) * STEP,
            y: cy, type: "mutual", w: nodeWidth(tag),
            expanded: false, expandedUp: false, expandedDown: false
        };
    });

    // 상호 노드와의 엣지만 초기 수집
    const mutualSet2 = new Set(mutualTags);
    const mutualFromRows = fromRows.filter(d => mutualSet2.has(getBaseName(d["Equipment Tag(From)"])));
    _collectEdges(mutualFromRows, tgt);
    renderTree(null);
}

// ── 2. 노드 확장 ──────────────────────────────────────────────
function expandNode(tag) {
    const node = nodeMap[tag];
    if (!node || node.expanded) return;
    node.expanded     = true;
    node.expandedUp   = true;
    node.expandedDown = true;

    const fromRows = powerData.filter(d => getBaseName(d["Equipment Tag(To)"])   === tag);
    const toRows   = powerData.filter(d => getBaseName(d["Equipment Tag(From)"]) === tag);

    const newFromTags = [...new Set(fromRows.map(d => getBaseName(d["Equipment Tag(From)"])))]
        .filter(t => t && t !== tag && !nodeMap[t])
        .filter(t => showSpare || !/spare/i.test(t));
    const newToTags   = [...new Set(toRows.map(d => getBaseName(d["Equipment Tag(To)"])))]
        .filter(t => t && t !== tag && !nodeMap[t])
        .filter(t => showSpare || !/spare/i.test(t));

    const allTags = [...Object.keys(nodeMap), ...newFromTags, ...newToTags];
    const STEP = Math.max(...allTags.map(nodeWidth)) + H_GAP;

    newFromTags.forEach((t, i) => {
        const total = newFromTags.length;
        nodeMap[t] = {
            x: node.x + (i - (total - 1) / 2) * STEP,
            y: node.y - V_GAP, type: "from", w: nodeWidth(t), expanded: false
        };
    });

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

    _collectEdges([...fromRows, ...toRows], tag);

    const svg     = d3.select("#tree-svg");
    const current = svgZoom ? d3.zoomTransform(svg.node()) : null;
    renderTree(current);
}

// ── 2a. 방향별 확장 ───────────────────────────────────────────
function expandNodeUpstream(tag) {
    const node = nodeMap[tag];
    if (!node || node.expandedUp) return;
    node.expandedUp = true;

    const fromRows    = powerData.filter(d => getBaseName(d["Equipment Tag(To)"]) === tag);
    const newFromTags = [...new Set(fromRows.map(d => getBaseName(d["Equipment Tag(From)"])))]
        .filter(t => t && t !== tag && !nodeMap[t])
        .filter(t => showSpare || !/spare/i.test(t));

    if (newFromTags.length > 0) {
        const STEP = Math.max(...[...Object.keys(nodeMap), ...newFromTags].map(nodeWidth)) + H_GAP;
        newFromTags.forEach((t, i) => {
            nodeMap[t] = {
                x: node.x + (i - (newFromTags.length - 1) / 2) * STEP,
                y: node.y - V_GAP, type: "from", w: nodeWidth(t),
                expanded: false, expandedUp: false, expandedDown: false
            };
        });
    }
    // 신규 노드 없어도 기존 노드와의 엣지 수집 (이미 표시된 상위 장비 연결)
    _collectEdges(fromRows, tag);
    renderTree(svgZoom ? d3.zoomTransform(d3.select("#tree-svg").node()) : null);
}

function expandNodeDownstream(tag) {
    const node = nodeMap[tag];
    if (!node || node.expandedDown) return;
    node.expandedDown = true;

    const toRows    = powerData.filter(d => getBaseName(d["Equipment Tag(From)"]) === tag);
    const newToTags = [...new Set(toRows.map(d => getBaseName(d["Equipment Tag(To)"])))]
        .filter(t => t && t !== tag && !nodeMap[t])
        .filter(t => showSpare || !/spare/i.test(t));

    if (newToTags.length > 0) {
        const STEP = Math.max(...[...Object.keys(nodeMap), ...newToTags].map(nodeWidth)) + H_GAP;
        newToTags.forEach((t, i) => {
            const row = Math.floor(i / colCount);
            const col = i % colCount;
            const rowCount = Math.min(newToTags.length - row * colCount, colCount);
            nodeMap[t] = {
                x: node.x - ((rowCount - 1) * STEP) / 2 + col * STEP,
                y: node.y + V_GAP + row * (NODE_H + V_GAP * 0.6),
                type: "to", w: nodeWidth(t),
                expanded: false, expandedUp: false, expandedDown: false
            };
        });
    }
    // 신규 노드 없어도 기존 노드와의 엣지 수집 (이미 표시된 하위 장비 연결)
    _collectEdges(toRows, tag);
    renderTree(svgZoom ? d3.zoomTransform(d3.select("#tree-svg").node()) : null);
}

// ── 2b. 전원 상태 계산 및 색상 적용 ─────────────────────────────
function recalcPoweredState() {
    // 1차: userOff 기준 초기화
    Object.keys(nodeMap).forEach(tag => {
        nodeMap[tag].powered = !nodeMap[tag].userOff;
    });
    // 2차: 상위 노드 전원 전파 (상위가 모두 꺼지면 하위도 꺼짐)
    let changed = true;
    while (changed) {
        changed = false;
        Object.keys(nodeMap).forEach(tag => {
            if (nodeMap[tag].userOff) {
                if (nodeMap[tag].powered !== false) { nodeMap[tag].powered = false; changed = true; }
                return;
            }
            const upTags = edgeList.filter(e => e.toTag === tag).map(e => e.fromTag).filter(t => nodeMap[t]);
            if (upTags.length === 0) {
                // 루트 노드: 상위 없으면 켜짐
                if (nodeMap[tag].powered !== true) { nodeMap[tag].powered = true; changed = true; }
                return;
            }
            const anyOn = upTags.some(t => nodeMap[t].powered);
            if (nodeMap[tag].powered !== anyOn) { nodeMap[tag].powered = anyOn; changed = true; }
        });
    }
}

function applyPowerColors() {
    recalcPoweredState();
    d3.selectAll("g.node").each(function() {
        const tag  = d3.select(this).attr("data-tag");
        const node = nodeMap[tag];
        if (!node) return;
        d3.select(this)
            .classed("node-off", node.powered === false)
            .classed("node-on",  node.powered !== false);
    });
    applyEdgeColors();
}


function applyEdgeColors() {
    d3.selectAll(".link").each(function() {
        const l       = d3.select(this);
        const fromTag = l.attr("data-from");
        const fn      = nodeMap[fromTag];
        const powered = fn ? fn.powered !== false : true;
        const isCross = l.classed("link-cross");

        if (isCross) {
            // 교차선: showCrossEdges 토글과 무관하게 항상 진하게 표시
            l.style("stroke",          powered ? "#e53935" : "#9e9e9e")
             .style("stroke-width",    "1.5")
             .style("stroke-dasharray", null)
             .style("stroke-opacity",  "0.8")
             .attr("marker-end", powered ? "url(#arr-on)" : "url(#arr-off)");
        } else if (powered) {
            l.style("stroke", "#e53935")
             .style("stroke-width", "1.8")
             .style("stroke-dasharray", null)
             .style("stroke-opacity", "0.8")
             .attr("marker-end", "url(#arr-on)");
        } else {
            l.style("stroke", "#9e9e9e")
             .style("stroke-width", "1")
             .style("stroke-dasharray", "5,4")
             .style("stroke-opacity", "0.55")
             .attr("marker-end", "url(#arr-off)");
        }
    });
}

function _highlightEdges(tag) {
    d3.selectAll(".link").each(function() {
        const l       = d3.select(this);
        const isUp    = l.attr("data-to")   === tag;
        const isDn    = l.attr("data-from") === tag;
        const isCross = l.classed("link-cross");

        if (isUp && !isCross) {
            l.style("stroke", "#1565c0").style("stroke-width", "3")
             .style("stroke-dasharray", null).style("stroke-opacity", "1")
             .attr("marker-end", "url(#arr-up)");
        } else if (isDn && !isCross) {
            l.style("stroke", "#e65100").style("stroke-width", "3")
             .style("stroke-dasharray", null).style("stroke-opacity", "1")
             .attr("marker-end", "url(#arr-down)");
        } else if ((isUp || isDn) && isCross) {
            // 선택 노드의 교차 엣지: 실선으로 강조 표시
            l.style("stroke", isUp ? "#1565c0" : "#e65100")
             .style("stroke-width", "2").style("stroke-dasharray", null)
             .style("stroke-opacity", "0.75")
             .attr("marker-end", "url(#arr-cross)");
        } else if (isCross) {
            l.style("stroke-opacity", "0.04");
        } else {
            l.style("stroke-opacity", "0.15");
        }
    });
}

function toggleNodePower(tag) {
    const node = nodeMap[tag];
    if (!node) return;
    node.userOff = !node.userOff;
    applyPowerColors();
}

function deleteNode(tag) {
    if (!nodeMap[tag]) return;
    delete nodeMap[tag];
    edgeList = edgeList.filter(e => e.fromTag !== tag && e.toTag !== tag);
    if (tgt === tag) tgt = Object.keys(nodeMap)[0] || "";
    _lastSelectedTag = null;
    closeNodeModal();
    if (Object.keys(nodeMap).length === 0) {
        d3.select("#tree-svg").selectAll("*").remove();
        svgZoom = null;
        const hint = document.getElementById("hint");
        if (hint) hint.classList.remove("hidden");
    } else {
        const cur = svgZoom ? d3.zoomTransform(d3.select("#tree-svg").node()) : null;
        renderTree(cur);
    }
}

// ── 3. 엣지 수집 ──────────────────────────────────────────────
function _collectEdges(rows, anchorBase) {
    rows.forEach(row => {
        const ft     = row["Equipment Tag(From)"];
        const tt     = row["Equipment Tag(To)"];
        if (!ft || !tt) return;
        const baseFt = getBaseName(ft);
        const baseTt = getBaseName(tt);
        if (!nodeMap[baseFt] || !nodeMap[baseTt]) return;
        if (baseFt !== anchorBase && baseTt !== anchorBase) return;

        // 원본 태그 기준으로 키 생성 (같은 EDB의 회로별 엣지 구분)
        const key = `${ft}→${tt}`;
        if (!edgeList.find(e => e.key === key)) {
            edgeList.push({
                key,
                fromTag:     baseFt,
                toTag:       baseTt,
                cktFrom:     row["CKT(From)"],
                cktTo:       row["CKT(To)"],
                suffixFrom:  getEdbSuffix(ft),  // -XXX (from 원본)
                suffixTo:    getEdbSuffix(tt)    // -XXX (to 원본)
            });
        }
    });
}

// ── 4. 렌더링 ─────────────────────────────────────────────────
function renderTree(preservedTransform) {
    recalcPoweredState();
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

    const defs = svg.append("defs");
    [
        { id: "arr-on",    fill: "#e53935", w: 6 },
        { id: "arr-off",   fill: "#bdbdbd", w: 6 },
        { id: "arr-up",    fill: "#1565c0", w: 6 },
        { id: "arr-down",  fill: "#e65100", w: 6 },
        { id: "arr-cross", fill: "#e53935", w: 4, opacity: 0.4 },
    ].forEach(({ id, fill, w, opacity }) => {
        const p = defs.append("marker")
            .attr("id", id)
            .attr("viewBox", "0 -5 10 10").attr("refX", 10).attr("refY", 0)
            .attr("markerWidth", w).attr("markerHeight", w).attr("orient", "auto")
            .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", fill);
        if (opacity !== undefined) p.attr("fill-opacity", opacity);
    });

    const edgeLayer  = g.append("g").attr("class", "links");
    const labelLayer = g.append("g").attr("class", "labels");
    const nodeLayer  = g.append("g").attr("class", "nodes");

    edgeList.forEach(edge => {
        const fn = nodeMap[edge.fromTag];
        const tn = nodeMap[edge.toTag];
        if (!fn || !tn) return;

        // 교차 엣지 감지: 수평 이동이 수직 낙차의 2배 초과 → cross-edge
        const edgeDy = tn.y - fn.y;
        const edgeDx = Math.abs(fn.x - tn.x);
        const isCrossEdge = edgeDy < NODE_H * 0.5 || (edgeDy > 0 && edgeDx > edgeDy * 2);

        edgeLayer.append("path")
            .attr("class", isCrossEdge ? "link link-cross" : "link")
            .attr("data-from", edge.fromTag)
            .attr("data-to",   edge.toTag)
            .attr("d", _bezier(fn, tn))
            .attr("marker-end", isCrossEdge ? "url(#arr-cross)" : "url(#arr-on)");

        const sameLevel = Math.abs(fn.y - tn.y) < NODE_H * 1.5;
        const x1 = sameLevel ? fn.x + (tn.x > fn.x ?  fn.w/2+2 : -fn.w/2-2) : fn.x;
        const y1 = sameLevel ? fn.y                                             : fn.y + NODE_H/2 + 2;
        const x2 = sameLevel ? tn.x + (tn.x > fn.x ? -tn.w/2-8 :  tn.w/2+8) : tn.x;
        const y2 = sameLevel ? tn.y                                             : tn.y - NODE_H/2 - 8;
        const lFromX = sameLevel ? x1        : x1 - 6;
        const lFromY = sameLevel ? y1 - 8    : y1 + 14;
        const lToX   = sameLevel ? x2        : x2 - 6;
        const lToY   = sameLevel ? y2 - 8    : y2 - 6;
        const lAnchor = sameLevel ? "middle" : "end";

        const lg = labelLayer.append("g")
            .attr("class", "edge-labels")
            .attr("data-from", edge.fromTag)
            .attr("data-to",   edge.toTag)
            .style("display", "none");

        if (edge.cktFrom) {
            lg.append("text").attr("class", "ckt-label")
                .attr("data-role", "ckt-from")
                .attr("x", lFromX).attr("y", lFromY)
                .attr("text-anchor", lAnchor).text(edge.cktFrom);
        }
        // -XXX는 원본 태그에서 추출한 suffixFrom/suffixTo 사용
        if (edge.suffixFrom) {
            lg.append("text").attr("class", "ckt-label edb-suffix")
                .attr("data-role", "edb-from")
                .attr("x", sameLevel ? x1 : x1 + 6)
                .attr("y", sameLevel ? y1 + 14 : y1 + 14)
                .attr("text-anchor", sameLevel ? "middle" : "start").text(edge.suffixFrom);
        }
        if (edge.suffixTo) {
            lg.append("text").attr("class", "ckt-label edb-suffix")
                .attr("data-role", "edb-to")
                .attr("x", sameLevel ? x2 : x2 + 6)
                .attr("y", sameLevel ? y2 + 14 : y2 - 6)
                .attr("text-anchor", sameLevel ? "middle" : "start").text(edge.suffixTo);
        }
        if (edge.cktTo) {
            lg.append("text").attr("class", "ckt-label")
                .attr("data-role", "ckt-to")
                .attr("x", lToX).attr("y", lToY)
                .attr("text-anchor", lAnchor).text(edge.cktTo);
        }
    });

    Object.entries(nodeMap).forEach(([tag, node]) => {
        const w  = node.w;
        const ng = nodeLayer.append("g")
            .attr("class", `node node-${node.type} ${node.powered === false ? 'node-off' : 'node-on'}`)
            .attr("transform", `translate(${node.x - w / 2}, ${node.y - NODE_H / 2})`)
            .attr("data-tag", tag)
            .style("cursor", "move")
            .call(d3.drag()
                .on("start", _dragStart)
                .on("drag",  _drag)
                .on("end",   _dragEnd)
            );

        ng.append("rect").attr("width", w).attr("height", NODE_H).attr("rx", 5);
        ng.append("text")
            .attr("x", w / 2)
            .attr("y", NODE_H / 2 + Math.floor(FONT_PX / 2) - 1)
            .attr("text-anchor", "middle")
            .text(tag); // 이미 베이스 태그

        if (!node.expanded) ng.select("rect").style("stroke-dasharray", "4,3");

        _setupInteractions(ng, tag);

        // X 버튼 (노드 삭제)
        const delBtn = ng.append("g")
            .attr("class", "node-del-btn")
            .attr("transform", `translate(${w - 16}, 2)`);
        delBtn.append("rect")
            .attr("width", 14).attr("height", 14)
            .attr("rx", 3)
            .attr("fill", "#e53935");
        delBtn.append("text")
            .attr("x", 7).attr("y", 10.5)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .attr("font-size", "11px")
            .attr("font-weight", "700")
            .attr("pointer-events", "none")
            .text("×");
        delBtn.on("pointerdown.del", (e) => e.stopPropagation())
              .on("click.del", (e) => { e.stopPropagation(); deleteNode(tag); });
        if (_hasHover) {
            delBtn.style("display", "none");
            ng.on("mouseenter.del", function() { d3.select(this).select(".node-del-btn").style("display", null); })
              .on("mouseleave.del", function() { d3.select(this).select(".node-del-btn").style("display", "none"); });
        }
    });

    applyEdgeColors();

    if (preservedTransform) {
        svg.call(svgZoom.transform, preservedTransform);
    } else {
        requestAnimationFrame(() => {
            try {
                // 사이드바 축소 후 변경된 캔버스 크기를 새로 읽음 (zoomFit 방식)
                const c  = document.getElementById("canvas-container");
                const cW = c.clientWidth  || 800;
                const cH = c.clientHeight || 600;
                const bbox = g.node().getBBox();
                if (!bbox.width || !bbox.height) return;
                const scale = Math.min(0.9 * cW / bbox.width, 0.9 * cH / bbox.height, 1.5);
                const tx = cW / 2 - scale * (bbox.x + bbox.width  / 2);
                const ty = cH / 2 - scale * (bbox.y + bbox.height / 2);
                svg.transition().duration(300)
                    .call(svgZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
            } catch (e) { /* 무시 */ }
        });
    }
}

// ── 5. 스마트 베지어 (수평/수직 자동 감지) ───────────────────
function _bezier(fn, tn) {
    const sameLevel = Math.abs(fn.y - tn.y) < NODE_H * 1.5;

    if (sameLevel) {
        // 수평 연결: 노드 옆면에서 시작/끝
        const goRight = tn.x > fn.x;
        const x1 = fn.x + (goRight ?  fn.w / 2 + 2  : -fn.w / 2 - 2);
        const y1 = fn.y;
        const x2 = tn.x + (goRight ? -tn.w / 2 - 8  :  tn.w / 2 + 8);
        const y2 = tn.y;
        const dx = Math.abs(x2 - x1) * 0.5;
        const s  = goRight ? 1 : -1;
        return `M${x1},${y1} C${x1+s*dx},${y1} ${x2-s*dx},${y2} ${x2},${y2}`;
    }

    // 수직 연결 (기존)
    const x1 = fn.x, y1 = fn.y + NODE_H / 2 + 2;
    const x2 = tn.x, y2 = tn.y - NODE_H / 2 - 8;
    const dy = Math.abs(y2 - y1) * 0.5;
    return `M${x1},${y1} C${x1},${y1+dy} ${x2},${y2-dy} ${x2},${y2}`;
}

// 주어진 태그의 모든 하위 장치(edgeList 기준, nodeMap에 존재하는 것만) 반환
function getAllDescendants(tag) {
    const result  = new Set();
    const visited = new Set([tag]);   // 시작 태그 자신은 결과에 포함하지 않음 (사이클 방지)
    const queue   = [tag];
    while (queue.length > 0) {
        const cur = queue.shift();
        edgeList.forEach(e => {
            if (e.fromTag === cur && nodeMap[e.toTag] && !visited.has(e.toTag)) {
                visited.add(e.toTag);
                result.add(e.toTag);
                queue.push(e.toTag);
            }
        });
    }
    return [...result];
}

// ── 6. 드래그 ────────────────────────────────────────────────
function _dragStart(event) {
    _dragging = false;
    d3.select(this).raise().classed("active", true);

    if (!_hasHover) {
        // 모바일: 탭 위치 저장 + 롱프레스 타이머 시작
        const tag = d3.select(this).attr("data-tag");
        const src = event && event.sourceEvent;
        _mobileTapX = src ? (src.touches ? src.touches[0].clientX : src.clientX) : 0;
        _mobileLongFired = false;
        if (_mobilePressTimer) clearTimeout(_mobilePressTimer);
        _mobilePressTimer = setTimeout(() => {
            _mobileLongFired = true;
            _mobilePressTimer = null;
            toggleNodePower(tag);
        }, 600);
    }
}
function _drag(event) {
    // 드래그 움직임 감지 → 롱프레스 취소
    if (_mobilePressTimer) { clearTimeout(_mobilePressTimer); _mobilePressTimer = null; }
    _dragging = true;
    const tag  = d3.select(this).attr("data-tag");
    const node = nodeMap[tag];
    if (!node) return;

    const dx = event.dx, dy = event.dy;

    let movedTags;
    if (moveSubeq) {
        // move-subeq: 상위 포함 전체를 증분 방식으로 이동 (상대 위치 유지)
        node.x += dx;
        node.y += dy;
        d3.select(this).attr("transform", `translate(${node.x - node.w / 2}, ${node.y - NODE_H / 2})`);

        movedTags = new Set([tag]);
        getAllDescendants(tag).forEach(descTag => {
            const dn = nodeMap[descTag];
            if (!dn) return;
            dn.x += dx;
            dn.y += dy;
            movedTags.add(descTag);
            d3.select(`g.node[data-tag="${descTag}"]`)
              .attr("transform", `translate(${dn.x - dn.w / 2}, ${dn.y - NODE_H / 2})`);
        });
    } else {
        // 기존 단일 노드 드래그
        node.x = event.x + node.w / 2;
        node.y = event.y + NODE_H / 2;
        d3.select(this).attr("transform", `translate(${event.x}, ${event.y})`);
        movedTags = new Set([tag]);
    }

    d3.selectAll(".link").each(function () {
        const l = d3.select(this);
        const fTag = l.attr("data-from"), tTag = l.attr("data-to");
        if (movedTags.has(fTag) || movedTags.has(tTag))
            l.attr("d", _bezier(nodeMap[fTag], nodeMap[tTag]));
    });

    d3.selectAll(".edge-labels").each(function () {
        const lg = d3.select(this);
        const fTag = lg.attr("data-from"), tTag = lg.attr("data-to");
        if (!movedTags.has(fTag) && !movedTags.has(tTag)) return;
        const fn = nodeMap[fTag], tn = nodeMap[tTag];
        if (!fn || !tn) return;
        const x1 = fn.x, y1 = fn.y + NODE_H / 2 + 2;
        const x2 = tn.x, y2 = tn.y - NODE_H / 2 - 8;
        lg.selectAll("text").each(function () {
            const t = d3.select(this), role = t.attr("data-role");
            if (role === "ckt-from") t.attr("x", x1 - 6).attr("y", y1 + 14);
            if (role === "edb-from") t.attr("x", x1 + 6).attr("y", y1 + 14);
            if (role === "edb-to")   t.attr("x", x2 + 6).attr("y", y2 - 6);
            if (role === "ckt-to")   t.attr("x", x2 - 6).attr("y", y2 - 6);
        });
    });
}
function _dragEnd() {
    if (_mobilePressTimer) { clearTimeout(_mobilePressTimer); _mobilePressTimer = null; }
    d3.select(this).classed("active", false);

    if (!_hasHover && !_dragging) {
        const tag = d3.select(this).attr("data-tag");
        if (_mobileLongFired) {
            // toggleNodePower는 이미 pressTimer에서 호출됨
        } else if (tag) {
            // 탭 처리: 단일탭 → 툴팁, 더블탭 좌/우 → 상위/하위 확장
            const now = Date.now();
            if (tag === _mobileLastTapTag && now - _mobileLastTapTime < 350) {
                const nodeEl = document.querySelector(`g.node[data-tag="${tag}"]`);
                const bbox   = nodeEl ? nodeEl.getBoundingClientRect() : null;
                const isLeft = bbox ? _mobileTapX < bbox.left + bbox.width / 2 : true;
                if (isLeft) expandNodeUpstream(tag);
                else        expandNodeDownstream(tag);
                _mobileLastTapTag  = null;
                _mobileLastTapTime = 0;
            } else {
                showNodeInfo(tag);
                _mobileLastTapTag  = tag;
                _mobileLastTapTime = now;
            }
        }
    }
    _mobileLongFired = false;
    setTimeout(() => { _dragging = false; }, 50);
}

// ── 7. 라벨 토글 ─────────────────────────────────────────────
function toggleNodeLabels(tag) {
    const upGroups   = d3.selectAll(".edge-labels").filter(function () {
        return d3.select(this).attr("data-to") === tag;
    });
    const downGroups = d3.selectAll(".edge-labels").filter(function () {
        return d3.select(this).attr("data-from") === tag;
    });
    const target = upGroups.size() > 0 ? upGroups : downGroups;
    const anyVisible = target.filter(function () {
        return d3.select(this).style("display") !== "none";
    }).size() > 0;
    downGroups.style("display", "none");
    upGroups.style("display", "none");
    if (!anyVisible) target.style("display", null);
}

// PC 환경 감지 (hover 가능한 포인터 장치)
const _hasHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// ── 8. 인터랙션 ───────────────────────────────────────────────
function _setupInteractions(sel, tag) {
    if (_hasHover) {
        // ── PC: 호버 → 툴팁, 클릭 → 선택장비, 더블클릭 → 확장 ───
        sel.on("mouseenter.interact", () => {
            if (_tooltipHideTimer) { clearTimeout(_tooltipHideTimer); _tooltipHideTimer = null; }
            if (!_dragging) showNodeInfo(tag);
        })
        .on("mouseleave.interact", () => {
            _tooltipHideTimer = setTimeout(() => {
                _tooltipHideTimer = null;
                closeNodeModal();
            }, 120);
        })
        .on("click.interact", (event) => {
            event.stopPropagation();
            if (_dragging) return;
            setAsCenter(tag);
        })
        .on("dblclick.interact", (event) => {
            event.stopPropagation();
            const bbox   = sel.node().getBoundingClientRect();
            const isLeft = event.clientX < bbox.left + bbox.width / 2;
            if (isLeft) expandNodeUpstream(tag);
            else        expandNodeDownstream(tag);
        })
        .on("contextmenu.interact", (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleNodePower(tag);
        });
        // 엣지 방향 강조 (호버 시)
        sel.on("mouseenter.edge-hl", () => { if (!_dragging) _highlightEdges(tag); })
           .on("mouseleave.edge-hl", () => { applyEdgeColors(); });
    }
    // 모바일: _dragStart/_drag/_dragEnd 에서 탭/더블탭/롱프레스 처리
}

// ── 9. 열 수 조절 ────────────────────────────────────────────
function changeColCount(delta) {
    const next = colCount + delta;
    if (next < 1) return;
    colCount = next;
    document.getElementById("col-count").textContent = colCount;
}

// ── 11. 트리에 태그 일괄 추가 (6열 그리드 배치) ─────────────────
const BATCH_COLS = 6;

function addTagsBatch(tags) {
    const allBases = tags.map(getBaseName).filter(Boolean);
    const bases    = allBases.filter(b => !nodeMap[b]);
    // 포커스 대상: 새로 추가되는 첫 노드, 없으면 검색한 첫 노드(이미 화면에 있음)
    const focusTarget = bases.length ? bases[0] : allBases[0];

    // 모두 이미 화면에 있음 → 추가 없이 해당 위치로 포커스만
    if (bases.length === 0) {
        if (focusTarget && nodeMap[focusTarget]) focusNode(focusTarget);
        return;
    }

    // 단일 태그: 항상 full 트리로 (from/to 포함)
    if (bases.length === 1) {
        if (Object.keys(nodeMap).length === 0) {
            drawTree(bases[0]); // 첫 트리: 전체 자동 맞춤
        } else {
            _addSingleWithConnections(bases[0]);
            focusNode(focusTarget);
        }
        return;
    }

    // 기존 노드 아래에 6열 그리드로 배치
    const existing = Object.values(nodeMap);
    const baseY = existing.length ? Math.max(...existing.map(n => n.y)) + V_GAP * 1.5 : 300;
    const centerX = existing.length
        ? existing.reduce((s, n) => s + n.x, 0) / existing.length
        : 500;

    const cellW = Math.max(...bases.map(nodeWidth)) + H_GAP;
    const cellH = NODE_H + 16;

    bases.forEach((base, i) => {
        const row = Math.floor(i / BATCH_COLS);
        const col = i % BATCH_COLS;
        const totalInRow = Math.min(bases.length - row * BATCH_COLS, BATCH_COLS);
        const rowStartX = centerX - ((totalInRow - 1) * cellW) / 2;
        nodeMap[base] = {
            x: rowStartX + col * cellW,
            y: baseY + row * cellH,
            type: "center",
            w: nodeWidth(base),
            expanded: false
        };
    });

    // 모든 선택 장비의 공급원을 한번에 수집 (중복 제거)
    const allFromTags = [];
    const fromRowsMap = {}; // base → fromRows (엣지 수집용)
    bases.forEach(base => {
        const fromRows = powerData.filter(d => getBaseName(d["Equipment Tag(To)"]) === base);
        fromRowsMap[base] = fromRows;
        fromRows.forEach(d => {
            const t = getBaseName(d["Equipment Tag(From)"]);
            if (t && t !== base && !nodeMap[t] && !allFromTags.includes(t) && (showSpare || !/spare/i.test(t))) {
                allFromTags.push(t);
            }
        });
    });

    // 공급원 노드를 선택 장비 위에 한 줄로 배치
    if (allFromTags.length > 0) {
        const fromCellW = Math.max(...allFromTags.map(nodeWidth)) + H_GAP;
        const fromStartX = centerX - ((allFromTags.length - 1) * fromCellW) / 2;
        allFromTags.forEach((t, i) => {
            nodeMap[t] = {
                x: fromStartX + i * fromCellW,
                y: baseY - V_GAP,
                type: "from",
                w: nodeWidth(t),
                expanded: false
            };
        });
    }

    // 엣지 수집
    bases.forEach(base => _collectEdges(fromRowsMap[base], base));

    const svg = d3.select("#tree-svg");
    const cur = svgZoom ? d3.zoomTransform(svg.node()) : null;
    renderTree(cur);
    if (focusTarget && nodeMap[focusTarget]) focusNode(focusTarget);
}

// ── 11b. 단일 태그를 기존 트리 아래에 from/to 포함해서 추가 ───
function _addSingleWithConnections(base) {
    if (nodeMap[base]) { showNodeInfo(base); return; }

    const existing = Object.values(nodeMap);
    const maxY  = Math.max(...existing.map(n => n.y));
    const avgX  = existing.reduce((s, n) => s + n.x, 0) / existing.length;
    const cx    = avgX;
    const cy    = maxY + V_GAP * 2;

    const fromRows = powerData.filter(d => getBaseName(d["Equipment Tag(To)"])   === base);
    const toRows   = powerData.filter(d => getBaseName(d["Equipment Tag(From)"]) === base);
    const fromTags = [...new Set(fromRows.map(d => getBaseName(d["Equipment Tag(From)"])))]
        .filter(t => t && t !== base && !nodeMap[t])
        .filter(t => showSpare || !/spare/i.test(t));
    const toTags   = [...new Set(toRows.map(d => getBaseName(d["Equipment Tag(To)"])))]
        .filter(t => t && t !== base && !nodeMap[t])
        .filter(t => showSpare || !/spare/i.test(t));

    const mutualSet = new Set(fromTags.filter(t => toTags.includes(t)));
    const onlyFrom  = fromTags.filter(t => !mutualSet.has(t));
    const mutuals   = [...mutualSet];
    const STEP = Math.max(...[base, ...fromTags].map(nodeWidth)) + H_GAP;

    // 초기 표시: 공급원(from) + 상호 노드만. 부하(to)는 클릭으로 확장.
    nodeMap[base] = { x: cx, y: cy, type: "center", w: nodeWidth(base), expanded: false };
    mutuals.forEach((t, i) => {
        nodeMap[t] = { x: cx + (i+1)*STEP, y: cy, type: "mutual", w: nodeWidth(t), expanded: false };
    });
    onlyFrom.forEach((t, i) => {
        const total = onlyFrom.length;
        nodeMap[t] = { x: cx + (i-(total-1)/2)*STEP, y: cy - V_GAP, type: "from", w: nodeWidth(t), expanded: false };
    });
    _collectEdges(fromRows, base);

    const svg = d3.select("#tree-svg");
    const cur = svgZoom ? d3.zoomTransform(svg.node()) : null;
    renderTree(cur);
}

function addTagToTree(tag) {
    addTagsBatch([tag]);
}

// ── 특정 노드를 화면 중앙으로 포커스 (현재 줌 레벨 유지 + 강조) ──
function focusNode(tag) {
    const node = nodeMap[tag];
    if (!node || !svgZoom) return;
    const svg = d3.select("#tree-svg");
    const c   = document.getElementById("canvas-container");
    const cW  = c.clientWidth  || 800;
    const cH  = c.clientHeight || 600;
    const cur = d3.zoomTransform(svg.node());
    // 너무 축소돼 있으면 적당히 확대, 아니면 현재 배율 유지
    const k   = Math.max(cur.k || 1, 0.7);
    const tx  = cW / 2 - k * node.x;
    const ty  = cH / 2 - k * node.y;
    svg.transition().duration(450)
        .call(svgZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));

    // 포커스 노드 강조
    d3.selectAll(".node").classed("node-selected", false);
    d3.selectAll(".node").filter(function () {
        return d3.select(this).attr("data-tag") === tag;
    }).classed("node-selected", true);
}

// ── 11c. 선택장비 지정 (기존 노드 유지, tgt + 타입만 변경) ──────
function setAsCenter(tag) {
    if (!nodeMap[tag]) return;

    // 이전 center → from 타입으로 DOM 직접 변경 (re-render 없이)
    if (tgt && nodeMap[tgt] && tgt !== tag) {
        nodeMap[tgt].type = "from";
        d3.selectAll(".node")
            .filter(function() { return d3.select(this).attr("data-tag") === tgt; })
            .attr("class", "node node-from");
    }

    // 새 center 지정
    tgt = tag;
    nodeMap[tag].type = "center";
    d3.selectAll(".node")
        .filter(function() { return d3.select(this).attr("data-tag") === tag; })
        .attr("class", "node node-center");
    // expandNode는 더블클릭/더블탭에서만 호출 (단일 클릭 시 확장 안 함)
}

// ── 12. 자동 레이아웃 (계층형 - 다중 공급원 중앙 배치) ────────────
function autoLayout() {
    const tags = Object.keys(nodeMap);
    if (!tags.length) return;

    const containerW = document.getElementById("canvas-container").clientWidth || 800;
    const cellW      = Math.max(...tags.map(nodeWidth)) + H_GAP;
    const LEVEL_H    = NODE_H + V_GAP;
    const COMP_GAP   = cellW * 1.5;

    // 방향 그래프 구축
    const ch = {}, pa = {};
    tags.forEach(t => { ch[t] = []; pa[t] = []; });
    edgeList.forEach(({ fromTag: f, toTag: t }) => {
        if (nodeMap[f] && nodeMap[t] && !ch[f].includes(t)) {
            ch[f].push(t);
            pa[t].push(f);
        }
    });

    // 무방향 BFS로 연결 컴포넌트 탐색
    const seenComp = new Set();
    const components = [];
    tags.forEach(start => {
        if (seenComp.has(start)) return;
        const comp = [], q = [start];
        while (q.length) {
            const n = q.shift();
            if (seenComp.has(n)) continue;
            seenComp.add(n); comp.push(n);
            [...ch[n], ...pa[n]].forEach(x => { if (!seenComp.has(x)) q.push(x); });
        }
        components.push(comp);
    });

    let globalX = 0;

    components.forEach(comp => {
        // 루트 노드 탐색 (컴포넌트 내 부모 없는 노드)
        const roots = comp.filter(t => !pa[t].some(p => comp.includes(p)));
        const startNodes = roots.length ? roots : [comp[0]];

        // BFS 레벨 할당 (여러 경로가 있으면 더 깊은 레벨 우선)
        const lv = {};
        startNodes.forEach(r => { lv[r] = 0; });
        const bfsQ = [...startNodes];
        const visited = new Set(startNodes);
        while (bfsQ.length) {
            const n = bfsQ.shift();
            ch[n].filter(c => comp.includes(c)).forEach(c => {
                const nl = lv[n] + 1;
                if (!visited.has(c)) { visited.add(c); lv[c] = nl; bfsQ.push(c); }
                else if (nl > lv[c])  { lv[c] = nl; bfsQ.push(c); }  // 레벨 상향 시 자식에게 재전파
            });
        }
        comp.filter(t => lv[t] === undefined).forEach(t => { lv[t] = 0; });

        const maxLv = Math.max(...comp.map(t => lv[t]));
        const byLv  = Array.from({ length: maxLv + 1 }, () => []);
        comp.forEach(t => byLv[lv[t]].push(t));

        // ── 공유 자식 판별 헬퍼 ─────────────────────────────────────
        // 직접 부모가 2명 이상인 노드 = 공유 자식 (이중급전 패널 등)
        const numDirPars = c =>
            (pa[c] || []).filter(p => comp.includes(p) && lv[p] === lv[c] - 1).length;

        // 레벨별 Y 시작 위치 (colCount 행 수 반영, 단독 부모 자식 기준)
        const levelY = [0];
        for (let l = 1; l <= maxLv; l++) {
            let maxRows = 1;
            byLv[l - 1].forEach(pTag => {
                // 단독 부모 자식만 행 수 계산 (공유 자식은 Phase 3b에서 별도 배치)
                const kids = ch[pTag].filter(c => comp.includes(c) && lv[c] === l && numDirPars(c) === 1);
                if (kids.length) maxRows = Math.max(maxRows, Math.ceil(kids.length / colCount));
            });
            levelY.push(levelY[l - 1] + (maxRows - 1) * (NODE_H + V_GAP * 0.6) + LEVEL_H);
        }

        // ── Phase 1: 서브트리 너비 계산 (하→상) ────────────────────
        // 단독 부모 자식: full stW 반영 (Phase 3에서 이 부모 아래에 직접 배치)
        // 공유 자식(직접 부모 N명): stW/N 반영 (부모 간격이 공유 자식 너비에 비례하도록)
        //   → Phase 3b에서 공유 자식은 부모 평균 위치에 별도 배치하므로 침투 없음
        const stW = {};
        for (let l = maxLv; l >= 0; l--) {
            byLv[l].forEach(t => {
                const kids = ch[t].filter(c => comp.includes(c) && lv[c] === lv[t] + 1);
                if (!kids.length) { stW[t] = cellW; return; }
                let maxW = 0;
                for (let r = 0, n = kids.length; r < Math.ceil(n / colCount); r++) {
                    const row = kids.slice(r * colCount, (r + 1) * colCount);
                    const rw = row.reduce((s, k) => {
                        const N = numDirPars(k);
                        return s + (stW[k] || cellW) / Math.max(1, N);
                    }, 0) + (row.length - 1) * H_GAP;
                    if (rw > maxW) maxW = rw;
                }
                stW[t] = Math.max(cellW, maxW);
            });
        }

        // ── Phase 2: 루트 노드 배치 ───────────────────────────────
        byLv[0].sort((a, b) => a.localeCompare(b));
        let rx = 0;
        byLv[0].forEach(t => {
            nodeMap[t].x = rx + stW[t] / 2;
            nodeMap[t].y = 0;
            rx += stW[t] + H_GAP;
        });

        // ── Phase 3: 하향 배치 (서브트리 너비 기반, 항상 부모 바로 아래) ──
        // placed: 이미 배치된 자식 → 복수 부모의 중복 배치 방지
        // placedBy: 어느 부모가 배치했는지 기록 → Phase 4 부모 재중앙 시 사용
        const placed   = new Set();
        const placedBy = {};

        for (let l = 0; l < maxLv; l++) {
            // 같은 레벨 내 왼→오른 순서로 처리 → 왼쪽 부모가 공유 자식 선점
            byLv[l].sort((a, b) => (nodeMap[a]?.x || 0) - (nodeMap[b]?.x || 0));

            byLv[l].forEach(t => {
                // 소유한 자식만 이 부모가 배치 (공유 자식은 owner 부모 한 곳에서만)
                // 단독 부모(직접 부모 1명)인 자식만 여기서 배치
                // 공유 자식(직접 부모 ≥2)은 Phase 3b에서 부모 평균 위치에 별도 배치
                let kids = ch[t].filter(c => comp.includes(c) && lv[c] === lv[t] + 1
                                              && numDirPars(c) === 1 && !placed.has(c));
                if (!kids.length) return;

                // 선 교차 최소화 (barycenter 휴리스틱):
                // 이미 배치된 다른 부모의 X 기준으로 자식 정렬
                // 당기는 강도 30% 제한 → 자식이 너무 멀리 산개하지 않도록
                kids = kids.slice().sort((a, b) => {
                    const bc = k => {
                        const others = pa[k].filter(
                            p => p !== t && comp.includes(p) && nodeMap[p]);
                        if (!others.length) return nodeMap[t].x;
                        const avgOther = others.reduce((s, p) => s + nodeMap[p].x, 0) / others.length;
                        return nodeMap[t].x + (avgOther - nodeMap[t].x) * 0.3;
                    };
                    return bc(a) - bc(b);
                });

                // 같은 레벨에서 직접 연결된 형제, 또는 공통 자식(lv+1)을 가진 형제는 인접하게 그룹화
                // → EBC-62770과 EBC-62780이 EDB-62770을 공통 자식으로 가지면 옆에 배치
                {
                    const kSet = new Set(kids);
                    const grouped = [], added = new Set();

                    // k의 인접 형제: 동레벨 직접 연결 + 공통 자식을 가진 형제
                    const adjacentOf = k => {
                        const peers = new Set();
                        [...ch[k], ...pa[k]]
                            .filter(n => kSet.has(n) && lv[n] === lv[k])
                            .forEach(n => peers.add(n));
                        ch[k]
                            .filter(c => comp.includes(c) && lv[c] === lv[k] + 1)
                            .forEach(c => {
                                pa[c].filter(p => kSet.has(p) && p !== k).forEach(p => peers.add(p));
                            });
                        return [...peers];
                    };

                    kids.forEach(k => {
                        if (added.has(k)) return;
                        // BFS로 전이적 그룹 확장
                        const queue = [k];
                        while (queue.length) {
                            const node = queue.shift();
                            if (added.has(node)) continue;
                            grouped.push(node); added.add(node);
                            adjacentOf(node).filter(n => !added.has(n)).forEach(n => queue.push(n));
                        }
                    });
                    kids = grouped;
                }

                // colCount 기준으로 자식을 행 분할하여 배치
                const rows = Math.ceil(kids.length / colCount);
                for (let r = 0; r < rows; r++) {
                    const row = kids.slice(r * colCount, (r + 1) * colCount);
                    const rw  = row.reduce((s, k) => s + (stW[k] || cellW), 0)
                              + (row.length - 1) * H_GAP;
                    let cx = nodeMap[t].x - rw / 2;
                    row.forEach(k => {
                        const kw = stW[k] || cellW;
                        nodeMap[k].x = cx + kw / 2;
                        nodeMap[k].y = levelY[lv[k]] + r * (NODE_H + V_GAP * 0.6);
                        cx += kw + H_GAP;
                    });
                }
                kids.forEach(k => { placed.add(k); placedBy[k] = t; });
            });

            // ── Phase 3b: 공유 자식 배치 ──────────────────────────────
            // 직접 부모가 여럿인 노드는 위 Phase 3에서 건너뛰었으므로 여기서 배치.
            // 같은 부모 세트를 공유하는 노드를 그룹으로 묶어 부모 평균 x에 나란히 배치.
            {
                const sg = new Map();
                byLv[l + 1].forEach(t => {
                    if (placed.has(t)) return;
                    const dPars = pa[t].filter(p => comp.includes(p) && lv[p] === lv[t] - 1 && nodeMap[p]);
                    if (dPars.length <= 1) return;
                    const key = dPars.slice().sort().join('\0');
                    if (!sg.has(key)) sg.set(key, { pars: dPars, nodes: [] });
                    sg.get(key).nodes.push(t);
                });
                sg.forEach(({ pars, nodes: gn }) => {
                    const centerX = pars.reduce((s, p) => s + nodeMap[p].x, 0) / pars.length;
                    const centerY = levelY[lv[gn[0]]];
                    const totalW  = gn.reduce((s, n) => s + (stW[n] || cellW), 0) + (gn.length - 1) * H_GAP;
                    let cx = centerX - totalW / 2;
                    gn.forEach(n => {
                        const nw = stW[n] || cellW;
                        nodeMap[n].x = cx + nw / 2;
                        nodeMap[n].y = centerY;
                        cx += nw + H_GAP;
                        placed.add(n);
                        placedBy[n] = pars[0];
                    });
                });
            }
        }

        // ── Phase 4: 상향 패스 (겹침 해소 → 부모 재중앙) ─────────────
        // 같은 Y(행)끼리만 겹침 해소 — 그리드 row가 달라 Y가 다른 노드는
        // X가 같아도 겹침이 아니므로 구분하여 처리
        // ※ shiftSubtree: 공유 자식(직접 부모 ≥2)은 이동 제외 → 이중 이동 방지
        //   이후 recenterShared 로 부모 평균 위치로 재보정
        const resolveByRow = group => {
            const byY = new Map();
            group.forEach(t => {
                const key = Math.round(nodeMap[t].y);
                if (!byY.has(key)) byY.set(key, []);
                byY.get(key).push(t);
            });
            byY.forEach(row => {
                if (row.length <= 1) return;
                row.sort((a, b) => nodeMap[a].x - nodeMap[b].x);

                const shiftSubtree = (root, delta) => {
                    const q = [root];
                    const seen = new Set([root]);
                    while (q.length) {
                        const n = q.shift();
                        nodeMap[n].x += delta;
                        (ch[n] || []).forEach(c => {
                            if (seen.has(c) || !nodeMap[c]) return;
                            // 공유 자식(직접 부모 ≥2)은 subtree 이동에서 제외 (이중 이동 방지)
                            const numDirPars = (pa[c] || []).filter(p => comp.includes(p) && lv[p] === lv[c] - 1).length;
                            if (numDirPars <= 1) { seen.add(c); q.push(c); }
                        });
                    }
                };

                for (let i = 1; i < row.length; i++) {
                    const minDist = ((stW[row[i - 1]] || cellW) + (stW[row[i]] || cellW)) / 2;
                    const delta = nodeMap[row[i - 1]].x + minDist - nodeMap[row[i]].x;
                    if (delta > 0) shiftSubtree(row[i], delta);
                }
                for (let i = row.length - 2; i >= 0; i--) {
                    const minDist = ((stW[row[i + 1]] || cellW) + (stW[row[i]] || cellW)) / 2;
                    const delta = nodeMap[row[i + 1]].x - minDist - nodeMap[row[i]].x;
                    if (delta < 0) shiftSubtree(row[i], delta);
                }
            });
        };

        // 공유 자식을 직접 부모들의 평균 x로 재보정
        // 같은 부모 세트를 공유하는 자식이 여럿이면 "그룹 전체를 강체 이동" 하여
        // 개별 이동 시 모두 동일 좌표로 충돌하는 현상을 방지.
        // 이동 시 소유 서브트리도 동반 이동 → 부모-자식 연결선이 어긋나지 않음.
        const recenterShared = level => {
            const groups = new Map();
            (byLv[level] || []).forEach(t => {
                const dPars = (pa[t] || []).filter(p => comp.includes(p) && lv[p] === lv[t] - 1 && nodeMap[p]);
                if (dPars.length <= 1) return;
                const key = dPars.slice().sort().join('\0');
                if (!groups.has(key)) groups.set(key, { pars: dPars, nodes: [] });
                groups.get(key).nodes.push(t);
            });
            groups.forEach(({ pars, nodes: gn }) => {
                const targetX = pars.reduce((s, p) => s + nodeMap[p].x, 0) / pars.length;
                const gc      = gn.reduce((s, n) => s + nodeMap[n].x, 0) / gn.length;
                let delta     = targetX - gc;
                if (Math.abs(delta) < 0.5) return;
                // 인접 노드 방향으로 밀어넣지 않도록 이동량 제한 (oscillation 방지)
                const gnSet      = new Set(gn);
                const groupHalfW = (gn.reduce((s, n) => s + (stW[n] || cellW), 0) + (gn.length - 1) * H_GAP) / 2;
                (byLv[level] || []).forEach(t => {
                    if (gnSet.has(t) || !nodeMap[t]) return;
                    const tHalfW = (stW[t] || cellW) / 2;
                    if (nodeMap[t].x < gc) {
                        // 왼쪽 이웃 → 왼쪽(음수) 이동 제한
                        const minCenter = nodeMap[t].x + tHalfW + groupHalfW;
                        if (delta < 0) delta = Math.max(delta, minCenter - gc);
                    } else {
                        // 오른쪽 이웃 → 오른쪽(양수) 이동 제한
                        const maxCenter = nodeMap[t].x - tHalfW - groupHalfW;
                        if (delta > 0) delta = Math.min(delta, maxCenter - gc);
                    }
                });
                if (Math.abs(delta) < 0.5) return;
                gn.forEach(n => {
                    nodeMap[n].x += delta;
                    // 단독 부모 서브트리 동반 이동
                    const q = ch[n].filter(c => comp.includes(c) && numDirPars(c) === 1);
                    const seen = new Set(q);
                    while (q.length) {
                        const c = q.shift();
                        nodeMap[c].x += delta;
                        ch[c].filter(x => comp.includes(x) && numDirPars(x) === 1 && !seen.has(x))
                             .forEach(x => { seen.add(x); q.push(x); });
                    }
                });
            });
        };

        for (let l = maxLv - 1; l >= 0; l--) {
            resolveByRow(byLv[l + 1]);
            byLv[l].forEach(t => {
                // 직접 배치한 자식만으로 부모 재중앙 계산
                // 이 부모가 직접 배치한 자식 중, 직접 부모가 자신 하나뿐인 단독 자식만 사용
                // 다중 부모 자식(EBC-62770, EBC-62780 둘 다 EDB의 부모인 경우)은 제외
                // → 재중앙 계산으로 인해 부모가 공유 자식 위치로 끌려가 형제와 분리되는 현상 방지
                const kids = ch[t].filter(c => {
                    if (!comp.includes(c) || lv[c] !== lv[t] + 1 || placedBy[c] !== t) return false;
                    const directPars = pa[c].filter(p => comp.includes(p) && lv[p] === lv[c] - 1);
                    return directPars.length === 1; // 단독 부모인 자식만
                });
                if (!kids.length) return;
                const left  = Math.min(...kids.map(c => nodeMap[c].x - (stW[c] || cellW) / 2));
                const right = Math.max(...kids.map(c => nodeMap[c].x + (stW[c] || cellW) / 2));
                nodeMap[t].x = (left + right) / 2;
            });
            resolveByRow(byLv[l]);
            recenterShared(l + 1); // 부모 이동 후 공유 자식 위치를 부모 평균으로 재보정
        }

        // ── 안정화 패스: 탑다운 → 바텀업 추가 실행 (잔여 파고들기 제거) ──
        // Phase 4 바텀업 패스가 상위 이동을 하위에 미반영하는 경우 보정
        const recenterExclusive = l => {
            byLv[l].forEach(t => {
                const kids = ch[t].filter(c => {
                    if (!comp.includes(c) || lv[c] !== lv[t] + 1 || placedBy[c] !== t) return false;
                    return (pa[c] || []).filter(p => comp.includes(p) && lv[p] === lv[c] - 1).length === 1;
                });
                if (!kids.length) return;
                const left  = Math.min(...kids.map(c => nodeMap[c].x - (stW[c] || cellW) / 2));
                const right = Math.max(...kids.map(c => nodeMap[c].x + (stW[c] || cellW) / 2));
                nodeMap[t].x = (left + right) / 2;
            });
        };
        // 탑다운: 루트부터 겹침 해소 전파
        for (let l = 0; l <= maxLv; l++) {
            resolveByRow(byLv[l]);
            recenterShared(l);
        }
        // 바텀업: 하위 확정 후 부모 재중앙 + 겹침 재해소
        for (let l = maxLv - 1; l >= 0; l--) {
            resolveByRow(byLv[l + 1]);
            recenterExclusive(l);
            resolveByRow(byLv[l]);
            recenterShared(l + 1);
        }
        // 안정화 (3회): recenterShared 클램핑으로 oscillation 억제 후 수렴
        for (let pass = 0; pass < 3; pass++) {
            for (let l = 0; l <= maxLv; l++) {
                resolveByRow(byLv[l]);
                recenterShared(l);
            }
            for (let l = maxLv - 1; l >= 0; l--) {
                resolveByRow(byLv[l + 1]);
                recenterExclusive(l);
                resolveByRow(byLv[l]);
                recenterShared(l + 1);
            }
        }
        // 최종 정리: 마지막 recenterShared 이후 잔여 겹침 제거
        for (let l = 0; l <= maxLv; l++) {
            resolveByRow(byLv[l]);
        }

        // 컴포넌트를 globalX 기준으로 이동
        const minX = Math.min(...comp.map(t => nodeMap[t].x - nodeMap[t].w / 2));
        const shift = globalX - minX;
        comp.forEach(t => { nodeMap[t].x += shift; });
        const maxX = Math.max(...comp.map(t => nodeMap[t].x + nodeMap[t].w / 2));
        globalX = maxX + COMP_GAP;
    });

    // 전체 캔버스 수평 중앙 정렬 + 상단 여백
    const allX    = tags.flatMap(t => [nodeMap[t].x - nodeMap[t].w / 2, nodeMap[t].x + nodeMap[t].w / 2]);
    const offsetX = containerW / 2 - (Math.min(...allX) + Math.max(...allX)) / 2;
    tags.forEach(t => { nodeMap[t].x += offsetX; nodeMap[t].y += 80; });

    renderTree(null);
}


// ── 13. 트리 초기화 ──────────────────────────────────────────
function resetTree() {
    nodeMap  = {};
    edgeList = [];
    tgt      = "";
    svgZoom  = null;
    d3.select("#tree-svg").selectAll("*").remove();
    const hint = document.getElementById("hint");
    if (hint) hint.classList.remove("hidden");
    closeNodeModal();
    // 검색창 초기화 + 사이드바 열기
    const si = document.getElementById("searchInput");
    if (si) si.value = "";
    const rl = document.getElementById("resultList");
    if (rl) rl.innerHTML = "";
    if (typeof selectedTags !== "undefined") selectedTags.clear();
    const sb = document.getElementById("sidebar");
    if (sb) sb.classList.remove("collapsed");
}

// ── 10. 노드 정보 툴팁 ───────────────────────────────────────
// 노드 DOM 요소의 실제 화면 좌표 기반으로 툴팁 배치 (줌/패닝 무관)
function _positionTooltip(tag) {
    const el = document.getElementById("node-tooltip");
    if (!el || !nodeMap[tag]) return;

    // 실제 DOM 요소 위치 사용 (zoom/transform 자동 반영)
    const nodeEl = d3.selectAll("g.node").filter(function () {
        return d3.select(this).attr("data-tag") === tag;
    }).node();

    let screenX, nodeBottom, nodeTop;
    if (nodeEl) {
        const r = nodeEl.getBoundingClientRect();
        screenX    = r.left + r.width / 2;
        nodeBottom = r.bottom;
        nodeTop    = r.top;
    } else {
        const svgEl = document.getElementById("tree-svg");
        const rect  = svgEl.getBoundingClientRect();
        const tr    = svgZoom ? d3.zoomTransform(svgEl) : d3.zoomIdentity;
        const node  = nodeMap[tag];
        screenX    = rect.left + tr.applyX(node.x);
        nodeBottom = rect.top  + tr.applyY(node.y + NODE_H / 2 + 2);
        nodeTop    = nodeBottom - NODE_H * (tr.k || 1);
    }

    const W  = window.innerWidth, H = window.innerHeight;

    // 화면 크기 기반 max-width/max-height 동적 적용 (모바일 대응)
    el.style.maxWidth  = Math.min(320, W - 16) + "px";
    el.style.maxHeight = Math.min(Math.floor(H * 0.65), H - 32) + "px";

    const tw = el.offsetWidth  || 260;
    const th = el.offsetHeight || 120;

    let x = screenX - tw / 2;
    let y = nodeBottom + 6;

    // 아래 공간 부족 → 노드 위쪽에 배치
    if (y + th > H - 8) y = nodeTop - th - 6;
    // 위로 넘침 보정
    if (y < 8) y = 8;
    // 좌우 보정
    if (x + tw > W - 8) x = W - tw - 8;
    if (x < 8) x = 8;

    el.style.left = x + "px";
    el.style.top  = y + "px";
}

// 툴팁 hover 유지 (초기화 1회)
document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("node-tooltip");
    if (!el) return;
    el.addEventListener("mouseenter", () => {
        if (_tooltipHideTimer) { clearTimeout(_tooltipHideTimer); _tooltipHideTimer = null; }
    });
    el.addEventListener("mouseleave", () => { closeNodeModal(); });

    // 툴팁 바깥 클릭/터치 시 닫기
    document.addEventListener("pointerdown", (e) => {
        if (el.style.display === "none") return;
        if (!el.contains(e.target)) closeNodeModal();
    });

    // PC: Delete 키로 마지막 선택 노드 삭제
    if (_hasHover) {
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Delete") return;
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;
            if (_lastSelectedTag) deleteNode(_lastSelectedTag);
        });
    }
});

function showNodeInfo(tag) {
    const node = nodeMap[tag];
    if (!node) return;
    _lastSelectedTag = tag;

    // 이 장비가 To(수전)일 때의 행만 수집
    const toRows = powerData.filter(d => getBaseName(d["Equipment Tag(To)"]) === tag);

    // 설명: To쪽 정보만 (장치가 To일 때의 Description(To))
    let desc = "";
    for (const r of toRows) {
        if (r["Description(To)"]) { desc = r["Description(To)"]; break; }
        if (r["Description"])     { desc = r["Description"];     break; }
    }

    // 위치: To쪽 Location(To) 또는 location/위치 포함 컬럼
    let location = "";
    for (const r of toRows) {
        if (r["Location(To)"]) { location = r["Location(To)"]; break; }
    }
    if (!location && toRows.length > 0) {
        const locKey = Object.keys(toRows[0]).find(k => /location|위치/i.test(k));
        if (locKey) {
            for (const r of toRows) { if (r[locKey]) { location = r[locKey]; break; } }
        }
    }

    // 화면에 표시된 공급원이 있는 행만 (공급원 노드가 nodeMap에 있어야 함)
    const incomingRows = toRows.filter(r =>
        nodeMap[getBaseName(r["Equipment Tag(From)"])]
    );

    // 공급원: 원본 Equipment Tag(From) 포함 (EDB -XXX 세자리 유지)
    const sourceList = [...new Set(incomingRows.map(r => r["Equipment Tag(From)"]).filter(Boolean))];

    // 상단 CKT: 공급원 측 회로 번호 (CKT(From))
    const upstreamCkt = [...new Set(incomingRows.map(r => r["CKT(From)"]).filter(Boolean))];

    // 자기 CKT: 이 노드의 수전 회로 번호 (CKT(To))
    const ownCkt = [...new Set(incomingRows.map(r => r["CKT(To)"]).filter(Boolean))];

    // EDB 회로 목록: 자신이 From일 때 -XXX 세자리 번호
    let edbSuffixes = [];
    if (/EDB/i.test(tag)) {
        edbSuffixes = [...new Set(
            powerData
                .map(d => d["Equipment Tag(From)"])
                .filter(f => f && getBaseName(f) === tag)
                .map(f => getEdbSuffix(f))
                .filter(Boolean)
        )].sort();
    }

    const row     = (label, val) => val ? `<tr><th>${label}</th><td>${val}</td></tr>` : "";
    const listRow = (label, arr) => arr.length
        ? `<tr><th>${label}</th><td>${arr.join("<br>")}</td></tr>` : "";

    document.getElementById("modal-tag").textContent = tag;
    document.getElementById("modal-body").innerHTML = `
        <table class="info-table">
          <tbody>
            ${row("설명", desc)}
            ${row("위치", location)}
            ${listRow("공급원", sourceList)}
            ${listRow("상단 CKT", upstreamCkt)}
            ${listRow("자기 CKT", ownCkt)}
            ${edbSuffixes.length ? `<tr><th>회로</th><td>${edbSuffixes.join(", ")}</td></tr>` : ""}
          </tbody>
        </table>`;

    // 선택 강조
    d3.selectAll(".node").classed("node-selected", false);
    d3.selectAll(".node").filter(function () {
        return d3.select(this).attr("data-tag") === tag;
    }).classed("node-selected", true);

    const el = document.getElementById("node-tooltip");
    el.style.left    = "-9999px"; // 렌더 전 화면 밖에서 크기 계산
    el.style.display = "block";
    requestAnimationFrame(() => _positionTooltip(tag));
}

// ── 뷰 저장/불러오기 ─────────────────────────────────────────────
let _savedViews = [];

async function saveCurrentView() {
    if (Object.keys(nodeMap).length === 0) {
        alert("저장할 트리가 없습니다.");
        return;
    }
    const name = prompt("저장 이름을 입력하세요:", `저장_${new Date().toLocaleDateString('ko-KR')}`);
    if (!name) return;

    const svgEl = document.getElementById("tree-svg");
    const tr    = svgZoom ? d3.zoomTransform(svgEl) : null;
    const state = {
        nodeMap:   nodeMap,
        edgeList:  edgeList,
        colCount:  colCount,
        tgt:       tgt,
        transform: tr ? { k: tr.k, x: tr.x, y: tr.y } : null
    };

    showStatus("💾 저장 중...", "loading");
    try {
        await fetch(GAS_URL, {
            method:  "POST",
            mode:    "no-cors",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body:    JSON.stringify({ action: "save", name, data: JSON.stringify(state) }),
            redirect: "follow"
        });
        showStatus(`✅ "${name}" 저장 완료`, "success");
        setTimeout(hideStatus, 3000);
    } catch (err) {
        showStatus("❌ 저장 실패: " + err.message, "error");
    }
}

async function loadSavedViews() {
    showStatus("⚡ 목록 로딩 중...", "loading");
    try {
        const res = await fetch(GAS_URL + "?action=loadViews", { redirect: "follow" });
        _savedViews = await res.json();
        hideStatus();
        _showViewModal();
    } catch (err) {
        showStatus("❌ 불러오기 실패: " + err.message, "error");
    }
}

function _showViewModal() {
    const modal = document.getElementById("view-modal");
    const list  = document.getElementById("view-modal-list");
    if (!modal || !list) return;

    if (!_savedViews.length) {
        list.innerHTML = '<li class="view-empty">저장된 화면이 없습니다</li>';
    } else {
        list.innerHTML = _savedViews.map((v, i) => `
            <li class="view-item" data-idx="${i}">
                <div class="view-info">
                    <span class="view-name">${esc(v.name)}</span>
                    <span class="view-time">${_fmtTime(v.timestamp)}</span>
                </div>
                <button class="view-del" data-idx="${i}">🗑</button>
            </li>`).join("");

        list.querySelectorAll(".view-info").forEach(el => {
            el.addEventListener("click", () => restoreView(_savedViews[+el.closest("li").dataset.idx].data));
        });
        list.querySelectorAll(".view-del").forEach(el => {
            el.addEventListener("click", () => deleteSavedView(+el.dataset.idx, el.closest("li")));
        });
    }
    modal.style.display = "flex";
}

function closeViewModal() {
    const modal = document.getElementById("view-modal");
    if (modal) modal.style.display = "none";
}

function restoreView(dataJson) {
    try {
        const state = JSON.parse(dataJson);
        nodeMap  = state.nodeMap  || {};
        edgeList = state.edgeList || [];
        colCount = state.colCount || 4;
        tgt      = state.tgt      || "";
        document.getElementById("col-count").textContent = colCount;
        const hint = document.getElementById("hint");
        if (hint) hint.classList.add("hidden");
        const tr = state.transform;
        const preserved = tr ? d3.zoomIdentity.translate(tr.x, tr.y).scale(tr.k) : null;
        closeViewModal();
        renderTree(preserved);
    } catch (err) {
        alert("복원 실패: " + err.message);
    }
}

async function deleteSavedView(idx, liEl) {
    const view = _savedViews[idx];
    if (!view || !confirm(`"${view.name}" 을 삭제할까요?`)) return;
    liEl.remove();
    _savedViews.splice(idx, 1);
    try {
        await fetch(GAS_URL, {
            method:  "POST",
            mode:    "no-cors",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body:    JSON.stringify({ action: "delete", name: view.name }),
            redirect: "follow"
        });
    } catch (err) { /* 무시 — UI에서는 이미 제거됨 */ }
}

function _fmtTime(ts) {
    if (!ts) return "";
    try {
        return new Date(ts).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch { return ts; }
}

function closeNodeModal() {
    const el = document.getElementById("node-tooltip");
    if (el) el.style.display = "none";
    d3.selectAll(".node").classed("node-selected", false);
}
