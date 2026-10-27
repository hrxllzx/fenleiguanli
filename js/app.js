/* ============================================================
 * 主应用逻辑：认证、视图路由、学生/老师交互
 * ============================================================ */
window.__errs = [];
window.addEventListener('error', e => window.__errs.push(String(e.message || e.error)));

const cfg = window.APP_CONFIG || {};
const api = createApi();
let profile = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, isErr) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + (isErr ? 'err' : 'ok');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 3000);
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
function showAuthMsg(msg, isErr) {
  const el = $('#auth-msg');
  el.textContent = msg;
  el.className = 'msg ' + (isErr ? 'err' : 'ok') + (msg ? '' : ' hidden');
}

/* ============ 认证 ============ */
function showModeHint() {
  const h = $('#mode-hint');
  h.textContent = api.mode === 'local'
    ? '当前为「本地演示模式」：数据只保存在本浏览器，用于预览界面。部署到线上见 README.md。'
    : '已连接云端（Supabase）。';
  h.classList.remove('hidden');
}

function switchAuthTab(which) {
  $('#tab-login').classList.toggle('active', which === 'login');
  $('#tab-register').classList.toggle('active', which === 'register');
  $('#login-form').classList.toggle('hidden', which !== 'login');
  $('#register-form').classList.toggle('hidden', which !== 'register');
  showAuthMsg('');
}

function bindAuth() {
  $('#tab-login').addEventListener('click', () => switchAuthTab('login'));
  $('#tab-register').addEventListener('click', () => switchAuthTab('register'));

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    showAuthMsg('');
    try {
      await api.signIn($('#login-username').value.trim(), $('#login-password').value);
      await enterApp();
    } catch (err) { showAuthMsg(err.message, true); }
  });

  $('#register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#reg-name').value.trim();
    const username = $('#reg-username').value.trim();
    const password = $('#reg-password').value;
    const role = (document.querySelector('input[name="reg-role"]:checked') || {}).value || 'student';
    const code = $('#reg-code').value.trim();
    showAuthMsg('');
    try {
      const res = await api.signUp(username, password, name, role, code);
      if (api.mode === 'supabase' && !res.access_token) {
        showAuthMsg('注册成功，但需激活后才能登录：请到 Supabase 后台关闭「Confirm email」（见 README），否则无法登录。');
        return;
      }
      await enterApp();
    } catch (err) { showAuthMsg(err.message, true); }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await api.signOut();
    profile = null;
    $('#main-view').classList.add('hidden');
    $('#auth-view').classList.remove('hidden');
    toast('已退出');
  });
}

async function enterApp() {
  profile = await api.getProfile();
  if (!profile) { showAuthMsg('无法获取用户信息，请重新登录', true); return; }
  $('#auth-view').classList.add('hidden');
  $('#main-view').classList.remove('hidden');
  $('#user-badge').textContent = `${profile.display_name || profile.username || ''}（${profile.role === 'teacher' ? '老师' : '学生'}）`;
  if (profile.role === 'teacher') renderTeacher();
  else renderStudent();
}

/* ============ 学生界面 ============ */
function renderStudent() {
  $('#app-content').innerHTML = `
    <div class="student">
      <div class="panel">
        <h2>📤 上传文件</h2>
        <div class="dropzone" id="dropzone">
          <input type="file" id="file-input" multiple style="display:none">
          <p>点击选择文件，或把文件拖拽到这里</p>
          <p class="hint">支持一次上传多个文件</p>
        </div>
        <div id="upload-queue" class="upload-queue"></div>
      </div>
      <div class="panel">
        <h2>📁 我的文件</h2>
        <table class="table"><thead><tr><th>文件名</th><th>大小</th><th>分类</th><th>时间</th><th>文件</th></tr></thead>
        <tbody id="my-files-body"></tbody></table>
      </div>
      <div class="panel">
        <h2>📋 我的任务</h2>
        <div id="my-tasks-list"></div>
      </div>
    </div>`;

  const dz = $('#dropzone');
  dz.addEventListener('click', () => $('#file-input').click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles(e.dataTransfer.files); });
  $('#file-input').addEventListener('change', e => handleFiles(e.target.files));

  renderMyFiles();
  renderMyTasks();
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const q = $('#upload-queue');
  q.innerHTML = '<p class="hint">正在上传 ' + files.length + ' 个文件…</p>';
  let ok = 0;
  for (const f of files) {
    try { await api.uploadFile(f); ok++; }
    catch (e) { toast('上传失败：' + f.name + ' — ' + e.message, true); }
  }
  q.innerHTML = '';
  toast(`已上传 ${ok}/${files.length} 个文件`);
  renderMyFiles();
}

async function renderMyFiles() {
  const uploads = await api.listUploads('mine');
  const body = $('#my-files-body');
  body.innerHTML = uploads.map(u => {
    const url = api.fileUrl(u);
    const link = url ? `<a class="link" href="${esc(url)}" target="_blank" download="${esc(u.filename)}">下载</a>` : '<span class="hint">(演示)</span>';
    const cat = u.category_id
      ? '<span class="tag tag-ai">' + esc(u.categories ? u.categories.name : '') + '</span>'
      : '<span class="tag tag-none">未分类</span>';
    return `<tr><td class="ellipsis" title="${esc(u.filename)}">${esc(u.filename)}</td><td>${fmtSize(u.size)}</td><td>${cat}</td><td>${fmtTime(u.created_at)}</td><td>${link}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">还没有上传文件</td></tr>';
}

async function renderMyTasks() {
  const assignments = await api.listAssignments('mine');
  const list = $('#my-tasks-list');
  if (!assignments.length) { list.innerHTML = '<p class="empty">还没有收到任务</p>'; return; }
  list.innerHTML = assignments.map(a => {
    const t = a.tasks || {};
    const done = a.status === 'done';
    return `<div class="task-card">
      <div class="task-card-head">
        <span class="task-title">📌 ${esc(t.title || '（任务已删除）')}</span>
        <span class="tag ${done ? 'tag-ai' : 'tag-manual'}">${done ? '已完成' : '待完成'}</span>
      </div>
      <div class="task-desc">${esc(t.description || '')}</div>
      <div class="task-meta">来源文件：${esc(a.uploads ? a.uploads.filename : '')}${a.assigned_by === 'ai' ? ' · AI 自动下发' : ' · 老师手动下发'}</div>
      ${t.attachment_path ? `<a class="link" href="${esc(api.publicUrl(t.attachment_path) || '#')}" target="_blank">📎 附件：${esc(t.attachment_name || '下载')}</a>` : ''}
      <div class="task-actions">
        <button class="btn btn-sm ${done ? '' : 'btn-primary'}" data-toggle="${a.id}|${done ? 'pending' : 'done'}">${done ? '标记为未完成' : '标记完成'}</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', e => {
    const [id, status] = e.target.dataset.toggle.split('|');
    onToggleAssignment(id, status);
  }));
}

async function onToggleAssignment(id, status) {
  await api.updateAssignment(id, { status });
  toast('已更新');
  renderMyTasks();
}

/* ============ 老师界面 ============ */
function renderTeacher() {
  $('#app-content').innerHTML = `
    <div class="teacher">
      <aside class="sidebar">
        <button class="side-btn active" data-sec="dashboard">📊 概览</button>
        <button class="side-btn" data-sec="files">📁 文件管理</button>
        <button class="side-btn" data-sec="categories">🏷️ 分类规则</button>
        <button class="side-btn" data-sec="tasks">📋 任务管理</button>
        <button class="side-btn" data-sec="users">👥 用户管理</button>
      </aside>
      <main class="teacher-main">
        <section id="sec-dashboard" class="sec"></section>
        <section id="sec-files" class="sec hidden"></section>
        <section id="sec-categories" class="sec hidden"></section>
        <section id="sec-tasks" class="sec hidden"></section>
        <section id="sec-users" class="sec hidden"></section>
      </main>
    </div>`;

  $$('.side-btn').forEach(b => b.addEventListener('click', () => switchSec(b.dataset.sec)));
  renderDashboard();
  renderFiles();
  renderCategories();
  renderTasks();
  renderUsers();
}

function switchSec(sec) {
  $$('.side-btn').forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
  $$('.sec').forEach(s => s.classList.add('hidden'));
  $('#sec-' + sec).classList.remove('hidden');
}

async function renderDashboard() {
  const sec = $('#sec-dashboard');
  sec.innerHTML = '<p class="loading">加载中…</p>';
  const [users, uploads, categories, tasks] = await Promise.all([
    api.listUsers(), api.listUploads('all'), api.listCategories(), api.listTasks()
  ]);
  const students = users.filter(u => u.role !== 'teacher');
  const classified = uploads.filter(u => u.category_id).length;
  const unclassified = uploads.filter(u => !u.category_id).length;
  sec.innerHTML = `
    <h2>📊 概览</h2>
    <div class="stat-grid">
      <div class="stat"><div class="num">${students.length}</div><div class="label">学生</div></div>
      <div class="stat"><div class="num">${uploads.length}</div><div class="label">上传文件</div></div>
      <div class="stat"><div class="num">${classified}</div><div class="label">已分类</div></div>
      <div class="stat"><div class="num">${tasks.length}</div><div class="label">任务</div></div>
    </div>
    <div class="toolbar">
      <button class="btn btn-primary" id="btn-auto-classify">🤖 开始自动分类（AI）</button>
      <button class="btn" id="btn-refill">🔁 补发任务（按分类）</button>
      <span class="hint">待分类文件 ${unclassified} 个</span>
    </div>
    <div id="dash-result" class="msg hidden"></div>`;

  $('#btn-auto-classify').addEventListener('click', onAutoClassify);
  $('#btn-refill').addEventListener('click', onRefill);
}

async function onAutoClassify() {
  const btn = $('#btn-auto-classify');
  const box = $('#dash-result');
  btn.disabled = true; btn.textContent = '分类中…';
  box.classList.add('hidden');
  try {
    const r = await api.autoClassify();
    box.className = 'msg ok';
    box.textContent = `完成：共 ${r.total} 个待分类，分类成功 ${r.classified} 个，下发任务 ${r.assigned} 个。`;
    await refreshTeacher();
  } catch (e) {
    box.className = 'msg err'; box.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = '🤖 开始自动分类（AI）';
  }
}

async function onRefill() {
  const [uploads, assignments, tasks] = await Promise.all([api.listUploads('all'), api.listAssignments('all'), api.listTasks()]);
  const assignedIds = new Set(assignments.map(a => a.upload_id));
  let n = 0;
  for (const u of uploads) {
    if (!u.category_id || assignedIds.has(u.id)) continue;
    const task = tasks.find(t => t.category_id === u.category_id) || tasks.find(t => t.category_id === null);
    if (!task) continue;
    await api.createAssignment({ upload_id: u.id, task_id: task.id, student_id: u.student_id, status: 'pending', assigned_by: 'teacher' });
    n++;
  }
  toast(n ? `已补发 ${n} 个任务` : '没有需要补发的任务');
  await refreshTeacher();
}

async function renderFiles() {
  const sec = $('#sec-files');
  sec.innerHTML = '<p class="loading">加载中…</p>';
  const [uploads, categories] = await Promise.all([api.listUploads('all'), api.listCategories()]);
  const rows = uploads.map(u => {
    const catOpts = categories.map(c => `<option value="${c.id}" ${u.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const url = api.fileUrl(u);
    const download = url ? `<a class="link" href="${esc(url)}" target="_blank" download="${esc(u.filename)}">下载</a>` : '<span class="hint">(演示)</span>';
    const tag = u.classified_by === 'ai' ? '<span class="tag tag-ai">AI</span>' : (u.classified_by ? '<span class="tag tag-manual">手动</span>' : '<span class="tag tag-none">未分类</span>');
    return `<tr>
      <td class="ellipsis" title="${esc(u.filename)}">${esc(u.filename)}</td>
      <td>${esc((u.students && (u.students.display_name || u.students.username)) || '')}</td>
      <td>${fmtSize(u.size)}</td>
      <td><select class="cat-select" data-id="${u.id}"><option value="" ${!u.category_id ? 'selected' : ''}>未分类</option>${catOpts}</select></td>
      <td>${tag}</td>
      <td>${fmtTime(u.created_at)}</td>
      <td>${download}</td>
      <td><button class="btn btn-sm btn-danger" data-del="${u.id}">删除</button></td>
    </tr>`;
  }).join('');
  sec.innerHTML = `<h2>📁 文件管理</h2>
    <table class="table"><thead><tr><th>文件名</th><th>学生</th><th>大小</th><th>分类（可手动改）</th><th>方式</th><th>上传时间</th><th>文件</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8" class="empty">暂无文件</td></tr>'}</tbody></table>`;
  sec.querySelectorAll('.cat-select').forEach(sel => sel.addEventListener('change', e => onManualClassify(e.target.dataset.id, e.target.value)));
  sec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => onDeleteUpload(e.target.dataset.del)));
}

async function onManualClassify(uploadId, categoryId) {
  await api.setUploadCategory(uploadId, categoryId || null);
  if (categoryId) {
    const [uploads, assignments, tasks] = await Promise.all([api.listUploads('all'), api.listAssignments('all'), api.listTasks()]);
    const upload = uploads.find(u => u.id === uploadId);
    const exists = assignments.some(a => a.upload_id === uploadId);
    if (!exists && upload) {
      const task = tasks.find(t => t.category_id === categoryId) || tasks.find(t => t.category_id === null);
      if (task) await api.createAssignment({ upload_id: uploadId, task_id: task.id, student_id: upload.student_id, status: 'pending', assigned_by: 'teacher' });
    }
  }
  toast('分类已更新');
}

async function onDeleteUpload(id) {
  if (!confirm('确定删除该文件？相关任务也会一并删除。')) return;
  await api.deleteUpload(id);
  toast('已删除');
  await refreshTeacher();
}

async function renderCategories() {
  const sec = $('#sec-categories');
  sec.innerHTML = '<p class="loading">加载中…</p>';
  const cats = await api.listCategories();
  const list = cats.map(c => `
    <div class="cat-item">
      <div class="cat-head">
        <span class="cat-name">${esc(c.name)}</span>
        <div class="cat-actions">
          <button class="btn btn-sm" data-edit="${c.id}">编辑</button>
          <button class="btn btn-sm btn-danger" data-del="${c.id}">删除</button>
        </div>
      </div>
      <div class="cat-rules">${esc(c.rules || '（无规则）')}</div>
    </div>`).join('');
  sec.innerHTML = `<h2>🏷️ 分类规则</h2>
    <div class="panel-inner">
      <p class="hint">规则会交给 AI，AI 依据规则把每个文件归入某个类别；关键词/描述用逗号或换行分隔。</p>
      <div class="cat-list">${list || '<p class="empty">还没有分类，先添加一个。</p>'}</div>
      <div class="cat-form">
        <input id="cat-name" placeholder="分类名称，如：论文 / 实验报告 / 作业">
        <textarea id="cat-rules" placeholder="分类规则，如：包含“实验报告”、文件名含 report、内容涉及数据分析…" rows="3"></textarea>
        <input type="hidden" id="cat-edit-id">
        <button class="btn btn-primary" id="btn-save-cat">添加分类</button>
      </div>
    </div>`;
  sec.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editCat(b.dataset.edit, cats)));
  sec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delCat(b.dataset.del)));
  $('#btn-save-cat').addEventListener('click', saveCat);
}

function editCat(id, cats) {
  const c = cats.find(x => x.id === id);
  if (!c) return;
  $('#cat-name').value = c.name;
  $('#cat-rules').value = c.rules;
  $('#cat-edit-id').value = c.id;
  $('#btn-save-cat').textContent = '保存修改';
}

async function saveCat() {
  const name = $('#cat-name').value.trim();
  const rules = $('#cat-rules').value.trim();
  const editId = $('#cat-edit-id').value;
  if (!name) { toast('请填写分类名称', true); return; }
  if (editId) await api.updateCategory(editId, { name, rules });
  else await api.createCategory(name, rules);
  toast('已保存');
  renderCategories();
}

async function delCat(id) {
  if (!confirm('删除分类后，属于它的文件会变为「未分类」，确定？')) return;
  await api.deleteCategory(id);
  toast('已删除');
  renderCategories();
}

async function renderTasks() {
  const sec = $('#sec-tasks');
  sec.innerHTML = '<p class="loading">加载中…</p>';
  const [tasks, categories] = await Promise.all([api.listTasks(), api.listCategories()]);
  const list = tasks.map(t => {
    const cat = t.category_id ? (t.categories ? t.categories.name : '') : '默认（适用于所有分类）';
    return `<div class="task-item">
      <div class="task-head">
        <span class="task-title">${esc(t.title)}</span>
        <div class="cat-actions">
          <button class="btn btn-sm" data-edit="${t.id}">编辑</button>
          <button class="btn btn-sm btn-danger" data-del="${t.id}">删除</button>
        </div>
      </div>
      <div class="task-meta">绑定分类：${esc(cat)}</div>
      <div class="task-desc">${esc(t.description || '')}</div>
      ${t.attachment_path ? `<a class="link" href="${esc(api.publicUrl(t.attachment_path) || '#')}" target="_blank">📎 附件：${esc(t.attachment_name || '下载')}</a>` : ''}
    </div>`;
  }).join('');
  const catOpts = '<option value="">默认（所有分类）</option>' + categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  sec.innerHTML = `<h2>📋 任务管理</h2>
    <div class="panel-inner">
      <p class="hint">每个任务可绑定一个分类，该分类的文件会被自动下发对应任务；未绑定分类的任务作为「默认任务」。</p>
      <div class="task-list">${list || '<p class="empty">还没有任务。</p>'}</div>
      <div class="task-form">
        <input id="task-title" placeholder="任务标题">
        <select id="task-cat">${catOpts}</select>
        <textarea id="task-desc" placeholder="任务说明（选填）" rows="2"></textarea>
        <input id="task-file" type="file">
        <input type="hidden" id="task-edit-id">
        <button class="btn btn-primary" id="btn-save-task">添加任务</button>
      </div>
    </div>`;
  sec.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editTask(b.dataset.edit, tasks, categories)));
  sec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delTask(b.dataset.del)));
  $('#btn-save-task').addEventListener('click', saveTask);
}

function editTask(id, tasks, categories) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  $('#task-title').value = t.title;
  $('#task-desc').value = t.description || '';
  $('#task-cat').value = t.category_id || '';
  $('#task-edit-id').value = t.id;
  $('#btn-save-task').textContent = '保存修改';
}

async function saveTask() {
  const title = $('#task-title').value.trim();
  const desc = $('#task-desc').value.trim();
  const cat = $('#task-cat').value || null;
  const editId = $('#task-edit-id').value;
  if (!title) { toast('请填写任务标题', true); return; }
  const data = { title, description: desc, category_id: cat };
  const fileInput = $('#task-file');
  if (fileInput.files && fileInput.files[0]) {
    const att = await api.uploadAttachment(fileInput.files[0]);
    data.attachment_path = att.path; data.attachment_name = att.name;
  }
  if (editId) await api.updateTask(editId, data);
  else await api.createTask(data);
  toast('已保存');
  renderTasks();
}

async function delTask(id) {
  if (!confirm('删除该任务？已下发给学生的记录也会删除。')) return;
  await api.deleteTask(id);
  toast('已删除');
  renderTasks();
}

async function renderUsers() {
  const sec = $('#sec-users');
  sec.innerHTML = '<p class="loading">加载中…</p>';
  const users = await api.listUsers();
  const rows = users.map(u => `
    <tr>
      <td>${esc(u.display_name || '')}</td>
      <td>${esc(u.username || '')}</td>
      <td><span class="tag ${u.role === 'teacher' ? 'tag-ai' : 'tag-none'}">${u.role === 'teacher' ? '老师' : '学生'}</span></td>
      <td>${fmtTime(u.created_at)}</td>
      <td><button class="btn btn-sm" data-role="${u.id}|${u.role === 'teacher' ? 'student' : 'teacher'}">${u.role === 'teacher' ? '设为学生' : '设为老师'}</button></td>
    </tr>`).join('');
  sec.innerHTML = `<h2>👥 用户管理</h2>
    <table class="table"><thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>注册时间</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty">暂无用户</td></tr>'}</tbody></table>`;
  sec.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', e => {
    const [id, role] = e.target.dataset.role.split('|');
    onSetRole(id, role);
  }));
}

async function onSetRole(id, role) {
  await api.setUserRole(id, role);
  toast('角色已更新');
  renderUsers();
}

async function refreshTeacher() {
  renderDashboard();
  renderFiles();
  renderTasks();
}

/* ============ 启动 ============ */
async function init() {
  const appName = cfg.APP_NAME || '作业分类与任务分发系统';
  $('#auth-title').textContent = appName;
  document.title = appName;
  const sub = document.querySelector('.auth-sub');
  if (sub) sub.textContent = cfg.APP_SUBTITLE || '';
  showModeHint();
  bindAuth();
  if (api.getSession()) {
    try { await enterApp(); } catch (e) { /* 会话失效则停留在登录页 */ }
  }
}
document.addEventListener('DOMContentLoaded', init);
