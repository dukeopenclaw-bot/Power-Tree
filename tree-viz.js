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
let nodeMap   = {};
let edgeList  = [];
let tgt       = "";   // 베이스 태그 (EDB-001 → EDB)
let colCount  = 4;
let svgZoom   = null;
let _dragging = false;

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
        .filter(t => t && t !== tgt);
    const toTags   = [...new Set(toRows.map(d =>   getBaseName(d["Equipment Tag(To)"])))]
        .filter(t => t && t !== tgt);

    // 상호 공급 관계 분리 (fromTags ∩ toTags)
    const mutualSet    = new Set(fromTags.filter(t => toTags.includes(t)));
    const onlyFromTags = fromTags.filter(t => !mutualSet.has(t));
    const onlyToTags   = toTags.filter(t => !mutualSet.has(t));
    const mutualTags   = [...mutualSet];

    const allTags = [tgt, ...fromTags, ...toTags];
    const STEP = Math.max(...allTags.map(nodeWidth)) + H_GAP;

    nodeMap[tgt] = { x: cx, y: cy, type: "center", w: nodeWidth(tgt), expanded: true };

    // 상호 노드 → 수평 배치 (center 오른쪽)
    mutualTags.forEach((tag, i) => {
        nodeMap[tag] = {
            x: cx + (i + 1) * STEP,
            y: cy, type: "mutual", w: nodeWidth(tag), expanded: false
        };
    });

    onlyFromTags.forEach((tag, i) => {
        const total = onlyFromTags.length;
        nodeMap[tag] = {
            x: cx + (i - (total - 1) / 2) * STEP,
            y: cy - V_GAP, type: "from", w: nodeWidth(tag), expanded: false
        };
    });

    onlyToTags.forEach((tag, i) => {
        const row      = Math.floor(i / colCount);
        const col      = i % colCount;
        const rowCount = Math.min(onlyToTags.length - row * colCount, colCount);
        const startX   = cx - ((rowCount - 1) * STEP) / 2;
        nodeMap[tag] = {
            x: startX + col * STEP,
            y: cy + V_GAP + row * (NODE_H + V_GAP * 0.6),
            type: "to", w: nodeWidth(tag), expanded: false
        };
    });

    _collectEdges([...fromRows, ...toRows], tgt);
    renderTree(null);
}

// ── 2. 노드 확장 ──────────────────────────────────────────────
function expandNode(tag) {
    const node = nodeMap[tag];
    if (!node || node.expanded) return;
    node.expanded = true;

    const fromRows = powerData.filter(d => getBaseName(d["Equipment Tag(To)"])   === tag);
    const toRows   = powerData.filter(d => getBaseName(d["Equipment Tag(From)"]) === tag);

    const newFromTags = [...new Set(fromRows.map(d => getBaseName(d["Equipment Tag(From)"])))]
        .filter(t => t && t !== tag && !nodeMap[t]);
    const newToTags   = [...new Set(toRows.map(d => getBaseName(d["Equipment Tag(To)"])))]
        .filter(t => t && t !== tag && !nodeMap[t]);

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

    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10").attr("refX", 10).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
        .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#546e7a");

    const edgeLayer  = g.append("g").attr("class", "links");
    const labelLayer = g.append("g").attr("class", "labels");
    const nodeLayer  = g.append("g").attr("class", "nodes");

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
            .attr("class", `node node-${node.type}`)
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
    });

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

// ── 6. 드래그 ────────────────────────────────────────────────
function _dragStart() { _dragging = false; d3.select(this).raise().classed("active", true); }
function _drag(event) {
    _dragging = true;
    const tag  = d3.select(this).attr("data-tag");
    const node = nodeMap[tag];
    if (!node) return;
    node.x = event.x + node.w / 2;
    node.y = event.y + NODE_H / 2;
    d3.select(this).attr("transform", `translate(${event.x}, ${event.y})`);

    d3.selectAll(".link").each(function () {
        const l = d3.select(this);
        const fTag = l.attr("data-from"), tTag = l.attr("data-to");
        if (fTag === tag || tTag === tag)
            l.attr("d", _bezier(nodeMap[fTag], nodeMap[tTag]));
    });

    d3.selectAll(".edge-labels").each(function () {
        const lg = d3.select(this);
        const fTag = lg.attr("data-from"), tTag = lg.attr("data-to");
        if (fTag !== tag && tTag !== tag) return;
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
    d3.select(this).classed("active", false);
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

// ── 8. 인터랙션 ───────────────────────────────────────────────
function _setupInteractions(sel, tag) {
    let clickTimer = null;
    let pressTimer = null;
    let longFired  = false;

    sel.on("click.interact", (event) => {
        event.stopPropagation();
        if (_dragging) return;
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            expandNode(tag);
        } else {
            clickTimer = setTimeout(() => {
                clickTimer = null;
                showNodeInfo(tag);
            }, 260);
        }
    });

    sel.on("touchstart.interact", () => {
        longFired = false;
        pressTimer = setTimeout(() => {
            longFired = true;
            pressTimer = null;
            expandNode(tag);
        }, 600);
    })
    .on("touchend.interact", (event) => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        if (!longFired) {
            event.preventDefault();
            showNodeInfo(tag);
        }
        longFired = false;
    })
    .on("touchcancel.interact", () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        longFired = false;
    });
}

// ── 9. 열 수 조절 ────────────────────────────────────────────
function changeColCount(delta) {
    const next = colCount + delta;
    if (next < 2) return;
    colCount = next;
    document.getElementById("col-count").textContent = colCount;
    if (tgt) drawTree(tgt);
}

// ── 10. 노드 정보 팝업 ────────────────────────────────────────
function showNodeInfo(tag) {
    const node = nodeMap[tag];
    if (!node) return;

    // 해당 태그가 포함된 모든 행 수집
    const rows = powerData.filter(d =>
        getBaseName(d["Equipment Tag(From)"]) === tag ||
        getBaseName(d["Equipment Tag(To)"])   === tag
    );

    // Description 추출 (From 또는 To 쪽에서)
    let desc = "";
    for (const r of rows) {
        if (getBaseName(r["Equipment Tag(From)"]) === tag && r["Description(From)"]) {
            desc = r["Description(From)"]; break;
        }
        if (getBaseName(r["Equipment Tag(To)"]) === tag && r["Description(To)"]) {
            desc = r["Description(To)"]; break;
        }
        if (r["Description"]) { desc = r["Description"]; break; }
    }

    // 공급원 (From) 목록
    const fromList = [...new Set(
        rows.filter(r => getBaseName(r["Equipment Tag(To)"]) === tag)
            .map(r => r["Equipment Tag(From)"])
            .filter(Boolean)
    )];

    // 부하 (To) 목록
    const toList = [...new Set(
        rows.filter(r => getBaseName(r["Equipment Tag(From)"]) === tag)
            .map(r => r["Equipment Tag(To)"])
            .filter(Boolean)
    )];

    // CKT 목록 (중복 제거)
    const cktFromList = [...new Set(rows.map(r => r["CKT(From)"]).filter(Boolean))];
    const cktToList   = [...new Set(rows.map(r => r["CKT(To)"]).filter(Boolean))];

    // 위치 정보
    const pos = `X: ${Math.round(node.x)},  Y: ${Math.round(node.y)}`;

    // 추가 컬럼 키 수집 (위의 것 제외한 나머지)
    const knownKeys = new Set([
        "Equipment Tag(From)", "Equipment Tag(To)",
        "Description(From)", "Description(To)", "Description",
        "CKT(From)", "CKT(To)"
    ]);
    const extraKeys = rows.length > 0
        ? Object.keys(rows[0]).filter(k => !knownKeys.has(k))
        : [];
    const extraRows = [...new Set(
        rows.flatMap(r => extraKeys.map(k => r[k] ? `${k}: ${r[k]}` : "").filter(Boolean))
    )];

    // 모달 내용 구성
    const row = (label, val) => val
        ? `<tr><th>${label}</th><td>${val}</td></tr>` : "";
    const listRow = (label, arr) => arr.length
        ? `<tr><th>${label}</th><td>${arr.join("<br>")}</td></tr>` : "";

    document.getElementById("modal-tag").textContent = tag;
    document.getElementById("modal-body").innerHTML = `
        <table class="info-table">
          <tbody>
            ${row("설명", desc)}
            ${row("타입", node.type === "center" ? "선택 장비" :
                          node.type === "from"   ? "공급원" :
                          node.type === "mutual" ? "상호 공급" : "부하")}
            ${listRow("공급원 (From)", fromList)}
            ${listRow("CKT (From)", cktFromList)}
            ${listRow("부하 (To)", toList)}
            ${listRow("CKT (To)", cktToList)}
            ${extraRows.map(s => `<tr><td colspan="2" class="extra-row">${s}</td></tr>`).join("")}
            ${row("화면 좌표", pos)}
          </tbody>
        </table>`;

    // 선택 강조
    d3.selectAll(".node").classed("node-selected", false);
    d3.selectAll(".node").filter(function () {
        return d3.select(this).attr("data-tag") === tag;
    }).classed("node-selected", true);

    document.getElementById("node-modal").style.display = "flex";
}

function closeNodeModal() {
    document.getElementById("node-modal").style.display = "none";
    d3.selectAll(".node").classed("node-selected", false);
}
