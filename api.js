/**
 * api.js
 * - GAS에서 데이터 로드 (CORS 처리 포함)
 * - 장비 Tag / Description / Location 통합 검색
 * - 다중 선택 후 일괄 추가
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

// ── 선택 상태 ─────────────────────────────────────────
let selectedTags = new Set();

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
    const res = await fetch(GAS_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error("JSON 배열 아님");

    const isSpareOnly = tag => /^spare$/i.test(String(tag || "").trim());
    powerData = json.filter(d => {
      const ft = String(d["Equipment Tag(From)"] || "").trim();
      const tt = String(d["Equipment Tag(To)"]   || "").trim();
      if (!ft && !tt) return false;
      if (isSpareOnly(ft) || isSpareOnly(tt)) return false;
      return true;
    });

    showStatus(`✅ ${powerData.length}개 회로 로드 완료`, "success");
    setTimeout(() => hideStatus(), 3000);
    initSearch();
  } catch (err) {
    console.error("[PowerTree] 데이터 로드 실패:", err);
    showStatus("❌ 데이터 로드 실패 — GAS URL 및 배포 설정 확인", "error");
  }
}

// ── 검색 초기화 ───────────────────────────────────────
function initSearch() {
  searchInput.addEventListener("input", () => {
    const val = searchInput.value.trim();
    selectedTags.clear();
    if (!val) { resultList.innerHTML = ""; return; }
    renderList(filterTags(val));
  });
}

// ── 검색 필터 (Tag + Description + Location) ─────────
function _locKey(d) {
  // 데이터에서 Location 관련 컬럼 자동 감지
  return Object.keys(d).find(k => /^loc(ation)?$/i.test(k.trim()) || /위치/.test(k)) || null;
}

function filterTags(query) {
  const q = query.toUpperCase();
  // seen: baseTag → { tag, desc, hint }
  const seen = new Map();

  powerData.forEach(d => {
    const ft  = String(d["Equipment Tag(From)"] || "").trim();
    const tt  = String(d["Equipment Tag(To)"]   || "").trim();
    const fd  = String(d["Description(From)"]   || d["Description"] || "").trim();
    const td  = String(d["Description(To)"]     || "").trim();
    const lk  = _locKey(d);
    const loc = lk ? String(d[lk] || "").trim() : "";

    const bft = ft ? (typeof getBaseName === "function" ? getBaseName(ft) : ft) : "";
    const btt = tt ? (typeof getBaseName === "function" ? getBaseName(tt) : tt) : "";

    function tryAdd(base, desc) {
      if (!base || seen.has(base)) return;
      const tagMatch  = base.toUpperCase().includes(q);
      const descMatch = desc.toUpperCase().includes(q);
      const locMatch  = loc.toUpperCase().includes(q);
      if (tagMatch || descMatch || locMatch) {
        seen.set(base, {
          tag:  base,
          desc: desc,
          hint: !tagMatch && descMatch ? "설명" : !tagMatch && locMatch ? "위치" : ""
        });
      }
    }
    tryAdd(bft, fd);
    tryAdd(btt, td);
  });

  return [...seen.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

// ── 검색 결과 렌더링 (체크박스 + 다중 선택) ──────────
function renderList(items) {
  if (!items.length) {
    resultList.innerHTML =
      '<li style="color:var(--text-dim);font-size:11px;padding:10px 14px;">결과 없음</li>';
    return;
  }

  const rows = items.map(({ tag, desc, hint }) => {
    const checked  = selectedTags.has(tag) ? "checked" : "";
    const hintBadge = hint ? `<span class="search-hint">${esc(hint)}</span>` : "";
    return `<li class="result-item${selectedTags.has(tag) ? " selected" : ""}"
               onclick="toggleSelect('${esc(tag)}')">
      <input type="checkbox" class="result-cb" ${checked}
             onclick="event.stopPropagation();toggleSelect('${esc(tag)}')">
      <span class="tag">${esc(tag)}</span>
      ${hintBadge}
      ${desc ? `<span class="desc">${esc(desc)}</span>` : ""}
    </li>`;
  }).join("");

  const addRow = `<li class="add-row">
    <button id="add-sel-btn" onclick="addSelected()"
            ${selectedTags.size === 0 ? "disabled" : ""}>
      선택 추가 <span id="sel-count">(${selectedTags.size})</span>
    </button>
  </li>`;

  resultList.innerHTML = rows + addRow;
}

// ── 선택 토글 ─────────────────────────────────────────
function toggleSelect(tag) {
  if (selectedTags.has(tag)) selectedTags.delete(tag);
  else selectedTags.add(tag);
  // 목록 다시 렌더링 (체크 상태 반영)
  const val = searchInput.value.trim();
  if (val) renderList(filterTags(val));
}

// ── 선택 항목 트리에 추가 ─────────────────────────────
function addSelected() {
  if (!selectedTags.size) return;
  if (hintEl) hintEl.classList.add("hidden");
  collapseSidebar();
  const tags = [...selectedTags];
  selectedTags.clear();
  setTimeout(() => addTagsBatch(tags), 280);
}

// ── 사이드바 제어 ─────────────────────────────────────
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
