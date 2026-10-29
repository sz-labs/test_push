const state = {
  page: 1,
  pageSize: 20,
  totalPages: 1,
  selectedFile: null,
  searchTimer: null,
  users: [],
  resetUserId: null,
};

const elements = {
  dbStatus: document.querySelector('#dbStatus'),
  currentUser: document.querySelector('#currentUser'),
  lastUpdated: document.querySelector('#lastUpdated'),
  totalRecords: document.querySelector('#totalRecords'),
  uniqueSkus: document.querySelector('#uniqueSkus'),
  inboundQty: document.querySelector('#inboundQty'),
  outboundQty: document.querySelector('#outboundQty'),
  currentStock: document.querySelector('#currentStock'),
  trendChart: document.querySelector('#trendChart'),
  typeList: document.querySelector('#typeList'),
  recordCount: document.querySelector('#recordCount'),
  recordTableBody: document.querySelector('#recordTableBody'),
  warehouseFilter: document.querySelector('#warehouseFilter'),
  directionFilter: document.querySelector('#directionFilter'),
  typeFilter: document.querySelector('#typeFilter'),
  dateFromFilter: document.querySelector('#dateFromFilter'),
  dateToFilter: document.querySelector('#dateToFilter'),
  searchInput: document.querySelector('#searchInput'),
  pageInfo: document.querySelector('#pageInfo'),
  previousPageButton: document.querySelector('#previousPageButton'),
  nextPageButton: document.querySelector('#nextPageButton'),
  importList: document.querySelector('#importList'),
  uploadModal: document.querySelector('#uploadModal'),
  fileInput: document.querySelector('#fileInput'),
  filePrompt: document.querySelector('#filePrompt'),
  fileMeta: document.querySelector('#fileMeta'),
  dropZone: document.querySelector('#dropZone'),
  submitUploadButton: document.querySelector('#submitUploadButton'),
  uploadResult: document.querySelector('#uploadResult'),
  openUsersButton: document.querySelector('#openUsersButton'),
  usersModal: document.querySelector('#usersModal'),
  closeUsersButton: document.querySelector('#closeUsersButton'),
  createUserForm: document.querySelector('#createUserForm'),
  newUsername: document.querySelector('#newUsername'),
  newUserPassword: document.querySelector('#newUserPassword'),
  createUserButton: document.querySelector('#createUserButton'),
  userMessage: document.querySelector('#userMessage'),
  userTableBody: document.querySelector('#userTableBody'),
  passwordResetForm: document.querySelector('#passwordResetForm'),
  passwordResetTitle: document.querySelector('#passwordResetTitle'),
  resetPasswordInput: document.querySelector('#resetPasswordInput'),
  cancelPasswordReset: document.querySelector('#cancelPasswordReset'),
  toast: document.querySelector('#toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value, maximumFractionDigits = 2) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(number);
}

function formatDateTime(value) {
  if (!value) return '--';
  return String(value).replace('T', ' ').slice(0, 16);
}

function formatShortDate(value) {
  if (!value) return '';
  const date = String(value).slice(0, 10);
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.replace('/login');
    throw new Error('登录已失效，请重新登录。');
  }
  if (!response.ok) throw new Error(payload.message || '请求失败');
  return payload;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.toast.hidden = true; }, 3200);
}

function renderTrend(data) {
  if (!data.length) {
    elements.trendChart.innerHTML = '<div class="empty-state">暂无可展示的数据</div>';
    return;
  }
  const maxValue = Math.max(1, ...data.flatMap((item) => [Number(item.inbound), Number(item.outbound)]));
  elements.trendChart.innerHTML = data.map((item) => {
    const inboundHeight = Math.max(1, Number(item.inbound) / maxValue * 100);
    const outboundHeight = Math.max(1, Number(item.outbound) / maxValue * 100);
    return `
      <div class="chart-day">
        <div class="bar-pair">
          <div class="bar in" style="height:${inboundHeight}%" title="入库 ${formatNumber(item.inbound)}"></div>
          <div class="bar out" style="height:${outboundHeight}%" title="出库 ${formatNumber(item.outbound)}"></div>
        </div>
        <span class="chart-label">${formatShortDate(item.day)}</span>
      </div>`;
  }).join('');
}

function renderTypes(data) {
  if (!data.length) {
    elements.typeList.innerHTML = '<div class="empty-state">暂无可展示的数据</div>';
    return;
  }
  const max = Math.max(...data.map((item) => Number(item.count)), 1);
  elements.typeList.innerHTML = data.map((item) => `
    <div class="type-row">
      <span class="type-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <strong class="type-count">${formatNumber(item.count, 0)}</strong>
      <div class="type-track"><div class="type-fill" style="width:${Number(item.count) / max * 100}%"></div></div>
    </div>`).join('');
}

function syncSelectOptions(select, values, placeholder) {
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>${values.map((value) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
  ).join('')}`;
  if (values.includes(current)) select.value = current;
}

async function loadDashboard() {
  const data = await fetchJson('/api/dashboard');
  elements.totalRecords.textContent = formatNumber(data.summary.total_records, 0);
  elements.uniqueSkus.textContent = formatNumber(data.summary.unique_skus, 0);
  elements.inboundQty.textContent = formatNumber(data.summary.inbound_qty);
  elements.outboundQty.textContent = formatNumber(data.summary.outbound_qty);
  elements.currentStock.textContent = formatNumber(data.summary.current_stock);
  elements.lastUpdated.textContent = data.summary.latest_event_at
    ? `最新业务时间 ${formatDateTime(data.summary.latest_event_at)}`
    : '数据库暂无库存记录';
  renderTrend(data.daily);
  renderTypes(data.types);
  syncSelectOptions(elements.warehouseFilter, data.warehouses, '全部仓库');
  syncSelectOptions(
    elements.typeFilter,
    data.types.map((item) => item.name).filter((name) => name !== '未分类'),
    '全部类型'
  );
}

function getRecordQuery() {
  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  const filters = {
    q: elements.searchInput.value.trim(),
    warehouse: elements.warehouseFilter.value,
    direction: elements.directionFilter.value,
    type: elements.typeFilter.value,
    dateFrom: elements.dateFromFilter.value,
    dateTo: elements.dateToFilter.value,
  };
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params.toString();
}

function renderRecords(data) {
  state.totalPages = data.totalPages;
  elements.recordCount.textContent = `共 ${formatNumber(data.total, 0)} 条记录`;
  elements.pageInfo.textContent = `第 ${data.page} / ${data.totalPages} 页`;
  elements.previousPageButton.disabled = data.page <= 1;
  elements.nextPageButton.disabled = data.page >= data.totalPages;

  if (!data.rows.length) {
    elements.recordTableBody.innerHTML = '<tr><td colspan="10" class="table-message">没有符合条件的记录</td></tr>';
    return;
  }

  elements.recordTableBody.innerHTML = data.rows.map((row) => {
    const change = Number(row.change_amount || 0);
    const changeClass = change > 0 ? 'change-in' : change < 0 ? 'change-out' : '';
    const changeText = change > 0 ? `+${formatNumber(change)}` : formatNumber(change);
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(row.occurred_at))}</td>
        <td class="sku-code" title="${escapeHtml(row.sku_code)}">${escapeHtml(row.sku_code)}</td>
        <td class="sku-name" title="${escapeHtml(row.sku_name || '')}">${escapeHtml(row.sku_name || '--')}</td>
        <td class="number-cell">${formatNumber(row.previous_stock)}</td>
        <td class="number-cell"><span class="change-value ${changeClass}">${changeText}</span></td>
        <td class="number-cell"><strong>${formatNumber(row.new_stock)}</strong></td>
        <td>${escapeHtml(row.warehouse || '--')}</td>
        <td><span class="type-badge" title="${escapeHtml(row.change_type || '')}">${escapeHtml(row.change_type || '未分类')}</span></td>
        <td>${escapeHtml(row.document_number || '--')}</td>
        <td class="number-cell">${row.current_cost == null ? '--' : formatNumber(row.current_cost, 4)}</td>
      </tr>`;
  }).join('');
}

async function loadRecords() {
  elements.recordTableBody.innerHTML = '<tr><td colspan="10" class="table-message">正在加载数据</td></tr>';
  renderRecords(await fetchJson(`/api/records?${getRecordQuery()}`));
}

function renderImports(rows) {
  if (!rows.length) {
    elements.importList.innerHTML = '<div class="empty-state">暂无导入记录</div>';
    return;
  }
  const statusNames = { completed: '已完成', failed: '失败', processing: '处理中' };
  elements.importList.innerHTML = rows.map((row) => `
    <div class="import-row">
      <div class="import-file">
        <strong title="${escapeHtml(row.file_name)}">${escapeHtml(row.file_name)}</strong>
        <span>${escapeHtml(row.sheet_name || '--')} · ${formatDateTime(row.imported_at)}</span>
      </div>
      <div class="import-stat"><strong>${formatNumber(row.total_rows, 0)}</strong><span>总行数</span></div>
      <div class="import-stat"><strong>${formatNumber(row.inserted_rows, 0)}</strong><span>新增</span></div>
      <div class="import-stat"><strong>${formatNumber(row.duplicate_rows, 0)}</strong><span>重复</span></div>
      <div class="import-stat"><strong>${formatNumber(row.error_rows, 0)}</strong><span>异常</span></div>
      <span class="status-pill status-${escapeHtml(row.status)}" title="${escapeHtml(row.error_message || '')}">${statusNames[row.status] || row.status}</span>
    </div>`).join('');
}

async function loadImports() {
  const data = await fetchJson('/api/imports');
  renderImports(data.rows);
}

async function refreshAll(showMessage = false) {
  try {
    await Promise.all([loadDashboard(), loadRecords(), loadImports()]);
    elements.dbStatus.className = 'db-status connected';
    elements.dbStatus.innerHTML = '<span></span>数据库已连接';
    if (showMessage) showToast('数据已刷新');
  } catch (error) {
    elements.dbStatus.className = 'db-status failed';
    elements.dbStatus.innerHTML = '<span></span>连接失败';
    showToast(error.message);
  }
}

function openUploadModal() {
  elements.uploadModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeUploadModal() {
  elements.uploadModal.hidden = true;
  document.body.style.overflow = '';
  resetUpload();
}

function resetUpload() {
  state.selectedFile = null;
  elements.fileInput.value = '';
  elements.filePrompt.textContent = '选择或拖入 Excel 文件';
  elements.fileMeta.textContent = '需包含 SKU编号、变动、新库存列';
  elements.submitUploadButton.disabled = true;
  elements.uploadResult.hidden = true;
  elements.uploadResult.className = 'upload-result';
  elements.uploadResult.textContent = '';
}

function selectFile(file) {
  if (!file) return;
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    showToast('请选择 .xlsx 或 .xls 文件');
    return;
  }
  state.selectedFile = file;
  elements.filePrompt.textContent = file.name;
  elements.fileMeta.textContent = `${formatNumber(file.size / 1024, 1)} KB`;
  elements.submitUploadButton.disabled = false;
  elements.uploadResult.hidden = true;
}

async function submitUpload() {
  if (!state.selectedFile) return;
  elements.submitUploadButton.disabled = true;
  elements.submitUploadButton.innerHTML = '<img src="/icons/loader-circle.svg" alt="" />正在导入';
  const formData = new FormData();
  formData.append('file', state.selectedFile);

  try {
    const result = await fetchJson('/api/imports', { method: 'POST', body: formData });
    elements.uploadResult.hidden = false;
    elements.uploadResult.className = 'upload-result success';
    elements.uploadResult.innerHTML = `导入完成：新增 <strong>${formatNumber(result.insertedRows, 0)}</strong> 条，重复 <strong>${formatNumber(result.duplicateRows, 0)}</strong> 条，异常 <strong>${formatNumber(result.errorRows, 0)}</strong> 条。`;
    state.page = 1;
    await refreshAll();
    showToast('Excel 数据已写入数据库');
  } catch (error) {
    elements.uploadResult.hidden = false;
    elements.uploadResult.className = 'upload-result error';
    elements.uploadResult.textContent = error.message;
  } finally {
    elements.submitUploadButton.disabled = false;
    elements.submitUploadButton.innerHTML = '<img src="/icons/upload.svg" alt="" />开始导入';
  }
}

function showUserMessage(message, type = 'success') {
  elements.userMessage.textContent = message;
  elements.userMessage.className = `user-message ${type}`;
  elements.userMessage.hidden = !message;
}

function closePasswordReset() {
  state.resetUserId = null;
  elements.passwordResetForm.hidden = true;
  elements.passwordResetTitle.textContent = '重置密码';
  elements.resetPasswordInput.value = '';
}

function renderUsers(rows) {
  state.users = rows;
  if (!rows.length) {
    elements.userTableBody.innerHTML = '<tr><td colspan="5" class="table-message">暂无用户</td></tr>';
    return;
  }

  elements.userTableBody.innerHTML = rows.map((user) => {
    const isAdmin = user.role === 'admin';
    const isActive = Boolean(Number(user.is_active));
    const username = escapeHtml(user.username);
    const statusAction = isActive ? '停用' : '启用';
    const statusIcon = isActive ? 'power-off.svg' : 'power.svg';
    return `
      <tr>
        <td><strong>${username}</strong></td>
        <td><span class="user-role role-${isAdmin ? 'admin' : 'user'}">${isAdmin ? '管理员' : '普通用户'}</span></td>
        <td><span class="user-status status-${isActive ? 'active' : 'inactive'}">${isActive ? '已启用' : '已停用'}</span></td>
        <td>${escapeHtml(formatDateTime(user.last_login_at))}</td>
        <td>
          <div class="user-actions">
            <button class="user-action-button" type="button" data-user-action="reset" data-user-id="${user.id}" title="重置密码">
              <img src="/icons/key-round.svg" alt="" />
            </button>
            ${isAdmin ? '' : `
              <button class="user-action-button" type="button" data-user-action="toggle" data-user-id="${user.id}" title="${statusAction}用户">
                <img src="/icons/${statusIcon}" alt="" />
              </button>
              <button class="user-action-button danger" type="button" data-user-action="delete" data-user-id="${user.id}" title="删除用户">
                <img src="/icons/trash-2.svg" alt="" />
              </button>`}
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function loadUsers() {
  elements.userTableBody.innerHTML = '<tr><td colspan="5" class="table-message">正在加载用户</td></tr>';
  try {
    const data = await fetchJson('/api/users');
    renderUsers(data.rows);
  } catch (error) {
    elements.userTableBody.innerHTML = '<tr><td colspan="5" class="table-message">用户列表加载失败</td></tr>';
    showUserMessage(error.message, 'error');
  }
}

async function openUsersModal() {
  showUserMessage('');
  closePasswordReset();
  elements.usersModal.hidden = false;
  document.body.style.overflow = 'hidden';
  await loadUsers();
}

function closeUsersModal() {
  elements.usersModal.hidden = true;
  document.body.style.overflow = '';
  elements.createUserForm.reset();
  showUserMessage('');
  closePasswordReset();
}

async function createUser(event) {
  event.preventDefault();
  const username = elements.newUsername.value.trim();
  const password = elements.newUserPassword.value;
  elements.createUserButton.disabled = true;

  try {
    await fetchJson('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    elements.createUserForm.reset();
    showUserMessage(`用户 ${username} 已新增。`);
    await loadUsers();
    elements.newUsername.focus();
  } catch (error) {
    showUserMessage(error.message, 'error');
  } finally {
    elements.createUserButton.disabled = false;
  }
}

async function handleUserAction(event) {
  const button = event.target.closest('[data-user-action]');
  if (!button) return;
  const userId = Number(button.dataset.userId);
  const user = state.users.find((item) => Number(item.id) === userId);
  if (!user) return;

  if (button.dataset.userAction === 'reset') {
    state.resetUserId = userId;
    elements.passwordResetTitle.textContent = `重置 ${user.username} 的密码`;
    elements.resetPasswordInput.value = '';
    elements.passwordResetForm.hidden = false;
    elements.resetPasswordInput.focus();
    return;
  }

  button.disabled = true;
  try {
    if (button.dataset.userAction === 'toggle') {
      const isActive = !Boolean(Number(user.is_active));
      await fetchJson(`/api/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      showUserMessage(`用户 ${user.username} 已${isActive ? '启用' : '停用'}。`);
    }

    if (button.dataset.userAction === 'delete') {
      if (!window.confirm(`确定删除用户 ${user.username}？`)) return;
      await fetchJson(`/api/users/${userId}`, { method: 'DELETE' });
      if (state.resetUserId === userId) closePasswordReset();
      showUserMessage(`用户 ${user.username} 已删除。`);
    }
    await loadUsers();
  } catch (error) {
    showUserMessage(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function resetUserPassword(event) {
  event.preventDefault();
  if (!state.resetUserId) return;
  const password = elements.resetPasswordInput.value;
  const submitButton = elements.passwordResetForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    await fetchJson(`/api/users/${state.resetUserId}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const user = state.users.find((item) => Number(item.id) === state.resetUserId);
    showUserMessage(`用户 ${user?.username || ''} 的密码已更新。`);
    closePasswordReset();
  } catch (error) {
    showUserMessage(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
}

document.querySelector('#refreshButton').addEventListener('click', () => refreshAll(true));
document.querySelector('#logoutButton').addEventListener('click', async () => {
  const button = document.querySelector('#logoutButton');
  button.disabled = true;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('/login');
  }
});
document.querySelector('#openUploadButton').addEventListener('click', openUploadModal);
document.querySelector('#closeUploadButton').addEventListener('click', closeUploadModal);
document.querySelector('#cancelUploadButton').addEventListener('click', closeUploadModal);
elements.submitUploadButton.addEventListener('click', submitUpload);
elements.fileInput.addEventListener('change', (event) => selectFile(event.target.files[0]));
elements.uploadModal.addEventListener('click', (event) => {
  if (event.target === elements.uploadModal) closeUploadModal();
});
elements.openUsersButton.addEventListener('click', openUsersModal);
elements.closeUsersButton.addEventListener('click', closeUsersModal);
elements.usersModal.addEventListener('click', (event) => {
  if (event.target === elements.usersModal) closeUsersModal();
});
elements.createUserForm.addEventListener('submit', createUser);
elements.userTableBody.addEventListener('click', handleUserAction);
elements.passwordResetForm.addEventListener('submit', resetUserPassword);
elements.cancelPasswordReset.addEventListener('click', closePasswordReset);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.uploadModal.hidden) closeUploadModal();
  if (event.key === 'Escape' && !elements.usersModal.hidden) closeUsersModal();
});

['dragenter', 'dragover'].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragging');
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
  });
});
elements.dropZone.addEventListener('drop', (event) => selectFile(event.dataTransfer.files[0]));

elements.searchInput.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => { state.page = 1; loadRecords(); }, 300);
});
[
  elements.warehouseFilter, elements.directionFilter, elements.typeFilter,
  elements.dateFromFilter, elements.dateToFilter,
].forEach((element) => element.addEventListener('change', () => {
  state.page = 1;
  loadRecords();
}));
document.querySelector('#clearFiltersButton').addEventListener('click', () => {
  elements.searchInput.value = '';
  elements.warehouseFilter.value = '';
  elements.directionFilter.value = '';
  elements.typeFilter.value = '';
  elements.dateFromFilter.value = '';
  elements.dateToFilter.value = '';
  state.page = 1;
  loadRecords();
});
elements.previousPageButton.addEventListener('click', () => {
  if (state.page > 1) { state.page -= 1; loadRecords(); }
});
elements.nextPageButton.addEventListener('click', () => {
  if (state.page < state.totalPages) { state.page += 1; loadRecords(); }
});

async function initialize() {
  try {
    const session = await fetchJson('/api/auth/session');
    elements.currentUser.textContent = session.username;
    elements.openUsersButton.hidden = session.role !== 'admin';
    await refreshAll();
  } catch (error) {
    if (!window.location.pathname.startsWith('/login')) showToast(error.message);
  }
}

initialize();
