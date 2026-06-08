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
let lunMap    = new Map(); // baseTag → LUN 값 (J열 기반)

// ── LUN 컬럼 키 캐시 ──────────────────────────────────
let _lunColKey = null;

function _getLunKey() {
  if (_lunColKey !== null) return _lunColKey;
  if (!powerData.length) return (_lunColKey = "");
  _lunColKey = Object.keys(powerData[0]).find(k => /\blun\b/i.test(k.trim())) || "";
  return _lunColKey;
}

/** LUN 맵 재구성: baseTag(To) → LUN 값 */
function _buildLunMap() {
  lunMap.clear();
  const key = _getLunKey();
  if (!key) return;
  powerData.forEach(d => {
    const lun = String(d[key] || "").trim();
    if (!lun) return;
    const tt  = String(d["Equipment Tag(To)"] || "").trim();
    if (tt) {
      const btt = typeof getBaseName === "function" ? getBaseName(tt) : tt;
      if (!lunMap.has(btt)) lunMap.set(btt, lun);
    }
  });
}

// ── DOM 참조 ──────────────────────────────────────────
let searchInput, resultList, statusEl, hintEl;

// ── 선택 상태 ─────────────────────────────────────────
let selectedTags = new Set();

// ── 필터 상태 ─────────────────────────────────────────
let showSpare = false;

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
  // SW 업데이트 리로드 시 로딩 메시지 생략 → 이중 로딩으로 보이는 현상 방지
  const isSWRefresh = sessionStorage.getItem('_sw_refresh') === '1';
  if (isSWRefresh) sessionStorage.removeItem('_sw_refresh');
  if (!isSWRefresh) showStatus("⚡ 데이터 로딩 중...", "loading");

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

    _lunColKey = null; // 컬럼 키 캐시 초기화
    _buildLunMap();

    if (!isSWRefresh) {
      const lunCount = lunMap.size;
      showStatus(`✅ ${powerData.length}개 회로 로드 완료${lunCount ? ` (전원인가 ${lunCount}개)` : ""}`, "success");
      setTimeout(() => hideStatus(), 3000);
    }
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
      if (!showSpare && /spare/i.test(base)) return;
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

  const allSelected = items.every(({ tag }) => selectedTags.has(tag));

  const topRow = `<li class="add-row top-row">
    <label class="select-all-label">
      <input type="checkbox" id="chk-all" ${allSelected ? "checked" : ""}
             onchange="toggleSelectAll(this.checked)"> 전체선택
    </label>
    <button id="add-sel-btn" onclick="addSelected()"
            ${selectedTags.size === 0 ? "disabled" : ""}>
      선택 추가 <span id="sel-count">(${selectedTags.size})</span>
    </button>
  </li>`;

  const rows = items.map(({ tag, desc, hint }) => {
    const checked   = selectedTags.has(tag) ? "checked" : "";
    const hintBadge = hint ? `<span class="search-hint">${esc(hint)}</span>` : "";
    return `<li class="result-item${selectedTags.has(tag) ? " selected" : ""}"
               onclick="toggleSelect('${esc(tag)}')">
      <input type="checkbox" class="result-cb" ${checked}
             onclick="event.stopPropagation();toggleSelect('${esc(tag)}')">
      <div class="result-text">
        <span class="tag">${esc(tag)}${hintBadge}</span>
        ${desc ? `<span class="desc">${esc(desc)}</span>` : ""}
      </div>
    </li>`;
  }).join("");

  resultList.innerHTML = topRow + rows;
}

// ── 선택 토글 ─────────────────────────────────────────
function toggleSelect(tag) {
  if (selectedTags.has(tag)) selectedTags.delete(tag);
  else selectedTags.add(tag);
  const val = searchInput.value.trim();
  if (val) renderList(filterTags(val));
}

// ── 전체 선택 / 해제 ──────────────────────────────────
function toggleSelectAll(checked) {
  const val = searchInput.value.trim();
  if (!val) return;
  const items = filterTags(val);
  if (checked) items.forEach(({ tag }) => selectedTags.add(tag));
  else         items.forEach(({ tag }) => selectedTags.delete(tag));
  renderList(items);
}

// ── 선택 항목 트리에 추가 ─────────────────────────────
function addSelected() {
  if (!selectedTags.size) return;
  if (hintEl) hintEl.classList.add("hidden");
  collapseSidebar();
  const tags = [...selectedTags];
  selectedTags.clear();
  // 검색창 초기화 (추가 후 다음 검색을 위해)
  if (searchInput) searchInput.value = "";
  if (resultList)  resultList.innerHTML = "";
  setTimeout(() => addTagsBatch(tags), 280);
}

// ── 사이드바 제어 ─────────────────────────────────────
// 드래그로 너비를 조절하면 인라인 style.width/minWidth가 설정되는데,
// 이는 .collapsed 클래스의 width:0 규칙보다 우선순위가 높아 축소해도
// 화면을 가리는 문제가 생긴다. 축소 시 인라인 값을 제거(저장)하고
// 확장 시 복원한다.
function _collapseSidebarEl(sb) {
  if (sb.style.width) sb.dataset.customWidth = sb.style.width;
  sb.style.width = "";
  sb.style.minWidth = "";
  sb.classList.add("collapsed");
}
function _expandSidebarEl(sb) {
  sb.classList.remove("collapsed");
  if (sb.dataset.customWidth) {
    sb.style.width    = sb.dataset.customWidth;
    sb.style.minWidth = sb.dataset.customWidth;
  }
}
function collapseSidebar() {
  const sb = document.getElementById("sidebar");
  if (!sb.classList.contains("collapsed")) _collapseSidebarEl(sb);
}
function toggleSidebar() {
  const sb = document.getElementById("sidebar");
  if (sb.classList.contains("collapsed")) _expandSidebarEl(sb);
  else _collapseSidebarEl(sb);
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

/** Spare 필터 토글 */
function updateSpareFilter(checked) {
  showSpare = checked;
  const val = searchInput ? searchInput.value.trim() : "";
  if (val) renderList(filterTags(val));
}

/** HTML 특수문자 이스케이프 */
function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
