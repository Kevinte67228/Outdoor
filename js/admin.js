/**
 * Outdoor Admin Module
 * 1. 密碼驗證 (291)
 * 2. 圖片拖曳 (跨欄位 A->B 移動 & 桌面拖入)
 * 3. 圖片刪除 & 向左/向右 90 度旋轉
 * 4. 全欄位即時編輯 (店碼、店名、縣市、地址、類型、BB代碼、規格尺寸、租金等)
 * 5. 動態版位增刪 (如 ABC 擴增 D 版位、或刪除特定版位)
 * 6. 本機 IndexedDB 暫存
 * 7. GitHub Pages 一鍵發布
 */

(function() {
  'use strict';

  const ADMIN_PWD = '291';
  const DB_NAME = 'OutdoorAdminDB';
  const DB_VERSION = 2;
  const STORE_NAME = 'photos_override';
  const GITHUB_REPO = 'Kevinte67228/Outdoor';

  // GitHub Personal Access Token (儲存於管理者本機瀏覽器 localStorage，公開代碼中零密鑰)
  function getGitHubToken() {
    return localStorage.getItem('outdoor_gh_token') || '';
  }

  let db = null;
  let isAdmin = false;
  let changeCount = 0;
  let draggedItem = null;
  let draggedSourceCell = null;
  let currentLightboxImgEl = null;

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

  function incrementChangeCount() {
    changeCount++;
    const badge = document.getElementById('admin-change-badge');
    const countEl = document.getElementById('admin-change-count');
    if (badge && countEl) {
      badge.style.display = 'inline-flex';
      countEl.textContent = changeCount;
    }
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
          rotate: parseInt(img.getAttribute('data-rotate') || '0', 10),
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
      const item = createPhotoItemElement(p.src, p.full, p.caption, p.alt, p.customClass, p.rotate);
      group.appendChild(item);
    });
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

    // Bind Drag events for item
    bindPhotoItemDragEvents(item);

    return item;
  }

  // ===== Open Lightbox Helper =====
  function openLightboxForImg(img) {
    const overlay = document.getElementById('lightbox-overlay');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    if (!overlay || !lightboxImg) return;

    currentLightboxImgEl = img;
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
  async function handleRotatePhoto(item, delta) {
    const img = item.querySelector('img');
    if (!img) return;

    let cur = parseInt(img.getAttribute('data-rotate') || '0', 10);
    cur = (cur + delta + 360) % 360;
    applyRotationToImg(img, cur);

    const cell = item.closest('.photo-cell');
    if (cell) await persistCell(cell);
    showToast('圖片已旋轉至 ' + cur + '°', 'info');
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

        await persistCell(cell);
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

      // Add Location Button Click
      const addBtn = e.target.closest('.btn-add-loc');
      if (addBtn) {
        e.stopPropagation();
        handleAddLocation(addBtn);
        return;
      }

      // Delete Location Button Click
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

    // Determine next letter
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
    const mergedCells = firstRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type, .photo-cell[data-col="exterior"], .photo-cell[data-col="visual"], .photo-cell[data-col="map"]');
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

    // Bind editable & drop
    newRow.querySelectorAll('.editable-cell').forEach(cell => bindSingleEditableCell(cell));
    const photoCell = newRow.querySelector('.photo-cell');
    if (photoCell) bindCellDropEvents(photoCell);

    incrementChangeCount();
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
      incrementChangeCount();
      showToast('已刪除整筆門市記錄', 'warning');
      return;
    }

    if (!confirm('確定要刪除版位 [' + locText + '] 嗎？')) return;

    const firstRow = blockRows[0];

    if (rowToDelete === firstRow) {
      // Row to delete is the first row! Move merged cells into secondRow
      const secondRow = blockRows[1];
      const mergedCells = Array.from(firstRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type'));
      const exteriorCell = firstRow.querySelector('.photo-cell[data-col="exterior"]');
      const visualCell = firstRow.querySelector('.photo-cell[data-col="visual"]');
      const mapCell = firstRow.querySelector('.photo-cell[data-col="map"]');

      // Prepend store-level cells to secondRow
      mergedCells.reverse().forEach(cell => {
        secondRow.insertBefore(cell, secondRow.firstChild);
      });

      // Insert exterior & visual before current
      const currentCell = secondRow.querySelector('.photo-cell[data-col="current"]');
      if (currentCell) {
        if (visualCell) secondRow.insertBefore(visualCell, currentCell);
        if (exteriorCell) secondRow.insertBefore(exteriorCell, visualCell || currentCell);
      }

      // Append map cell at end
      if (mapCell) secondRow.appendChild(mapCell);

      // Decrement rowspan on all merged cells
      secondRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type, .photo-cell[data-col="exterior"], .photo-cell[data-col="visual"], .photo-cell[data-col="map"]').forEach(cell => {
        const cur = parseInt(cell.getAttribute('rowspan') || '2', 10);
        cell.setAttribute('rowspan', Math.max(cur - 1, 1));
      });

      rowToDelete.remove();

    } else {
      // Deleting a non-first row
      firstRow.querySelectorAll('.col-new, .store-code, .store-name, .store-county, .store-address, .ad-type, .photo-cell[data-col="exterior"], .photo-cell[data-col="visual"], .photo-cell[data-col="map"]').forEach(cell => {
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

    incrementChangeCount();
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
    // 1. New store toggle
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
        incrementChangeCount();
        showToast('已切換為：' + (newStatus ? '新增門市' : '一般門市'), 'info');
      };
      return;
    }

    // 2. Ad Type Cycle
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
        incrementChangeCount();
        showToast('已切換廣告類型為：' + nextType, 'info');
      };
      return;
    }

    // 3. Text Cells (Store Code, Name, County, Address, BB, Dimensions, Rental)
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
        incrementChangeCount();
        showToast('已儲存修改內容', 'success');
      }
    };
  }

  // ===== Apply Stored Overrides =====
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
      console.log('[Outdoor Admin] 已套用 ' + records.length + ' 筆自訂圖檔記錄');
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

    // Enable draggable and rotation on all items
    document.querySelectorAll('.photo-item').forEach(item => {
      item.setAttribute('draggable', 'true');
      bindPhotoItemDragEvents(item);
    });

    // Enable contenteditable on editable text cells
    document.querySelectorAll('.editable-cell').forEach(cell => {
      if (!cell.classList.contains('col-new') && !cell.classList.contains('ad-type')) {
        cell.setAttribute('contenteditable', 'true');
      }
    });

    if (showNotice) {
      showToast('歡迎進入管理者模式！所有欄位皆可點擊編輯、支援版位增刪與圖片旋轉', 'success');
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

    // Token Configuration Button
    const tokenBtn = document.getElementById('btn-admin-token');
    if (tokenBtn) {
      tokenBtn.addEventListener('click', () => {
        const cur = localStorage.getItem('outdoor_gh_token') || '';
        const masked = cur ? cur.slice(0, 7) + '...' + cur.slice(-4) : '未設定';
        const val = prompt('【GitHub Token 管理】
目前本機狀態：' + masked + '

請輸入新的 Token（留空按確定可清除）：', cur);
        if (val !== null) {
          if (val.trim()) {
            localStorage.setItem('outdoor_gh_token', val.trim());
            showToast('Token 已成功儲存在這台電腦', 'success');
          } else {
            localStorage.removeItem('outdoor_gh_token');
            showToast('已清除這台電腦上的 Token', 'info');
          }
        }
      });
    }

    // Lightbox Rotation Buttons
    const lbRotLeft = document.getElementById('lightbox-rot-left');
    const lbRotRight = document.getElementById('lightbox-rot-right');
    const lbImg = document.getElementById('lightbox-img');

    if (lbRotLeft && lbImg) {
      lbRotLeft.addEventListener('click', (e) => {
        e.stopPropagation();
        handleLightboxRotate(-90);
      });
    }
    if (lbRotRight && lbImg) {
      lbRotRight.addEventListener('click', (e) => {
        e.stopPropagation();
        handleLightboxRotate(90);
      });
    }
  }

  function handleLightboxRotate(delta) {
    const lbImg = document.getElementById('lightbox-img');
    if (!lbImg) return;

    let cur = parseInt(lbImg.getAttribute('data-rotate') || '0', 10);
    cur = (cur + delta + 360) % 360;
    lbImg.setAttribute('data-rotate', cur);
    lbImg.style.transform = cur ? 'rotate(' + cur + 'deg)' : '';

    if (currentLightboxImgEl) {
      applyRotationToImg(currentLightboxImgEl, cur);
      const cell = currentLightboxImgEl.closest('.photo-cell');
      if (cell) persistCell(cell);
      showToast('已旋轉大圖至 ' + cur + '° (原圖已同步)', 'info');
    }
  }

  // ===== Publish to GitHub Pages via REST API =====
  async function handlePublishToGitHub() {
    let token = getGitHubToken();
    if (!token) {
      token = prompt('【安全認證】首次發布請輸入您的 GitHub Personal Access Token (PAT)：
（此 Token 僅會安全儲存在您這台電腦的瀏覽器中，公開網頁代碼完全不包含任何密鑰）');
      if (!token || !token.trim()) {
        showToast('已取消發布 (未提供 Token)', 'warning');
        return;
      }
      token = token.trim();
      localStorage.setItem('outdoor_gh_token', token);
    }

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
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

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

      // Remove temporary attributes
      cloneDoc.querySelectorAll('.photo-item').forEach(item => {
        item.removeAttribute('draggable');
        item.classList.remove('dragging');
      });
      cloneDoc.querySelectorAll('.photo-cell').forEach(cell => {
        cell.classList.remove('drag-over');
      });
      cloneDoc.querySelectorAll('.editable-cell').forEach(cell => {
        cell.removeAttribute('contenteditable');
      });

      const fullHtml = '<!DOCTYPE html>\n' + cloneDoc.outerHTML;

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
          message: 'chore(admin): 管理者更新門市照片與版位欄位 (' + new Date().toLocaleString('zh-TW') + ')',
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

    // 3. Bind Editable Cells
    bindEditableCells();

    // 4. Bind Location Controls (Add/Delete)
    bindLocationControls();

    // 5. Apply Local Customizations from IndexedDB
    await applyAllStoredOverrides();

    // 6. Bind Existing Items: Drag, Delete, Rotate
    document.querySelectorAll('.photo-item').forEach(item => {
      bindPhotoItemDragEvents(item);

      const delBtn = item.querySelector('.photo-del-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleDeletePhoto(item);
        });
      }

      const rotL = item.querySelector('.photo-rot-left');
      if (rotL) {
        rotL.addEventListener('click', (e) => {
          e.stopPropagation();
          handleRotatePhoto(item, -90);
        });
      }

      const rotR = item.querySelector('.photo-rot-right');
      if (rotR) {
        rotR.addEventListener('click', (e) => {
          e.stopPropagation();
          handleRotatePhoto(item, 90);
        });
      }

      const img = item.querySelector('img');
      if (img) {
        img.addEventListener('click', () => {
          openLightboxForImg(img);
        });
      }
    });

    // 7. Check if already logged in this session
    checkSessionAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
