/* app.js
   - Initializes Supabase client
   - Exposes mopyAuth.signInWithCredentials for login.html
   - Exposes mopyApp.initDashboard() for dashboard.html
*/

(() => {
  // ---------- CONFIG ----------
  const SUPABASE_URL = 'https://lzsopkzlifwjdhtxtrkt.supabase.co'; // your project URL
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6c29wa3psaWZ3amRodHh0cmt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjIzNzMsImV4cCI6MjA3OTM5ODM3M30.owsfr2JR_a5DH76TMvh1JX4atPGznmZz1ikQ60nwT8k';

  // Initialize supabase
  const supabase = supabaseJs.createClient ? supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON) : supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // expose a small API
  window.mopyAuth = {
    // sign in using username & password (bcrypt verification in browser)
    async signInWithCredentials(username, password) {
      // fetch user by username
      const { data, error } = await supabase
        .from('users')
        .select('id, username, password_hash, role')
        .eq('username', username)
        .limit(1)
        .maybeSingle();

      if (error) throw new Error('Database error: ' + error.message);
      if (!data) throw new Error('Unknown user');

      const storedHash = data.password_hash;
      // bcryptjs is loaded globally as dcodeIO.bcrypt (when using bcryptjs)
      // we test compareSync or compare
      if (typeof dcodeIO === 'undefined' || !dcodeIO.bcrypt) {
        throw new Error('Missing bcryptjs library');
      }

      const match = dcodeIO.bcrypt.compareSync(password, storedHash);
      if (!match) throw new Error('Invalid password');

      // success — store session in localStorage (id, username, role)
      localStorage.setItem('mopy_user', JSON.stringify({
        id: data.id,
        username: data.username,
        role: data.role
      }));

      return true;
    },

    getCurrentUser() {
      const raw = localStorage.getItem('mopy_user');
      if (!raw) return null;
      return JSON.parse(raw);
    },

    signOut() {
      localStorage.removeItem('mopy_user');
    }
  };

  // ---------- helpers ----------
  function getWeekNumberForDate(d = new Date()) {
    // same week scheme as earlier: year*100 + weeknumber
    const copy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
    return copy.getUTCFullYear() * 100 + weekNo;
  }

  // ---------- dashboard app ----------
  window.mopyApp = {
    supabase,
    initDashboard: async function () {
      const user = window.mopyAuth.getCurrentUser();
      if (!user) { window.location.href = 'login.html'; return; }
      this.currentUser = user;
      this.currentWeek = getWeekNumberForDate();

      // show subtitle
      const sub = document.getElementById('subtitle');
      if (sub) sub.textContent = `Signed in as ${user.username} (${user.role})`;

      // load user list (id + username)
      const { data: users, error: uerr } = await supabase
        .from('users')
        .select('id, username, role')
        .order('username');

      if (uerr) {
        console.error('Error loading users', uerr);
      } else {
        this.userList = users || [];
      }

      // render create form & tasks
      renderCreateForm(this);
      await renderTasks(this);

      // optional: enable periodic refresh
      setInterval(() => renderTasks(this), 15000);
    },

    logout: function () {
      window.mopyAuth.signOut();
      window.location.href = 'login.html';
    }
  };

  // ---------- render create area ----------
  function renderCreateForm(ctx) {
    const c = document.getElementById('createForm');
    c.innerHTML = '';

    const role = ctx.currentUser.role;
    if (role === 'viewer') {
      c.innerHTML = '<div class="small-muted">You have VIEW-ONLY access.</div>';
      return;
    }

    // Owner gets a multi-select of all users
    if (role === 'owner') {
      const title = createEl('label', {innerHTML:'<span>Title</span>'});
      const titleIn = createEl('input', { id: 'task_title', placeholder: 'Task title' });

      const desc = createEl('label', {innerHTML:'<span>Description</span>'});
      const descIn = createEl('textarea', { id: 'task_desc', placeholder: 'Optional description' });

      const assignLabel = createEl('label', {innerHTML: '<span>Assign to (Ctrl/Cmd + click multi)</span>'});
      const select = document.createElement('select');
      select.id = 'task_assign';
      select.multiple = true;
      select.size = Math.min(ctx.userList.length, 6);
      ctx.userList.forEach(u => {
        const o = document.createElement('option');
        o.value = u.id;
        o.textContent = u.username;
        select.appendChild(o);
      });

      const btn = createEl('button', { className:'btn primary', innerText:'Create & Assign' });
      btn.addEventListener('click', async () => {
        await handleCreateTask(ctx, true);
      });

      c.appendChild(title); c.appendChild(titleIn);
      c.appendChild(desc); c.appendChild(descIn);
      c.appendChild(assignLabel); c.appendChild(select);
      c.appendChild(btn);
      return;
    }

    // Editor: create assigned to themselves
    {
      const title = createEl('label', {innerHTML:'<span>Title</span>'});
      const titleIn = createEl('input', { id: 'task_title', placeholder: 'Task title' });
      const desc = createEl('label', {innerHTML:'<span>Description</span>'});
      const descIn = createEl('textarea', { id: 'task_desc', placeholder: 'Optional description' });
      const btn = createEl('button', { className:'btn primary', innerText:'Create (assigned to you)' });
      btn.addEventListener('click', async () => {
        await handleCreateTask(ctx, false);
      });

      const note = createEl('div', { className:'small-muted', innerText:'Editors: max 3 tasks per week.' });
      c.appendChild(title); c.appendChild(titleIn);
      c.appendChild(desc); c.appendChild(descIn);
      c.appendChild(btn);
      c.appendChild(note);
    }
  }

  // ---------- create task logic ----------
  async function handleCreateTask(ctx, isOwner) {
    const title = (document.getElementById('task_title') || {}).value || '';
    const desc = (document.getElementById('task_desc') || {}).value || '';

    if (!title.trim()) { alert('Add a title'); return; }

    // editor limit
    if (!isOwner && ctx.currentUser.role === 'editor') {
      const countResp = await ctx.supabase
        .from('tasks')
        .select('id', { count: 'exact' })
        .eq('creator', ctx.currentUser.id)
        .eq('week', ctx.currentWeek);

      if (countResp.error) { console.error(countResp.error); }
      const existing = countResp.count || 0;
      if (existing >= 3) { alert('You have reached 3 tasks this week.'); return; }
    }

    let assignedIds = [];
    if (isOwner) {
      const sel = document.getElementById('task_assign');
      assignedIds = Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean);
      if (assignedIds.length === 0) { alert('Select at least one assignee'); return; }
    } else {
      assignedIds = [ctx.currentUser.id];
    }

    // create finished_by array initially empty
    const payload = {
      title: title.trim(),
      description: desc.trim(),
      creator: ctx.currentUser.id,
      assigned: assignedIds,
      finished_by: [],
      week: ctx.currentWeek
    };

    const { data, error } = await ctx.supabase.from('tasks').insert([payload]);
    if (error) {
      console.error('Insert error', error);
      alert('Failed to create task: ' + error.message);
      return;
    }

    // clear inputs
    const tIn = document.getElementById('task_title');
    if (tIn) tIn.value = '';
    const dIn = document.getElementById('task_desc');
    if (dIn) dIn.value = '';
    const sel = document.getElementById('task_assign');
    if (sel) sel.selectedIndex = -1;

    // re-render
    await renderTasks(ctx);
  }

  // ---------- render tasks ----------
  async function renderTasks(ctx) {
    const container = document.getElementById('tasksList');
    container.innerHTML = 'Loading...';

    // fetch top 100 tasks
    const resp = await ctx.supabase
      .from('tasks')
      .select('id, title, description, creator, assigned, finished_by, created_at, week, archived')
      .order('created_at', { ascending: false })
      .limit(200);

    if (resp.error) {
      container.innerHTML = 'Error loading tasks';
      console.error(resp.error);
      return;
    }

    const tasks = resp.data || [];
    if (!tasks.length) { container.innerHTML = '<div class="small-muted">No tasks yet.</div>'; return; }

    // build mapping userId => username for display
    const userMap = {};
    (ctx.userList || []).forEach(u => userMap[u.id] = u.username);

    container.innerHTML = '';
    for (const t of tasks) {
      const total = (t.assigned || []).length;
      const doneCount = (t.finished_by || []).length;
      const isCompleted = (doneCount === total && total > 0);

      const wrapper = document.createElement('div');
      wrapper.className = 'task';

      const titleHtml = `<strong>${escapeHtml(t.title)}</strong>`;
      const metaHtml = `<div class="meta">by ${escapeHtml(userMap[t.creator] || 'unknown')} • ${new Date(t.created_at).toLocaleString()}</div>`;
      const descHtml = `<div style="margin-top:8px;color:rgba(255,255,255,0.92)">${escapeHtml(t.description || '')}</div>`;
      const progress = `<div style="margin-top:8px">${doneCount}/${total} finished ${isCompleted ? ' — COMPLETED' : ''}</div>`;

      wrapper.innerHTML = `${titleHtml}${metaHtml}${descHtml}${progress}<div style="margin-top:10px" id="assign_${t.id}"></div><div id="controls_${t.id}" style="margin-top:10px"></div>`;

      container.appendChild(wrapper);

      // assign list
      const assignDiv = document.getElementById(`assign_${t.id}`);
      for (const uid of (t.assigned || [])) {
        const userName = userMap[uid] || uid;
        const row = document.createElement('div');
        row.style.display='flex'; row.style.alignItems='center'; row.style.gap='10px'; row.style.marginBottom='6px';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = (t.finished_by || []).includes(uid);
        // determine if checkbox enabled
        let enabled = false;
        const me = ctx.currentUser.id;
        if (ctx.currentUser.role === 'viewer') enabled = false;
        else if (me === uid) enabled = true; // assignee self-toggle
        else if (ctx.currentUser.role === 'owner') enabled = true; // owner can toggle any
        else if (ctx.currentUser.role === 'editor' && t.creator === me) enabled = true; // editor who created can toggle
        else enabled = false;

        chk.disabled = !enabled;
        chk.addEventListener('change', async () => {
          await toggleFinish(ctx, t, uid, chk.checked);
        });

        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = userName + (uid === t.creator ? ' (creator)' : '');

        row.appendChild(chk); row.appendChild(chip);
        assignDiv.appendChild(row);
      }

      // controls: finish button for own incomplete, edit/delete for owner or editor own tasks
      const controls = document.getElementById(`controls_${t.id}`);

      // "I'm Done" quick button for assignee not finished
      if (ctx.currentUser.role !== 'viewer' && (t.assigned || []).includes(ctx.currentUser.id) && !(t.finished_by||[]).includes(ctx.currentUser.id)) {
        const btn = document.createElement('button');
        btn.className = 'btn ghost';
        btn.textContent = "I'm Done";
        btn.addEventListener('click', async ()=> {
          await toggleFinish(ctx, t, ctx.currentUser.id, true);
        });
        controls.appendChild(btn);
      }

      // edit/delete
      if (ctx.currentUser.role === 'owner' || (ctx.currentUser.role === 'editor' && t.creator === ctx.currentUser.id)) {
        const edit = document.createElement('button');
        edit.className = 'btn ghost';
        edit.textContent = 'Edit';
        edit.addEventListener('click', ()=> editTask(ctx, t));
        controls.appendChild(edit);

        const del = document.createElement('button');
        del.className = 'btn ghost';
        del.textContent = 'Delete';
        del.style.marginLeft='8px';
        del.addEventListener('click', ()=> deleteTask(ctx, t.id));
        controls.appendChild(del);
      }
    }
  }

  // ---------- toggle finish logic ----------
  async function toggleFinish(ctx, task, uid, checked) {
    // reload latest task row to avoid race
    const re = await ctx.supabase.from('tasks').select('finished_by').eq('id', task.id).maybeSingle();
    if (re.error) { console.error(re.error); return; }
    const finished = re.data.finished_by || [];
    let updated;
    if (checked && !finished.includes(uid)) {
      // add
      updated = [...finished, uid];
    } else if (!checked && finished.includes(uid)) {
      // remove
      updated = finished.filter(x => x !== uid);
    } else {
      updated = finished;
    }

    const { error } = await ctx.supabase.from('tasks').update({ finished_by: updated }).eq('id', task.id);
    if (error) { console.error('Update finished_by error', error); alert('Failed to update'); return; }

    // if all finished then mark archived true
    if ((updated.length === (task.assigned || []).length) && (task.assigned || []).length > 0) {
      await ctx.supabase.from('tasks').update({ archived: true }).eq('id', task.id);
    }

    // re-render tasks
    await renderTasks(ctx);
  }

  // ---------- edit task ----------
  async function editTask(ctx, task) {
    // permission check (owner any, editor only own)
    if (!(ctx.currentUser.role === 'owner' || (ctx.currentUser.role === 'editor' && task.creator === ctx.currentUser.id))) {
      alert('No permission to edit');
      return;
    }

    const newTitle = prompt('Edit title', task.title);
    if (newTitle === null) return;
    const newDesc = prompt('Edit description', task.description || '');
    if (newDesc === null) return;

    let newAssigned = task.assigned || [];
    if (ctx.currentUser.role === 'owner') {
      const upd = prompt('Assign users (comma-separated usernames). Leave blank to keep current.', (task.assigned||[]).map(id => {
        const match = (ctx.userList || []).find(u => u.id === id);
        return match ? match.username : id;
      }).join(','));
      if (upd !== null && upd.trim() !== '') {
        // map usernames to uuids
        const names = upd.split(',').map(s => s.trim()).filter(Boolean);
        const map = {};
        (ctx.userList || []).forEach(u => map[u.username] = u.id);
        const mapped = names.map(n => map[n]).filter(Boolean);
        if (mapped.length === 0) { alert('No valid usernames found'); return; }
        newAssigned = mapped;
      }
    }

    // preserve finished_by flags for users still assigned, otherwise drop
    const preserved = {};
    (newAssigned || []).forEach(a => {
      preserved[a] = (task.finished_by || []).includes(a);
    });

    const payload = {
      title: newTitle.trim(),
      description: newDesc.trim(),
      assigned: newAssigned,
      finished_by: Object.keys(preserved).filter(k => preserved[k])
    };

    const { error } = await ctx.supabase.from('tasks').update(payload).eq('id', task.id);
    if (error) { console.error(error); alert('Failed to update'); return; }
    await renderTasks(ctx);
  }

  // ---------- delete task ----------
  async function deleteTask(ctx, id) {
    // permission check inside UI ensures only permitted buttons exist
    if (!confirm('Delete task?')) return;
    const { error } = await ctx.supabase.from('tasks').delete().eq('id', id);
    if (error) { console.error(error); alert('Failed to delete'); return; }
    await renderTasks(ctx);
  }

  // ---------- utility ----------
  function createEl(tag, opts = {}) {
    const el = document.createElement(tag);
    for (const k in opts) {
      if (k === 'className') el.className = opts[k];
      else if (k === 'innerHTML') el.innerHTML = opts[k];
      else if (k === 'innerText') el.innerText = opts[k];
      else el.setAttribute(k, opts[k]);
    }
    return el;
  }

  function escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // expose logout for dashboard button
  window.mopyApp.logout = function() {
    window.mopyAuth.signOut();
    location.href = 'login.html';
  };

})();
