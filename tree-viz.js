function drawTree(targetTag) {
    const svg = d3.select("#tree-svg");
    svg.selectAll("*").remove();

    const centerNode = powerData.find(d => d["Equipment Tag(To)"] === targetTag);
    const fromNodes = powerData.filter(d => d["Equipment Tag(To)"] === centerNode["Equipment Tag(From)"]);
    const toNodes = powerData.filter(d => d["Equipment Tag(From)"] === targetTag);

    const width = document.getElementById('canvas-container').clientWidth;
    const height = document.getElementById('canvas-container').clientHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    // 1. 노드 배치 (사각형 형태)
    const nodes = [];
    // 중앙 장비
    nodes.push({ x: centerX, y: centerY, tag: targetTag, type: 'main', data: centerNode });
    
    // From 장비 (위쪽)
    if(centerNode["Equipment Tag(From)"]) {
        nodes.push({ x: centerX, y: centerY - 150, tag: centerNode["Equipment Tag(From)"], type: 'from' });
    }

    // To 장비 (아래쪽, 여러 단 배치)
    const itemsPerRow = 4;
    toNodes.forEach((d, i) => {
        const row = Math.floor(i / itemsPerRow);
        const col = i % itemsPerRow;
        const totalInRow = Math.min(toNodes.length - (row * itemsPerRow), itemsPerRow);
        const startX = centerX - ((totalInRow - 1) * 100) / 2;
        nodes.push({ 
            x: startX + (col * 100), 
            y: centerY + 150 + (row * 80), 
            tag: d["Equipment Tag(To)"], 
            type: 'to',
            data: d
        });
    });

    // 2. 링크 그리기 (꺾은선)
    nodes.forEach(node => {
        if(node.type === 'from' || node.type === 'to') {
            const startX = node.type === 'from' ? node.x : centerX;
            const startY = node.type === 'from' ? node.y + 25 : centerY + 25;
            const endX = node.type === 'from' ? centerX : node.x;
            const endY = node.type === 'from' ? centerY - 25 : node.y - 25;

            // 직각 꺾은선 경로 계산
            const path = `M ${startX} ${startY} V ${(startY + endY)/2} H ${endX} V ${endY}`;
            
            svg.append("path").attr("d", path).attr("class", "link")
               .attr("marker-end", "url(#arrowhead)");
        }
    });

    // 3. 노드 그리기 및 클릭 이벤트
    const nodeGroups = svg.selectAll(".node")
        .data(nodes).enter().append("g")
        .attr("transform", d => `translate(${d.x - 40}, ${d.y - 25})`)
        .on("click", function(event, d) {
            handleNodeClick(d3.select(this), d);
        })
        .on("dblclick", function(event, d) {
            drawTree(d.tag);
        });

    nodeGroups.append("rect").attr("width", 80).attr("height", 50).attr("rx", 5);
    nodeGroups.append("text").attr("x", 40).attr("y", 30).attr("text-anchor", "middle").text(d => d.tag).style("font-size", "10px");
}

function handleNodeClick(selection, d) {
    // 3자리 숫자 체크 (EDB 등)
    const tagMatch = String(d.tag).match(/-(\d{3})$/);
    const suffix = tagMatch ? tagMatch[1] : null;

    // 텍스트 표시 로직 (이미 있으면 제거, 없으면 생성)
    if (!selection.select(".info-text").empty()) {
        selection.selectAll(".info-text").remove();
        return;
    }

    if (suffix) {
        // EDB 등 숫자 있는 경우
        selection.append("text").attr("class", "info-text label-text").attr("y", -5).text(`-${suffix} / ${d.data?.["CKT(From)"] || ''}`);
    } else {
        // 일반 장비
        selection.append("text").attr("class", "info-text label-text").attr("y", -5).text(d.data?.["CKT(From)"] || '');
    }
}