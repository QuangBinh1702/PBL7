export function LegacyMarkup() {
  return <div className="local-only-app" dangerouslySetInnerHTML={{ __html: `<div class="token-prompt hidden" id="tokenPrompt"></div>

  <!-- TOP BAR -->
  <div class="topbar">
    <div class="topbar-left">
      <a href="#" class="logo">
        <div class="logo-dot">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
        </div>
        BVTK Mapper
      </a>
      <div class="topbar-info">
        <span id="infoCoords"></span>
        <span id="infoDate"></span>
      </div>
    </div>
    <div class="topbar-right">
      <button class="layer-toggle active" data-layer="sequences" title="Coverage lines">
        <span class="dot" style="background:var(--green)"></span> Coverage
      </button>
      <button class="layer-toggle active" data-layer="features" title="Map features">
        <span class="dot" style="background:var(--blue)"></span> Features
      </button>
      <button class="layer-toggle active" data-layer="signs" title="Traffic signs">
        <span class="dot" style="background:var(--orange)"></span> Signs
      </button>
      <button class="layer-toggle active local-only-hidden" data-layer="local" title="Coverage from local database" style="border-color:var(--blue)">
        <span class="dot" style="background:var(--blue)"></span> Coverage
      </button>
    </div>
  </div>

  <!-- MAIN -->
  <div class="app-container" id="appContainer">
    <!-- VIEWER -->
    <div id="viewer">
      <img id="localViewerImage" class="local-viewer-image" src="" alt="Selected street view image">
      <div id="localViewerEmpty" class="local-viewer-empty">Chọn một điểm ảnh trên bản đồ để xem ảnh.</div>
      <div class="loading-overlay" id="viewerLoading">
        <div class="spinner"></div>
        <div class="loading-text">Đang tải hình ảnh...</div>
      </div>
      <button class="viewer-expand-btn" id="viewerExpandBtn" title="Expand / Collapse">⛶</button>
      <div class="viewer-bar">
        <div class="viewer-bar-left">
          <span class="viewer-date" id="viewerDate">—</span>
        </div>
        <div class="viewer-bar-right">
          <button id="viewerMinBtn" title="Thu nhỏ">—</button>
        </div>
      </div>
    </div>
    <div class="analysis-dots" id="analysisDots">
      <button class="analysis-dot" type="button" data-field="scene_text" title="SCENE"></button>
      <button class="analysis-dot" type="button" data-field="road_text" title="ROAD"></button>
      <button class="analysis-dot" type="button" data-field="vehicle_text" title="VEHICLE"></button>
      <button class="analysis-dot" type="button" data-field="sign_text" title="SIGN"></button>
      <button class="analysis-dot" type="button" data-field="safety_text" title="SAFETY"></button>
    </div>
    <div class="analysis-popup" id="analysisPopup" hidden>
      <div class="analysis-popup-header">
        <div class="analysis-popup-title" id="analysisPopupTitle">Phân tích ảnh</div>
        <div class="analysis-popup-source" id="analysisSource" hidden></div>
      </div>
      <div class="analysis-popup-body" id="analysisBody">Chọn một chấm tròn để xem nội dung.</div>
    </div>

    <!-- Image hover preview tooltip -->
    <div class="image-hover-preview" id="imageHoverPreview">
      <img id="imageHoverImg" src="" alt="">
    </div>

    <!-- DIVIDER -->
    <div class="divider" id="divider"></div>

    <!-- MAP -->
    <div id="map">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" class="search-input" id="searchInput" placeholder="Tìm kiếm địa điểm...">
        <div class="search-suggestions" id="searchSuggestions"></div>
        <div class="search-status" id="searchStatus">—</div>
      </div>
      <div class="map-controls">
        <button class="map-btn" id="btnZoomIn" title="Phóng to">+</button>
        <button class="map-btn" id="btnZoomOut" title="Thu nhỏ">−</button>
        <button class="map-btn" id="btnLocate" title="Vị trí hiện tại">📍</button>
      </div>
      <div class="map-style-control" id="mapStyleControl">
        <button class="map-style-trigger" id="mapStyleTrigger" type="button" aria-expanded="false">
          <span class="map-style-trigger-icon swatch-standard"></span>
          <span>Map style</span>
        </button>
        <div class="map-style-popover" id="mapStylePopover" hidden>
          <div class="map-style-title">Map style</div>
          <button class="map-style-option active" data-style="standard" type="button">
            <span class="map-style-swatch swatch-standard"></span>
            <span>
              <strong>Voyager</strong>
              <small>Fresh green labels</small>
            </span>
          </button>
          <button class="map-style-option" data-style="light" type="button">
            <span class="map-style-swatch swatch-light"></span>
            <span>
              <strong>Light</strong>
              <small>Clean streets</small>
            </span>
          </button>
          <button class="map-style-option" data-style="dark" type="button">
            <span class="map-style-swatch swatch-dark"></span>
            <span>
              <strong>Dark</strong>
              <small>Night mode</small>
            </span>
          </button>
        </div>
      </div>
      <div class="legend" id="mapLegend">
        <div class="legend-title">Chú giải</div>
        <div class="legend-item"><span class="legend-color" style="background:var(--green)"></span> Coverage</div>
        <div class="legend-item"><span class="legend-dot legend-dot-image"></span> Ảnh</div>
        <div class="legend-item"><span class="legend-dot" style="background:#7c3aed"></span> Đối tượng</div>
        <div class="legend-item"><span class="legend-dot" style="background:var(--orange)"></span> Biển báo</div>
        <div class="legend-item"><span class="legend-dot legend-dot-search"></span> Kết quả tìm kiếm</div>
      </div>
      <div class="coords-display" id="coordsDisplay">—</div>
    </div>

  </div>

  <!-- DETECTION PANEL -->
  <div class="detection-panel" id="detectionPanel">
    <div class="detection-header">
      <div class="detection-header-left">
        <img id="detectionIcon" src="" alt="">
        <span id="detectionTitle">—</span>
      </div>
      <button class="detection-close" id="detectionClose" title="Close">✕</button>
    </div>
    <div class="detection-list" id="detectionList"></div>
    <div class="detection-footer">
      <span class="detection-page-info" id="detectionPageInfo"></span>
      <button class="detection-nav-btn" id="detectionNextBtn" style="display:none">Next 3</button>
    </div>
  </div>

  <!-- FILTER PANELS -->
  <div class="filter-panels" id="filterPanels">
    <!-- Show traffic signs -->
    <div class="filter-panel" id="signsPanel">
      <div class="filter-header">
        <div class="filter-header-left">Show traffic signs</div>
        <button class="filter-download-btn" id="downloadSignsBtn">Download</button>
      </div>
      <div class="filter-tags" id="signsTags"></div>
      <div class="filter-dropdown-wrap">
        <button class="filter-dropdown-btn" id="signsDropdownBtn">
          <span>Select traffic signs to show</span>
          <span>▼</span>
        </button>
        <div class="filter-dropdown-list" id="signsDropdownList"></div>
      </div>
      <div class="filter-count" id="signsCount"></div>
    </div>
    <!-- Show points -->
    <div class="filter-panel" id="pointsPanel">
      <div class="filter-header">
        <div class="filter-header-left">Show points</div>
        <button class="filter-download-btn" id="downloadPointsBtn">Download</button>
      </div>
      <div class="filter-tags" id="pointsTags"></div>
      <div class="filter-dropdown-wrap">
        <button class="filter-dropdown-btn" id="pointsDropdownBtn">
          <span>Select points to show</span>
          <span>▼</span>
        </button>
        <div class="filter-dropdown-list" id="pointsDropdownList"></div>
      </div>
      <div class="filter-count" id="pointsCount"></div>
    </div>
  </div>` }} />;
}
