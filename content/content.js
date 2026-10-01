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

    if (message.action === 'STOP_CAPTURE') {
      stopRequested = true;
      sendResponse({ status: 'STOPPED' });
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
  async function runFullPageCapture(scrollDelay) {
    isCapturing = true;
    cancelRequested = false;
    stopRequested = false;
    originalScrollPos = { x: window.scrollX, y: window.scrollY };

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

      let currentY = 0;
      const totalSteps = Math.ceil(totalHeight / viewportHeight);
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
        const sliceHeight = Math.min(viewportHeight, totalHeight - actualScrollY);
        lastScrollY = actualScrollY;
        lastSliceHeight = sliceHeight;

        stepIndex++;
        const percent = Math.min(100, Math.round((stepIndex / totalSteps) * 100));

        // Wait a frame to ensure page is fully repainted before capture
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

        // Capture current viewport slice & store directly into background storage
        const storeResult = await requestSliceStore({
          index: stepIndex - 1,
          y: actualScrollY,
          viewportWidth: viewportWidth,
          viewportHeight: viewportHeight,
          sliceHeight: sliceHeight
        });

        // Update progress in popup
        sendProgressToPopup(percent, stepIndex, totalSteps);

        if (!storeResult || storeResult.error) {
          throw new Error("Không thể chụp ảnh từ trình duyệt: " + (storeResult?.error || 'Lỗi chụp ảnh'));
        }

        // Advance Y offset
        if (currentY + viewportHeight >= totalHeight) {
          break; // Reached bottom
        }
        currentY += viewportHeight;
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
            totalWidth: totalWidth,
            totalHeight: lastScrollY + lastSliceHeight, // chiều cao thực tế đã chụp
            viewportWidth: viewportWidth,
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

})();
