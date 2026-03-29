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

// ── 모바일 탭/롱프레스 전역 상태 ───────────────────────────────
let _mobilePressTimer   = null;
let _mobileLongFired    = false;
let _mobileLastTapTag   = null;
let _mobileLastTapTime  = 0;

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
    const mutualTags   = [...mutualSet];

    const allTags = [tgt, ...fromTags, ...mutualTags];
    const STEP = Math.max(...allTags.map(nodeWidth)) + H_GAP;

    // 초기 표시: 공급원(from) + 상호 노드만. 부하(to)는 더블클릭으로 확장.
    nodeMap[tgt] = { x: cx, y: cy, type: "center", w: nodeWidth(tgt), expanded: false };

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

    // 부하(to) 노드는 초기에 배치하지 않음 → 더블클릭 시 expandNode로 표시
    _collectEdges(fromRows, tgt);
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
function _dragStart() {
    _dragging = false;
    d3.select(this).raise().classed("active", true);

    if (!_hasHover) {
        // 모바일: 롱프레스 타이머 시작
        const tag = d3.select(this).attr("data-tag");
        _mobileLongFired = false;
        if (_mobilePressTimer) clearTimeout(_mobilePressTimer);
        _mobilePressTimer = setTimeout(() => {
            _mobileLongFired = true;
            _mobilePressTimer = null;
            setAsCenter(tag); // 색상만 즉시 변경 (re-render 없음)
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
    if (_mobilePressTimer) { clearTimeout(_mobilePressTimer); _mobilePressTimer = null; }
    d3.select(this).classed("active", false);

    if (!_hasHover && !_dragging) {
        const tag = d3.select(this).attr("data-tag");
        if (_mobileLongFired) {
            // 롱프레스 종료 → 확장
            if (tag && nodeMap[tag] && !nodeMap[tag].expanded) expandNode(tag);
        } else if (tag) {
            // 탭 처리: 단일탭 → 툴팁, 더블탭 → 선택장비+확장
            const now = Date.now();
            if (tag === _mobileLastTapTag && now - _mobileLastTapTime < 350) {
                setAsCenter(tag);
                if (nodeMap[tag] && !nodeMap[tag].expanded) expandNode(tag);
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
            setAsCenter(tag);
            if (!nodeMap[tag].expanded) expandNode(tag);
        });
    }
    // 모바일: _dragStart/_drag/_dragEnd 에서 탭/더블탭/롱프레스 처리
}

// ── 9. 열 수 조절 ────────────────────────────────────────────
function changeColCount(delta) {
    const next = colCount + delta;
    if (next < 2) return;
    colCount = next;
    document.getElementById("col-count").textContent = colCount;
    if (tgt) drawTree(tgt);
}

// ── 11. 트리에 태그 일괄 추가 (6열 그리드 배치) ─────────────────
const BATCH_COLS = 6;

function addTagsBatch(tags) {
    const bases = tags.map(getBaseName).filter(b => b && !nodeMap[b]);
    if (bases.length === 0) return;

    // 단일 태그: 항상 full 트리로 (from/to 포함)
    if (bases.length === 1) {
        if (Object.keys(nodeMap).length === 0) {
            drawTree(bases[0]);
        } else {
            _addSingleWithConnections(bases[0]);
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
            if (t && t !== base && !nodeMap[t] && !allFromTags.includes(t)) {
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
        .filter(t => t && t !== base && !nodeMap[t]);
    const toTags   = [...new Set(toRows.map(d => getBaseName(d["Equipment Tag(To)"])))]
        .filter(t => t && t !== base && !nodeMap[t]);

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

// ── 12. 자동 레이아웃 (레벨별 짝수열 다단 그리드 배치) ──────────
function autoLayout() {
    const tags = Object.keys(nodeMap);
    if (tags.length === 0) return;

    const container  = document.getElementById("canvas-container");
    const containerW = container.clientWidth || 800;

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
    const seen = new Set();
    const components = [];
    tags.forEach(start => {
        if (seen.has(start)) return;
        const comp = [], q = [start];
        while (q.length) {
            const n = q.shift();
            if (seen.has(n)) continue;
            seen.add(n); comp.push(n);
            [...ch[n], ...pa[n]].forEach(x => { if (!seen.has(x)) q.push(x); });
        }
        components.push(comp);
    });

    const LEVEL_H  = NODE_H + V_GAP;
    const COMP_GAP = 80;   // 컴포넌트 간격
    let globalX    = 0;

    components.forEach(comp => {
        // 루트 노드 (컴포넌트 내 부모 없는 노드)
        const roots = comp.filter(t => !pa[t].some(p => comp.includes(p)));
        const startRoots = roots.length ? roots : [comp[0]];

        // BFS로 각 노드의 레벨 할당
        const level = {};
        const bfsQ  = [...startRoots];
        startRoots.forEach(r => { level[r] = 0; });
        const visited = new Set(startRoots);
        while (bfsQ.length) {
            const n = bfsQ.shift();
            ch[n].filter(c => comp.includes(c) && !visited.has(c)).forEach(c => {
                visited.add(c);
                level[c] = level[n] + 1;
                bfsQ.push(c);
            });
        }
        // 미방문 노드(사이클 등) → 레벨 0
        comp.filter(t => level[t] === undefined).forEach(t => { level[t] = 0; });

        // 레벨별 그룹화
        const maxLevel = Math.max(...comp.map(t => level[t]));
        const groups   = Array.from({ length: maxLevel + 1 }, () => []);
        comp.forEach(t => groups[level[t]].push(t));

        // 컴포넌트 격자 열 수: colCount(짝수) 기준, 최대 해당 레벨 노드 수
        const maxInLevel   = Math.max(...groups.map(g => g.length));
        const compCols     = Math.min(maxInLevel, colCount);
        const cellW        = Math.max(...comp.map(nodeWidth)) + H_GAP;
        const compWidth    = compCols * cellW;

        let yPos = 0;
        groups.forEach(grp => {
            const nCols = Math.min(grp.length, compCols);
            const nRows = Math.ceil(grp.length / nCols);

            grp.forEach((t, i) => {
                const row  = Math.floor(i / nCols);
                const col  = i % nCols;
                const nodesInRow = Math.min(grp.length - row * nCols, nCols);
                // 짧은 행은 컴포넌트 중앙 정렬
                const leftPad = (compWidth - nodesInRow * cellW) / 2;
                nodeMap[t].x = globalX + leftPad + col * cellW + cellW / 2;
                nodeMap[t].y = yPos + row * LEVEL_H;
            });

            yPos += nRows * LEVEL_H;
        });

        globalX += compWidth + COMP_GAP;
    });

    // 전체 캔버스 수평 중앙 정렬
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
});

function showNodeInfo(tag) {
    const node = nodeMap[tag];
    if (!node) return;

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

function closeNodeModal() {
    const el = document.getElementById("node-tooltip");
    if (el) el.style.display = "none";
    d3.selectAll(".node").classed("node-selected", false);
}
