// Popup UI script

document.addEventListener('DOMContentLoaded', async () => {
  const btnFullPage = document.getElementById('btn-full-page');
  const btnVisibleArea = document.getElementById('btn-visible-area');
  const btnOpenRecent = document.getElementById('btn-open-recent');
  const speedBtns = document.querySelectorAll('.speed-btn');

  let selectedDelay = 400;

  // Load saved speed setting if present
  try {
    const data = await chrome.storage.local.get('scrollDelay');
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
  } catch (e) {}

  // Speed selection toggle
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDelay = parseInt(btn.dataset.delay, 10);
      chrome.storage.local.set({ scrollDelay: selectedDelay });
    });
  });

  // 1. Full Page Capture Click
  btnFullPage.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      alert('Không thể xác định trang web hiện tại.');
      return;
    }

    // Check if URL is capturable (chrome:// or file:// or edge:// cannot be captured by default content scripts)
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      alert('Không thể chụp hình trên các trang hệ thống nội bộ của trình duyệt.');
      return;
    }

    try {
      // Ensure content script is ready
      await ensureContentScriptInjected(tab.id);

      // Trigger capture
      chrome.tabs.sendMessage(tab.id, {
        action: 'START_FULL_PAGE_CAPTURE',
        scrollDelay: selectedDelay
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
        }
        window.close(); // Close popup to let user see progress HUD on screen
      });
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

      chrome.tabs.sendMessage(tab.id, { action: 'START_VISIBLE_CAPTURE' }, () => {
        window.close();
      });
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // 3. Open Recent Preview
  btnOpenRecent.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });
    window.close();
  });

  // Helper: Ensure content script is loaded on the page
  async function ensureContentScriptInjected(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, async (response) => {
        if (response && response.status === 'READY') {
          resolve();
        } else {
          // Dynamically inject content script if tab was opened before extension was loaded
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
