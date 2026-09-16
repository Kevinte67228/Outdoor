const fs = require('fs');
const path = require('path');

const entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'accurate_entries.json'), 'utf8'));

// Count totals
const totalEntries = entries.length;
const uniqueStoreCodes = new Set(entries.map(e => e.storeCode)).size;
let totalBBLocations = 0;
let totalRentalSum = 0;
let canvasCount = 0;
let ledCount = 0;
let newStoreCount = 0;

entries.forEach(e => {
  const count = Math.max(e.specRows.length, 1);
  totalBBLocations += count;
  if (e.isNew) newStoreCount++;
  if (e.adType === '帆布外招') canvasCount++;
  else if (e.adType === '導光板') ledCount++;

  e.specRows.forEach(r => {
    if (r.rental) {
      const num = parseInt(r.rental.replace(/[^0-9]/g, ''));
      if (!isNaN(num) && num > 0 && num < 1000000) totalRentalSum += num;
    }
  });
});

// Unique counties
const countyOrder = [
  '基隆市', '台北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣',
  '台中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '台南市',
  '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣'
];
const presentCounties = new Set(entries.map(e => e.county).filter(c => c && c !== '—'));
const sortedCounties = countyOrder.filter(c => presentCounties.has(c));

let html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>門市戶外廣告看板明細</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>

  <!-- Header -->
  <div class="page-header">
    <div class="header-left">
      <h1>🏪 門市戶外廣告看板明細</h1>
      <div class="subtitle">門市外招現況調查 (全門市橫式分類明細表)</div>
    </div>
    <div class="header-right">
      <div class="date-badge">📅 2026 年 7 月</div>
      <a href="https://kevinte67228.github.io/Outdoor/" target="_blank" class="header-btn link-btn" title="在新視窗開啟 GitHub Pages 線上版">🌐 線上預覽</a>
      <button type="button" id="admin-login-btn" class="header-btn admin-btn" title="輸入密碼進入管理者模式">🔐 管理功能</button>
    </div>
  </div>

  <!-- Admin Toolbar (浮動/固定管理列) -->
  <div id="admin-toolbar" class="admin-toolbar" style="display: none;">
    <div class="admin-toolbar-inner">
      <div class="admin-status">
        <span class="admin-badge">🛡️ 管理者模式中</span>
        <span class="admin-tip">💡 支援跨欄位拖曳、桌面拖入新圖、點 ✕ 刪除</span>
        <span id="admin-change-badge" class="change-badge" style="display:none;">已變更 <strong id="admin-change-count">0</strong> 處</span>
      </div>
      <div class="admin-actions">
        <button type="button" id="btn-admin-publish" class="btn-action btn-publish" title="將當前修改直接提交發布至 GitHub Pages，讓所有使用者皆可看到">🚀 發布更新至線上</button>
        <button type="button" id="btn-admin-export" class="btn-action btn-secondary" title="匯出本機所有圖片調整設定為 JSON 檔案">📥 匯出備份</button>
        <button type="button" id="btn-admin-import" class="btn-action btn-secondary" title="匯入先前備份的 JSON 設定">📤 匯入備份</button>
        <input type="file" id="admin-import-file" accept=".json" style="display:none;">
        <button type="button" id="btn-admin-reset" class="btn-action btn-danger-outline" title="清除所有變更並還原為初始圖檔">🔄 還原預設</button>
        <button type="button" id="btn-admin-logout" class="btn-action btn-logout" title="退出管理者模式">🔒 登出</button>
      </div>
    </div>
  </div>

  <!-- Stats Bar -->
  <div class="stats-bar">
    <div class="stat-card">門市總數 <strong>${uniqueStoreCodes}</strong>間</div>
    <div class="stat-card">廣告項目 <strong>${totalEntries}</strong>筆</div>
    <div class="stat-card">看板位置 <strong>${totalBBLocations}</strong>處</div>
    <div class="stat-card">帆布外招 <strong>${canvasCount}</strong></div>
    <div class="stat-card">導光板 <strong>${ledCount}</strong></div>
    <div class="stat-card">新增門市 <strong>${newStoreCount}</strong>間</div>
    <div class="stat-card">已辨識租金合計 <strong>$${totalRentalSum.toLocaleString()}</strong></div>
  </div>

  <!-- Filter & Search Bar -->
  <div class="filter-bar">
    <input type="text" id="search-input" placeholder="🔍 搜尋店碼、店名、縣市、地址、看板代碼..." class="search-input">
    <select id="county-filter" class="type-filter">
      <option value="">全部縣市</option>
      ${sortedCounties.map(c => `<option value="${c}">${c}</option>`).join('\n      ')}
    </select>
    <select id="type-filter" class="type-filter">
      <option value="">全部類型</option>
      <option value="帆布外招">帆布外招</option>
      <option value="導光板">導光板</option>
      <option value="包柱">包柱</option>
      <option value="大圖輸出">大圖輸出</option>
    </select>
    <select id="new-filter" class="type-filter">
      <option value="">全部門市</option>
      <option value="新增">僅顯示新增門市</option>
    </select>
  </div>

  <!-- Main Table -->
  <div class="table-container">
    <table class="billboard-table" id="main-table">
      <thead>
        <tr>
          <th>新增</th>
          <th>店碼 <button class="sort-btn" id="sort-store" data-sort="storeCode" title="依店碼排序">↕</button></th>
          <th>店名</th>
          <th>縣市 <button class="sort-btn" id="sort-county" data-sort="county" title="依縣市排序">↕</button></th>
          <th>地址</th>
          <th>廣告類型</th>
          <th>BB</th>
          <th>導光板 W</th>
          <th>導光板 H</th>
          <th>出血 W</th>
          <th>出血 H</th>
          <th>可見 W</th>
          <th>可見 H</th>
          <th>租金</th>
          <th>門市外觀<br><span class="th-sub">(原本照片)</span></th>
          <th>廣告海報<br><span class="th-sub">(視覺設計圖)</span></th>
          <th>2026現況<br><span class="th-sub">(現況照片)</span></th>
          <th>定位截圖<br><span class="th-sub">(Google地圖)</span></th>
        </tr>
      </thead>
      <tbody>
`;

entries.forEach((e) => {
  const code = e.storeCode || '';
  const name = e.storeName || '';
  const addr = e.address || '';
  const adType = e.adType || '帆布外招';
  const isNew = e.isNew;

  // Type badge styling
  let badgeClass = 'type-canvas';
  if (adType === '導光板') badgeClass = 'type-led';
  else if (adType === '包柱') badgeClass = 'type-column';
  else if (adType === '大圖輸出') badgeClass = 'type-poster';

  const rows = (e.specRows && e.specRows.length > 0) ? e.specRows : [
    { location: 'A', ledW: '—', ledH: '—', bldW: '—', bldH: '—', visW: '—', visH: '—', rental: '—' }
  ];

  const rowCount = rows.length;
  const origPhotos = e.originalPhoto || [];
  const visualDesigns = e.visualDesign || [];
  const googleMaps = e.googleMap || [];
  const currPhotos = e.currentPhotos || [];

  for (let i = 0; i < rowCount; i++) {
    const r = rows[i];
    const loc = r.location || (rowCount === 1 ? 'A' : String.fromCharCode(65 + i));
    const isFirst = i === 0;
    const isLast = i === rowCount - 1;

    const county = e.county || '—';

    // Add entry-last-row class to the last row of each entry
    const rowClass = isLast ? 'entry-last-row' : 'entry-inner-row';

    html += `        <tr data-store="${code}" data-name="${name}" data-county="${county}" data-addr="${addr}" data-type="${adType}" data-new="${isNew ? '新增' : ''}" class="${rowClass}">\n`;

    // Merged columns (First row only)
    if (isFirst) {
      // 1. 新增 (獨立欄位)
      html += `          <td class="col-new editable-cell" rowspan="${rowCount}">${isNew ? '<span class="badge-new-col" title="點擊切換新增狀態">新增</span>' : '<span class="no-data" title="點擊切換新增狀態">—</span>'}</td>\n`;
      // 2. 店碼
      html += `          <td class="store-code editable-cell" rowspan="${rowCount}">${code}</td>\n`;
      // 3. 店名
      html += `          <td class="store-name editable-cell" rowspan="${rowCount}">${name}</td>\n`;
      // 4. 縣市 (根據地址)
      html += `          <td class="store-county editable-cell" rowspan="${rowCount}">${county !== '—' ? '<span class="badge-county">' + county + '</span>' : '<span class="no-data">—</span>'}</td>\n`;
      // 5. 地址
      html += `          <td class="store-address editable-cell" rowspan="${rowCount}">${addr}${e.notes ? '<br><span class="note">📌 ' + e.notes + '</span>' : ''}</td>\n`;
      // 6. 廣告類型
      html += `          <td class="ad-type editable-cell" rowspan="${rowCount}"><span class="type-badge ${badgeClass}" title="點擊切換廣告類型">${adType}</span></td>\n`;
    }

    // 7. BB Location
    html += `          <td class="bb-location editable-cell"><span class="bb-text">${loc}</span><button class="loc-del-btn" type="button" title="刪除此版位">&times;</button>${isLast ? '<button class="btn-add-loc" type="button" title="新增一個版位 (如 A,B,C ➜ D)">➕ 加版位</button>' : ''}</td>\n`;
    // 8. 導光板 W
    html += `          <td class="dimension-led editable-cell">${r.ledW || '—'}</td>\n`;
    // 9. 導光板 H
    html += `          <td class="dimension-led editable-cell">${r.ledH || '—'}</td>\n`;
    // 10. 出血 W
    html += `          <td class="dimension-bleed editable-cell">${r.bldW || '—'}</td>\n`;
    // 11. 出血 H
    html += `          <td class="dimension-bleed editable-cell">${r.bldH || '—'}</td>\n`;
    // 12. 可見 W
    html += `          <td class="dimension editable-cell">${r.visW || '—'}</td>\n`;
    // 13. 可見 H
    html += `          <td class="dimension editable-cell">${r.visH || '—'}</td>\n`;
    // 14. 租金
    html += `          <td class="rental editable-cell">${r.rental || '—'}</td>\n`;

    // 15. 門市外觀 (原本照片, Merged)
    if (isFirst) {
      html += `          <td class="photo-cell" rowspan="${rowCount}" data-col="exterior" data-store="${code}" data-adtype="${adType}">\n`;
      if (origPhotos.length > 0) {
        html += `            <div class="photo-group">\n`;
        origPhotos.forEach(img => {
          html += `              <div class="photo-item">\n`;
          html += `                <img class="thumb" src="images/${img}" data-full="images/${img}" data-caption="${code} ${name} (${adType}) — 門市外觀實景照" alt="${code} 門市外觀" loading="lazy" data-rotate="0">\n`;
          html += `                <button class="photo-rot-btn photo-rot-left" type="button" title="向左旋轉90度">↺</button>\n`;
          html += `                <button class="photo-rot-btn photo-rot-right" type="button" title="向右旋轉90度">↻</button>\n`;
          html += `                <button class="photo-del-btn" type="button" title="刪除此圖檔">&times;</button>\n`;
          html += `              </div>\n`;
        });
        html += `            </div>\n`;
      } else {
        html += `            <span class="no-data">—</span>\n`;
      }
      html += `          </td>\n`;

      // 16. 廣告海報 (視覺設計圖, Merged)
      html += `          <td class="photo-cell" rowspan="${rowCount}" data-col="visual" data-store="${code}" data-adtype="${adType}">\n`;
      if (visualDesigns.length > 0) {
        html += `            <div class="photo-group">\n`;
        visualDesigns.forEach(img => {
          html += `              <div class="photo-item">\n`;
          html += `                <img class="thumb visual-thumb" src="images/${img}" data-full="images/${img}" data-caption="${code} ${name} (${adType}) — 廣告海報/設計稿" alt="${code} 廣告海報" loading="lazy" data-rotate="0">\n`;
          html += `                <button class="photo-rot-btn photo-rot-left" type="button" title="向左旋轉90度">↺</button>\n`;
          html += `                <button class="photo-rot-btn photo-rot-right" type="button" title="向右旋轉90度">↻</button>\n`;
          html += `                <button class="photo-del-btn" type="button" title="刪除此圖檔">&times;</button>\n`;
          html += `              </div>\n`;
        });
        html += `            </div>\n`;
      } else {
        html += `            <span class="no-data">—</span>\n`;
      }
      html += `          </td>\n`;
    }

    // 17. 2026現況 (現況照片, Per-location)
    html += `          <td class="photo-cell" data-col="current" data-loc="${loc}" data-store="${code}" data-adtype="${adType}">\n`;
    if (currPhotos.length > 0) {
      html += `            <div class="photo-group">\n`;
      let selectedCurr = [];
      if (rowCount === 1) {
        selectedCurr = currPhotos;
      } else if (currPhotos.length >= rowCount) {
        selectedCurr = [currPhotos[i]];
      } else {
        selectedCurr = i === 0 ? currPhotos : [];
      }

      if (selectedCurr.length > 0) {
        selectedCurr.forEach(img => {
          html += `              <div class="photo-item">\n`;
          html += `                <img class="thumb" src="images/${img}" data-full="images/${img}" data-caption="${code} ${name} ${loc} (${adType}) — 2026現況照片" alt="${code} 2026現況" loading="lazy" data-rotate="0">\n`;
          html += `                <button class="photo-rot-btn photo-rot-left" type="button" title="向左旋轉90度">↺</button>\n`;
          html += `                <button class="photo-rot-btn photo-rot-right" type="button" title="向右旋轉90度">↻</button>\n`;
          html += `                <button class="photo-del-btn" type="button" title="刪除此圖檔">&times;</button>\n`;
          html += `              </div>\n`;
        });
      } else {
        html += `              <span class="no-data">—</span>\n`;
      }
      html += `            </div>\n`;
    } else {
      html += `            <span class="no-data">—</span>\n`;
    }
    html += `          </td>\n`;

    // 18. 定位截圖 (Google地圖, Merged, 最後一欄)
    if (isFirst) {
      html += `          <td class="photo-cell" rowspan="${rowCount}" data-col="map" data-store="${code}" data-adtype="${adType}">\n`;
      if (googleMaps.length > 0) {
        html += `            <div class="photo-group">\n`;
        googleMaps.forEach(img => {
          html += `              <div class="photo-item">\n`;
          html += `                <img class="thumb map-thumb" src="images/${img}" data-full="images/${img}" data-caption="${code} ${name} (${adType}) — Google地圖定位截圖" alt="${code} 定位截圖" loading="lazy" data-rotate="0">\n`;
          html += `                <button class="photo-rot-btn photo-rot-left" type="button" title="向左旋轉90度">↺</button>\n`;
          html += `                <button class="photo-rot-btn photo-rot-right" type="button" title="向右旋轉90度">↻</button>\n`;
          html += `                <button class="photo-del-btn" type="button" title="刪除此圖檔">&times;</button>\n`;
          html += `              </div>\n`;
        });
        html += `            </div>\n`;
      } else {
        html += `            <span class="no-data">—</span>\n`;
      }
      html += `          </td>\n`;
    }

    html += `        </tr>\n`;

  }
});

html += `      </tbody>
    </table>
  </div>

  <!-- Lightbox Modal -->
  <div class="lightbox-overlay" id="lightbox-overlay">
    <div class="lightbox-content">
      <div class="lightbox-close">&times;</div>
      <img id="lightbox-img" src="" alt="放大檢視" data-rotate="0">
      <div class="lightbox-toolbar">
        <button type="button" id="lightbox-rot-left" class="lb-rot-btn" title="向左旋轉 90°">↺ 向左 90°</button>
        <button type="button" id="lightbox-rot-right" class="lb-rot-btn" title="向右旋轉 90°">↻ 向右 90°</button>
      </div>
      <div class="lightbox-caption" id="lightbox-caption"></div>
    </div>
  </div>

  <!-- Admin Login Modal -->
  <div id="admin-modal" class="modal-overlay" style="display: none;">
    <div class="modal-card">
      <div class="modal-header">
        <h3>🔐 管理者驗證</h3>
        <button class="modal-close" id="admin-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">請輸入管理密碼以啟用編輯、拖曳與圖檔刪除功能：</p>
        <div class="password-input-wrap">
          <input type="password" id="admin-password-input" placeholder="請輸入密碼" autocomplete="off">
          <button type="button" id="toggle-pwd-btn" class="toggle-pwd-btn" title="顯示/隱藏密碼">👁️</button>
        </div>
        <div id="admin-pwd-error" class="error-msg" style="display:none;">⚠️ 密碼錯誤，請重新輸入</div>
      </div>
      <div class="modal-footer">
        <button type="button" id="admin-login-cancel" class="btn-modal btn-cancel">取消</button>
        <button type="button" id="admin-login-submit" class="btn-modal btn-confirm">確定進入</button>
      </div>
    </div>
  </div>

  <!-- Sync / Publish Modal -->
  <div id="sync-modal" class="modal-overlay" style="display: none;">
    <div class="modal-card sync-card">
      <div class="modal-header">
        <h3 id="sync-modal-title">🚀 同步發布至 GitHub Pages</h3>
        <button class="modal-close" id="sync-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div id="sync-spinner" class="sync-spinner"></div>
        <div id="sync-status-text" class="sync-status-text">準備發布中...</div>
        <div id="sync-log-box" class="sync-log-box"></div>
      </div>
      <div class="modal-footer">
        <a id="sync-visit-link" href="https://kevinte67228.github.io/Outdoor/" target="_blank" class="btn-modal btn-view-online" style="display:none;">🌐 開啟線上版</a>
        <button type="button" id="sync-modal-ok" class="btn-modal btn-confirm" style="display:none;">關閉</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div id="toast-container" class="toast-container"></div>

  <!-- Scripts -->
  <script src="js/main.js"></script>
  <script src="js/admin.js"></script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf8');
console.log('Successfully generated index.html with 17 superset columns and updated classifications!');
