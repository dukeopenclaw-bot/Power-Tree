/**
 * tree-viz.js
 * 전기 파워트리 시각화 엔진
 * * 주요 기능:
 * 1. 노드 배치: 중앙(선택 장비), 위(From), 아래(To - 다단 배치)
 * 2. 시각화: 직각 꺾은선 화살표, 상태별 노드 색상
 * 3. 이동: 노드 드래그 및 연결선 실시간 업데이트
 * 4. 인터랙션: 클릭(정보 토글), 더블클릭/롱프레스(트리 재구성)
 */

// ── 레이아웃 및 환경 설정 ─────────────────────────────────────
const NODE_W = 140;      // 노드 너비
const NODE_H = 46;       // 노드 높이
const H_GAP = 60;        // 노드 간 수평 간격
const V_GAP = 180;       // 레벨 간 수직 간격
const ITEMS_PER_ROW = 3; // To 장비 한 행당 최대 개수

let nodeMap = {};        // 현재 화면의 노드 좌표 저장 { tag: {x, y, type, data} }
let labelVisible = {};   // CKT 라벨 표시 상태

// ── 1. 메인 그리기 함수 ───────────────────────────────────────
function drawTree(targetTag) {
    const svg = d3.select("#tree-svg");
    svg.selectAll("*").remove(); // 이전 트리 삭제
    
    nodeMap = {};
    labelVisible = {};

    // 데이터 필터링
    const mainData = powerData.find(d => d["Equipment Tag(To)"] === targetTag) || 
                   powerData.find(d => d["Equipment Tag(From)"] === targetTag);
    if (!mainData && !targetTag) return;

    const fromTags = [...new Set(powerData.filter(d => d["Equipment Tag(To)"] === targetTag).map(d => d["Equipment Tag(From)"]))].filter(Boolean);
    const toRows = powerData.filter(d => d["Equipment Tag(From)"] === targetTag);

    const container = document.getElementById("canvas-container");
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;

    // ── 노드 좌표 계산 (Layout) ───────────────────────────────
    // 1. 중앙 노드
    nodeMap[targetTag] = { x: cx, y: cy, type: "center", tag: targetTag, data: mainData };

    // 2. From 노드 (위쪽)
    fromTags.forEach((tag, i) => {
        const total = fromTags.length;
        const x = cx + (i - (total - 1) / 2) * (NODE_W + H_GAP);
        nodeMap[tag] = { x: x, y: cy - V_GAP, type: "from", tag: tag };
    });

    // 3. To 노드 (아래쪽, 다단 배치)
    toRows.forEach((d, i) => {
        const row = Math.floor(i / ITEMS_PER_ROW);
        const col = i % ITEMS_PER_ROW;
        const rowCount = Math.min(toRows.length - row * ITEMS_PER_ROW, ITEMS_PER_ROW);
        const startX = cx - ((rowCount - 1) * (NODE_W + H_GAP)) / 2;
        
        const tag = d["Equipment Tag(To)"];
        nodeMap[tag] = { 
            x: startX + col * (NODE_W + H_GAP), 
            y: cy + V_GAP + (row * (NODE_H + 40)), 
            type: "to", 
            tag: tag,
            data: d 
        };
    });

    // ── SVG 요소 생성 ─────────────────────────────────────────
    const g = svg.append("g").attr("id", "main-g");
    
    // 줌 기능 설정
    const zoom = d3.zoom().on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);

    // 화살표 머리 정의
    svg.append("defs").append("marker")
        .attr("id", "arrowhead").attr("viewBox", "0 -5 10 10").attr("refX", 10).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
        .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#546e7a");

    const edgeLayer = g.append("g").attr("class", "links");
    const nodeLayer = g.append("g").attr("class", "nodes");

    // ── 선(Edge) 및 라벨 그리기 ──────────────────────────────
    const edges = [];
    fromTags.forEach(fTag => edges.push({ from: fTag, to: targetTag }));
    toRows.forEach(d => edges.push({ from: targetTag, to: d["Equipment Tag(To)"], data: d }));

    edges.forEach(edge => {
        const fn = nodeMap[edge.from];
        const tn = nodeMap[edge.to];
        if (!fn || !tn) return;

        const path = edgeLayer.append("path")
            .attr("class", "link")
            .attr("data-from", edge.from)
            .attr("data-to", edge.to)
            .attr("d", calculateOrthogonalPath(fn, tn))
            .attr("marker-end", "url(#arrowhead)");

        // CKT 라벨 추가 (초기엔 숨김)
        const labelData = getLabelText(edge);
        g.append("text")
            .attr("class", `ckt-label label-${edge.from}-${edge.to}`)
            .attr("data-from", edge.from)
            .attr("data-to", edge.to)
            .style("display", "none")
            .text(labelData.text)
            .attr("x", labelData.isFrom ? fn.x + 5 : tn.x + 5)
            .attr("y", labelData.isFrom ? fn.y + NODE_H/2 + 15 : tn.y - NODE_H/2 - 5);
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

        // 이벤트 바인딩 (클릭/더블클릭/롱프레스)
        setupInteractions(ng, tag);
    });
}

// ── 2. 유틸리티 함수 및 드래그 로직 ───────────────────────────

//  경로 계산 함수

function calculateOrthogonalPath(fn, tn) {
    const x1 = fn.x;
    const y1 = fn.y + NODE_H / 2; // From 노드 하단
    const x2 = tn.x;
    const y2 = tn.y - NODE_H / 2; // To 노드 상단
    
    // ── 겹침 방지 핵심 로직 ────────────────────────────────
    // 모든 선이 같은 높이에서 꺾이지 않도록 
    // 목적지(tn)의 X 좌표나 순번에 따라 꺾임 위치(offset)를 다르게 줍니다.
    const midY = (y1 + y2) / 2;
    
    // 노드의 X 위치에 따라 꺾이는 지점을 +- 20px 정도 분산시킵니다.
    // 이렇게 하면 수평선들이 서로 위아래로 빗겨나가게 됩니다.
    const spread = (x2 - fn.x) * 0.1; 
    const adaptiveMidY = midY + (Math.sin(x2) * 10); // 사인 함수를 이용한 미세 분산

    // 경로 생성: 수직(V) -> 수평(H) -> 수직(V)
    return `M${x1},${y1} V${adaptiveMidY} H${x2} V${y2}`;
}

function getLabelText(edge) {
    const isToSide = edge.from === nodeMap[edge.to]?.tag; // 목적지 기준 판단
    const d = edge.data || powerData.find(pd => pd["Equipment Tag(From)"] === edge.from && pd["Equipment Tag(To)"] === edge.to);
    
    if (!d) return { text: "", isFrom: false };

    // EDB-XXX 형식 체크 (정규식)
    const suffixMatch = String(edge.from).match(/-(\d{3})$/);
    if (suffixMatch) {
        return { text: `-${suffixMatch[1]} / ${d["CKT(From)"] || ""}`, isFrom: true };
    }
    return { text: d["CKT(From)"] || d["CKT(To)"] || "", isFrom: !isToSide };
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
            l.attr("d", calculateOrthogonalPath(nodeMap[fTag], nodeMap[tTag]));
            // 라벨 위치도 함께 업데이트 가능 (선택 사항)
        }
    });
}
function dragEnded(event, d) { d3.select(this).classed("active", false); }

// 클릭/더블클릭/롱프레스 구분 로직
function setupInteractions(selection, tag) {
    let clickCount = 0;
    let timer;
    let pressTimer;

    selection.on("mousedown", () => {
        pressTimer = setTimeout(() => {
            clickCount = 0;
            drawTree(tag); // 롱프레스 -> 해당 장비로 이동
        }, 600);
    }).on("mouseup", () => clearTimeout(pressTimer))
      .on("click", (e) => {
        clickCount++;
        if (clickCount === 1) {
            timer = setTimeout(() => {
                if (clickCount === 1) {
                    // 단일 클릭 -> CKT 토글
                    const labels = d3.selectAll(`.label-${tag}, [data-from="${tag}"], [data-to="${tag}"]`).filter(".ckt-label");
                    const current = labels.style("display");
                    labels.style("display", current === "none" ? "block" : "none");
                }
                clickCount = 0;
            }, 250);
        } else if (clickCount === 2) {
            clearTimeout(timer);
            clickCount = 0;
            drawTree(tag); // 더블클릭 -> 해당 장비로 이동
        }
    });
}
