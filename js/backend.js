/* ============================================================
 * 统一后端接口
 * 两个实现类（方法名完全一致，app.js 按配置选一个）：
 *   SupabaseAdapter —— 真实云端（Supabase REST + Storage + Auth + Edge Function）
 *   LocalAdapter    —— 本地演示（localStorage，直接打开 index.html 即可预览）
 * ============================================================ */

const __uuid = () =>
  (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : ('id_' + Math.random().toString(36).slice(2) + Date.now().toString(36));

const __isTextFile = (name) =>
  /\.(txt|md|csv|json|log|py|js|ts|java|c|cpp|h|html|css|xml|ya?ml|ini|cfg)$/i.test(name || '');

const __err = async (res, prefix) => {
  let msg = res.status + ' ' + res.statusText;
  try { const j = await res.json(); msg = j.message || j.msg || j.error || j.error_description || msg; } catch (e) {}
  throw new Error((prefix ? prefix + '：' : '') + msg);
};

// 账号 → 隐藏邮箱：Supabase 底层仍是邮箱，这里用「账号哈希@固定域名」做确定性映射，
// 用户只看到账号，永远不接触邮箱。账号不区分大小写。
const __norm = (u) => String(u || '').trim().toLowerCase();
const __hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};
const __toEmail = (u) => 'u' + __hash(__norm(u)) + '@fenleixitong.app';

/* ============================================================
 * Supabase 适配器（真实云端）
 * ============================================================ */
class SupabaseAdapter {
  constructor(url, key) {
    this.url = (url || '').replace(/\/+$/, '');
    this.key = key;
    this.mode = 'supabase';
    this.token = localStorage.getItem('sb_token') || null;
    try { this.user = JSON.parse(localStorage.getItem('sb_user') || 'null'); } catch (e) { this.user = null; }
  }

  _headers(extra = {}) {
    const h = { apikey: this.key, ...extra };
    if (this.token) h.Authorization = 'Bearer ' + this.token;
    return h;
  }

  async _json(method, path, { body, query, headers } = {}) {
    let url = this.url + path;
    if (query) url += '?' + new URLSearchParams(query);
    const h = this._headers(headers);
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (!res.ok) await __err(res);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  _saveSession(token, user) { this.token = token; this.user = user; localStorage.setItem('sb_token', token); localStorage.setItem('sb_user', JSON.stringify(user)); }
  _clearSession() { this.token = null; this.user = null; localStorage.removeItem('sb_token'); localStorage.removeItem('sb_user'); }
  getSession() { return this.token ? { token: this.token, user: this.user } : null; }

  /* ---- 认证 ---- */
  async signUp(username, password, name, role, code) {
    const email = __toEmail(username);
    const data = await this._json('POST', '/auth/v1/signup', { body: { email, password, data: { display_name: name || username, username } } });
    if (data.access_token) this._saveSession(data.access_token, data.user);
    return data;
  }
  async signIn(username, password) {
    const email = __toEmail(username);
    const data = await this._json('POST', '/auth/v1/token', { query: { grant_type: 'password' }, body: { email, password } });
    this._saveSession(data.access_token, data.user);
    return data.user;
  }
  async signOut() { try { await this._json('POST', '/auth/v1/logout'); } catch (e) {} this._clearSession(); }
  async getProfile() {
    if (!this.user) return null;
    const rows = await this._json('GET', '/rest/v1/profiles', { query: { id: 'eq.' + this.user.id, select: '*' } });
    return rows && rows[0] ? rows[0] : null;
  }

  /* ---- 分类 ---- */
  async listCategories() { return this._json('GET', '/rest/v1/categories', { query: { select: '*', order: 'created_at.asc' } }); }
  async createCategory(name, rules) { const r = await this._json('POST', '/rest/v1/categories', { headers: { Prefer: 'return=representation' }, body: { name, rules } }); return Array.isArray(r) ? r[0] : r; }
  async updateCategory(id, patch) { return this._json('PATCH', '/rest/v1/categories', { query: { id: 'eq.' + id }, body: patch }); }
  async deleteCategory(id) { return this._json('DELETE', '/rest/v1/categories', { query: { id: 'eq.' + id } }); }

  /* ---- 文件 ---- */
  async listUploads(scope) {
    const q = { select: '*,categories(name),students:student_id(display_name,username)', order: 'created_at.desc' };
    if (scope === 'mine') q.student_id = 'eq.' + this.user.id;
    return this._json('GET', '/rest/v1/uploads', { query: q });
  }
  async uploadFile(file) {
    const path = this.user.id + '/' + __uuid() + '_' + file.name;
    const res = await fetch(this.url + '/storage/v1/object/uploads/' + encodeURIComponent(path), {
      method: 'POST',
      headers: { apikey: this.key, Authorization: 'Bearer ' + this.token, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) await __err(res, '文件上传失败');
    const rec = await this._json('POST', '/rest/v1/uploads', {
      headers: { Prefer: 'return=representation' },
      body: { student_id: this.user.id, filename: file.name, storage_path: path, size: file.size, mime: file.type || '', status: 'new' },
    });
    return Array.isArray(rec) ? rec[0] : rec;
  }
  fileUrl(upload) { return this.publicUrl(upload.storage_path); }
  publicUrl(path) { return path ? (this.url + '/storage/v1/object/public/uploads/' + encodeURIComponent(path)) : null; }
  async uploadAttachment(file) {
    const path = 'tasks/' + __uuid() + '_' + file.name;
    const res = await fetch(this.url + '/storage/v1/object/uploads/' + encodeURIComponent(path), {
      method: 'POST',
      headers: { apikey: this.key, Authorization: 'Bearer ' + this.token, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) await __err(res, '附件上传失败');
    return { path, name: file.name };
  }
  async setUploadCategory(uploadId, categoryId) {
    return this._json('PATCH', '/rest/v1/uploads', { query: { id: 'eq.' + uploadId }, body: { category_id: categoryId || null, classified_by: categoryId ? 'teacher' : null } });
  }
  async deleteUpload(id) { return this._json('DELETE', '/rest/v1/uploads', { query: { id: 'eq.' + id } }); }

  /* ---- 任务 ---- */
  async listTasks() { return this._json('GET', '/rest/v1/tasks', { query: { select: '*,categories(name)', order: 'created_at.asc' } }); }
  async createTask(data) { const r = await this._json('POST', '/rest/v1/tasks', { headers: { Prefer: 'return=representation' }, body: data }); return Array.isArray(r) ? r[0] : r; }
  async updateTask(id, patch) { return this._json('PATCH', '/rest/v1/tasks', { query: { id: 'eq.' + id }, body: patch }); }
  async deleteTask(id) { return this._json('DELETE', '/rest/v1/tasks', { query: { id: 'eq.' + id } }); }

  /* ---- 分配 ---- */
  async listAssignments(scope) {
    const q = { select: '*,tasks(*),uploads(filename,category_id)', order: 'created_at.desc' };
    if (scope === 'mine') q.student_id = 'eq.' + this.user.id;
    return this._json('GET', '/rest/v1/assignments', { query: q });
  }
  async createAssignment(data) { const r = await this._json('POST', '/rest/v1/assignments', { headers: { Prefer: 'return=representation' }, body: data }); return Array.isArray(r) ? r[0] : r; }
  async updateAssignment(id, patch) { return this._json('PATCH', '/rest/v1/assignments', { query: { id: 'eq.' + id }, body: patch }); }
  async deleteAssignment(id) { return this._json('DELETE', '/rest/v1/assignments', { query: { id: 'eq.' + id } }); }

  /* ---- 用户（老师） ---- */
  async listUsers() { return this._json('GET', '/rest/v1/profiles', { query: { select: '*', order: 'created_at.asc' } }); }
  async setUserRole(userId, role) { return this._json('PATCH', '/rest/v1/profiles', { query: { id: 'eq.' + userId }, body: { role } }); }

  /* ---- AI 自动分类（调用 Edge Function） ---- */
  async autoClassify() {
    const res = await fetch(this.url + '/functions/v1/classify', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token, apikey: this.key, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) await __err(res, '自动分类失败');
    return res.json();
  }
}

/* ============================================================
 * Local 适配器（本地演示，localStorage）
 * ============================================================ */
class LocalAdapter {
  constructor() {
    this.mode = 'local';
    this.db = this._load();
  }
  _load() {
    try {
      const d = JSON.parse(localStorage.getItem('lxz_db') || 'null');
      if (d) return d;
    } catch (e) {}
    return { users: [], session: null, categories: [], uploads: [], tasks: [], assignments: [] };
  }
  _save() { localStorage.setItem('lxz_db', JSON.stringify(this.db)); }
  get me() { return this.db.users.find(u => u.id === this.db.session) || null; }
  _catName(id) { const c = this.db.categories.find(x => x.id === id); return c ? c.name : ''; }
  _student(id) { const u = this.db.users.find(x => x.id === id); return u ? { display_name: u.name, username: u.username } : null; }

  /* ---- 认证 ---- */
  async signUp(username, password, name, role, code) {
    if (!username || !password) throw new Error('账号和密码不能为空');
    if (this.db.users.find(u => __norm(u.username) === __norm(username))) throw new Error('该账号已注册');
    const actualRole = (role === 'teacher')
      ? (code === (window.APP_CONFIG.DEMO_TEACHER_CODE || '')) ? 'teacher' : 'student'
      : 'student';
    const user = { id: __uuid(), username: username.trim(), password, name: name || username.trim(), role: actualRole, created_at: new Date().toISOString() };
    this.db.users.push(user);
    this.db.session = user.id;
    this._save();
    return { user: { id: user.id, username: username.trim(), user_metadata: { display_name: name || username.trim() } }, access_token: 'demo' };
  }
  async signIn(username, password) {
    const u = this.db.users.find(x => __norm(x.username) === __norm(username) && x.password === password);
    if (!u) throw new Error('账号或密码错误');
    this.db.session = u.id; this._save();
    return { id: u.id, username: u.username };
  }
  async signOut() { this.db.session = null; this._save(); }
  getSession() { return this.me ? { user: { id: this.me.id } } : null; }
  async getProfile() {
    const m = this.me;
    return m ? { id: m.id, username: m.username, display_name: m.name, role: m.role, created_at: m.created_at } : null;
  }

  /* ---- 分类 ---- */
  async listCategories() { return this.db.categories.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async createCategory(name, rules) { const c = { id: __uuid(), name, rules, created_at: new Date().toISOString() }; this.db.categories.push(c); this._save(); return c; }
  async updateCategory(id, patch) { const c = this.db.categories.find(x => x.id === id); if (c) Object.assign(c, patch); this._save(); return c; }
  async deleteCategory(id) { this.db.categories = this.db.categories.filter(x => x.id !== id); this._save(); }

  /* ---- 文件 ---- */
  async listUploads(scope) {
    let list = this.db.uploads.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (scope === 'mine') list = list.filter(u => u.student_id === this.me.id);
    return list.map(u => ({
      ...u,
      categories: u.category_id ? { name: this._catName(u.category_id) } : null,
      students: this._student(u.student_id),
    }));
  }
  async uploadFile(file) {
    const rec = { id: __uuid(), student_id: this.me.id, filename: file.name, size: file.size, mime: file.type || '', category_id: null, classified_by: null, status: 'new', created_at: new Date().toISOString() };
    if (file.size <= 300 * 1024) { try { rec.dataUrl = await this._readDataUrl(file); } catch (e) {} }
    if (__isTextFile(file.name)) { try { rec.text = (await file.text()).slice(0, 1500); } catch (e) {} }
    this.db.uploads.push(rec); this._save();
    return rec;
  }
  _readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  fileUrl(upload) { return this.publicUrl(upload.dataUrl); }
  publicUrl(path) { return path || null; }
  async uploadAttachment(file) {
    let dataUrl = null;
    if (file.size <= 300 * 1024) { try { dataUrl = await this._readDataUrl(file); } catch (e) {} }
    return { path: dataUrl, name: file.name };
  }
  async setUploadCategory(uploadId, categoryId) { const u = this.db.uploads.find(x => x.id === uploadId); if (u) { u.category_id = categoryId || null; u.classified_by = categoryId ? 'teacher' : null; } this._save(); }
  async deleteUpload(id) { this.db.uploads = this.db.uploads.filter(x => x.id !== id); this.db.assignments = this.db.assignments.filter(a => a.upload_id !== id); this._save(); }

  /* ---- 任务 ---- */
  async listTasks() {
    return this.db.tasks.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(t => ({ ...t, categories: t.category_id ? { name: this._catName(t.category_id) } : null }));
  }
  async createTask(data) { const t = { id: __uuid(), title: '', description: '', category_id: null, attachment_path: null, created_at: new Date().toISOString(), ...data }; this.db.tasks.push(t); this._save(); return t; }
  async updateTask(id, patch) { const t = this.db.tasks.find(x => x.id === id); if (t) Object.assign(t, patch); this._save(); return t; }
  async deleteTask(id) { this.db.tasks = this.db.tasks.filter(x => x.id !== id); this.db.assignments = this.db.assignments.filter(a => a.task_id !== id); this._save(); }

  /* ---- 分配 ---- */
  async listAssignments(scope) {
    let list = this.db.assignments.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (scope === 'mine') list = list.filter(a => a.student_id === this.me.id);
    return list.map(a => {
      const t = this.db.tasks.find(x => x.id === a.task_id);
      const u = this.db.uploads.find(x => x.id === a.upload_id);
      return { ...a, tasks: t || null, uploads: u ? { filename: u.filename, category_id: u.category_id } : null };
    });
  }
  async createAssignment(data) { const a = { id: __uuid(), status: 'pending', assigned_by: 'teacher', created_at: new Date().toISOString(), ...data }; this.db.assignments.push(a); this._save(); return a; }
  async updateAssignment(id, patch) { const a = this.db.assignments.find(x => x.id === id); if (a) Object.assign(a, patch); this._save(); return a; }
  async deleteAssignment(id) { this.db.assignments = this.db.assignments.filter(x => x.id !== id); this._save(); }

  /* ---- 用户（老师） ---- */
  async listUsers() { return this.db.users.map(u => ({ id: u.id, username: u.username, display_name: u.name, role: u.role, created_at: u.created_at })); }
  async setUserRole(userId, role) { const u = this.db.users.find(x => x.id === userId); if (u) u.role = role; this._save(); }

  /* ---- AI 自动分类（演示：规则关键词匹配） ---- */
  async autoClassify() {
    const cats = this.db.categories;
    const pending = this.db.uploads.filter(u => !u.category_id);
    let classified = 0, assigned = 0;
    for (const u of pending) {
      const catId = this._matchCategory(u, cats);
      if (catId) {
        u.category_id = catId; u.classified_by = 'ai'; classified++;
        const task = this.db.tasks.find(t => t.category_id === catId) || this.db.tasks.find(t => t.category_id === null);
        if (task) {
          this.db.assignments.push({ id: __uuid(), upload_id: u.id, task_id: task.id, student_id: u.student_id, status: 'pending', assigned_by: 'ai', created_at: new Date().toISOString() });
          assigned++;
        }
      }
    }
    this._save();
    return { classified, assigned, total: pending.length };
  }
  _matchCategory(upload, cats) {
    const hay = ((upload.filename || '') + ' ' + (upload.text || '')).toLowerCase();
    let best = null, bestScore = 0;
    for (const c of cats) {
      let score = 0;
      if (c.name && hay.includes(c.name.toLowerCase())) score += 3;
      const kws = (c.rules || '').split(/[\n,，、;；。]/).map(s => s.trim()).filter(s => s.length >= 2);
      for (const kw of kws) if (hay.includes(kw.toLowerCase())) score += 1;
      if (score > bestScore) { bestScore = score; best = c.id; }
    }
    return best;
  }
}

/* ============================================================
 * 工厂：按配置选择实现
 * ============================================================ */
function createApi() {
  const cfg = window.APP_CONFIG || {};
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
    return new SupabaseAdapter(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  return new LocalAdapter();
}
