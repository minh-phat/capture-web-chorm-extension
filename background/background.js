// Background Service Worker for Web Capture Extension

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 0. Start a new full page capture session -> clean up old slice keys
  if (message.action === 'START_CAPTURE_SESSION') {
    chrome.storage.local.get(null, (items) => {
      if (items) {
        const keysToRemove = Object.keys(items).filter(k => k.startsWith('slice_'));
        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove, () => {
            sendResponse({ status: 'OK' });
          });
          return;
        }
      }
      sendResponse({ status: 'OK' });
    });
    return true;
  }

  // 1. Capture current visible tab screenshot & respond with dataUrl
  if (message.action === 'CAPTURE_VISIBLE_TAB') {
    const windowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png', quality: 100 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error('Error capturing visible tab:', chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Capture failed' });
      } else {
        sendResponse({ dataUrl: dataUrl });
      }
    });
    return true;
  }

  // 1b. Capture current visible tab & store slice directly in storage (bypasses 64MB sendMessage limit)
  if (message.action === 'CAPTURE_AND_STORE_SLICE') {
    const windowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png', quality: 100 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error('Error capturing slice:', chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Capture failed' });
      } else {
        const sliceData = {
          index: message.data.index,
          dataUrl: dataUrl,
          y: message.data.y,
          viewportWidth: message.data.viewportWidth,
          viewportHeight: message.data.viewportHeight,
          sliceHeight: message.data.sliceHeight
        };
        const key = `slice_${message.data.index}`;
        chrome.storage.local.set({ [key]: sliceData }, () => {
          sendResponse({ status: 'OK' });
        });
      }
    });
    return true;
  }

  // Relay: progress update from content script -> broadcast to popup
  if (message.action === 'CAPTURE_PROGRESS') {
    // Broadcast to all extension pages (popup listens to this)
    chrome.runtime.sendMessage({
      action: 'CAPTURE_PROGRESS',
      percent: message.percent,
      currentStep: message.currentStep,
      totalSteps: message.totalSteps
    }).catch(() => {/* popup may be closed */});
    sendResponse({ status: 'OK' });
    return true;
  }

  // Relay: capture cancelled from content script -> popup
  if (message.action === 'CAPTURE_CANCELLED') {
    chrome.runtime.sendMessage({ action: 'CAPTURE_CANCELLED' }).catch(() => {});
    sendResponse({ status: 'OK' });
    return true;
  }

  // 2. Full page capture completed -> Save meta & Open Preview tab
  if (message.action === 'FINISH_FULL_PAGE_CAPTURE') {
    const captureData = {
      type: 'FULL_PAGE',
      sliceCount: message.data.sliceCount,
      slices: message.data.slices || null, // fallback for legacy
      totalWidth: message.data.totalWidth,
      totalHeight: message.data.totalHeight,
      viewportWidth: message.data.viewportWidth,
      viewportHeight: message.data.viewportHeight,
      devicePixelRatio: message.data.devicePixelRatio,
      pageTitle: message.data.pageTitle,
      pageUrl: message.data.pageUrl,
      timestamp: Date.now()
    };

    chrome.storage.local.set({ latestCaptureData: captureData }, () => {
      // Notify popup that capture is done before opening preview
      chrome.runtime.sendMessage({ action: 'CAPTURE_DONE' }).catch(() => {});
      chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });
    });
    sendResponse({ status: 'OK' });
    return true;
  }

  // 3. Visible capture completed -> Save data & Open Preview tab
  if (message.action === 'FINISH_VISIBLE_CAPTURE') {
    const captureData = {
      type: 'VISIBLE',
      dataUrl: message.data.dataUrl,
      width: message.data.width,
      height: message.data.height,
      devicePixelRatio: message.data.devicePixelRatio,
      pageTitle: message.data.pageTitle,
      pageUrl: message.data.pageUrl,
      timestamp: Date.now()
    };

    chrome.storage.local.set({ latestCaptureData: captureData }, () => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_DONE' }).catch(() => {});
      chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });
    });
    sendResponse({ status: 'OK' });
    return true;
  }
});
