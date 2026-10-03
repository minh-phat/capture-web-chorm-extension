// Content script for Full Page Screenshot & Web Capture

(function () {
  // Prevent duplicate injection
  if (window.__webCaptureInjected) return;
  window.__webCaptureInjected = true;

  let isCapturing = false;
  let cancelRequested = false;
  let stopRequested = false;
  let hiddenElementsMap = new Map();
  let originalScrollPos = { x: 0, y: 0 };

  // Listen for messages from popup or service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PING') {
      sendResponse({ status: 'READY' });
      return true;
    }

    if (message.action === 'START_FULL_PAGE_CAPTURE') {
      if (isCapturing) {
        sendResponse({ status: 'ALREADY_RUNNING' });
        return true;
      }
      const scrollDelay = message.scrollDelay || 400;
      runFullPageCapture(scrollDelay, {
        sliceHeight: message.sliceHeight || null,
        xFrom: (message.xFrom !== null && message.xFrom !== undefined) ? message.xFrom : null,
        xTo: (message.xTo !== null && message.xTo !== undefined) ? message.xTo : null
      });
      sendResponse({ status: 'STARTED' });
      return true;
    }

    if (message.action === 'START_VISIBLE_CAPTURE') {
      runVisibleCapture();
      sendResponse({ status: 'STARTED' });
      return true;
    }

    if (message.action === 'CANCEL_CAPTURE') {
      cancelRequested = true;
      sendResponse({ status: 'CANCELLED' });
      return true;
    }

    if (message.action === 'STOP_CAPTURE') {
      stopRequested = true;
      sendResponse({ status: 'STOPPED' });
      return true;
    }

    if (message.action === 'TOGGLE_COORD_INSPECTOR') {
      if (message.active) {
        startCoordInspector();
      } else {
        stopCoordInspector();
      }
      sendResponse({ status: 'OK' });
      return true;
    }
  });

  // Send progress update to popup (via background relay or direct runtime message)
  function sendProgressToPopup(percent, currentStep, totalSteps) {
    try {
      chrome.runtime.sendMessage({
        action: 'CAPTURE_PROGRESS',
        percent: percent,
        currentStep: currentStep,
        totalSteps: totalSteps
      });
    } catch (e) {
      // Popup may have been closed - ignore
    }
  }

  // Main full page capture runner
  async function runFullPageCapture(scrollDelay, cropOptions = {}) {
    isCapturing = true;
    cancelRequested = false;
    stopRequested = false;
    originalScrollPos = { x: window.scrollX, y: window.scrollY };

    // Resolve crop options
    const customSliceHeight = (cropOptions.sliceHeight && cropOptions.sliceHeight > 0)
      ? Math.floor(cropOptions.sliceHeight) : null;
    const xFromPx = (cropOptions.xFrom !== null && cropOptions.xFrom !== undefined && cropOptions.xFrom >= 0)
      ? Math.floor(cropOptions.xFrom) : null;
    const xToPx = (cropOptions.xTo !== null && cropOptions.xTo !== undefined && cropOptions.xTo > 0)
      ? Math.floor(cropOptions.xTo) : null;

    // Temporarily hide scrollbar so it doesn't appear in the captured images
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // Disable smooth scroll temporarily for precise positioning
    const originalScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';

    try {
      // 0. Notify background worker to reset slice storage
      await startCaptureSession();

      // 1. Hide sticky & fixed elements so they don't duplicate on every slice
      hideStickyElements();

      // 2. Determine full page metrics
      const totalWidth = Math.max(
        document.documentElement.clientWidth,
        document.body.clientWidth,
        document.documentElement.scrollWidth,
        document.body.scrollWidth
      );
      const totalHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const devicePixelRatio = window.devicePixelRatio || 1;

      // Determine effective slice height (custom or viewport height)
      const effectiveSliceH = customSliceHeight
        ? Math.min(customSliceHeight, viewportHeight)
        : viewportHeight;

      // Determine effective X crop bounds (in CSS pixels)
      const effectiveXFrom = (xFromPx !== null) ? Math.max(0, xFromPx) : 0;
      const effectiveXTo   = (xToPx !== null)   ? Math.min(xToPx, totalWidth) : totalWidth;
      const effectiveCropWidth = Math.max(1, effectiveXTo - effectiveXFrom);
      const hasCrop = (effectiveXFrom > 0 || effectiveXTo < totalWidth);

      let currentY = 0;
      const totalSteps = Math.ceil(totalHeight / effectiveSliceH);
      let stepIndex = 0;
      let lastScrollY = 0;
      let lastSliceHeight = 0;

      while (currentY < totalHeight && !cancelRequested && !stopRequested) {
        // Scroll to position
        window.scrollTo(0, currentY);

        // Wait for smooth scroll / lazy loading images to render
        await sleep(scrollDelay);

        // Wait for visible images to load if lazy
        await triggerAndWaitLazyImages();

        // Calculate actual visible height for the slice (last slice may be partial)
        const actualScrollY = window.scrollY;
        const sliceHeight = Math.min(effectiveSliceH, totalHeight - actualScrollY);
        lastScrollY = actualScrollY;
        lastSliceHeight = sliceHeight;

        stepIndex++;
        const percent = Math.min(100, Math.round((stepIndex / totalSteps) * 100));

        // Wait a frame to ensure page is fully repainted before capture
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

        // If X-crop is required: capture raw then crop via canvas before storing
        let storeResult;
        if (hasCrop) {
          const rawDataUrl = await requestSliceCapture();
          if (!rawDataUrl) throw new Error('Không thể chụp ảnh');
          const croppedDataUrl = await cropDataUrl(
            rawDataUrl,
            effectiveXFrom * devicePixelRatio,
            0,
            effectiveCropWidth * devicePixelRatio,
            sliceHeight * devicePixelRatio
          );
          storeResult = await storeSliceDataUrl(stepIndex - 1, croppedDataUrl, actualScrollY, effectiveCropWidth, viewportHeight, sliceHeight);
        } else {
          storeResult = await requestSliceStore({
            index: stepIndex - 1,
            y: actualScrollY,
            viewportWidth: viewportWidth,
            viewportHeight: viewportHeight,
            sliceHeight: sliceHeight
          });
        }

        // Update progress in popup
        sendProgressToPopup(percent, stepIndex, totalSteps);

        if (!storeResult || storeResult.error) {
          throw new Error('Đã xảy ra lỗi khi chụp: ' + (storeResult?.error || 'Lỗi chụp ảnh'));
        }

        // Advance Y offset
        if (currentY + effectiveSliceH >= totalHeight) {
          break; // Reached bottom
        }
        currentY += effectiveSliceH;
      }


      // Restore scroll behavior & overflow
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      document.body.style.scrollBehavior = originalScrollBehavior;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;

      // Scroll back to original position
      window.scrollTo(originalScrollPos.x, originalScrollPos.y);
      restoreStickyElements();

      if (cancelRequested) {
        isCapturing = false;
        chrome.runtime.sendMessage({ action: 'CAPTURE_CANCELLED' });
        return;
      }

      // Nếu người dùng nhấn "Dừng & Lưu": gửi phần ảnh đã chụp được
      if (stopRequested && stepIndex > 0) {
        chrome.runtime.sendMessage({
          action: 'FINISH_FULL_PAGE_CAPTURE',
          data: {
            sliceCount: stepIndex,
            totalWidth: hasCrop ? effectiveCropWidth : totalWidth,
            totalHeight: lastScrollY + lastSliceHeight,
            viewportWidth: hasCrop ? effectiveCropWidth : viewportWidth,
            viewportHeight: viewportHeight,
            devicePixelRatio: devicePixelRatio,
            pageTitle: document.title || 'Trang web',
            pageUrl: window.location.href
          }
        });
        isCapturing = false;
        return;
      }

      // Send captured slices info to background to process and open preview
      chrome.runtime.sendMessage({
        action: 'FINISH_FULL_PAGE_CAPTURE',
        data: {
          sliceCount: stepIndex,
          totalWidth: hasCrop ? effectiveCropWidth : totalWidth,
          totalHeight: totalHeight,
          viewportWidth: hasCrop ? effectiveCropWidth : viewportWidth,
          viewportHeight: viewportHeight,
          devicePixelRatio: devicePixelRatio,
          pageTitle: document.title || 'Trang web',
          pageUrl: window.location.href
        }
      });

    } catch (err) {
      console.error('Lỗi khi chụp trang web:', err);
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      document.body.style.scrollBehavior = originalScrollBehavior;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
      window.scrollTo(originalScrollPos.x, originalScrollPos.y);
      restoreStickyElements();
      try {
        chrome.runtime.sendMessage({ action: 'CAPTURE_CANCELLED' });
      } catch (e) {}
      alert('Đã xảy ra lỗi khi chụp hình toàn bộ trang web: ' + (err.message || err));
    } finally {
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      document.body.style.scrollBehavior = originalScrollBehavior;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
      isCapturing = false;
    }
  }

  // Single visible capture runner
  async function runVisibleCapture() {
    try {
      // Wait a brief moment for page to settle (popup is still open, not closed)
      await sleep(100);

      const devicePixelRatio = window.devicePixelRatio || 1;
      const sliceDataUrl = await requestSliceCapture();

      if (!sliceDataUrl) {
        alert('Không thể chụp hình vùng hiển thị.');
        return;
      }

      chrome.runtime.sendMessage({
        action: 'FINISH_VISIBLE_CAPTURE',
        data: {
          dataUrl: sliceDataUrl,
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: devicePixelRatio,
          pageTitle: document.title || 'Trang web',
          pageUrl: window.location.href
        }
      });
    } catch (err) {
      console.error('Lỗi chụp visible area:', err);
      try {
        chrome.runtime.sendMessage({ action: 'CAPTURE_CANCELLED' });
      } catch (e) {}
    }
  }

  // Start new capture session
  function startCaptureSession() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'START_CAPTURE_SESSION' }, () => {
        resolve();
      });
    });
  }

  // Request visible tab capture and store slice directly in storage
  function requestSliceStore(sliceMeta) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_AND_STORE_SLICE', data: sliceMeta }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Capture slice error:', chrome.runtime.lastError);
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { error: 'Không phản hồi' });
        }
      });
    });
  }

  // Store a pre-cropped dataUrl slice into storage (used when X-crop is applied)
  function storeSliceDataUrl(index, dataUrl, y, cropWidth, viewportHeight, sliceHeight) {
    return new Promise((resolve) => {
      const sliceData = {
        index: index,
        dataUrl: dataUrl,
        y: y,
        viewportWidth: cropWidth,
        viewportHeight: viewportHeight,
        sliceHeight: sliceHeight
      };
      const key = `slice_${index}`;
      chrome.storage.local.set({ [key]: sliceData }, () => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve({ status: 'OK' });
        }
      });
    });
  }

  // Crop a dataUrl image via canvas (all values in physical pixels)
  function cropDataUrl(dataUrl, sx, sy, sw, sh) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Clamp to actual image bounds
        const safeX = Math.max(0, Math.min(sx, img.width));
        const safeY = Math.max(0, Math.min(sy, img.height));
        const safeW = Math.max(1, Math.min(sw, img.width - safeX));
        const safeH = Math.max(1, Math.min(sh, img.height - safeY));
        const canvas = document.createElement('canvas');
        canvas.width = safeW;
        canvas.height = safeH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, safeX, safeY, safeW, safeH, 0, 0, safeW, safeH);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // Request visible tab capture from Service Worker
  function requestSliceCapture() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.dataUrl) {
          console.warn('Capture error:', chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(response.dataUrl);
        }
      });
    });
  }

  // Hide position: fixed / position: sticky elements except our HUD
  function hideStickyElements() {
    hiddenElementsMap.clear();
    const allElements = document.querySelectorAll('*');

    allElements.forEach((el) => {
      try {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          hiddenElementsMap.set(el, {
            visibility: el.style.visibility,
            opacity: el.style.opacity
          });
          el.style.visibility = 'hidden';
        }
      } catch (e) {
        // Ignore un-computable elements
      }
    });
  }

  // Restore hidden sticky elements
  function restoreStickyElements() {
    hiddenElementsMap.forEach((origStyles, el) => {
      try {
        el.style.visibility = origStyles.visibility;
        el.style.opacity = origStyles.opacity;
      } catch (e) { }
    });
    hiddenElementsMap.clear();
  }

  // Wait for images in viewport to finish loading (essential for comic/manga readers)
  function triggerAndWaitLazyImages() {
    return new Promise((resolve) => {
      const images = Array.from(document.querySelectorAll('img'));
      const pendingImages = images.filter(img => {
        const rect = img.getBoundingClientRect();
        const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
        return isInViewport && !img.complete && img.src;
      });

      if (pendingImages.length === 0) {
        resolve();
        return;
      }

      let loadedCount = 0;
      const timer = setTimeout(() => {
        resolve(); // Timeout fallback (500ms max wait)
      }, 500);

      const checkDone = () => {
        loadedCount++;
        if (loadedCount >= pendingImages.length) {
          clearTimeout(timer);
          resolve();
        }
      };

      pendingImages.forEach(img => {
        if (img.complete) {
          checkDone();
        } else {
          img.addEventListener('load', checkDone, { once: true });
          img.addEventListener('error', checkDone, { once: true });
        }
      });
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Coordinate Inspector
  // ============================================================
  let coordInspectorEl = null;
  let coordMouseHandler = null;
  let coordClickHandler = null;
  let coordKeyHandler = null;

  function startCoordInspector() {
    if (coordInspectorEl) return; // already active

    // Create floating tooltip
    coordInspectorEl = document.createElement('div');
    coordInspectorEl.id = 'web-capture-coord-inspector';
    coordInspectorEl.innerHTML = `
      <div class="wcci-header">
        <span class="wcci-dot"></span>
        <span class="wcci-title">Toạ độ — Web Capture</span>
        <button class="wcci-close" title="Đóng (Esc)">×</button>
      </div>
      <div class="wcci-body">
        <div class="wcci-row"><span class="wcci-lbl">X (CSS):</span><span class="wcci-val" id="wcci-x">-</span></div>
        <div class="wcci-row"><span class="wcci-lbl">Y (CSS):</span><span class="wcci-val" id="wcci-y">-</span></div>
        <div class="wcci-row"><span class="wcci-lbl">Scroll Y:</span><span class="wcci-val" id="wcci-sy">-</span></div>
        <div class="wcci-row wcci-abs"><span class="wcci-lbl">X abs:</span><span class="wcci-val" id="wcci-ax">-</span></div>
        <div class="wcci-row wcci-abs"><span class="wcci-lbl">Y abs:</span><span class="wcci-val" id="wcci-ay">-</span></div>
      </div>
      <div class="wcci-hint">Click trang = copy toạ độ</div>
      <div class="wcci-copied" id="wcci-copied">✓ Đã copy!</div>
    `;
    document.body.appendChild(coordInspectorEl);

    // Mouse move handler
    coordMouseHandler = (e) => {
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const cssX = Math.round(e.clientX);
      const cssY = Math.round(e.clientY);
      const absX = Math.round(e.clientX + scrollX);
      const absY = Math.round(e.clientY + scrollY);

      document.getElementById('wcci-x').textContent  = cssX + ' px';
      document.getElementById('wcci-y').textContent  = cssY + ' px';
      document.getElementById('wcci-sy').textContent = Math.round(scrollY) + ' px';
      document.getElementById('wcci-ax').textContent = absX + ' px';
      document.getElementById('wcci-ay').textContent = absY + ' px';

      // Position tooltip near cursor, keep within viewport
      const el = coordInspectorEl;
      const margin = 18;
      let left = e.clientX + margin;
      let top  = e.clientY + margin;
      if (left + el.offsetWidth + margin > window.innerWidth)  left = e.clientX - el.offsetWidth - margin;
      if (top  + el.offsetHeight + margin > window.innerHeight) top  = e.clientY - el.offsetHeight - margin;
      el.style.left = Math.max(4, left) + 'px';
      el.style.top  = Math.max(4, top)  + 'px';
    };

    // Click on page = copy coordinates to clipboard
    coordClickHandler = (e) => {
      if (e.target.closest('#web-capture-coord-inspector')) return;
      e.preventDefault();
      e.stopPropagation();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const absX = Math.round(e.clientX + scrollX);
      const absY = Math.round(e.clientY + scrollY);
      const cssX = Math.round(e.clientX);
      const text = `X=${cssX}px (abs=${absX}px), ScrollY=${Math.round(scrollY)}px, absY=${absY}px`;
      try {
        navigator.clipboard.writeText(text);
      } catch (err) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const copied = document.getElementById('wcci-copied');
      if (copied) {
        copied.style.opacity = '1';
        setTimeout(() => { copied.style.opacity = '0'; }, 1800);
      }
    };

    // Esc key to close
    coordKeyHandler = (e) => {
      if (e.key === 'Escape') stopCoordInspector();
    };

    // Close button
    const closeBtn = coordInspectorEl.querySelector('.wcci-close');
    if (closeBtn) closeBtn.addEventListener('click', stopCoordInspector);

    document.addEventListener('mousemove', coordMouseHandler, true);
    document.addEventListener('click', coordClickHandler, true);
    document.addEventListener('keydown', coordKeyHandler, true);
  }

  function stopCoordInspector() {
    if (coordInspectorEl) {
      coordInspectorEl.remove();
      coordInspectorEl = null;
    }
    if (coordMouseHandler) document.removeEventListener('mousemove', coordMouseHandler, true);
    if (coordClickHandler) document.removeEventListener('click', coordClickHandler, true);
    if (coordKeyHandler)   document.removeEventListener('keydown', coordKeyHandler, true);
    coordMouseHandler = null;
    coordClickHandler = null;
    coordKeyHandler   = null;
  }

})();
