// Preview viewer script: Handles image canvas stitching, zoom controls, download, and copy

document.addEventListener('DOMContentLoaded', async () => {
  const pageTitleEl = document.getElementById('page-title');
  const pageUrlEl = document.getElementById('page-url');
  const infoDimensionsEl = document.getElementById('info-dimensions');
  const infoFormatEl = document.getElementById('info-format');
  const infoSizeEl = document.getElementById('info-size');

  const btnDownload = document.getElementById('btn-download');
  const btnCopy = document.getElementById('btn-copy');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const btnZoom100 = document.getElementById('btn-zoom-100');
  const zoomLevelText = document.getElementById('zoom-level-text');

  const previewViewport = document.getElementById('preview-viewport');
  const loadingState = document.getElementById('loading-state');
  const loadingText = document.getElementById('loading-text');
  const imageWrapper = document.getElementById('image-wrapper');
  const previewImg = document.getElementById('preview-img');

  let currentBlob = null;
  let currentDataUrl = null;
  let finalWidth = 0;
  let finalHeight = 0;
  let zoomLevel = 1.0;
  let defaultFileName = 'web-capture.png';

  // Load capture data from storage
  try {
    const data = await chrome.storage.local.get('latestCaptureData');
    if (!data || !data.latestCaptureData) {
      showError('Không tìm thấy dữ liệu ảnh đã chụp.');
      return;
    }

    const capture = data.latestCaptureData;
    setupPageMeta(capture);

    if (capture.type === 'FULL_PAGE') {
      await processFullPageSlices(capture);
    } else {
      await processVisibleCapture(capture);
    }
  } catch (err) {
    console.error('Lỗi khi tải preview:', err);
    showError('Không thể tạo hình ảnh xem trước: ' + err.message);
  }

  // Setup title & domain meta info
  function setupPageMeta(capture) {
    pageTitleEl.textContent = capture.pageTitle || 'Trang web';
    pageUrlEl.textContent = capture.pageUrl || '';

    // Generate smart filename
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
    defaultFileName = `web-capture-${domain}-${dateStr}-${timeStr}.png`;
  }

  // Canvas stitcher for Full Page Slices
  async function processFullPageSlices(capture) {
    let slices = capture.slices;

    // Load slices from storage keys if stored individually
    if (!slices && capture.sliceCount > 0) {
      loadingText.textContent = `Đang tải ${capture.sliceCount} phần ảnh toàn bộ trang...`;
      const sliceKeys = Array.from({ length: capture.sliceCount }, (_, i) => `slice_${i}`);
      const storageData = await chrome.storage.local.get(sliceKeys);
      slices = sliceKeys.map(key => storageData[key]).filter(Boolean);
    }

    if (!slices || slices.length === 0) {
      showError('Dữ liệu các phần ảnh bị thiếu hoặc đã bị xóa.');
      return;
    }

    loadingText.textContent = `Đang ghép ${slices.length} phần ảnh toàn bộ trang...`;

    // Load all slice images in parallel
    const loadedImages = await Promise.all(
      slices.map(slice => loadImage(slice.dataUrl))
    );

    // Calculate canvas size
    const firstImg = loadedImages[0];
    const canvasWidth = firstImg.width;

    // Total height calculation based on slices
    let computedHeight = 0;
    for (let i = 0; i < slices.length; i++) {
      if (i === slices.length - 1) {
        // Last slice might be partial slice
        const ratio = firstImg.width / slices[i].viewportWidth;
        computedHeight = Math.round(slices[i].y * ratio + loadedImages[i].height);
      }
    }
    if (computedHeight <= 0) {
      computedHeight = loadedImages.reduce((sum, img) => sum + img.height, 0);
    }

    // Canvas height safety check (Max ~32,000px height)
    const MAX_CANVAS_HEIGHT = 32000;
    let targetWidth = canvasWidth;
    let targetHeight = computedHeight;
    let scaleRatio = 1.0;

    if (computedHeight > MAX_CANVAS_HEIGHT) {
      scaleRatio = MAX_CANVAS_HEIGHT / computedHeight;
      targetHeight = MAX_CANVAS_HEIGHT;
      targetWidth = Math.round(canvasWidth * scaleRatio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    // Render slices onto canvas
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      const img = loadedImages[i];
      const sliceY = Math.round(slice.y * (canvasWidth / slice.viewportWidth) * scaleRatio);

      ctx.drawImage(img, 0, sliceY, targetWidth, Math.round(img.height * scaleRatio));
    }

    // Export canvas to Blob
    canvas.toBlob((blob) => {
      if (!blob) {
        showError('Không thể tạo hình ảnh PNG từ canvas.');
        return;
      }

      currentBlob = blob;
      currentDataUrl = URL.createObjectURL(blob);

      finalWidth = targetWidth;
      finalHeight = targetHeight;

      displayFinalImage(currentDataUrl, targetWidth, targetHeight, blob.size);
    }, 'image/png', 1.0);
  }

  // Single visible capture processor
  async function processVisibleCapture(capture) {
    loadingText.textContent = 'Đang tải hình ảnh...';
    const img = await loadImage(capture.dataUrl);

    // Convert dataUrl to blob for accurate file size calculation
    const response = await fetch(capture.dataUrl);
    const blob = await response.blob();

    currentBlob = blob;
    currentDataUrl = capture.dataUrl;
    finalWidth = img.width;
    finalHeight = img.height;

    displayFinalImage(currentDataUrl, img.width, img.height, blob.size);
  }

  // Display image & setup zoom fit
  function displayFinalImage(url, width, height, bytes) {
    previewImg.src = url;
    loadingState.style.display = 'none';
    imageWrapper.style.display = 'inline-block';

    infoDimensionsEl.textContent = `${width} x ${height} px`;
    infoFormatEl.textContent = 'PNG';
    infoSizeEl.textContent = formatBytes(bytes);

    // Auto fit to screen width initially if image is large
    autoFitToWindow();
  }

  // Zoom control helper functions
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

  // Toolbar Event Listeners
  btnZoomOut.addEventListener('click', () => setZoom(zoomLevel - 0.15));
  btnZoomIn.addEventListener('click', () => setZoom(zoomLevel + 0.15));
  btnZoom100.addEventListener('click', () => setZoom(1.0));
  btnZoomFit.addEventListener('click', () => autoFitToWindow());

  // Mousewheel Zooming
  previewViewport.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(zoomLevel + delta);
    }
  }, { passive: false });

  // Download Handler
  btnDownload.addEventListener('click', () => {
    if (!currentDataUrl) return;

    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: currentDataUrl,
        filename: defaultFileName,
        saveAs: true
      });
    } else {
      // Fallback anchor tag download
      const a = document.createElement('a');
      a.href = currentDataUrl;
      a.download = defaultFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });

  // Copy to Clipboard Handler
  btnCopy.addEventListener('click', async () => {
    if (!currentBlob) return;

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          [currentBlob.type]: currentBlob
        })
      ]);

      const origText = btnCopy.innerHTML;
      btnCopy.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Đã sao chép!
      `;
      setTimeout(() => {
        btnCopy.innerHTML = origText;
      }, 2000);
    } catch (err) {
      console.error('Lỗi khi copy:', err);
      alert('Không thể sao chép hình ảnh vào bộ nhớ tạm: ' + err.message);
    }
  });

  // Helpers
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function showError(msg) {
    loadingState.innerHTML = `
      <div style="color: #ef4444; font-size: 16px; font-weight: 600;">Lỗi</div>
      <div style="color: #94a3b8; font-size: 14px;">${msg}</div>
    `;
  }
});
