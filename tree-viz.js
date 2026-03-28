// tree-viz.js 전체 내용을 이 코드로 교체하세요.

/**
 * tree-viz.js
 * 전기 파워트리 시각화 엔진 (겹침 방지 및 직각 배치 버전)
 */

// ── 레이아웃 및 환경 설정 ─────────────────────────────────────
const NODE_W = 160;      // 노드 너비 (글자가 안 가려지도록 확대)
const NODE_H = 50;       // 노드 높이
const H_GAP = 80;        // 노드 간 수평 간격 (확대)
const V_GAP = 200;       // 레벨 간 수직 간격 (확대, 선 공간 확보)
const ITEMS_PER_ROW = 2; // To 장비 한 행당 최대 개수 (짝수 열 → 가운데 선 겹침 방지)

let nodeMap = {};        // 현재 화면의 노드 좌표 저장
let labelVisible = {};   // CKT 라벨 표시 상태
let tgt = "";            // 현재 선택된 장비 태그
const edgeStyle = "bezier"; // 곡선 고정

// ── 1. 메인 그리기 함수 ───────────────────────────────────────
function drawTree(targetTag) {
    const svg = d3.select("#tree-svg");
    svg.selectAll("*").remove(); // 이전 트리 삭제

    // 안내 오버레이 숨김
    const hintDiv = document.getElementById("hint");
    if (hintDiv) hintDiv.classList.add("hidden");

    nodeMap = {};
    labelVisible = {};
    tgt = targetTag; // 전역 변수에 저장 (addEdges에서 사용)

    if (!tgt && powerData.length > 0) {
        // 초기 로드 시 데이터가 있으면 첫 번째 장비로 임시 설정 (테스트용)
        tgt = powerData[0]["Equipment Tag(From)"];
    }
    if (!tgt) return; // 데이터가 없으면 종료

    // 데이터 필터링 (선택된 장비 기준)
    const fromRows = powerData.filter(d => d["Equipment Tag(To)"] === tgt);
    const toRows = powerData.filter(d => d["Equipment Tag(From)"] === tgt);

    // 중복 제거 및 태그 추출
    const fromTags = [...new Set(fromRows.map(d => d["Equipment Tag(From)"]))].filter(Boolean);
    const toTags = [...new Set(toRows.map(d => d["Equipment Tag(To)"]))].filter(Boolean);

    const container = document.getElementById("canvas-container");
    const containerW = container.clientWidth || 800;
    const containerH = container.clientHeight || 600;
    const cx = containerW / 2;
    const cy = containerH / 2;

    // ── 노드 좌표 계산 (Layout - 겹침 방지) ───────────────────────────
    // 1. 중앙 노드
    nodeMap[tgt] = { x: cx, y: cy, type: "center", tag: tgt };

    // 2. From 노드 (위쪽)
    fromTags.forEach((tag, i) => {
        const total = fromTags.length;
        const x = cx + (i - (total - 1) / 2) * (NODE_W + H_GAP);
        nodeMap[tag] = { x: x, y: cy - V_GAP, type: "from", tag: tag };
    });

    // 3. To 노드 (아래쪽, 다단 배치 및 간격 확대)
    toTags.forEach((tag, i) => {
        const row = Math.floor(i / ITEMS_PER_ROW);
        const col = i % ITEMS_PER_ROW;
        const rowCount = Math.min(toTags.length - row * ITEMS_PER_ROW, ITEMS_PER_ROW);
        const startX = cx - ((rowCount - 1) * (NODE_W + H_GAP)) / 2;
        
        nodeMap[tag] = { 
            x: startX + col * (NODE_W + H_GAP), 
            y: cy + V_GAP + (row * (NODE_H + V_GAP/2)), // 수직 간격도 가변
            type: "to", 
            tag: tag
        };
    });

    // ── SVG 요소 생성 ─────────────────────────────────────────
    const g = svg.append("g").attr("id", "main-g");
    
    // 줌 기능 설정 (드래그와 충돌 방지 로직 포함)
    const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", (e) => {
            if (event && event.type === 'drag') return; // 드래그 중엔 줌 금지
            g.attr("transform", e.transform);
        });
    svg.call(zoom);

    // 화살표 머리 정의
    svg.append("defs").append("marker")
        .attr("id", "arrowhead").attr("viewBox", "0 -5 10 10").attr("refX", 10).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
        .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#546e7a");

    const edgeLayer = g.append("g").attr("class", "links");
    const nodeLayer = g.append("g").attr("class", "nodes");
    const labelLayer = g.append("g").attr("class", "labels");

    // ── 엣지 목록 (선택된 장비 기준 필터링 강화) ───────────────────────────
    const edges = [];
    const addEdges = rows => {
        rows.forEach(row => {
            const ft = row["Equipment Tag(From)"];
            const tt = row["Equipment Tag(To)"];
            if (!ft || !tt || !nodeMap[ft] || !nodeMap[tt]) return;
            
            // [핵심] ft 또는 tt 중 하나는 반드시 현재 선택된 장비(tgt)여야만 선을 그립니다.
            if (ft !== tgt && tt !== tgt) return; 

            const key = `${ft}→${tt}`;
            if (!edges.find(e => e.key === key)) {
                edges.push({
                    key, fromTag: ft, toTag: tt,
                    cktFrom: row["CKT(From)"], cktTo: row["CKT(To)"],
                    data: row
                });
            }
        });
    };
    addEdges(fromRows);
    addEdges(toRows);

    // ── 선(Edge) 및 라벨 그리기 ──────────────────────────────
    edges.forEach(edge => {
        const fn = nodeMap[edge.fromTag];
        const tn = nodeMap[edge.toTag];

        const path = edgeLayer.append("path")
            .attr("class", "link")
            .attr("data-from", edge.fromTag)
            .attr("data-to", edge.toTag)
            .attr("d", getEdgePath(fn, tn))
            .attr("marker-end", "url(#arrowhead)");

        // CKT 라벨 추가 로직 (생략 - 이전 코드와 동일하지만 labelLayer에 추가)
        // ... (이전 코드의 getLabelText 및 text 생성 로직을 여기에 추가) ...
    });

    // ── 노드(장비 사각형) 그리기 ─────────────────────────────
    Object.entries(nodeMap).forEach(([tag, node]) => {
        const ng = nodeLayer.append("g")
            .attr("class", `node node-${node.type}`)
            .attr("transform", `translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`)
            .style("cursor", "move")
            .call(d3.drag()
                .on("start", dragStarted)
                .on("drag", dragged)
                .on("end", dragEnded)
            );

        ng.append("rect").attr("width", NODE_W).attr("height", NODE_H).attr("rx", 6);
        ng.append("text")
            .attr("x", NODE_W / 2).attr("y", NODE_H / 2 + 5)
            .attr("text-anchor", "middle").text(tag);

        // 이벤트 바인딩 (클릭/더블클릭/롱프레스 - 이전 코드와 동일)
        setupInteractions(ng, tag);
    });
    
    // 트리 전체를 캔버스 정 가운데에 맞춤
    requestAnimationFrame(() => {
        try {
            const bbox = g.node().getBBox();
            if (!bbox.width || !bbox.height) return;

            const pad = 40;
            const scale = Math.min(
                (containerW - pad * 2) / bbox.width,
                (containerH - pad * 2) / bbox.height,
                1.2
            );
            const tx = containerW / 2 - scale * (bbox.x + bbox.width  / 2);
            const ty = containerH / 2 - scale * (bbox.y + bbox.height / 2);

            svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
        } catch (e) { /* BBox 실패 무시 */ }
    });
}

// ── 2. 유틸리티 함수 및 드래그 로직 ───────────────────────────

/** 베지어 곡선 경로: 노드 하단 → 노드 상단을 S자 곡선으로 연결 */
function getEdgePath(fn, tn) {
    const x1 = fn.x;
    const y1 = fn.y + NODE_H / 2 + 2;
    const x2 = tn.x;
    const y2 = tn.y - NODE_H / 2 - 8;
    const dy = Math.abs(y2 - y1) * 0.5;
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
}

// 드래그 핸들러
function dragStarted(event, d) { d3.select(this).raise().classed("active", true); }
function dragged(event, d) {
    const tag = d3.select(this).select("text").text();
    const node = nodeMap[tag];
    node.x = event.x + NODE_W/2; // 중심점 기준 보정
    node.y = event.y + NODE_H/2;
    
    d3.select(this).attr("transform", `translate(${event.x}, ${event.y})`);
    
    // 연결된 모든 선 업데이트
    d3.selectAll(".link").each(function() {
        const l = d3.select(this);
        const fTag = l.attr("data-from");
        const tTag = l.attr("data-to");
        if (fTag === tag || tTag === tag) {
            l.attr("d", getEdgePath(nodeMap[fTag], nodeMap[tTag]));
        }
    });
}
function dragEnded(event, d) { d3.select(this).classed("active", false); }

// 클릭/더블클릭/롱프레스 구분 로직 (이전 코드와 동일)
function setupInteractions(selection, tag) {
    // ... (이전 코드의 setupInteractions 로직을 여기에 추가) ...
}
