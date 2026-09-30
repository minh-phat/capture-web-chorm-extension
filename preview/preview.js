// Preview Viewer Script: Gallery View, Canvas Stitcher, Zoom, Download & Lightbox

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements - Topbar Meta & Pills
  const pageTitleEl = document.getElementById('page-title');
  const pageUrlEl = document.getElementById('page-url');
  const viewTabs = document.getElementById('view-tabs');
  const tabGallery = document.getElementById('tab-gallery');
  const tabMerged = document.getElementById('tab-merged');
  const badgeSliceCount = document.getElementById('badge-slice-count');
  const tabMergedStatus = document.getElementById('tab-merged-status');
  const imageInfoPill = document.getElementById('image-info-pill');
  const infoDimensionsEl = document.getElementById('info-dimensions');
  const infoFormatEl = document.getElementById('info-format');
  const infoSizeEl = document.getElementById('info-size');

  // Topbar Action Groups
  const actionsGallery = document.getElementById('actions-gallery');
  const actionsMerged = document.getElementById('actions-merged');
  const btnDownloadAll = document.getElementById('btn-download-all');
  const btnDownloadAllText = document.getElementById('btn-download-all-text');
  const btnDownloadCount = document.getElementById('btn-download-count');
  const btnDownloadOptions = document.getElementById('btn-download-options');
  const downloadDropdownMenu = document.getElementById('download-dropdown-menu');
  const optDownloadZip = document.getElementById('opt-download-zip');
  const optDownloadSeparate = document.getElementById('opt-download-separate');
  const btnStitch = document.getElementById('btn-stitch');
  const btnBackToGallery = document.getElementById('btn-back-to-gallery');
  const btnCopy = document.getElementById('btn-copy');
  const btnDownload = document.getElementById('btn-download');

  // ZIP Progress Modal Elements
  const zipModal = document.getElementById('zip-modal');
  const zipModalDesc = document.getElementById('zip-modal-desc');
  const zipProgressBar = document.getElementById('zip-progress-bar');
  const zipModalStatus = document.getElementById('zip-modal-status');
  const btnCancelZip = document.getElementById('btn-cancel-zip');

  // Main Viewports & States
  const previewViewport = document.getElementById('preview-viewport');
  const loadingState = document.getElementById('loading-state');
  const loadingText = document.getElementById('loading-text');

  // Gallery View Elements
  const galleryView = document.getElementById('gallery-view');
  const galleryCountText = document.getElementById('gallery-count-text');
  const checkSelectAll = document.getElementById('check-select-all');
  const selectedCountBadge = document.getElementById('selected-count-badge');
  const totalCountBadge = document.getElementById('total-count-badge');
  const btnLayoutGrid = document.getElementById('btn-layout-grid');
  const btnLayoutStrip = document.getElementById('btn-layout-strip');
  const btnQuickStitch = document.getElementById('btn-quick-stitch');
  const galleryGrid = document.getElementById('gallery-grid');
  const galleryStrip = document.getElementById('gallery-strip');

  // Merged View Elements
  const mergedView = document.getElementById('merged-view');
  const zoomToolbar = document.getElementById('zoom-toolbar');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const btnZoom100 = document.getElementById('btn-zoom-100');
  const zoomLevelText = document.getElementById('zoom-level-text');
  const imageWrapper = document.getElementById('image-wrapper');
  const previewImg = document.getElementById('preview-img');
  const unstitchedPrompt = document.getElementById('unstitched-prompt');
  const promptSliceCount = document.getElementById('prompt-slice-count');
  const btnPromptStitch = document.getElementById('btn-prompt-stitch');

  // Lightbox Elements
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxBackdrop = document.getElementById('lightbox-backdrop');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxMetaInfo = document.getElementById('lightbox-meta-info');
  const lightboxImg = document.getElementById('lightbox-img');
  const btnLightboxPrev = document.getElementById('btn-lightbox-prev');
  const btnLightboxNext = document.getElementById('btn-lightbox-next');
  const btnLightboxCopy = document.getElementById('btn-lightbox-copy');
  const btnLightboxDownload = document.getElementById('btn-lightbox-download');
  const btnLightboxClose = document.getElementById('btn-lightbox-close');

  // Toast
  const toast = document.getElementById('toast');

  // State
  let captureData = null;
  let slicesState = []; // Array of { index, dataUrl, y, viewportWidth, viewportHeight, sliceHeight, selected: true }
  let isStitched = false;
  let currentBlob = null;
  let currentDataUrl = null;
  let finalWidth = 0;
  let finalHeight = 0;
  let zoomLevel = 1.0;
  let defaultBaseName = 'web-capture';
  let defaultFileName = 'web-capture.png';
  let currentLightboxIndex = 0;
  let currentViewMode = 'GALLERY'; // 'GALLERY' or 'MERGED'
  let galleryLayout = 'GRID'; // 'GRID' or 'STRIP'

  // Initialize
  try {
    const storage = await chrome.storage.local.get(['latestCaptureData', 'showGalleryFirst']);
    if (!storage || !storage.latestCaptureData) {
      showError('Không tìm thấy dữ liệu ảnh đã chụp.');
      return;
    }

    captureData = storage.latestCaptureData;
    const showGalleryFirst = storage.showGalleryFirst !== false; // Default true
    setupPageMeta(captureData);

    if (captureData.type === 'FULL_PAGE') {
      await initFullPageCapture(captureData, showGalleryFirst);
    } else {
      await initVisibleCapture(captureData);
    }
  } catch (err) {
    console.error('Lỗi khi tải preview:', err);
    showError('Không thể tạo hình ảnh xem trước: ' + (err.message || err));
  }

  // ==========================================================================
  // INITIALIZATION HANDLERS
  // ==========================================================================

  // Setup title & domain meta info
  function setupPageMeta(capture) {
    pageTitleEl.textContent = capture.pageTitle || 'Trang web';
    pageUrlEl.textContent = capture.pageUrl || '';

    let domain = 'website';
    try {
      if (capture.pageUrl) {
        const urlObj = new URL(capture.pageUrl);
        domain = urlObj.hostname.replace('www.', '').replace(/[^a-zA-Z0-9]/g, '-');
      }
    } catch (e) { }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    defaultBaseName = `web-capture-${domain}-${dateStr}-${timeStr}`;
    defaultFileName = `${defaultBaseName}.png`;
  }

  // Handle Full Page capture sessions
  async function initFullPageCapture(capture, showGalleryFirst) {
    let slices = capture.slices;

    // Load slices from storage keys if stored separately
    if (!slices && capture.sliceCount > 0) {
      loadingText.textContent = `Đang tải ${capture.sliceCount} phần ảnh đã chụp...`;
      const sliceKeys = Array.from({ length: capture.sliceCount }, (_, i) => `slice_${i}`);
      const storageData = await chrome.storage.local.get(sliceKeys);
      slices = sliceKeys.map((key, idx) => {
        const item = storageData[key];
        if (item) {
          if (item.index === undefined) item.index = idx;
          return item;
        }
        return null;
      }).filter(Boolean);
    }

    if (!slices || slices.length === 0) {
      showError('Dữ liệu các phần ảnh bị thiếu hoặc đã bị xóa.');
      return;
    }

    // Build slicesState
    slicesState = slices.map((s, idx) => ({
      ...s,
      index: s.index !== undefined ? s.index : idx,
      selected: true
    }));

    // Update counts and badges
    badgeSliceCount.textContent = slicesState.length;
    btnDownloadCount.textContent = slicesState.length;
    galleryCountText.textContent = `Đã chụp ${slicesState.length} phần ảnh từ trang web`;
    promptSliceCount.textContent = slicesState.length;
    updateSelectionCounts();

    // Render slices cards in Gallery
    renderGalleryGrid();
    renderGalleryStrip();

    // Show tabs because this is a multi-slice capture
    viewTabs.style.display = 'inline-flex';

    if (showGalleryFirst) {
      // Show Gallery View first as requested
      switchToGalleryView();
      loadingState.style.display = 'none';
      galleryView.style.display = 'flex';
      showToast(`📸 Đã chụp thành công ${slicesState.length} phần ảnh!`, 3000);
    } else {
      // Auto-stitch if user configured auto
      loadingState.style.display = 'flex';
      galleryView.style.display = 'none';
      await performStitch(slicesState);
      switchToMergedView();
    }
  }

  // Handle Single Visible Area capture
  async function initVisibleCapture(capture) {
    loadingText.textContent = 'Đang tải hình ảnh...';
    viewTabs.style.display = 'none'; // Only 1 image, no tabs needed

    const img = await loadImage(capture.dataUrl);
    const response = await fetch(capture.dataUrl);
    const blob = await response.blob();

    currentBlob = blob;
    currentDataUrl = capture.dataUrl;
    finalWidth = img.width;
    finalHeight = img.height;

    loadingState.style.display = 'none';
    galleryView.style.display = 'none';
    mergedView.style.display = 'flex';
    actionsGallery.style.display = 'none';
    actionsMerged.style.display = 'flex';
    btnBackToGallery.style.display = 'none'; // No gallery to go back to

    displayFinalImage(currentDataUrl, img.width, img.height, blob.size);
  }

  // ==========================================================================
  // GALLERY RENDERING & INTERACTION
  // ==========================================================================

  function renderGalleryGrid() {
    galleryGrid.innerHTML = '';

    slicesState.forEach((slice, idx) => {
      const card = document.createElement('div');
      card.className = `slice-card ${slice.selected ? '' : 'excluded'}`;
      card.dataset.index = idx;

      const sliceHeight = slice.sliceHeight || slice.viewportHeight || 0;
      const sliceWidth = slice.viewportWidth || 0;

      card.innerHTML = `
        <div class="slice-card-header">
          <div class="slice-header-left">
            <input type="checkbox" class="slice-checkbox" data-index="${idx}" ${slice.selected ? 'checked' : ''} title="Chọn ảnh này để ghép">
            <span class="slice-index-badge">Phần #${idx + 1}</span>
          </div>
          <span class="slice-y-pill" title="Tọa độ cuộn Y">Y: ${slice.y}px</span>
        </div>

        <div class="slice-thumb-wrapper" data-index="${idx}">
          <img class="slice-thumb-img" src="${slice.dataUrl}" alt="Phần #${idx + 1}" loading="lazy" />
          <div class="slice-overlay-actions">
            <button class="overlay-action-btn btn-action-zoom" data-index="${idx}" title="Xem phóng to">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <button class="overlay-action-btn btn-action-copy" data-index="${idx}" title="Sao chép ảnh này">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button class="overlay-action-btn btn-action-download" data-index="${idx}" title="Tải ảnh này về máy">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="slice-card-footer">
          <div class="slice-dimensions">
            <span>${sliceWidth} × ${sliceHeight} px</span>
          </div>
          <div class="slice-card-actions">
            <button class="slice-quick-btn btn-quick-zoom" data-index="${idx}">Xem chi tiết</button>
          </div>
        </div>
      `;

      // Checkbox event
      const chk = card.querySelector('.slice-checkbox');
      chk.addEventListener('change', (e) => {
        slice.selected = e.target.checked;
        if (slice.selected) {
          card.classList.remove('excluded');
        } else {
          card.classList.add('excluded');
        }
        updateSelectionCounts();
        // Invalidate cached stitched result so re-stitching reflects selection
        isStitched = false;
        tabMergedStatus.classList.remove('stitched');
      });

      // Thumbnail click opens Lightbox
      const thumb = card.querySelector('.slice-thumb-wrapper');
      thumb.addEventListener('click', (e) => {
        if (!e.target.closest('.overlay-action-btn')) {
          openLightbox(idx);
        }
      });

      // Overlay Action buttons
      card.querySelector('.btn-action-zoom').addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(idx);
      });

      card.querySelector('.btn-quick-zoom').addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(idx);
      });

      card.querySelector('.btn-action-copy').addEventListener('click', async (e) => {
        e.stopPropagation();
        await copySliceToClipboard(slice, e.currentTarget);
      });

      card.querySelector('.btn-action-download').addEventListener('click', (e) => {
        e.stopPropagation();
        downloadSingleSlice(slice, idx);
      });

      galleryGrid.appendChild(card);
    });
  }

  function renderGalleryStrip() {
    galleryStrip.innerHTML = '';
    slicesState.forEach((slice, idx) => {
      const item = document.createElement('div');
      item.className = 'strip-item';
      item.innerHTML = `
        <img class="strip-img" src="${slice.dataUrl}" alt="Phần #${idx + 1}" loading="lazy" />
        <div class="strip-marker">Phần ${idx + 1} / ${slicesState.length}</div>
      `;
      item.addEventListener('click', () => openLightbox(idx));
      galleryStrip.appendChild(item);
    });
  }

  function updateSelectionCounts() {
    const selectedCount = slicesState.filter(s => s.selected).length;
    const totalCount = slicesState.length;

    selectedCountBadge.textContent = selectedCount;
    totalCountBadge.textContent = totalCount;
    if (btnDownloadCount) btnDownloadCount.textContent = selectedCount;

    // Dynamically update download button label based on selected count
    if (btnDownloadAllText) {
      if (selectedCount <= 1) {
        btnDownloadAllText.innerHTML = `Tải ảnh (<span id="btn-download-count">${selectedCount}</span>)`;
      } else {
        btnDownloadAllText.innerHTML = `Tải file ZIP (<span id="btn-download-count">${selectedCount}</span>)`;
      }
    }

    checkSelectAll.checked = selectedCount === totalCount;
    checkSelectAll.indeterminate = selectedCount > 0 && selectedCount < totalCount;

    // Update stitch buttons text
    if (selectedCount === totalCount) {
      btnStitch.querySelector('span').textContent = 'Ghép thành 1 hình ảnh';
      btnQuickStitch.querySelector('span').textContent = 'Ghép tất cả ảnh';
    } else {
      btnStitch.querySelector('span').textContent = `Ghép ${selectedCount} ảnh đã chọn`;
      btnQuickStitch.querySelector('span').textContent = `Ghép ${selectedCount} ảnh đã chọn`;
    }
  }

  // Select all toggle
  checkSelectAll.addEventListener('change', () => {
    const isChecked = checkSelectAll.checked;
    slicesState.forEach(s => s.selected = isChecked);

    document.querySelectorAll('.slice-checkbox').forEach(chk => {
      chk.checked = isChecked;
    });

    document.querySelectorAll('.slice-card').forEach(card => {
      if (isChecked) {
        card.classList.remove('excluded');
      } else {
        card.classList.add('excluded');
      }
    });

    updateSelectionCounts();
    isStitched = false;
    tabMergedStatus.classList.remove('stitched');
  });

  // Layout switcher (Grid vs Strip)
  btnLayoutGrid.addEventListener('click', () => {
    btnLayoutGrid.classList.add('active');
    btnLayoutStrip.classList.remove('active');
    galleryGrid.style.display = 'grid';
    galleryStrip.style.display = 'none';
    galleryLayout = 'GRID';
  });

  btnLayoutStrip.addEventListener('click', () => {
    btnLayoutStrip.classList.add('active');
    btnLayoutGrid.classList.remove('active');
    galleryGrid.style.display = 'none';
    galleryStrip.style.display = 'flex';
    galleryLayout = 'STRIP';
  });

  // ==========================================================================
  // STITCHING ENGINE
  // ==========================================================================

  async function performStitch() {
    const selectedSlices = slicesState.filter(s => s.selected);

    if (selectedSlices.length === 0) {
      alert('Vui lòng chọn ít nhất một phần ảnh để tiến hành ghép.');
      return false;
    }

    loadingState.style.display = 'flex';
    loadingText.textContent = `Đang ghép ${selectedSlices.length} phần ảnh đã chọn...`;
    galleryView.style.display = 'none';
    mergedView.style.display = 'none';

    try {
      // 1. Load all selected slice images in parallel
      const loadedImages = await Promise.all(
        selectedSlices.map(slice => loadImage(slice.dataUrl))
      );

      const firstImg = loadedImages[0];
      const canvasWidth = firstImg.width;

      // 2. Calculate canvas total height
      let computedHeight = 0;
      const isAllSelected = selectedSlices.length === slicesState.length;

      if (isAllSelected) {
        // Continuous full page scroll formula
        const lastIdx = selectedSlices.length - 1;
        const lastSlice = selectedSlices[lastIdx];
        const lastImg = loadedImages[lastIdx];
        const ratio = firstImg.width / lastSlice.viewportWidth;
        computedHeight = Math.round(lastSlice.y * ratio + lastImg.height);
      } else {
        // Sequential stacking formula for custom selected subset
        computedHeight = loadedImages.reduce((sum, img) => sum + img.height, 0);
      }

      if (computedHeight <= 0) {
        computedHeight = loadedImages.reduce((sum, img) => sum + img.height, 0);
      }

      // 3. Canvas safety check (Max ~32,000px height for browser canvas limit)
      const MAX_CANVAS_HEIGHT = 32000;
      let targetWidth = canvasWidth;
      let targetHeight = computedHeight;
      let scaleRatio = 1.0;

      if (computedHeight > MAX_CANVAS_HEIGHT) {
        scaleRatio = MAX_CANVAS_HEIGHT / computedHeight;
        targetHeight = MAX_CANVAS_HEIGHT;
        targetWidth = Math.round(canvasWidth * scaleRatio);
      }

      // 4. Create and draw onto canvas
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      let currentDrawY = 0;
      for (let i = 0; i < selectedSlices.length; i++) {
        const slice = selectedSlices[i];
        const img = loadedImages[i];

        let sliceY = 0;
        if (isAllSelected) {
          sliceY = Math.round(slice.y * (canvasWidth / slice.viewportWidth) * scaleRatio);
        } else {
          sliceY = currentDrawY;
          currentDrawY += Math.round(img.height * scaleRatio);
        }

        ctx.drawImage(img, 0, sliceY, targetWidth, Math.round(img.height * scaleRatio));
      }

      // 5. Export canvas to PNG Blob
      await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Không thể tạo hình ảnh PNG từ canvas.'));
            return;
          }

          currentBlob = blob;
          currentDataUrl = URL.createObjectURL(blob);
          finalWidth = targetWidth;
          finalHeight = targetHeight;

          displayFinalImage(currentDataUrl, targetWidth, targetHeight, blob.size);
          isStitched = true;
          tabMergedStatus.classList.add('stitched');
          tabMergedStatus.title = 'Đã ghép hoàn tất';
          resolve();
        }, 'image/png', 1.0);
      });

      loadingState.style.display = 'none';
      return true;
    } catch (err) {
      console.error('Lỗi khi ghép ảnh:', err);
      loadingState.style.display = 'none';
      alert('Đã xảy ra lỗi khi ghép ảnh: ' + (err.message || err));
      return false;
    }
  }

  // Display stitched image & setup zoom fit
  function displayFinalImage(url, width, height, bytes) {
    previewImg.src = url;
    loadingState.style.display = 'none';
    unstitchedPrompt.style.display = 'none';
    imageWrapper.style.display = 'inline-block';
    zoomToolbar.style.display = 'flex';

    infoDimensionsEl.textContent = `${width} × ${height} px`;
    infoFormatEl.textContent = 'PNG';
    infoSizeEl.textContent = formatBytes(bytes);
    imageInfoPill.style.display = 'flex';

    autoFitToWindow();
  }

  // ==========================================================================
  // VIEW NAVIGATION (GALLERY <-> MERGED)
  // ==========================================================================

  function switchToGalleryView() {
    currentViewMode = 'GALLERY';
    tabGallery.classList.add('active');
    tabMerged.classList.remove('active');

    galleryView.style.display = 'flex';
    mergedView.style.display = 'none';
    loadingState.style.display = 'none';

    actionsGallery.style.display = 'flex';
    actionsMerged.style.display = 'none';
    imageInfoPill.style.display = 'none';
    zoomToolbar.style.display = 'none';
  }

  async function switchToMergedView() {
    currentViewMode = 'MERGED';
    tabMerged.classList.add('active');
    tabGallery.classList.remove('active');

    galleryView.style.display = 'none';
    mergedView.style.display = 'flex';
    actionsGallery.style.display = 'none';
    actionsMerged.style.display = 'flex';

    if (isStitched && currentDataUrl) {
      unstitchedPrompt.style.display = 'none';
      imageWrapper.style.display = 'inline-block';
      zoomToolbar.style.display = 'flex';
      imageInfoPill.style.display = 'flex';
      autoFitToWindow();
    } else {
      // Prompt user to stitch
      imageWrapper.style.display = 'none';
      zoomToolbar.style.display = 'none';
      imageInfoPill.style.display = 'none';
      unstitchedPrompt.style.display = 'flex';
    }
  }

  // Tab click events
  tabGallery.addEventListener('click', switchToGalleryView);

  tabMerged.addEventListener('click', async () => {
    if (!isStitched) {
      // Switch to merged tab where prompt is shown, or user can click stitch
      switchToMergedView();
    } else {
      switchToMergedView();
    }
  });

  btnBackToGallery.addEventListener('click', switchToGalleryView);

  // Stitch triggers
  btnStitch.addEventListener('click', async () => {
    const success = await performStitch();
    if (success) {
      switchToMergedView();
      showToast('✨ Ghép các phần ảnh thành công!', 2500);
    }
  });

  btnQuickStitch.addEventListener('click', async () => {
    const success = await performStitch();
    if (success) {
      switchToMergedView();
      showToast('✨ Ghép các phần ảnh thành công!', 2500);
    }
  });

  btnPromptStitch.addEventListener('click', async () => {
    const success = await performStitch();
    if (success) {
      switchToMergedView();
      showToast('✨ Ghép các phần ảnh thành công!', 2500);
    }
  });

  // ==========================================================================
  // DOWNLOAD & EXPORT HANDLERS (ZIP & PNG)
  // ==========================================================================

  let isZipPackaging = false;
  let zipCancelRequested = false;

  // Toggle download options dropdown
  if (btnDownloadOptions && downloadDropdownMenu) {
    btnDownloadOptions.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = downloadDropdownMenu.style.display !== 'none';
      downloadDropdownMenu.style.display = isVisible ? 'none' : 'flex';
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.download-btn-group')) {
        downloadDropdownMenu.style.display = 'none';
      }
    });
  }

  // Dropdown option: Download ZIP
  if (optDownloadZip) {
    optDownloadZip.addEventListener('click', () => {
      if (downloadDropdownMenu) downloadDropdownMenu.style.display = 'none';
      handleZipDownload();
    });
  }

  // Dropdown option: Download Separate PNGs
  if (optDownloadSeparate) {
    optDownloadSeparate.addEventListener('click', () => {
      if (downloadDropdownMenu) downloadDropdownMenu.style.display = 'none';
      handleSeparateDownload();
    });
  }

  // Cancel ZIP packaging
  if (btnCancelZip) {
    btnCancelZip.addEventListener('click', () => {
      zipCancelRequested = true;
      if (zipModal) zipModal.style.display = 'none';
      isZipPackaging = false;
      showToast('Đã hủy quá trình đóng gói ZIP.');
    });
  }

  // Main Download Button: Auto ZIP for multiple images, direct PNG for single image
  btnDownloadAll.addEventListener('click', async () => {
    const selectedSlices = slicesState.filter(s => s.selected);
    if (selectedSlices.length === 0) {
      alert('Vui lòng chọn ít nhất một phần ảnh để tải về.');
      return;
    }

    if (selectedSlices.length === 1) {
      // If only 1 image selected, download directly as single PNG
      const slice = selectedSlices[0];
      downloadSingleSlice(slice, slice.index !== undefined ? slice.index : 0);
    } else {
      // 2 or more images (e.g. 50, 100 images): Pack into a clean ZIP file!
      await handleZipDownload();
    }
  });

  // Package all selected slices into a single ZIP archive
  async function handleZipDownload() {
    if (isZipPackaging) return;
    const selectedSlices = slicesState.filter(s => s.selected);
    if (selectedSlices.length === 0) {
      alert('Vui lòng chọn ít nhất một phần ảnh để tải về.');
      return;
    }

    if (typeof JSZip === 'undefined') {
      alert('Thư viện đóng gói ZIP chưa sẵn sàng. Đang chuyển sang tải từng ảnh...');
      await handleSeparateDownload();
      return;
    }

    isZipPackaging = true;
    zipCancelRequested = false;

    // Reset and show modal
    if (zipProgressBar) zipProgressBar.style.width = '0%';
    if (zipModalStatus) zipModalStatus.textContent = '0%';
    if (zipModalDesc) zipModalDesc.textContent = `Đang chuẩn bị đóng gói ${selectedSlices.length} ảnh...`;
    if (zipModal) zipModal.style.display = 'flex';

    try {
      const zip = new JSZip();

      // Determine padding digits based on total count (e.g. 100 slices -> "001", "002" ...)
      const padLen = Math.max(2, String(selectedSlices.length).length);

      // 1. Add all selected slices into the zip archive
      for (let i = 0; i < selectedSlices.length; i++) {
        if (zipCancelRequested) return;

        const slice = selectedSlices[i];
        const stepNum = i + 1;
        const padIndex = String(stepNum).padStart(padLen, '0');
        const fileName = `${defaultBaseName}-trang-${padIndex}.png`;

        // Strip data:image/...;base64, prefix for ultra-fast base64 memory loading
        const base64Data = slice.dataUrl.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
        zip.file(fileName, base64Data, { base64: true });

        // Update progress (adding phase: 0% -> 40%)
        const addPercent = Math.round((stepNum / selectedSlices.length) * 40);
        if (zipProgressBar) zipProgressBar.style.width = `${addPercent}%`;
        if (zipModalStatus) zipModalStatus.textContent = `${addPercent}%`;
        if (zipModalDesc) zipModalDesc.textContent = `Đang gom ảnh ${stepNum} / ${selectedSlices.length}...`;

        // Yield execution every 6 files to prevent UI freeze on large sets (e.g. 100 images)
        if (i % 6 === 0) {
          await sleep(15);
        }
      }

      if (zipCancelRequested) return;

      // 2. Add metadata readme file
      const infoContent = [
        `==================================================`,
        `Bộ ảnh chụp từ Web Capture Extension`,
        `==================================================`,
        `Tiêu đề trang: ${captureData?.pageTitle || 'Trang web'}`,
        `Địa chỉ URL: ${captureData?.pageUrl || '---'}`,
        `Tổng số phần ảnh: ${selectedSlices.length}`,
        `Thời gian chụp: ${new Date().toLocaleString('vi-VN')}`,
        `Thứ tự file: trang-001.png đến trang-${String(selectedSlices.length).padStart(padLen, '0')}.png`,
        `==================================================`
      ].join('\r\n');
      zip.file('thong-tin-chup.txt', infoContent);

      if (zipModalDesc) zipModalDesc.textContent = 'Đang nén dữ liệu vào file ZIP...';

      // 3. Generate ZIP binary blob with compression (compressing phase: 40% -> 100%)
      const zipBlob = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        },
        (metadata) => {
          if (zipCancelRequested) return;
          const compressPercent = 40 + Math.round(metadata.percent * 0.60);
          if (zipProgressBar) zipProgressBar.style.width = `${compressPercent}%`;
          if (zipModalStatus) zipModalStatus.textContent = `${compressPercent}%`;
          if (zipModalDesc) zipModalDesc.textContent = `Đang nén dữ liệu... ${Math.round(metadata.percent)}%`;
        }
      );

      if (zipCancelRequested) return;

      if (zipProgressBar) zipProgressBar.style.width = '100%';
      if (zipModalStatus) zipModalStatus.textContent = '100%';
      if (zipModalDesc) zipModalDesc.textContent = 'Hoàn tất! Đang tải file ZIP về máy...';
      await sleep(350);

      // Trigger download
      const zipFileName = `${defaultBaseName}.zip`;
      const blobUrl = URL.createObjectURL(zipBlob);
      downloadDataUrl(blobUrl, zipFileName);

      // Clean up memory
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

      showToast(`📦 Đã đóng gói thành công file ZIP chứa ${selectedSlices.length} ảnh!`, 3500);
    } catch (err) {
      console.error('Lỗi khi đóng gói file ZIP:', err);
      alert('Đã xảy ra lỗi khi tạo file ZIP: ' + (err.message || err));
    } finally {
      isZipPackaging = false;
      if (zipModal) zipModal.style.display = 'none';
    }
  }

  // Download slices individually
  async function handleSeparateDownload() {
    const selectedSlices = slicesState.filter(s => s.selected);
    if (selectedSlices.length === 0) {
      alert('Vui lòng chọn ít nhất một phần ảnh để tải về.');
      return;
    }

    if (selectedSlices.length > 15) {
      const confirmed = confirm(
        `Bạn đang chuẩn bị tải về ${selectedSlices.length} tệp ảnh riêng lẻ.\nTrình duyệt có thể hỏi xác nhận cho phép tải nhiều tệp.\n\nKhuyên dùng: Bạn nên chọn "Tải file ZIP" để đóng gói thành 1 tệp duy nhất.\n\nBạn có chắc chắn muốn tiếp tục tải lẻ không?`
      );
      if (!confirmed) return;
    }

    showToast(`⏳ Đang bắt đầu tải về ${selectedSlices.length} ảnh lẻ...`, 2000);

    const padLen = Math.max(2, String(selectedSlices.length).length);
    for (let i = 0; i < selectedSlices.length; i++) {
      const slice = selectedSlices[i];
      const padNum = String(i + 1).padStart(padLen, '0');
      const filename = `${defaultBaseName}-trang-${padNum}.png`;

      downloadDataUrl(slice.dataUrl, filename);
      await sleep(250); // slight delay between downloads to prevent browser choke
    }

    showToast(`✅ Đã tải về toàn bộ ${selectedSlices.length} ảnh!`, 3000);
  }

  // Download single slice
  function downloadSingleSlice(slice, index) {
    const padNum = String(index + 1).padStart(2, '0');
    const filename = `${defaultBaseName}-phan-${padNum}.png`;
    downloadDataUrl(slice.dataUrl, filename);
    showToast(`Đang tải ảnh phần #${index + 1}...`, 2000);
  }

  // Download stitched full image
  btnDownload.addEventListener('click', () => {
    if (!currentDataUrl) return;
    downloadDataUrl(currentDataUrl, defaultFileName);
    showToast('Đang tải ảnh ghép về máy...', 2000);
  });

  function downloadDataUrl(url, filename) {
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  // ==========================================================================
  // COPY TO CLIPBOARD
  // ==========================================================================

  // Copy stitched image
  btnCopy.addEventListener('click', async () => {
    if (!currentBlob) return;
    await copyBlobToClipboard(currentBlob, btnCopy);
  });

  // Copy single slice
  async function copySliceToClipboard(slice, triggerBtn) {
    try {
      const response = await fetch(slice.dataUrl);
      const blob = await response.blob();
      await copyBlobToClipboard(blob, triggerBtn);
    } catch (err) {
      console.error('Lỗi copy slice:', err);
      alert('Không thể sao chép hình ảnh: ' + err.message);
    }
  }

  async function copyBlobToClipboard(blob, triggerBtn) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);

      if (triggerBtn) {
        const origHTML = triggerBtn.innerHTML;
        triggerBtn.innerHTML = `
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          ${triggerBtn.classList.contains('overlay-action-btn') || triggerBtn.classList.contains('btn-icon') ? '' : '<span>Đã sao chép!</span>'}
        `;
        setTimeout(() => {
          triggerBtn.innerHTML = origHTML;
        }, 2000);
      }
      showToast('📋 Đã sao chép hình ảnh vào bộ nhớ tạm!', 2500);
    } catch (err) {
      console.error('Lỗi khi sao chép:', err);
      alert('Không thể sao chép hình ảnh vào bộ nhớ tạm: ' + err.message);
    }
  }

  // ==========================================================================
  // LIGHTBOX MODAL HANDLERS
  // ==========================================================================

  function openLightbox(index) {
    if (index < 0 || index >= slicesState.length) return;
    currentLightboxIndex = index;

    const slice = slicesState[index];
    lightboxImg.src = slice.dataUrl;
    lightboxTitle.textContent = `Phần ảnh #${index + 1} / ${slicesState.length}`;
    lightboxMetaInfo.textContent = `Y: ${slice.y}px • ${slice.viewportWidth} × ${slice.sliceHeight || slice.viewportHeight} px`;

    lightboxModal.style.display = 'flex';
  }

  function closeLightbox() {
    lightboxModal.style.display = 'none';
  }

  btnLightboxClose.addEventListener('click', closeLightbox);
  lightboxBackdrop.addEventListener('click', closeLightbox);

  btnLightboxPrev.addEventListener('click', () => {
    if (currentLightboxIndex > 0) {
      openLightbox(currentLightboxIndex - 1);
    } else {
      openLightbox(slicesState.length - 1); // loop
    }
  });

  btnLightboxNext.addEventListener('click', () => {
    if (currentLightboxIndex < slicesState.length - 1) {
      openLightbox(currentLightboxIndex + 1);
    } else {
      openLightbox(0); // loop
    }
  });

  btnLightboxCopy.addEventListener('click', async () => {
    const slice = slicesState[currentLightboxIndex];
    if (slice) {
      await copySliceToClipboard(slice, btnLightboxCopy);
    }
  });

  btnLightboxDownload.addEventListener('click', () => {
    const slice = slicesState[currentLightboxIndex];
    if (slice) {
      downloadSingleSlice(slice, currentLightboxIndex);
    }
  });

  // Keyboard navigation for lightbox
  window.addEventListener('keydown', (e) => {
    if (lightboxModal.style.display === 'flex') {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') btnLightboxPrev.click();
      if (e.key === 'ArrowRight') btnLightboxNext.click();
    }
  });

  // ==========================================================================
  // ZOOM CONTROLS (MERGED VIEW)
  // ==========================================================================

  function setZoom(newZoom) {
    zoomLevel = Math.max(0.05, Math.min(4.0, newZoom));
    imageWrapper.style.transform = `scale(${zoomLevel})`;
    zoomLevelText.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  function autoFitToWindow() {
    const availableWidth = previewViewport.clientWidth - 80;
    if (finalWidth > 0 && availableWidth > 0 && finalWidth > availableWidth) {
      const fitZoom = availableWidth / finalWidth;
      setZoom(fitZoom);
    } else {
      setZoom(1.0);
    }
  }

  btnZoomOut.addEventListener('click', () => setZoom(zoomLevel - 0.15));
  btnZoomIn.addEventListener('click', () => setZoom(zoomLevel + 0.15));
  btnZoom100.addEventListener('click', () => setZoom(1.0));
  btnZoomFit.addEventListener('click', () => autoFitToWindow());

  // Mousewheel zoom with Ctrl/Cmd key
  previewViewport.addEventListener('wheel', (e) => {
    if (currentViewMode === 'MERGED' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(zoomLevel + delta);
    }
  }, { passive: false });

  // ==========================================================================
  // UTILITY HELPERS
  // ==========================================================================

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  let toastTimeout = null;
  function showToast(message, duration = 2500) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  function showError(msg) {
    loadingState.innerHTML = `
      <div style="color: #ef4444; font-size: 16px; font-weight: 700; margin-bottom: 6px;">Đã xảy ra lỗi</div>
      <div style="color: #94a3b8; font-size: 13.5px;">${msg}</div>
    `;
    loadingState.style.display = 'flex';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
});
