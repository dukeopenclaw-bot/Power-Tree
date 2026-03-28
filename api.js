/**
 * api.js
 * - GAS에서 데이터 로드 (CORS 처리 포함)
 * - 전 장비 태그 검색 (From + To 통합)
 * - 중복 제거 및 Description 표시
 *
 * [주의] GAS 배포 시 반드시 "모든 사용자 (익명 포함)" 으로 설정해야 합니다.
 *        배포 후 새 URL을 GAS_URL에 교체하세요.
 */

// ── 설정 ──────────────────────────────────────────────
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbz5faZhHDfmES_J2b7V410BS6u4Kqiw29RvX90-yUyuimIeAVPydGy8bDVW0W7nx_oU/exec";

// ── 전역 데이터 ───────────────────────────────────────
let powerData = []; // tree-viz.js에서도 참조

// ── DOM 참조 ──────────────────────────────────────────
let searchInput, resultList, statusEl, hintEl;

// ── 초기화 ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  searchInput = document.getElementById("searchInput");
  resultList  = document.getElementById("resultList");
  statusEl    = document.getElementById("status");
  hintEl      = document.getElementById("hint");

  loadData();
});

// ── 데이터 로드 ───────────────────────────────────────
async function loadData() {
  showStatus("⚡ 데이터 로딩 중...", "loading");

  try {
    // GAS URL 은 리다이렉트가 발생하므로 redirect:'follow' 필수
    const res = await fetch(GAS_URL, { redirect: "follow" });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();

    if (!Array.isArray(json)) throw new Error("JSON 배열 아님");

    powerData = json.filter(
      d =>
        String(d["Equipment Tag(From)"] || "").trim() ||
        String(d["Equipment Tag(To)"] || "").trim()
    );

    showStatus(`✅ ${powerData.length}개 회로 로드 완료`, "success");
    setTimeout(() => hideStatus(), 3000);

    initSearch();
  } catch (err) {
    console.error("[PowerTree] 데이터 로드 실패:", err);
    showStatus(
      "❌ 데이터 로드 실패 — GAS URL 및 배포 설정 확인",
      "error"
    );
  }
}

// ── 검색 초기화 ───────────────────────────────────────
function initSearch() {
  searchInput.addEventListener("input", () => {
    const val = searchInput.value.trim();
    if (!val) { resultList.innerHTML = ""; return; }
    const results = filterTags(val);
    renderList(results);
  });
}

/**
 * From / To 열을 모두 검색하여 { tag, desc } 배열 반환 (중복 제거)
 */
function filterTags(query) {
  const q = query.toUpperCase();
  const seen = new Map(); // tag -> desc

  powerData.forEach(d => {
    const ft = String(d["Equipment Tag(From)"] || "").trim();
    const tt = String(d["Equipment Tag(To)"]   || "").trim();
    const fd = String(d["Description(From)"]   || d["Description"] || "").trim();
    const td = String(d["Description(To)"]     || "").trim();

    if (ft && ft.toUpperCase().includes(q) && !seen.has(ft)) seen.set(ft, fd);
    if (tt && tt.toUpperCase().includes(q) && !seen.has(tt)) seen.set(tt, td);
  });

  return [...seen.entries()]
    .map(([tag, desc]) => ({ tag, desc }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

// ── 검색 결과 렌더링 ──────────────────────────────────
// 표시용 태그: EDB 포함 태그의 끝 -XXX(3자리) 제거
function stripSuffix(tag) {
  return /EDB/i.test(tag) ? tag.replace(/-\d{3}$/, "") : tag;
}

function renderList(items) {
  if (!items.length) {
    resultList.innerHTML =
      '<li style="color:var(--text-dim);font-size:11px;padding:10px 14px;">결과 없음</li>';
    return;
  }

  resultList.innerHTML = items
    .map(
      ({ tag, desc }) =>
        `<li onclick="selectTag('${esc(tag)}')">
          <span class="tag">${esc(stripSuffix(tag))}</span>
          ${desc ? `<span class="desc">${esc(desc)}</span>` : ""}
        </li>`
    )
    .join("");
}

// 태그 선택 (리스트 클릭) → 트리 그린 후 사이드바 축소
function selectTag(tag) {
  if (hintEl) hintEl.classList.add("hidden");
  drawTree(tag);
  collapseSidebar();
}

function collapseSidebar() {
  document.getElementById("sidebar").classList.add("collapsed");
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

// ── 유틸 ──────────────────────────────────────────────
function showStatus(msg, type) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  statusEl.style.display = "block";
}

function hideStatus() {
  if (statusEl) statusEl.style.display = "none";
}

/** HTML 특수문자 이스케이프 */
function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
