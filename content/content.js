// Content script for Full Page Screenshot & Web Capture

(function () {
  // Prevent duplicate injection
  if (window.__webCaptureInjected) return;
  window.__webCaptureInjected = true;

  let isCapturing = false;
  let cancelRequested = false;
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
      runFullPageCapture(scrollDelay);
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
  });

  // Main full page capture runner
  async function runFullPageCapture(scrollDelay) {
    isCapturing = true;
    cancelRequested = false;
    originalScrollPos = { x: window.scrollX, y: window.scrollY };

    showHudOverlay();

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

      let currentY = 0;
      const totalSteps = Math.ceil(totalHeight / viewportHeight);
      let stepIndex = 0;

      // Disable smooth scroll temporarily for precise positioning
      const originalScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      document.body.style.scrollBehavior = 'auto';

      while (currentY < totalHeight && !cancelRequested) {
        // Scroll to position
        window.scrollTo(0, currentY);

        // Wait for smooth scroll / lazy loading images to render
        await sleep(scrollDelay);

        // Wait for visible images to load if lazy
        await triggerAndWaitLazyImages();

        // Calculate actual visible height for the slice (last slice may be partial)
        const actualScrollY = window.scrollY;
        const sliceHeight = Math.min(viewportHeight, totalHeight - actualScrollY);

        // Update progress HUD
        stepIndex++;
        const percent = Math.min(100, Math.round((stepIndex / totalSteps) * 100));
        updateHudProgress(percent, stepIndex, totalSteps);

        // Capture current viewport slice & store directly into background storage
        const storeResult = await requestSliceStore({
          index: stepIndex - 1,
          y: actualScrollY,
          viewportWidth: viewportWidth,
          viewportHeight: viewportHeight,
          sliceHeight: sliceHeight
        });

        if (!storeResult || storeResult.error) {
          throw new Error("Không thể chụp ảnh từ trình duyệt: " + (storeResult?.error || 'Lỗi chụp ảnh'));
        }

        // Advance Y offset
        if (currentY + viewportHeight >= totalHeight) {
          break; // Reached bottom
        }
        currentY += viewportHeight;
      }

      // Restore scroll behavior
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      document.body.style.scrollBehavior = originalScrollBehavior;

      // Scroll back to original position
      window.scrollTo(originalScrollPos.x, originalScrollPos.y);
      restoreStickyElements();
      removeHudOverlay();

      if (cancelRequested) {
        isCapturing = false;
        return;
      }

      // Send captured slices info to background to process and open preview
      chrome.runtime.sendMessage({
        action: 'FINISH_FULL_PAGE_CAPTURE',
        data: {
          sliceCount: stepIndex,
          totalWidth: totalWidth,
          totalHeight: totalHeight,
          viewportWidth: viewportWidth,
          viewportHeight: viewportHeight,
          devicePixelRatio: devicePixelRatio,
          pageTitle: document.title || 'Trang web',
          pageUrl: window.location.href
        }
      });

    } catch (err) {
      console.error('Lỗi khi chụp trang web:', err);
      window.scrollTo(originalScrollPos.x, originalScrollPos.y);
      restoreStickyElements();
      removeHudOverlay();
      alert('Đã xảy ra lỗi khi chụp hình toàn bộ trang web: ' + (err.message || err));
    } finally {
      isCapturing = false;
    }
  }

  // Single visible capture runner
  async function runVisibleCapture() {
    try {
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
      if (el.id === 'web-capture-progress-hud' || el.closest('#web-capture-progress-hud')) {
        return;
      }
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
      // Find all images near viewport
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

  // HUD Progress Overlay UI creation & management
  function showHudOverlay() {
    removeHudOverlay();

    const hud = document.createElement('div');
    hud.id = 'web-capture-progress-hud';
    hud.innerHTML = `
      <div class="web-capture-hud-header">
        <div class="web-capture-hud-title">
          <span class="web-capture-hud-spinner"></span>
          Đang chụp toàn bộ trang...
        </div>
        <div class="web-capture-hud-percent" id="web-capture-hud-percent">0%</div>
      </div>
      <div class="web-capture-progress-bar-bg">
        <div class="web-capture-progress-bar-fill" id="web-capture-hud-bar" style="width: 0%;"></div>
      </div>
      <div class="web-capture-hud-footer">
        <span id="web-capture-hud-step-text">Đang cuộn và chụp...</span>
        <button class="web-capture-cancel-btn" id="web-capture-cancel-btn">Hủy</button>
      </div>
    `;

    document.body.appendChild(hud);

    document.getElementById('web-capture-cancel-btn')?.addEventListener('click', () => {
      cancelRequested = true;
      removeHudOverlay();
    });
  }

  function updateHudProgress(percent, currentStep, totalSteps) {
    const percentEl = document.getElementById('web-capture-hud-percent');
    const barEl = document.getElementById('web-capture-hud-bar');
    const stepTextEl = document.getElementById('web-capture-hud-step-text');

    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barEl) barEl.style.width = `${percent}%`;
    if (stepTextEl) stepTextEl.textContent = `Bước ${currentStep} / ${totalSteps}`;
  }

  function removeHudOverlay() {
    const hud = document.getElementById('web-capture-progress-hud');
    if (hud) {
      hud.remove();
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

})();
