const GAS_URL = "https://script.google.com/macros/s/AKfycbz5faZhHDfmES_J2b7V410BS6u4Kqiw29RvX90-yUyuimIeAVPydGy8bDVW0W7nx_oU/exec";

async function fetchData() {
    try {
        const response = await fetch(GAS_URL);
        const data = await response.json();
        return data;
    } catch (e) {
        console.error("데이터 로드 실패:", e);
        return [];
    }
}

let powerData = [];
const searchInput = document.getElementById('searchInput');
const resultList = document.getElementById('resultList');

fetchData().then(data => {
    powerData = data;
    initSearch();
});

function initSearch() {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase();
        const filtered = powerData.filter(d => 
            String(d["Equipment Tag(To)"]).toUpperCase().includes(val)
        );
        renderList(filtered);
    });
}

function renderList(list) {
    resultList.innerHTML = list.map(item => 
        `<li onclick="drawTree('${item["Equipment Tag(To)"]}')">${item["Equipment Tag(To)"]}</li>`
    ).join('');
}