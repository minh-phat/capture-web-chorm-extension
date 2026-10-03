// Popup UI script

document.addEventListener('DOMContentLoaded', async () => {
  const btnFullPage = document.getElementById('btn-full-page');
  const btnVisibleArea = document.getElementById('btn-visible-area');
  const btnOpenRecent = document.getElementById('btn-open-recent');
  const speedBtns = document.querySelectorAll('.speed-btn');
  const checkShowGallery = document.getElementById('check-show-gallery');
  const inputSliceHeight = document.getElementById('input-slice-height');
  const inputXFrom = document.getElementById('input-x-from');
  const inputXTo = document.getElementById('input-x-to');
  const btnCoordInspector = document.getElementById('btn-coord-inspector');

  // Capture screen elements
  const captureScreen = document.getElementById('capture-screen');
  const captureStatusText = document.getElementById('capture-status-text');
  const captureProgressBar = document.getElementById('capture-progress-bar');
  const captureStepText = document.getElementById('capture-step-text');
  const capturePercentText = document.getElementById('capture-percent-text');
  const captureCancelBtn = document.getElementById('capture-cancel-btn');
  const captureStopBtn = document.getElementById('capture-stop-btn');

  let selectedDelay = 400;
  let showGalleryFirst = true;
  let captureTabId = null;
  let isCapturing = false;
  let coordInspectorActive = false;

  // Load saved settings if present
  try {
    const data = await chrome.storage.local.get(['scrollDelay', 'showGalleryFirst', 'sliceHeight', 'xFrom', 'xTo']);
    if (data && data.scrollDelay) {
      selectedDelay = data.scrollDelay;
      speedBtns.forEach(btn => {
        if (parseInt(btn.dataset.delay, 10) === selectedDelay) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    if (data && data.showGalleryFirst !== undefined) {
      showGalleryFirst = !!data.showGalleryFirst;
      if (checkShowGallery) {
        checkShowGallery.checked = showGalleryFirst;
      }
    } else {
      chrome.storage.local.set({ showGalleryFirst: true });
    }

    // Restore advanced crop settings
    if (data && data.sliceHeight) inputSliceHeight.value = data.sliceHeight;
    if (data && data.xFrom !== undefined && data.xFrom !== null) inputXFrom.value = data.xFrom;
    if (data && data.xTo) inputXTo.value = data.xTo;
  } catch (e) {}

  // Persist advanced settings on change
  inputSliceHeight.addEventListener('change', () => {
    const val = parseInt(inputSliceHeight.value, 10);
    chrome.storage.local.set({ sliceHeight: isNaN(val) ? null : val });
  });
  inputXFrom.addEventListener('change', () => {
    const val = parseInt(inputXFrom.value, 10);
    chrome.storage.local.set({ xFrom: isNaN(val) ? null : val });
  });
  inputXTo.addEventListener('change', () => {
    const val = parseInt(inputXTo.value, 10);
    chrome.storage.local.set({ xTo: isNaN(val) ? null : val });
  });

  // Coordinate Inspector toggle
  btnCoordInspector.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
      alert('Không thể dùng tính năng này trên trang hệ thống của trình duyệt.');
      return;
    }
    try {
      await ensureContentScriptInjected(tab.id);
      coordInspectorActive = !coordInspectorActive;
      chrome.tabs.sendMessage(tab.id, {
        action: 'TOGGLE_COORD_INSPECTOR',
        active: coordInspectorActive
      });
      if (coordInspectorActive) {
        btnCoordInspector.classList.add('active');
        btnCoordInspector.textContent = '🟡 Đang kiểm tra toạ độ — Click để tắt';
        // close popup so user can hover on the page
        window.close();
      } else {
        btnCoordInspector.classList.remove('active');
        btnCoordInspector.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Bật kiểm tra toạ độ chuột trên trang`;
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // Toggle show gallery setting
  if (checkShowGallery) {
    checkShowGallery.addEventListener('change', () => {
      showGalleryFirst = checkShowGallery.checked;
      chrome.storage.local.set({ showGalleryFirst: showGalleryFirst });
    });
  }

  // Speed selection toggle
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDelay = parseInt(btn.dataset.delay, 10);
      chrome.storage.local.set({ scrollDelay: selectedDelay });
    });
  });

  // Listen for progress updates from content script via background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'CAPTURE_PROGRESS') {
      updateCaptureProgress(message.percent, message.currentStep, message.totalSteps);
    }
    if (message.action === 'CAPTURE_DONE') {
      // Capture completed - popup will be closed by background when preview tab opens
      hideCaptureScreen();
    }
    if (message.action === 'CAPTURE_CANCELLED') {
      hideCaptureScreen();
    }
  });

  // Cancel button inside progress screen
  captureCancelBtn.addEventListener('click', async () => {
    captureCancelBtn.disabled = true;
    captureStopBtn.disabled = true;
    if (captureTabId) {
      chrome.tabs.sendMessage(captureTabId, { action: 'CANCEL_CAPTURE' });
    }
    hideCaptureScreen();
  });

  // Stop & Save button inside progress screen
  captureStopBtn.addEventListener('click', async () => {
    if (!captureTabId) return;
    captureStopBtn.disabled = true;
    captureCancelBtn.disabled = true;
    captureStatusText.textContent = 'Đang lưu ảnh đã chụp...';
    captureStepText.textContent = 'Vui lòng chờ...';
    chrome.tabs.sendMessage(captureTabId, { action: 'STOP_CAPTURE' });
  });

  // 1. Full Page Capture Click
  btnFullPage.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      alert('Không thể xác định trang web hiện tại.');
      return;
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      alert('Không thể chụp hình trên các trang hệ thống nội bộ của trình duyệt.');
      return;
    }

    try {
      await ensureContentScriptInjected(tab.id);

      captureTabId = tab.id;
      showCaptureScreen('Đang chụp toàn bộ trang...');

      const sliceH = parseInt(inputSliceHeight.value, 10);
      const xFromV = parseInt(inputXFrom.value, 10);
      const xToV = parseInt(inputXTo.value, 10);

      chrome.tabs.sendMessage(tab.id, {
        action: 'START_FULL_PAGE_CAPTURE',
        scrollDelay: selectedDelay,
        sliceHeight: isNaN(sliceH) ? null : sliceH,
        xFrom: isNaN(xFromV) ? null : xFromV,
        xTo: isNaN(xToV) ? null : xToV
      });
      // Do NOT close popup - keep it open to show progress
    } catch (err) {
      console.error(err);
      alert('Không thể kết nối với trang web: ' + err.message);
    }
  });

  // 2. Visible Area Capture Click
  btnVisibleArea.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      alert('Không thể chụp hình trên các trang hệ thống nội bộ của trình duyệt.');
      return;
    }

    try {
      await ensureContentScriptInjected(tab.id);

      captureTabId = tab.id;
      showCaptureScreen('Đang chụp màn hình hiện tại...');

      chrome.tabs.sendMessage(tab.id, { action: 'START_VISIBLE_CAPTURE' });
      // Do NOT close popup
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // 3. Open Recent Preview
  btnOpenRecent.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });
    window.close();
  });

  // ---- Capture Screen helpers ----
  function showCaptureScreen(statusText) {
    isCapturing = true;
    captureStatusText.textContent = statusText || 'Đang chuẩn bị chụp...';
    captureProgressBar.style.width = '0%';
    captureStepText.textContent = 'Bắt đầu...';
    capturePercentText.textContent = '0%';
    captureStopBtn.disabled = false;
    captureCancelBtn.disabled = false;
    captureScreen.style.display = 'flex';
  }

  function hideCaptureScreen() {
    isCapturing = false;
    captureTabId = null;
    captureScreen.style.display = 'none';
  }

  function updateCaptureProgress(percent, currentStep, totalSteps) {
    captureProgressBar.style.width = `${percent}%`;
    capturePercentText.textContent = `${percent}%`;
    if (currentStep !== undefined && totalSteps !== undefined) {
      captureStepText.textContent = `Bước ${currentStep} / ${totalSteps}`;
    }
    if (percent >= 100) {
      captureStatusText.textContent = 'Hoàn tất! Đang mở xem trước...';
      captureStepText.textContent = 'Ghép ảnh...';
    }
  }

  // Helper: Ensure content script is loaded on the page
  async function ensureContentScriptInjected(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, async (response) => {
        if (response && response.status === 'READY') {
          resolve();
        } else {
          try {
            await chrome.scripting.insertCSS({
              target: { tabId: tabId },
              files: ['content/content.css']
            });
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['content/content.js']
            });
            resolve();
          } catch (e) {
            reject(new Error('Vui lòng làm mới (F5) trang web trước khi chụp.'));
          }
        }
      });
    });
  }
});
