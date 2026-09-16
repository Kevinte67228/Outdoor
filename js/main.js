document.addEventListener('DOMContentLoaded', () => {
  // ===== Lightbox =====
  const overlay = document.getElementById('lightbox-overlay');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxCaption = document.getElementById('lightbox-caption');

  document.querySelectorAll('.thumb').forEach(thumb => {
    thumb.addEventListener('click', (e) => {
      const src = e.target.getAttribute('data-full') || e.target.src;
      const caption = e.target.getAttribute('data-caption') || '';
      lightboxImg.src = src;
      lightboxCaption.textContent = caption;
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('lightbox-close')) {
      closeLightbox();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  function closeLightbox() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    lightboxImg.src = '';
  }

  // ===== Search & Filter =====
  const searchInput = document.getElementById('search-input');
  const countyFilter = document.getElementById('county-filter');
  const typeFilter = document.getElementById('type-filter');
  const newFilter = document.getElementById('new-filter');
  const table = document.getElementById('main-table');
  const tbody = table.querySelector('tbody');
  const rows = table.querySelectorAll('tbody tr');

  // Group rows by merged item block (row with store-code)
  const entryGroups = [];
  let currentGroup = null;

  rows.forEach(row => {
    const storeCodeCell = row.querySelector('.store-code');
    if (storeCodeCell) {
      currentGroup = {
        storeCode: row.dataset.store || '',
        storeName: row.dataset.name || '',
        county: row.dataset.county || '',
        address: row.dataset.addr || '',
        type: row.dataset.type || '',
        isNew: row.dataset.new || '',
        originalIndex: entryGroups.length,
        rows: [row]
      };
      entryGroups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.rows.push(row);
    }
  });

  function applyFilter() {
    const query = searchInput.value.toLowerCase().trim();
    const countyVal = countyFilter ? countyFilter.value : '';
    const typeVal = typeFilter.value;
    const newVal = newFilter ? newFilter.value : '';

    entryGroups.forEach(group => {
      const matchesSearch = !query || 
        group.storeCode.toLowerCase().includes(query) ||
        group.storeName.toLowerCase().includes(query) ||
        group.county.toLowerCase().includes(query) ||
        group.address.toLowerCase().includes(query) ||
        group.rows.some(r => r.textContent.toLowerCase().includes(query));
      
      const matchesCounty = !countyVal || group.county === countyVal;
      const matchesType = !typeVal || group.type === typeVal;
      const matchesNew = !newVal || group.isNew === newVal;

      const visible = matchesSearch && matchesCounty && matchesType && matchesNew;

      group.rows.forEach(row => {
        row.classList.toggle('hidden-row', !visible);
      });
    });
  }

  searchInput.addEventListener('input', applyFilter);
  if (countyFilter) countyFilter.addEventListener('change', applyFilter);
  typeFilter.addEventListener('change', applyFilter);
  if (newFilter) newFilter.addEventListener('change', applyFilter);

  // ===== Sorting (Store Code & County) =====
  let currentSort = { field: null, direction: null }; // 'asc' | 'desc' | null

  const sortBtns = document.querySelectorAll('.sort-btn');

  sortBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const field = btn.getAttribute('data-sort');
      
      let newDir = 'asc';
      if (currentSort.field === field) {
        if (currentSort.direction === 'asc') newDir = 'desc';
        else if (currentSort.direction === 'desc') newDir = null;
      }
      
      currentSort = { field: newDir ? field : null, direction: newDir };

      // Update button icons
      sortBtns.forEach(b => {
        b.classList.remove('active');
        b.textContent = '↕';
      });

      if (newDir) {
        btn.classList.add('active');
        btn.textContent = newDir === 'asc' ? '▲' : '▼';
      }

      // Sort entryGroups
      const sorted = [...entryGroups].sort((a, b) => {
        if (!currentSort.direction) {
          return a.originalIndex - b.originalIndex;
        }
        
        let valA = a[currentSort.field] || '';
        let valB = b[currentSort.field] || '';

        // Keep '—' entries at the bottom in ascending order
        if (valA === '—') valA = 'zzz';
        if (valB === '—') valB = 'zzz';

        let cmp = 0;
        if (currentSort.field === 'county') {
          cmp = valA.localeCompare(valB, 'zh-Hant');
          if (cmp === 0) cmp = a.storeCode.localeCompare(b.storeCode);
        } else {
          cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        }

        return currentSort.direction === 'asc' ? cmp : -cmp;
      });

      // Re-attach rows in sorted order to tbody preserving rowspan
      const fragment = document.createDocumentFragment();
      sorted.forEach(group => {
        group.rows.forEach(r => fragment.appendChild(r));
      });
      tbody.appendChild(fragment);
    });
  });
});
