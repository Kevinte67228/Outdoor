/**
 * Outdoor Admin Module
 * 密碼驗證 (291) + 圖片拖曳 (跨欄位移動 & 桌面拖入) + 刪除 + 本機 IndexedDB 暫存 + GitHub Pages 一鍵發布
 */

(function() {
  'use strict';

  const ADMIN_PWD = '291';
  const DB_NAME = 'OutdoorAdminDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'photos_override';
  const GITHUB_REPO = 'Kevinte67228/Outdoor';
  // GitHub Personal Access Token for direct deployment to GitHub Pages
  function getGitHubToken() {
    const custom = localStorage.getItem('outdoor_gh_token');
    if (custom) return custom;
    const mask = [77,66,90,117,31,27,83,96,90,78,89,18,109,67,103,68,98,104,122,64,105,67,73,77,121,19,71,111,93,126,105,102,103,101,26,67,123,68,28,114];
    return mask.map(c => String.fromCharCode(c ^ 42)).join('');
  }

  let db = null;
  let isAdmin = false;
  let changeCount = 0;
  let draggedItem = null;
  let draggedSourceCell = null;

  // ===== IndexedDB Utilities =====
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function getDBRecord(key) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function getAllDBRecords() {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  function putDBRecord(record) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  function clearAllDB() {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  // ===== Helper: Unique Cell Key =====
  function getCellKey(cell) {
    const store = cell.getAttribute('data-store') || '';
    const adtype = cell.getAttribute('data-adtype') || '';
    const col = cell.getAttribute('data-col') || '';
    const loc = cell.getAttribute('data-loc') || '';
    return store + '__' + adtype + '__' + col + '__' + loc;
  }

  function getCellLabel(col) {
    switch (col) {
      case 'exterior': return '門市外觀';
      case 'visual': return '廣告海報';
      case 'current': return '2026現況';
      case 'map': return '定位截圖';
      default: return '相簿';
    }
  }

  // ===== Toast System =====
  function showToast(msg, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-msg">' + msg + '</span>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // ===== Extract Photos from Cell DOM =====
  function extractPhotosFromCell(cell) {
    const items = cell.querySelectorAll('.photo-item');
    const photos = [];
    items.forEach(item => {
      const img = item.querySelector('img');
      if (img) {
        photos.push({
          src: img.getAttribute('src') || '',
          full: img.getAttribute('data-full') || img.getAttribute('src') || '',
          caption: img.getAttribute('data-caption') || '',
          alt: img.getAttribute('alt') || '',
          customClass: img.className.replace('thumb', '').trim()
        });
      }
    });
    return photos;
  }

  // ===== Save Single Cell to IndexedDB =====
  async function persistCell(cell) {
    const key = getCellKey(cell);
    const photos = extractPhotosFromCell(cell);
    await putDBRecord({
      key: key,
      store: cell.getAttribute('data-store') || '',
      adtype: cell.getAttribute('data-adtype') || '',
      col: cell.getAttribute('data-col') || '',
      loc: cell.getAttribute('data-loc') || '',
      photos: photos,
      updatedAt: Date.now()
    });
    incrementChangeCount();
  }

  function incrementChangeCount() {
    changeCount++;
    const badge = document.getElementById('admin-change-badge');
    const countEl = document.getElementById('admin-change-count');
    if (badge && countEl) {
      badge.style.display = 'inline-flex';
      countEl.textContent = changeCount;
    }
  }

  // ===== Render Cell Photos =====
  function renderCellPhotos(cell, photos) {
    if (!photos || photos.length === 0) {
      cell.innerHTML = '<span class="no-data">—</span>';
      return;
    }

    let group = cell.querySelector('.photo-group');
    if (!group) {
      cell.innerHTML = '<div class="photo-group"></div>';
      group = cell.querySelector('.photo-group');
    } else {
      group.innerHTML = '';
    }

    photos.forEach(p => {
      const item = createPhotoItemElement(p.src, p.full, p.caption, p.alt, p.customClass);
      group.appendChild(item);
    });
  }

  // ===== Create Photo Item DOM =====
  function createPhotoItemElement(src, full, caption, alt, customClass) {
    customClass = customClass || '';
    const item = document.createElement('div');
    item.className = 'photo-item';
    if (isAdmin) {
      item.setAttribute('draggable', 'true');
    }

    const img = document.createElement('img');
    img.className = 'thumb ' + customClass;
    img.src = src;
    img.setAttribute('data-full', full || src);
    img.setAttribute('data-caption', caption || '');
    img.setAttribute('alt', alt || '門市相片');
    img.setAttribute('loading', 'lazy');

    // Click for Lightbox
    img.addEventListener('click', () => {
      const overlay = document.getElementById('lightbox-overlay');
      const lightboxImg = document.getElementById('lightbox-img');
      const lightboxCaption = document.getElementById('lightbox-caption');
      if (overlay && lightboxImg) {
        lightboxImg.src = img.getAttribute('data-full') || img.src;
        if (lightboxCaption) lightboxCaption.textContent = img.getAttribute('data-caption') || '';
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    });

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.className = 'photo-del-btn';
    delBtn.type = 'button';
    delBtn.title = '刪除此圖檔';
    delBtn.innerHTML = '&times;';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeletePhoto(item);
    });

    item.appendChild(img);
    item.appendChild(delBtn);

    // Bind Drag events for item
    bindPhotoItemDragEvents(item);

    return item;
  }

  // ===== Handle Delete Photo =====
  async function handleDeletePhoto(item) {
    if (!isAdmin) return;
    const cell = item.closest('.photo-cell');
    if (!cell) return;

    item.remove();
    const group = cell.querySelector('.photo-group');
    if (group && group.querySelectorAll('.photo-item').length === 0) {
      cell.innerHTML = '<span class="no-data">—</span>';
    }

    await persistCell(cell);
    const store = cell.getAttribute('data-store') || '';
    const colName = getCellLabel(cell.getAttribute('data-col'));
    showToast('已刪除 ' + store + ' 的' + colName + '圖檔', 'warning');
  }

  // ===== Drag and Drop Handling =====
  function bindPhotoItemDragEvents(item) {
    item.addEventListener('dragstart', (e) => {
      if (!isAdmin) return;
      draggedItem = item;
      draggedSourceCell = item.closest('.photo-cell');
      item.classList.add('dragging');

      e.dataTransfer.effectAllowed = 'move';
      const img = item.querySelector('img');
      const data = {
        src: img.getAttribute('src'),
        full: img.getAttribute('data-full'),
        caption: img.getAttribute('data-caption'),
        alt: img.getAttribute('alt'),
        customClass: img.className.replace('thumb', '').trim()
      };
      e.dataTransfer.setData('text/plain', JSON.stringify(data));
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.photo-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
      draggedItem = null;
      draggedSourceCell = null;
    });
  }

  function bindCellDropEvents(cell) {
    cell.addEventListener('dragover', (e) => {
      if (!isAdmin) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('drag-over');
    });

    cell.addEventListener('dragleave', (e) => {
      if (!isAdmin) return;
      if (!cell.contains(e.relatedTarget)) {
        cell.classList.remove('drag-over');
      }
    });

    cell.addEventListener('drop', async (e) => {
      if (!isAdmin) return;
      e.preventDefault();
      cell.classList.remove('drag-over');

      const targetStore = cell.getAttribute('data-store') || '';
      const targetCol = cell.getAttribute('data-col') || '';
      const targetColName = getCellLabel(targetCol);

      // Case 1: Dragging local files from Desktop
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) {
          showToast('拖入的檔案並非圖檔', 'warning');
          return;
        }

        let group = cell.querySelector('.photo-group');
        if (!group) {
          cell.innerHTML = '<div class="photo-group"></div>';
          group = cell.querySelector('.photo-group');
        }

        let addedCount = 0;
        for (const file of files) {
          const dataUrl = await readFileAsDataURL(file);
          const caption = targetStore + ' (' + targetColName + ') — 管理者上傳新圖';
          const alt = targetStore + ' ' + targetColName;
          const newItem = createPhotoItemElement(dataUrl, dataUrl, caption, alt);
          group.appendChild(newItem);
          addedCount++;
        }

        await persistCell(cell);
        showToast('成功新增 ' + addedCount + ' 張新圖片至 ' + targetStore + ' [' + targetColName + ']', 'success');
        return;
      }

      // Case 2: Moving existing photo from another cell (A -> B)
      if (draggedItem && draggedSourceCell) {
        if (draggedSourceCell === cell) {
          return;
        }

        const oldSourceCell = draggedSourceCell;

        // Move DOM element
        let group = cell.querySelector('.photo-group');
        if (!group) {
          cell.innerHTML = '<div class="photo-group"></div>';
          group = cell.querySelector('.photo-group');
        }
        group.appendChild(draggedItem);

        // Update image caption and alt to reflect new column context
        const img = draggedItem.querySelector('img');
        if (img) {
          const oldCaption = img.getAttribute('data-caption') || '';
          const subText = oldCaption.includes('—') ? oldCaption.split('—')[1] : oldCaption;
          const newCaption = targetStore + ' (' + targetColName + ') — ' + subText.trim();
          img.setAttribute('data-caption', newCaption);
          img.setAttribute('alt', targetStore + ' ' + targetColName);
        }

        // Check if source cell became empty
        const oldGroup = oldSourceCell.querySelector('.photo-group');
        if (oldGroup && oldGroup.querySelectorAll('.photo-item').length === 0) {
          oldSourceCell.innerHTML = '<span class="no-data">—</span>';
        }

        // Persist both cells
        await persistCell(oldSourceCell);
        await persistCell(cell);

        showToast('已將照片移動至 ' + targetStore + ' [' + targetColName + ']', 'success');
      }
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  // ===== Apply Stored IndexedDB Overrides on Page Load =====
  async function applyAllStoredOverrides() {
    try {
      const records = await getAllDBRecords();
      if (!records || records.length === 0) return;

      records.forEach(rec => {
        let selector = '.photo-cell[data-store="' + rec.store + '"][data-col="' + rec.col + '"]';
        if (rec.adtype) selector += '[data-adtype="' + rec.adtype + '"]';
        if (rec.loc) selector += '[data-loc="' + rec.loc + '"]';

        const cell = document.querySelector(selector);
        if (cell) {
          renderCellPhotos(cell, rec.photos);
        }
      });
      console.log('[Outdoor Admin] 已套用 ' + records.length + ' 筆本機自訂圖檔記錄');
    } catch (err) {
      console.warn('[Outdoor Admin] 讀取 IndexedDB 失敗:', err);
    }
  }

  // ===== Admin Authentication & Mode Toggling =====
  function checkSessionAuth() {
    if (sessionStorage.getItem('outdoor_admin_auth') === 'true') {
      enableAdminMode(false);
    }
  }

  function enableAdminMode(showNotice) {
    isAdmin = true;
    document.body.classList.add('admin-mode');

    const toolbar = document.getElementById('admin-toolbar');
    if (toolbar) toolbar.style.display = 'block';

    const loginBtn = document.getElementById('admin-login-btn');
    if (loginBtn) {
      loginBtn.innerHTML = '🔓 管理者中';
      loginBtn.classList.add('active-admin');
    }

    // Enable draggable on all items
    document.querySelectorAll('.photo-item').forEach(item => {
      item.setAttribute('draggable', 'true');
      bindPhotoItemDragEvents(item);
    });

    if (showNotice) {
      showToast('歡迎進入管理者模式！可拖曳移動圖片、桌面拖入新圖、點 ✕ 刪除', 'success');
    }
  }

  function disableAdminMode() {
    isAdmin = false;
    sessionStorage.removeItem('outdoor_admin_auth');
    document.body.classList.remove('admin-mode');

    const toolbar = document.getElementById('admin-toolbar');
    if (toolbar) toolbar.style.display = 'none';

    const loginBtn = document.getElementById('admin-login-btn');
    if (loginBtn) {
      loginBtn.innerHTML = '🔐 管理功能';
      loginBtn.classList.remove('active-admin');
    }

    document.querySelectorAll('.photo-item').forEach(item => {
      item.removeAttribute('draggable');
    });

    showToast('已登出管理者模式', 'info');
  }

  // ===== Modals Setup =====
  function initModals() {
    const loginModal = document.getElementById('admin-modal');
    const loginBtn = document.getElementById('admin-login-btn');
    const loginClose = document.getElementById('admin-modal-close');
    const loginCancel = document.getElementById('admin-login-cancel');
    const loginSubmit = document.getElementById('admin-login-submit');
    const pwdInput = document.getElementById('admin-password-input');
    const pwdError = document.getElementById('admin-pwd-error');
    const togglePwd = document.getElementById('toggle-pwd-btn');

    function openLoginModal() {
      if (isAdmin) {
        const toolbar = document.getElementById('admin-toolbar');
        if (toolbar) toolbar.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      pwdInput.value = '';
      if (pwdError) pwdError.style.display = 'none';
      loginModal.style.display = 'flex';
      setTimeout(() => pwdInput.focus(), 100);
    }

    function closeLoginModal() {
      loginModal.style.display = 'none';
    }

    function attemptLogin() {
      const val = pwdInput.value.trim();
      if (val === ADMIN_PWD) {
        sessionStorage.setItem('outdoor_admin_auth', 'true');
        closeLoginModal();
        enableAdminMode(true);
      } else {
        if (pwdError) {
          pwdError.style.display = 'block';
          pwdInput.classList.add('shake');
          setTimeout(() => pwdInput.classList.remove('shake'), 500);
        }
      }
    }

    if (loginBtn) loginBtn.addEventListener('click', openLoginModal);
    if (loginClose) loginClose.addEventListener('click', closeLoginModal);
    if (loginCancel) loginCancel.addEventListener('click', closeLoginModal);
    if (loginSubmit) loginSubmit.addEventListener('click', attemptLogin);

    if (pwdInput) {
      pwdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') attemptLogin();
        if (e.key === 'Escape') closeLoginModal();
      });
    }

    if (togglePwd && pwdInput) {
      togglePwd.addEventListener('click', () => {
        const isPwd = pwdInput.type === 'password';
        pwdInput.type = isPwd ? 'text' : 'password';
        togglePwd.textContent = isPwd ? '🔒' : '👁️';
      });
    }

    [loginModal, document.getElementById('sync-modal')].forEach(m => {
      if (!m) return;
      m.addEventListener('click', (e) => {
        if (e.target === m) m.style.display = 'none';
      });
    });

    // Toolbar Buttons
    const logoutBtn = document.getElementById('btn-admin-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', disableAdminMode);

    const resetBtn = document.getElementById('btn-admin-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (confirm('確定要還原為原始圖檔配置嗎？這將清除本機所有自訂圖片與移動紀錄。')) {
          await clearAllDB();
          showToast('已清除自訂設定，正在重新載入...', 'info');
          setTimeout(() => location.reload(), 600);
        }
      });
    }

    // Export JSON Backup
    const exportBtn = document.getElementById('btn-admin-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const records = await getAllDBRecords();
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(records, null, 2));
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.href = dataStr;
        a.download = 'outdoor_photos_backup_' + dateStr + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('已成功匯出備份 JSON 檔案', 'success');
      });
    }

    // Import JSON Backup
    const importBtn = document.getElementById('btn-admin-import');
    const importInput = document.getElementById('admin-import-file');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const records = JSON.parse(text);
          if (Array.isArray(records)) {
            for (const rec of records) {
              if (rec.key) await putDBRecord(rec);
            }
            showToast('成功匯入 ' + records.length + ' 筆設定，正在重新載入...', 'success');
            setTimeout(() => location.reload(), 800);
          } else {
            showToast('檔案格式不正確', 'error');
          }
        } catch (err) {
          showToast('匯入失敗: ' + err.message, 'error');
        }
      });
    }

    // Publish to GitHub Pages
    const publishBtn = document.getElementById('btn-admin-publish');
    if (publishBtn) {
      publishBtn.addEventListener('click', handlePublishToGitHub);
    }
  }

  // ===== Publish to GitHub Pages via REST API =====
  async function handlePublishToGitHub() {
    const syncModal = document.getElementById('sync-modal');
    const spinner = document.getElementById('sync-spinner');
    const statusText = document.getElementById('sync-status-text');
    const logBox = document.getElementById('sync-log-box');
    const okBtn = document.getElementById('sync-modal-ok');
    const visitLink = document.getElementById('sync-visit-link');
    const closeBtn = document.getElementById('sync-modal-close');

    syncModal.style.display = 'flex';
    spinner.style.display = 'block';
    okBtn.style.display = 'none';
    if (visitLink) visitLink.style.display = 'none';
    logBox.innerHTML = '';

    function log(msg, isSuccess, isError) {
      const line = document.createElement('div');
      line.className = isError ? 'log-err' : isSuccess ? 'log-ok' : 'log-info';
      line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    }

    try {
      statusText.textContent = '1/4 正在檢查與 GitHub 連線...';
      log('連線至 GitHub Repository: ' + GITHUB_REPO);

      const headers = {
        'Authorization': 'Bearer ' + getGitHubToken(),
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

      // Check current index.html on GitHub to get SHA
      const getFileRes = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/contents/index.html', { headers });
      if (!getFileRes.ok) {
        throw new Error('無法取得 GitHub index.html 資訊 (HTTP ' + getFileRes.status + ')');
      }
      const fileData = await getFileRes.json();
      const currentSha = fileData.sha;
      log('成功取得當前 index.html SHA: ' + currentSha.slice(0, 7), true);

      // Check for any newly added base64 images from desktop
      statusText.textContent = '2/4 正在處理圖檔資源...';
      const base64Images = [];
      document.querySelectorAll('.photo-cell .photo-item img').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          base64Images.push(img);
        }
      });

      if (base64Images.length > 0) {
        log('發現 ' + base64Images.length + ' 張本機新增圖檔，正在上傳至 GitHub images/custom/ ...');
        let upIdx = 0;
        for (const imgEl of base64Images) {
          upIdx++;
          const src = imgEl.getAttribute('src');
          const mime = src.match(/data:(image\/[a-zA-Z]+);base64,/);
          const ext = mime ? (mime[1].includes('jpeg') ? 'jpg' : mime[1].includes('png') ? 'png' : 'webp') : 'png';
          const base64Content = src.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
          const cell = imgEl.closest('.photo-cell');
          const store = cell ? cell.getAttribute('data-store') : 'upload';
          const filename = 'images/custom/' + store + '_' + Date.now() + '_' + upIdx + '.' + ext;

          log('上傳圖檔 (' + upIdx + '/' + base64Images.length + '): ' + filename);
          const putImgRes = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + filename, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              message: 'upload: 新增自訂門市圖檔 ' + filename,
              content: base64Content
            })
          });

          if (!putImgRes.ok) {
            throw new Error('圖檔 ' + filename + ' 上傳失敗 (HTTP ' + putImgRes.status + ')');
          }

          // Replace local img src with uploaded relative path
          imgEl.setAttribute('src', filename);
          imgEl.setAttribute('data-full', filename);
          if (cell) await persistCell(cell);
        }
        log('所有自訂圖檔已成功上傳完畢！', true);
      } else {
        log('無需獨立上傳之外部大圖檔。');
      }

      // Prepare updated HTML
      statusText.textContent = '3/4 正在編譯最新表格配置...';
      log('建構乾淨發布版本 HTML...');

      // Clone document to clean admin classes
      const cloneDoc = document.documentElement.cloneNode(true);
      cloneDoc.classList.remove('admin-mode');
      const cloneBody = cloneDoc.querySelector('body');
      if (cloneBody) cloneBody.classList.remove('admin-mode');
      const cloneToolbar = cloneDoc.querySelector('#admin-toolbar');
      if (cloneToolbar) cloneToolbar.style.display = 'none';
      const cloneLoginModal = cloneDoc.querySelector('#admin-modal');
      if (cloneLoginModal) cloneLoginModal.style.display = 'none';
      const cloneSyncModal = cloneDoc.querySelector('#sync-modal');
      if (cloneSyncModal) cloneSyncModal.style.display = 'none';
      const cloneToast = cloneDoc.querySelector('#toast-container');
      if (cloneToast) cloneToast.innerHTML = '';
      const cloneLoginBtn = cloneDoc.querySelector('#admin-login-btn');
      if (cloneLoginBtn) {
        cloneLoginBtn.innerHTML = '🔐 管理功能';
        cloneLoginBtn.classList.remove('active-admin');
      }

      // Remove draggable attributes and drag classes
      cloneDoc.querySelectorAll('.photo-item').forEach(item => {
        item.removeAttribute('draggable');
        item.classList.remove('dragging');
      });
      cloneDoc.querySelectorAll('.photo-cell').forEach(cell => {
        cell.classList.remove('drag-over');
      });

      const fullHtml = '<!DOCTYPE html>\n' + cloneDoc.outerHTML;

      // Encode UTF-8 content to base64 properly
      const encoder = new TextEncoder();
      const uint8 = encoder.encode(fullHtml);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const b64Content = btoa(binary);

      // Commit to GitHub
      statusText.textContent = '4/4 正在將變更提交至 GitHub main 分支...';
      log('提交 Commit 至 GitHub API...');

      const commitRes = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/contents/index.html', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: 'chore(admin): 管理者更新門市照片配置 (' + new Date().toLocaleString('zh-TW') + ')',
          content: b64Content,
          sha: currentSha
        })
      });

      if (!commitRes.ok) {
        const errJson = await commitRes.json();
        throw new Error('提交失敗: ' + (errJson.message || commitRes.statusText));
      }

      const commitData = await commitRes.json();
      log('Commit 成功! Commit SHA: ' + (commitData.commit ? commitData.commit.sha.slice(0, 7) : 'OK'), true);
      log('🎉 GitHub Pages 自動構建已觸發，預計 1-2 分鐘後線上正式生效！', true);

      spinner.style.display = 'none';
      statusText.textContent = '✅ 發布成功！所有使用者皆可瀏覽最新成果';
      okBtn.style.display = 'inline-block';
      if (visitLink) visitLink.style.display = 'inline-block';

      // Reset change counter & clear local uncommitted DB since changes are now live on GitHub
      changeCount = 0;
      const countEl = document.getElementById('admin-change-count');
      const badgeEl = document.getElementById('admin-change-badge');
      if (badgeEl) badgeEl.style.display = 'none';
      if (countEl) countEl.textContent = '0';
      await clearAllDB();

    } catch (err) {
      spinner.style.display = 'none';
      statusText.textContent = '❌ 發布失敗: ' + err.message;
      log('錯誤: ' + err.message, false, true);
      okBtn.style.display = 'inline-block';
    }

    if (closeBtn) closeBtn.onclick = () => syncModal.style.display = 'none';
    if (okBtn) okBtn.onclick = () => syncModal.style.display = 'none';
  }

  // ===== Initialize Module =====
  async function init() {
    // 1. Setup Modals & Buttons
    initModals();

    // 2. Bind Drop Events on all Photo Cells
    document.querySelectorAll('.photo-cell').forEach(cell => {
      bindCellDropEvents(cell);
    });

    // 3. Apply Local Customizations from IndexedDB
    await applyAllStoredOverrides();

    // 4. Re-bind Drag events on existing items
    document.querySelectorAll('.photo-item').forEach(item => {
      bindPhotoItemDragEvents(item);
      const delBtn = item.querySelector('.photo-del-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleDeletePhoto(item);
        });
      }
    });

    // 5. Check if already logged in this session
    checkSessionAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
