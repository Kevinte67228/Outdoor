/**
 * Outdoor Admin Module (with UAT & Production Dual-Environment Support)
 * 1. 密碼驗證 (291)
 * 2. 環境感知：自動偵測 UAT 測試站 (Outdoor-UAT) 與 正式站 (Outdoor)
 * 3. 圖片拖曳 (跨欄位 A->B 移動 & 桌面拖入)
 * 4. 圖片刪除 & 向左/向右 90 度旋轉 (縮圖與大圖燈箱雙向同步)
 * 5. 全欄位即時編輯 (店碼、店名、縣市、地址、類型、BB代碼、規格尺寸、租金、備註等)
 * 6. 動態版位增刪 (既有 ABC 擴展 D 版位、或刪除特定版位)
 * 7. 本機資料庫全表格持久化 (UAT 與 Prod 獨立 IndexedDB + 💾 儲存變更按鈕)
 * 8. 兩階段發布：
 *    - 在 UAT 環境：可「發布更新至 UAT」或「🌟 一鍵發布至正式版 (Prod)」
 *    - 在 Prod 環境：可「發布更新至線上」或「🧪 前往 UAT 測試站」
 */

(function() {
  'use strict';

  // ===== Environment Detection =====
  const IS_UAT = window.location.hostname.includes('github.io')
    ? window.location.pathname.toLowerCase().includes('/outdoor-uat')
    : (window.location.search.includes('env=uat') || document.title.includes('UAT'));

  const REPO_PROD = 'Kevinte67228/Outdoor';
  const REPO_UAT = 'Kevinte67228/Outdoor-UAT';
  const CURRENT_REPO = IS_UAT ? REPO_UAT : REPO_PROD;
  const CURRENT_ENV_LABEL = IS_UAT ? 'UAT 測試環境' : '正式環境 (Production)';

  const ADMIN_PWD = '291';
  const DB_NAME = IS_UAT ? 'OutdoorAdminDB_UAT' : 'OutdoorAdminDB';
  const DB_VERSION = 4;
  const STORE_PHOTOS = 'photos_override';
  const STORE_TABLE = 'table_state';

  // GitHub Personal Access Token (自動解密，無須手動輸入阻礙流程)
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

  // ===== UAT UI Setup =====
  function setupUatUi() {
    if (!IS_UAT) return;

    // 1. Update Document Title
    if (!document.title.includes('UAT')) {
      document.title = '[UAT 測試環境] ' + document.title;
    }

    // 2. Add badge to header H1
    const h1 = document.querySelector('.page-header h1');
    if (h1 && !h1.querySelector('.badge-env-uat')) {
      const badge = document.createElement('span');
      badge.className = 'badge-env-uat';
      badge.textContent = '🧪 UAT 測試站';
      h1.appendChild(badge);
    }

    // 3. Insert Top Announcement Banner
    if (!document.querySelector('.uat-banner')) {
      const banner = document.createElement('div');
      banner.className = 'uat-banner';
      banner.innerHTML = 
        '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
          '<span class="uat-pill">🧪 UAT 測試環境</span>' +
          '<span>此網站為測試驗收站，所有操作與修改皆獨立於正式版；待確認無誤後，請於管理者模式點擊「🌟 一鍵發布至正式版」。</span>' +
        '</div>' +
        '<a href="https://kevinte67228.github.io/Outdoor/" target="_blank" class="uat-btn-prod">🌐 開啟正式版 (Production)</a>';
      
      const header = document.querySelector('.page-header');
      if (header && header.parentNode) {
        header.parentNode.insertBefore(banner, header);
      }
    }
  }

  // ===== IndexedDB Utilities =====
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_PHOTOS)) {
          d.createObjectStore(STORE_PHOTOS, { keyPath: 'key' });
        }
        if (!d.objectStoreNames.contains(STORE_TABLE)) {
          d.createObjectStore(STORE_TABLE, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function saveTableSnapshotToDB(html) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_TABLE, 'readwrite');
      const store = tx.objectStore(STORE_TABLE);
      const req = store.put({ id: 'main_tbody', html: html, updatedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  function getTableSnapshotFromDB() {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_TABLE, 'readonly');
      const store = tx.objectStore(STORE_TABLE);
      const req = store.get('main_tbody');
      req.onsuccess = () => resolve(req.result ? req.result.html : null);
      req.onerror = () => reject(req.error);
    }));
  }

  function clearAllDB() {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction([STORE_PHOTOS, STORE_TABLE], 'readwrite');
      tx.objectStore(STORE_PHOTOS).clear();
      tx.objectStore(STORE_TABLE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // ===== Save Full Table State to DB =====
  let autoSaveTimer = null;
  async function saveTableState(showNotification = false) {
    const tbody = document.querySelector('#main-table tbody');
    if (!tbody) return;

    // Clean up temporary drag/editing classes before storing
    const clone = tbody.cloneNode(true);
    clone.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    clone.querySelectorAll('.dragging').forEach(c => c.classList.remove('dragging'));
    clone.querySelectorAll('tr.hidden-row').forEach(c => c.classList.remove('hidden-row'));

    await saveTableSnapshotToDB(clone.innerHTML);

    if (showNotification) {
      changeCount = 0;
      updateChangeBadge(true);
      showToast('✅ 所有修改已成功儲存至本機 (' + (IS_UAT ? 'UAT' : '正式版') + ')！', 'success');
    }
  }

  function triggerAutoSave() {
    changeCount++;
    updateChangeBadge(false);
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      saveTableState(false);
    }, 400);
  }

  function updateChangeBadge(isSaved) {
    const badge = document.getElementById('admin-change-badge');
    if (!badge) return;

    badge.style.display = 'inline-flex';
    if (isSaved) {
      badge.className = 'change-badge saved';
      badge.innerHTML = '✅ 已儲存至本機 (' + (IS_UAT ? 'UAT' : '正式') + ')';
    } else {
      badge.className = 'change-badge';
      badge.innerHTML = '● 尚未發布 (已變更 <strong id="admin-change-count">' + changeCount + '</strong> 處)';
    }
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

  // ===== Apply Rotation Styling =====
  function applyRotationToImg(img, deg) {
    deg = (deg % 360 + 360) % 360;
    img.setAttribute('data-rotate', deg);
    if (deg === 90 || deg === 270) {
      img.style.transform = 'rotate(' + deg + 'deg) scale(0.68)';
    } else if (deg === 180) {
      img.style.transform = 'rotate(180deg)';
    } else {
      img.style.transform = '';
    }
  }

  // ===== Create Photo Item DOM =====
  function createPhotoItemElement(src, full, caption, alt, customClass, rotate) {
    customClass = customClass || '';
    rotate = parseInt(rotate || 0, 10);
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
    applyRotationToImg(img, rotate);

    // Click for Lightbox
    img.addEventListener('click', () => {
      openLightboxForImg(img);
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

    // Rotate Left Button (↺)
    const rotLeftBtn = document.createElement('button');
    rotLeftBtn.className = 'photo-rot-btn photo-rot-left';
    rotLeftBtn.type = 'button';
    rotLeftBtn.title = '向左旋轉90度';
    rotLeftBtn.innerHTML = '↺';
    rotLeftBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRotatePhoto(item, -90);
    });

    // Rotate Right Button (↻)
    const rotRightBtn = document.createElement('button');
    rotRightBtn.className = 'photo-rot-btn photo-rot-right';
    rotRightBtn.type = 'button';
    rotRightBtn.title = '向右旋轉90度';
    rotRightBtn.innerHTML = '↻';
    rotRightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRotatePhoto(item, 90);
    });

    item.appendChild(img);
    item.appendChild(rotLeftBtn);
    item.appendChild(rotRightBtn);
    item.appendChild(delBtn);

    bindPhotoItemDragEvents(item);

    return item;
  }

  // ===== Open Lightbox Helper =====
  function openLightboxForImg(img) {
    const overlay = document.getElementById('lightbox-overlay');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    if (!overlay || !lightboxImg) return;

    window.currentLightboxSourceImg = img;
    lightboxImg.src = img.getAttribute('data-full') || img.src;
    const rot = parseInt(img.getAttribute('data-rotate') || '0', 10);
    lightboxImg.setAttribute('data-rotate', rot);
    lightboxImg.style.transform = rot ? 'rotate(' + rot + 'deg)' : '';

    if (lightboxCaption) {
      lightboxCaption.textContent = img.getAttribute('data-caption') || '';
    }
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // ===== Handle Photo Rotation =====
  function handleRotatePhoto(item, delta) {
    const img = item.querySelector('img');
    if (!img) return;

    let cur = parseInt(img.getAttribute('data-rotate') || '0', 10);
    cur = (cur + delta + 360) % 360;
    applyRotationToImg(img, cur);

    triggerAutoSave();
    showToast('圖片已旋轉至 ' + cur + '°', 'info');
  }

  // ===== Handle Lightbox Rotation (Syncs with thumbnail!) =====
  function handleLightboxRotate(delta) {
    const lbImg = document.getElementById('lightbox-img');
    if (!lbImg) return;

    let cur = parseInt(lbImg.getAttribute('data-rotate') || '0', 10);
    cur = (cur + delta + 360) % 360;
    lbImg.setAttribute('data-rotate', cur);
    lbImg.style.transform = cur ? 'rotate(' + cur + 'deg)' : '';

    if (window.currentLightboxSourceImg) {
      applyRotationToImg(window.currentLightboxSourceImg, cur);
      triggerAutoSave();
      showToast('已旋轉大圖至 ' + cur + '° (原圖縮圖已同步旋轉)', 'info');
    }
  }

  // ===== Handle Delete Photo =====
  function handleDeletePhoto(item) {
    if (!isAdmin) return;
    const cell = item.closest('.photo-cell');
    if (!cell) return;

    item.remove();
    const group = cell.querySelector('.photo-group');
    if (group && group.querySelectorAll('.photo-item').length === 0) {
      cell.innerHTML = '<span class="no-data">—</span>';
    }

    triggerAutoSave();
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
        rotate: img.getAttribute('data-rotate') || '0',
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
          const newItem = createPhotoItemElement(dataUrl, dataUrl, caption, alt, '', 0);
          group.appendChild(newItem);
          addedCount++;
        }

        triggerAutoSave();
        showToast('成功新增 ' + addedCount + ' 張新圖片至 ' + targetStore + ' [' + targetColName + ']', 'success');
        return;
      }

      // Case 2: Moving existing photo from another cell (A -> B)
      if (draggedItem && draggedSourceCell) {
        if (draggedSourceCell === cell) return;

        const oldSourceCell = draggedSourceCell;

        let group = cell.querySelector('.photo-group');
        if (!group) {
          cell.innerHTML = '<div class="photo-group"></div>';
          group = cell.querySelector('.photo-group');
        }
        group.appendChild(draggedItem);

        const img = draggedItem.querySelector('img');
        if (img) {
          const oldCaption = img.getAttribute('data-caption') || '';
          const subText = oldCaption.includes('—') ? oldCaption.split('—')[1] : oldCaption;
          const newCaption = targetStore + ' (' + targetColName + ') — ' + subText.trim();
          img.setAttribute('data-caption', newCaption);
          img.setAttribute('alt', targetStore + ' ' + targetColName);
        }

        const oldGroup = oldSourceCell.querySelector('.photo-group');
        if (oldGroup && oldGroup.querySelectorAll('.photo-item').length === 0) {
          oldSourceCell.innerHTML = '<span class="no-data">—</span>';
        }

        triggerAutoSave();
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

  // ===== Helper: Get All Rows for an Entry Block =====
  function getEntryBlockRows(targetRow) {
    let cur = targetRow;
    while (cur && !cur.querySelector('.store-code')) {
      cur = cur.previousElementSibling;
    }
    if (!cur) cur = targetRow;
    const firstRow = cur;
    const rows = [firstRow];

    let next = firstRow.nextElementSibling;
    while (next && !next.querySelector('.store-code') && next.tagName === 'TR') {
      rows.push(next);
      next = next.nextElementSibling;
    }
    return rows;
  }

  // ===== Location (BB) Add / Delete Logic =====
  function bindLocationControls() {
    const table = document.getElementById('main-table');
    if (!table) return;

    table.addEventListener('click', (e) => {
      if (!isAdmin) return;

      const addBtn = e.target.closest('.btn-add-loc');
      if (addBtn) {
        e.stopPropagation();
        handleAddLocation(addBtn);
        return;
      }

      const delBtn = e.target.closest('.loc-del-btn');
      if (delBtn) {
        e.stopPropagation();
        handleDeleteLocation(delBtn);
        return;
      }
    });
  }

  function handleAddLocation(btn) {
    const currentRow = btn.closest('tr');
    if (!currentRow) return;

    const blockRows = getEntryBlockRows(currentRow);
    const firstRow = blockRows[0];
    const lastRow = blockRows[blockRows.length - 1];

    const locEls = blockRows.map(r => r.querySelector('.bb-text')).filter(Boolean);
    let nextLoc = 'B';
    if (locEls.length > 0) {
      const lastText = locEls[locEls.length - 1].textContent.trim();
      if (lastText.length === 1 && lastText >= 'A' && lastText < 'Z') {
        nextLoc = String.fromCharCode(lastText.charCodeAt(0) + 1);
      } else {
        nextLoc = String.fromCharCode(65 + blockRows.length);
      }
    }

    const inputLoc = prompt('請輸入新增的版位代碼：', nextLoc);
    if (!inputLoc) return;
    nextLoc = inputLoc.trim().toUpperCase();

    // Increment rowspan on all merged cells in firstRow
    const mergedCells = firstRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type, .photo-cell[data-col="exterior"], .photo-cell[data-col="visual"], .photo-cell[data-col="map"], .store-notes');
    mergedCells.forEach(cell => {
      const cur = parseInt(cell.getAttribute('rowspan') || '1', 10);
      cell.setAttribute('rowspan', cur + 1);
    });

    // Update lastRow classes & remove old add button
    lastRow.classList.remove('entry-last-row');
    lastRow.classList.add('entry-inner-row');
    const oldAdd = lastRow.querySelector('.btn-add-loc');
    if (oldAdd) oldAdd.remove();

    // Construct new row
    const newRow = document.createElement('tr');
    newRow.className = 'entry-last-row';
    newRow.dataset.store = firstRow.dataset.store || '';
    newRow.dataset.name = firstRow.dataset.name || '';
    newRow.dataset.county = firstRow.dataset.county || '';
    newRow.dataset.addr = firstRow.dataset.addr || '';
    newRow.dataset.type = firstRow.dataset.type || '';
    newRow.dataset.new = firstRow.dataset.new || '';

    newRow.innerHTML = 
      '<td class="bb-location editable-cell"><span class="bb-text">' + nextLoc + '</span><button class="loc-del-btn" type="button" title="刪除此版位">&times;</button><button class="btn-add-loc" type="button" title="新增一個版位 (如 A,B,C ➜ D)">➕ 加版位</button></td>' +
      '<td class="dimension-led editable-cell">—</td>' +
      '<td class="dimension-led editable-cell">—</td>' +
      '<td class="dimension-bleed editable-cell">—</td>' +
      '<td class="dimension-bleed editable-cell">—</td>' +
      '<td class="dimension editable-cell">—</td>' +
      '<td class="dimension editable-cell">—</td>' +
      '<td class="rental editable-cell">—</td>' +
      '<td class="photo-cell" data-col="current" data-loc="' + nextLoc + '" data-store="' + (firstRow.dataset.store || '') + '" data-adtype="' + (firstRow.dataset.type || '') + '">' +
        '<span class="no-data">—</span>' +
      '</td>';

    lastRow.parentNode.insertBefore(newRow, lastRow.nextSibling);

    newRow.querySelectorAll('.editable-cell').forEach(cell => bindSingleEditableCell(cell));
    const photoCell = newRow.querySelector('.photo-cell');
    if (photoCell) bindCellDropEvents(photoCell);

    triggerAutoSave();
    if (window.reindexFilterGroups) window.reindexFilterGroups();
    showToast('已成功為 ' + (firstRow.dataset.store || '') + ' 新增版位 [' + nextLoc + ']', 'success');
  }

  function handleDeleteLocation(btn) {
    const rowToDelete = btn.closest('tr');
    if (!rowToDelete) return;

    const blockRows = getEntryBlockRows(rowToDelete);
    const locText = rowToDelete.querySelector('.bb-text') ? rowToDelete.querySelector('.bb-text').textContent.trim() : '';

    if (blockRows.length === 1) {
      if (!confirm('此門市僅有此單一版位，刪除將會移除整筆門市記錄，確定刪除嗎？')) return;
      rowToDelete.remove();
      triggerAutoSave();
      if (window.reindexFilterGroups) window.reindexFilterGroups();
      showToast('已刪除整筆門市記錄', 'warning');
      return;
    }

    if (!confirm('確定要刪除版位 [' + locText + '] 嗎？')) return;

    const firstRow = blockRows[0];

    if (rowToDelete === firstRow) {
      const secondRow = blockRows[1];
      const mergedCells = Array.from(firstRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type'));
      const exteriorCell = firstRow.querySelector('.photo-cell[data-col="exterior"]');
      const visualCell = firstRow.querySelector('.photo-cell[data-col="visual"]');
      const mapCell = firstRow.querySelector('.photo-cell[data-col="map"]');
      const notesCell = firstRow.querySelector('.store-notes');

      mergedCells.reverse().forEach(cell => {
        secondRow.insertBefore(cell, secondRow.firstChild);
      });

      const currentCell = secondRow.querySelector('.photo-cell[data-col="current"]');
      if (currentCell) {
        if (visualCell) secondRow.insertBefore(visualCell, currentCell);
        if (exteriorCell) secondRow.insertBefore(exteriorCell, visualCell || currentCell);
      }

      if (mapCell) secondRow.appendChild(mapCell);
      if (notesCell) secondRow.appendChild(notesCell);

      secondRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type, .photo-cell[data-col="exterior"], .photo-cell[data-col="visual"], .photo-cell[data-col="map"], .store-notes').forEach(cell => {
        const cur = parseInt(cell.getAttribute('rowspan') || '2', 10);
        cell.setAttribute('rowspan', Math.max(cur - 1, 1));
      });

      rowToDelete.remove();

    } else {
      firstRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type, .photo-cell[data-col="exterior"], .photo-cell[data-col="visual"], .photo-cell[data-col="map"], .store-notes').forEach(cell => {
        const cur = parseInt(cell.getAttribute('rowspan') || '2', 10);
        cell.setAttribute('rowspan', Math.max(cur - 1, 1));
      });

      if (rowToDelete.classList.contains('entry-last-row') && blockRows.length >= 2) {
        const newLastRow = blockRows[blockRows.length - 2];
        newLastRow.classList.remove('entry-inner-row');
        newLastRow.classList.add('entry-last-row');
        const bbCell = newLastRow.querySelector('.bb-location');
        if (bbCell && !bbCell.querySelector('.btn-add-loc')) {
          const addBtn = document.createElement('button');
          addBtn.className = 'btn-add-loc';
          addBtn.type = 'button';
          addBtn.title = '新增一個版位 (如 A,B,C ➜ D)';
          addBtn.textContent = '➕ 加版位';
          bbCell.appendChild(addBtn);
        }
      }

      rowToDelete.remove();
    }

    triggerAutoSave();
    if (window.reindexFilterGroups) window.reindexFilterGroups();
    showToast('已刪除版位 [' + locText + ']', 'warning');
  }

  // ===== Full Field Inline Editing =====
  const AD_TYPES = ['帆布外招', '導光板', '包柱', '大圖輸出'];
  const AD_TYPE_CLASSES = {
    '帆布外招': 'type-canvas',
    '導光板': 'type-led',
    '包柱': 'type-column',
    '大圖輸出': 'type-poster'
  };

  function bindEditableCells() {
    document.querySelectorAll('.editable-cell').forEach(cell => {
      bindSingleEditableCell(cell);
    });
  }

  function bindSingleEditableCell(cell) {
    if (cell.classList.contains('col-new')) {
      cell.onclick = (e) => {
        if (!isAdmin) return;
        e.stopPropagation();
        const row = cell.closest('tr');
        const isCurrentNew = row.dataset.new === '新增';
        const newStatus = !isCurrentNew;
        row.dataset.new = newStatus ? '新增' : '';
        cell.innerHTML = newStatus 
          ? '<span class="badge-new-col" title="點擊切換新增狀態">新增</span>' 
          : '<span class="no-data" title="點擊切換新增狀態">—</span>';
        triggerAutoSave();
        if (window.reindexFilterGroups) window.reindexFilterGroups();
        showToast('已切換為：' + (newStatus ? '新增門市' : '一般門市'), 'info');
      };
      return;
    }

    if (cell.classList.contains('ad-type')) {
      cell.onclick = (e) => {
        if (!isAdmin) return;
        e.stopPropagation();
        const row = cell.closest('tr');
        const curType = row.dataset.type || '帆布外招';
        let idx = AD_TYPES.indexOf(curType);
        if (idx === -1) idx = 0;
        const nextType = AD_TYPES[(idx + 1) % AD_TYPES.length];
        const nextClass = AD_TYPE_CLASSES[nextType] || 'type-canvas';
        row.dataset.type = nextType;
        cell.innerHTML = '<span class="type-badge ' + nextClass + '" title="點擊切換廣告類型">' + nextType + '</span>';
        triggerAutoSave();
        if (window.reindexFilterGroups) window.reindexFilterGroups();
        showToast('已切換廣告類型為：' + nextType, 'info');
      };
      return;
    }

    if (cell.classList.contains('bb-location')) {
      const textSpan = cell.querySelector('.bb-text');
      if (textSpan) {
        if (isAdmin) textSpan.setAttribute('contenteditable', 'true');
        textSpan.onfocus = () => {
          if (!isAdmin) return;
          textSpan.dataset.origVal = textSpan.innerText.trim();
        };
        textSpan.onkeydown = (e) => {
          if (!isAdmin) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            textSpan.blur();
          }
        };
        textSpan.onblur = () => {
          if (!isAdmin) return;
          const text = textSpan.innerText.trim();
          if (text !== (textSpan.dataset.origVal || '')) {
            triggerAutoSave();
            if (window.reindexFilterGroups) window.reindexFilterGroups();
            showToast('已修改版位代碼為：' + text, 'info');
          }
        };
      }
      return;
    }

    if (isAdmin) {
      cell.setAttribute('contenteditable', 'true');
    }

    cell.onfocus = () => {
      if (!isAdmin) return;
      cell.dataset.origVal = cell.innerText.trim();
    };

    cell.onkeydown = (e) => {
      if (!isAdmin) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        cell.blur();
      }
    };

    cell.onblur = () => {
      if (!isAdmin) return;
      const text = cell.innerText.trim();
      const orig = cell.dataset.origVal || '';
      if (text !== orig) {
        const row = cell.closest('tr');
        if (cell.classList.contains('store-code') && row) row.dataset.store = text;
        if (cell.classList.contains('store-name') && row) row.dataset.name = text;
        if (cell.classList.contains('store-county') && row) row.dataset.county = text;
        if (cell.classList.contains('store-address') && row) row.dataset.addr = text;
        triggerAutoSave();
        if (window.reindexFilterGroups) window.reindexFilterGroups();
        showToast('已儲存修改內容', 'success');
      }
    };

    // Auto-save on input as well
    cell.oninput = () => {
      if (!isAdmin) return;
      triggerAutoSave();
    };
  }

  // ===== Load Stored Table State on Startup =====
  async function initTableStateFromDB() {
    try {
      const savedHtml = await getTableSnapshotFromDB();
      if (savedHtml && savedHtml.trim().length > 100) {
        if (!savedHtml.includes('store-notes')) {
          console.log('[Outdoor Admin] 檢測到表格欄位結構升級 (新增備註欄位)，自動同步為最新配置');
          return;
        }
        const tbody = document.querySelector('#main-table tbody');
        if (tbody) {
          tbody.innerHTML = savedHtml;
          console.log('[Outdoor Admin] 成功載入本機資料庫暫存之表格內容');
          if (window.reindexFilterGroups) window.reindexFilterGroups();
        }
      }
    } catch (err) {
      console.warn('[Outdoor Admin] 讀取本機資料庫暫存失敗:', err);
    }
  }

  // ===== Rebind All Interactive Listeners =====
  function rebindAllListeners() {
    // 1. Drop on cells
    document.querySelectorAll('.photo-cell').forEach(cell => {
      bindCellDropEvents(cell);
    });

    // 2. Editable cells
    bindEditableCells();

    // 3. Location add/delete
    bindLocationControls();

    // 4. Photo Items: Drag, Lightbox, Delete, Rotate
    document.querySelectorAll('.photo-item').forEach(item => {
      bindPhotoItemDragEvents(item);

      const delBtn = item.querySelector('.photo-del-btn');
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          handleDeletePhoto(item);
        };
      }

      const rotL = item.querySelector('.photo-rot-left');
      if (rotL) {
        rotL.onclick = (e) => {
          e.stopPropagation();
          handleRotatePhoto(item, -90);
        };
      }

      const rotR = item.querySelector('.photo-rot-right');
      if (rotR) {
        rotR.onclick = (e) => {
          e.stopPropagation();
          handleRotatePhoto(item, 90);
        };
      }

      const img = item.querySelector('img');
      if (img) {
        img.onclick = () => {
          openLightboxForImg(img);
        };
        // Apply existing rotation if present
        const rot = parseInt(img.getAttribute('data-rotate') || '0', 10);
        if (rot) applyRotationToImg(img, rot);
      }
    });

    // 5. Lightbox Rotate Buttons
    const lbRotLeft = document.getElementById('lightbox-rot-left');
    const lbRotRight = document.getElementById('lightbox-rot-right');
    if (lbRotLeft) {
      lbRotLeft.onclick = (e) => {
        e.stopPropagation();
        handleLightboxRotate(-90);
      };
    }
    if (lbRotRight) {
      lbRotRight.onclick = (e) => {
        e.stopPropagation();
        handleLightboxRotate(90);
      };
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
      loginBtn.innerHTML = IS_UAT ? '🔓 UAT 管理中' : '🔓 管理者中';
      loginBtn.classList.add('active-admin');
    }

    const statusBadge = document.getElementById('admin-status-badge');
    const statusTip = document.getElementById('admin-status-tip');
    const publishBtn = document.getElementById('btn-admin-publish');
    const promoteBtn = document.getElementById('btn-admin-promote');
    const uatLink = document.getElementById('link-admin-uat');

    if (IS_UAT) {
      if (statusBadge) statusBadge.innerHTML = '🧪 UAT 管理者模式';
      if (statusTip) statusTip.innerHTML = '💡 支援編輯與拖曳；確認無誤後可一鍵同步至正式版';
      if (publishBtn) {
        publishBtn.innerHTML = '🚀 發布更新至 UAT';
        publishBtn.title = '發布更新至 Outdoor-UAT 測試環境';
      }
      if (promoteBtn) promoteBtn.style.display = 'inline-block';
      if (uatLink) uatLink.style.display = 'none';
    } else {
      if (statusBadge) statusBadge.innerHTML = '🛡️ 正式環境 管理者模式';
      if (statusTip) statusTip.innerHTML = '💡 正式生產環境；建議重大變更先至 UAT 測試驗收';
      if (publishBtn) {
        publishBtn.innerHTML = '🚀 發布更新至線上';
        publishBtn.title = '發布更新至正式生產環境';
      }
      if (promoteBtn) promoteBtn.style.display = 'none';
      if (uatLink) uatLink.style.display = 'inline-block';
    }

    document.querySelectorAll('.photo-item').forEach(item => {
      item.setAttribute('draggable', 'true');
    });

    document.querySelectorAll('.editable-cell').forEach(cell => {
      if (!cell.classList.contains('col-new') && !cell.classList.contains('ad-type')) {
        if (cell.classList.contains('bb-location')) {
          const s = cell.querySelector('.bb-text');
          if (s) s.setAttribute('contenteditable', 'true');
        } else {
          cell.setAttribute('contenteditable', 'true');
        }
      }
    });

    if (showNotice) {
      showToast(
        IS_UAT
          ? '歡迎進入 UAT 測試管理者模式！完成測試後可點擊「🌟 一鍵發布至正式版」'
          : '歡迎進入管理者模式！修改後可點擊「💾 儲存變更」，滿意後再點「🚀 發布更新至線上」',
        'success'
      );
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

    document.querySelectorAll('.editable-cell').forEach(cell => {
      cell.removeAttribute('contenteditable');
      const s = cell.querySelector('.bb-text');
      if (s) s.removeAttribute('contenteditable');
    });

    showToast('已登出管理者模式', 'info');
  }

  // ===== Modals & Toolbar Buttons Setup =====
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

    if (loginBtn) loginBtn.onclick = openLoginModal;
    if (loginClose) loginClose.onclick = closeLoginModal;
    if (loginCancel) loginCancel.onclick = closeLoginModal;
    if (loginSubmit) loginSubmit.onclick = attemptLogin;

    if (pwdInput) {
      pwdInput.onkeydown = (e) => {
        if (e.key === 'Enter') attemptLogin();
        if (e.key === 'Escape') closeLoginModal();
      };
    }

    if (togglePwd && pwdInput) {
      togglePwd.onclick = () => {
        const isPwd = pwdInput.type === 'password';
        pwdInput.type = isPwd ? 'text' : 'password';
        togglePwd.textContent = isPwd ? '🔒' : '👁️';
      };
    }

    [loginModal, document.getElementById('sync-modal')].forEach(m => {
      if (!m) return;
      m.onclick = (e) => {
        if (e.target === m) m.style.display = 'none';
      };
    });

    // 💾 Explicit Save Button
    const saveBtn = document.getElementById('btn-admin-save');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        await saveTableState(true);
      };
    }

    // 🚀 Publish to Current Environment (UAT or PROD)
    const publishBtn = document.getElementById('btn-admin-publish');
    if (publishBtn) {
      publishBtn.onclick = () => handlePublishToGitHub(CURRENT_REPO, CURRENT_ENV_LABEL);
    }

    // 🌟 Promote from UAT to Production
    const promoteBtn = document.getElementById('btn-admin-promote');
    if (promoteBtn) {
      promoteBtn.onclick = () => {
        if (!confirm('🌟 確認要將目前 UAT 的最新狀態直接發布至「正式環境 (Production)」嗎？\n\n發布後，所有同仁與一般使用者將在正式版 (Outdoor) 看到您在 UAT 的最新修改成果！')) {
          return;
        }
        handlePublishToGitHub(REPO_PROD, '正式環境 (Production)');
      };
    }

    // 🔄 Reset Button
    const resetBtn = document.getElementById('btn-admin-reset');
    if (resetBtn) {
      resetBtn.onclick = async () => {
        if (confirm('確定要還原為原始圖檔與欄位配置嗎？這將清除本機所有尚未發布的修改。')) {
          await clearAllDB();
          showToast('已清除本機設定，正在重新載入...', 'info');
          setTimeout(() => location.reload(), 600);
        }
      };
    }

    // ⚙️ Token Setting Button
    const tokenBtn = document.getElementById('btn-admin-token');
    if (tokenBtn) {
      tokenBtn.onclick = () => {
        const cur = localStorage.getItem('outdoor_gh_token') || '';
        const masked = cur ? cur.slice(0, 7) + '...' + cur.slice(-4) : '使用系統內建';
        const val = prompt('【GitHub Token 設定】\n目前狀態：' + masked + '\n\n可輸入自訂 Token（留空按確定回復系統預設）：', cur);
        if (val !== null) {
          if (val.trim()) {
            localStorage.setItem('outdoor_gh_token', val.trim());
            showToast('已自訂並儲存 Token', 'success');
          } else {
            localStorage.removeItem('outdoor_gh_token');
            showToast('已回復系統內建 Token', 'info');
          }
        }
      };
    }

    // 🔒 Logout Button
    const logoutBtn = document.getElementById('btn-admin-logout');
    if (logoutBtn) logoutBtn.onclick = disableAdminMode;

    // 📥 Export JSON Backup
    const exportBtn = document.getElementById('btn-admin-export');
    if (exportBtn) {
      exportBtn.onclick = async () => {
        const savedHtml = await getTableSnapshotFromDB();
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ html: savedHtml }, null, 2));
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.href = dataStr;
        a.download = (IS_UAT ? 'outdoor_uat_table_backup_' : 'outdoor_table_backup_') + dateStr + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('已成功匯出備份檔案', 'success');
      };
    }

    // 📤 Import JSON Backup
    const importBtn = document.getElementById('btn-admin-import');
    const importInput = document.getElementById('admin-import-file');
    if (importBtn && importInput) {
      importBtn.onclick = () => importInput.click();
      importInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const json = JSON.parse(text);
          if (json.html) {
            await saveTableSnapshotToDB(json.html);
            showToast('成功匯入備份，正在重新載入...', 'success');
            setTimeout(() => location.reload(), 800);
          } else {
            showToast('檔案格式不正確', 'error');
          }
        } catch (err) {
          showToast('匯入失敗: ' + err.message, 'error');
        }
      };
    }
  }

  // ===== Publish to GitHub Pages via REST API =====
  async function handlePublishToGitHub(targetRepo, targetLabel) {
    targetRepo = targetRepo || CURRENT_REPO;
    targetLabel = targetLabel || CURRENT_ENV_LABEL;

    // Save locally first
    await saveTableState(false);

    const token = getGitHubToken();
    const syncModal = document.getElementById('sync-modal');
    const syncModalTitle = document.getElementById('sync-modal-title');
    const spinner = document.getElementById('sync-spinner');
    const statusText = document.getElementById('sync-status-text');
    const logBox = document.getElementById('sync-log-box');
    const okBtn = document.getElementById('sync-modal-ok');
    const visitLink = document.getElementById('sync-visit-link');
    const closeBtn = document.getElementById('sync-modal-close');

    if (syncModalTitle) {
      syncModalTitle.textContent = (targetRepo === REPO_PROD && IS_UAT)
        ? '🌟 一鍵發布至正式環境 (Production)'
        : '🚀 同步發布至 ' + targetLabel;
    }

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
      statusText.textContent = '1/4 正在檢查與 GitHub 連線 (' + targetLabel + ')...';
      log('目標儲存庫: ' + targetRepo + ' (' + targetLabel + ')');

      const headers = {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

      const getFileRes = await fetch('https://api.github.com/repos/' + targetRepo + '/contents/index.html', { headers });
      if (!getFileRes.ok) {
        throw new Error('無法取得 ' + targetRepo + ' 的 index.html 資訊 (HTTP ' + getFileRes.status + ')');
      }
      const fileData = await getFileRes.json();
      const currentSha = fileData.sha;
      log('成功取得 ' + targetRepo + ' 當前 index.html SHA: ' + currentSha.slice(0, 7), true);

      // Check for any newly added base64 images from desktop
      statusText.textContent = '2/4 正在檢查自訂圖檔資源...';
      const base64Images = [];
      document.querySelectorAll('.photo-cell .photo-item img').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          base64Images.push(img);
        }
      });

      if (base64Images.length > 0) {
        log('發現 ' + base64Images.length + ' 張本機新增圖檔，正在同步上傳至 ' + targetRepo + ' images/custom/ ...');
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
          const putImgRes = await fetch('https://api.github.com/repos/' + targetRepo + '/contents/' + filename, {
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

          imgEl.setAttribute('src', filename);
          imgEl.setAttribute('data-full', filename);
        }
        log('所有自訂圖檔已成功上傳完畢！', true);
        await saveTableState(false);
      } else {
        log('無需獨立上傳之外部大圖檔。');
      }

      // Prepare updated HTML
      statusText.textContent = '3/4 正在編譯乾淨發布版本...';
      log('建構發布版本 HTML...');

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

      // If pushing to Production, strip all UAT banners and badges
      if (targetRepo === REPO_PROD) {
        const uatBanner = cloneDoc.querySelector('.uat-banner');
        if (uatBanner) uatBanner.remove();
        const uatBadge = cloneDoc.querySelector('.badge-env-uat');
        if (uatBadge) uatBadge.remove();
        const docTitle = cloneDoc.querySelector('title');
        if (docTitle) docTitle.textContent = '門市戶外廣告看板明細';
      }

      // Reset any search/filters and hidden-row classes so published version is clean
      cloneDoc.querySelectorAll('tr.hidden-row').forEach(r => r.classList.remove('hidden-row'));
      const sInput = cloneDoc.querySelector('#search-input');
      if (sInput) sInput.value = '';
      const cFilter = cloneDoc.querySelector('#county-filter');
      if (cFilter) cFilter.value = '';
      const tFilter = cloneDoc.querySelector('#type-filter');
      if (tFilter) tFilter.value = '';
      const nFilter = cloneDoc.querySelector('#new-filter');
      if (nFilter) nFilter.value = '';

      // Ensure rotated style and data attributes are firmly intact on all images
      cloneDoc.querySelectorAll('.photo-item img').forEach(img => {
        const rot = parseInt(img.getAttribute('data-rotate') || '0', 10);
        if (rot === 90 || rot === 270) {
          img.setAttribute('style', 'transform: rotate(' + rot + 'deg) scale(0.68) !important;');
        } else if (rot === 180) {
          img.setAttribute('style', 'transform: rotate(180deg) !important;');
        } else {
          img.removeAttribute('style');
        }
      });

      // Remove temporary administrative attributes from clone
      cloneDoc.querySelectorAll('.photo-item').forEach(item => {
        item.removeAttribute('draggable');
        item.classList.remove('dragging');
      });
      cloneDoc.querySelectorAll('.photo-cell').forEach(cell => {
        cell.classList.remove('drag-over');
      });
      cloneDoc.querySelectorAll('.editable-cell').forEach(cell => {
        cell.removeAttribute('contenteditable');
        const s = cell.querySelector('.bb-text');
        if (s) s.removeAttribute('contenteditable');
      });

      const fullHtml = '<!DOCTYPE html>\n' + cloneDoc.outerHTML;

      const encoder = new TextEncoder();
      const uint8 = encoder.encode(fullHtml);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
      }
      const b64Content = btoa(binary);

      // Commit to GitHub
      statusText.textContent = '4/4 正在提交變更至 ' + targetRepo + ' main 分支...';
      log('提交 Commit 至 ' + targetRepo + ' ...');

      const commitMsg = (targetRepo === REPO_PROD && IS_UAT)
        ? 'chore(deploy): 從 UAT 驗收測試站同步推送至正式生產環境 (' + new Date().toLocaleString('zh-TW') + ')'
        : 'chore(admin): 管理者更新門市圖檔與版位備註 (' + new Date().toLocaleString('zh-TW') + ')';

      const commitRes = await fetch('https://api.github.com/repos/' + targetRepo + '/contents/index.html', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: commitMsg,
          content: b64Content,
          sha: currentSha
        })
      });

      if (!commitRes.ok) {
        const errJson = await commitRes.json();
        throw new Error('提交失敗: ' + (errJson.message || commitRes.statusText));
      }

      const commitData = await commitRes.json();
      log('Commit 成功! SHA: ' + (commitData.commit ? commitData.commit.sha.slice(0, 7) : 'OK'), true);
      log('🎉 ' + targetLabel + ' 自動構建已觸發，預計 1-2 分鐘後線上正式生效！', true);

      spinner.style.display = 'none';
      statusText.textContent = (targetRepo === REPO_PROD && IS_UAT)
        ? '🎉 成功發布至正式環境 (Production)！'
        : '✅ 發布成功！所有使用者皆可瀏覽最新成果';
      
      okBtn.style.display = 'inline-block';
      if (visitLink) {
        const destUrl = targetRepo === REPO_PROD 
          ? 'https://kevinte67228.github.io/Outdoor/'
          : 'https://kevinte67228.github.io/Outdoor-UAT/';
        visitLink.href = destUrl;
        visitLink.textContent = targetRepo === REPO_PROD ? '🌐 開啟正式版網站' : '🌐 開啟 UAT 測試站';
        visitLink.style.display = 'inline-block';
      }

      changeCount = 0;
      updateChangeBadge(true);

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
    // 1. Setup UAT UI (banner, badges, title)
    setupUatUi();

    // 2. Setup Modals & Buttons
    initModals();

    // 3. Load Stored Table State from IndexedDB
    await initTableStateFromDB();

    // 4. Rebind all interactive event listeners
    rebindAllListeners();

    // 5. Check session authentication
    checkSessionAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
