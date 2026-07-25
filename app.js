(function(){
  const DAY_NAMES = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  const MONTH_NAMES = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

  /* ===== Supabase Config =====
     غيّر القيمتين دول ببيانات مشروعك من Supabase Dashboard > Settings > API
  */
  const SUPABASE_URL = 'https://txdgfvxnjofpmiaiwsax.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_-yUhuWCFab5f0jLN6kY3kQ_SGJRPYgy';

  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let currentUserId = null; // بيتحدد بعد تسجيل الدخول (مجهول أو حقيقي)
  let isAnonymousUser = true; // هل الحساب الحالي مجهول ولا مربوط بإيميل حقيقي
  let currentUserEmail = null;
  let accountModalMode = 'save'; // 'save' = ربط الحساب المجهول | 'signin' = دخول لحساب موجود
  const LOCAL_BACKUP_KEY = 'habit-data-v2'; // نسخة احتياطية محلية في حالة قطع النت

  /* تسجيل دخول مجهول تلقائي (Anonymous Auth):
     ده بيدي كل جهاز/متصفح هوية ثابتة (user_id) في Supabase من غير ما نحتاج
     نبني شاشة تسجيل دخول دلوقتي. البيانات بتتخزن على السيرفر مرتبطة بالهوية دي.
     المستخدم بعدين يقدر "يربط" الحساب المجهول ده بإيميل وباسورد حقيقيين
     (من نافذة الحساب) من غير ما يفقد أي بيانات. */
  async function ensureAuth(){
    try{
      const { data: { session } } = await supabaseClient.auth.getSession();
      if(session && session.user){
        applyAuthUser(session.user);
        return;
      }
      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if(error) throw error;
      applyAuthUser(data.user);
    }catch(e){
      console.error('Auth error:', e);
      currentUserId = null;
    }
  }

  function applyAuthUser(user){
    if(!user) return;
    currentUserId = user.id;
    isAnonymousUser = !!user.is_anonymous;
    currentUserEmail = user.email || null;
    updateAccountIcon();
  }

  function updateAccountIcon(){
    const icon = document.getElementById('accountIcon');
    const btn = document.getElementById('accountBtn');
    if(!icon || !btn) return;
    if(!isAnonymousUser && currentUserEmail){
      icon.textContent = 'account_circle';
      btn.classList.add('is-linked');
      btn.title = currentUserEmail;
    } else {
      icon.textContent = 'person_outline';
      btn.classList.remove('is-linked');
      btn.title = 'الحساب';
    }
  }

  const contentEl = document.getElementById('content');
  const toastEl = document.getElementById('toast');

  let state = {
    keywords: [], 
    drafts: [], // قائمة المسودات المحفوظة بدلاً من الحذف
    days: {},
    filters: [],
    timers: {},
    darkMode: false
  };
  let selectedDate = toISO(new Date());
  let editingKeywordId = null;
  let activeFilter = 'all';
  let bankOpen = true;
  let justOpenedBank = true;
  let closingBank = false;
  let bankCloseTimeoutId = null;
  let bankSearchQuery = '';
  let draftsSearchQuery = '';
  let bankDisplayLimit = 10;
  let timerPanelRenderedForDate = null;

  let pendingTaskName = '';
  let pendingTaskFilterId = null;

  const timerPanelEl = document.getElementById('timerPanel');

  function toISO(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function fromISO(s){
    const [y,m,d] = s.split('-').map(Number);
    return new Date(y, m-1, d);
  }
  function todayStr(){ return toISO(new Date()); }
  function addDays(dateStr, n){
    const d = fromISO(dateStr);
    d.setDate(d.getDate()+n);
    return toISO(d);
  }
  function fmtDay(dateStr){
    const d = fromISO(dateStr);
    return `${DAY_NAMES[d.getDay()]}، ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }
  function parseDurationToMinutes(str){
    if(!str) return 0;
    let text = String(str).trim();
    if(!text) return 0;
    const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
    text = text.replace(/[٠-٩]/g, d => arabicDigits.indexOf(d));
    text = text.replace(/½/g, '.5');

    let totalMinutes = 0;
    let matched = false;

    const hourRegex = /(\d+(?:\.\d+)?)\s*(ساعات|ساعة|ساعه|س\b|h\b)/gi;
    let m;
    while((m = hourRegex.exec(text)) !== null){
      totalMinutes += parseFloat(m[1]) * 60;
      matched = true;
    }

    const minRegex = /(\d+(?:\.\d+)?)\s*(دقايق|دقيقة|دقيقه|د\b|m\b)/gi;
    while((m = minRegex.exec(text)) !== null){
      totalMinutes += parseFloat(m[1]);
      matched = true;
    }

    if(/نص\s*ساعة|نصف\s*ساعة/i.test(text)){ totalMinutes += 30; matched = true; }
    if(/ربع\s*ساعة/i.test(text)){ totalMinutes += 15; matched = true; }

    if(!matched){
      const plain = text.match(/^(\d+(?:\.\d+)?)$/);
      if(plain){ totalMinutes = parseFloat(plain[1]) * 60; matched = true; }
    }

    return matched ? totalMinutes : 0;
  }

  function formatMinutes(totalMinutes){
    if(!totalMinutes || totalMinutes <= 0) return '';
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    if(hours > 0 && mins > 0) return `${hours} ساعة و ${mins} دقيقة`;
    if(hours > 0) return `${hours} ساعة`;
    return `${mins} دقيقة`;
  }

  function uid(){
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  /* ===== Wheel Picker (Drum Roller) ===== */
  const WHEEL_ITEM_H = 42;
  let pickerTaskId = null;

  function buildWheelList(listEl, count){
    let html = '';
    for(let set = 0; set < 3; set++){
      for(let i=0; i<count; i++){
        html += `<li class="wheel-item" data-value="${i}" data-real-index="${set * count + i}">${String(i).padStart(2,'0')}</li>`;
      }
    }
    listEl.innerHTML = html;
  }

  function updateWheelStyles(colEl){
    const centerY = colEl.scrollTop + colEl.clientHeight / 2;
    colEl.querySelectorAll('.wheel-item').forEach(li => {
      const itemCenter = li.offsetTop + WHEEL_ITEM_H / 2;
      const delta = Math.abs(itemCenter - centerY);
      const opacity = Math.max(0.25, 1 - delta / 90);
      const scale = Math.max(0.78, 1 - delta / 260);
      li.style.opacity = opacity;
      li.style.transform = `scale(${scale})`;
    });
  }

  function snapWheel(colEl, count){
    let idx = Math.round(colEl.scrollTop / WHEEL_ITEM_H);
    colEl.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
    colEl._value = idx % count;
  }

  function initWheel(colEl, listEl, count, initialValue){
    buildWheelList(listEl, count);
    colEl._value = initialValue;

    let scrollTimeout = null;
    colEl.onscroll = () => {
      updateWheelStyles(colEl);
      const currentScrollTop = colEl.scrollTop;
      const singleSetHeight = count * WHEEL_ITEM_H;
      
      if (currentScrollTop < singleSetHeight * 0.5) {
        colEl.scrollTop = currentScrollTop + singleSetHeight;
      } else if (currentScrollTop > singleSetHeight * 1.5) {
        colEl.scrollTop = currentScrollTop - singleSetHeight;
      }

      if(scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        let idx = Math.round(colEl.scrollTop / WHEEL_ITEM_H);
        colEl.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
        colEl._value = idx % count;
      }, 100);
    };

    listEl.querySelectorAll('.wheel-item').forEach(li => {
      li.onclick = () => {
        const realIdx = parseInt(li.dataset.realIndex, 10);
        colEl.scrollTo({ top: realIdx * WHEEL_ITEM_H, behavior: 'smooth' });
      };
    });

    let isDragging = false;
    let startY = 0;
    let startScrollTop = 0;

    colEl.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startY = e.clientY;
      startScrollTop = colEl.scrollTop;
      try { colEl.setPointerCapture(e.pointerId); } catch(err) {}
      e.preventDefault();
    });

    colEl.addEventListener('pointermove', (e) => {
      if(!isDragging) return;
      const deltaY = e.clientY - startY;
      colEl.scrollTop = startScrollTop - deltaY;
      updateWheelStyles(colEl);
    });

    const endDrag = (e) => {
      if(!isDragging) return;
      isDragging = false;
      try { colEl.releasePointerCapture(e.pointerId); } catch(err) {}
      snapWheel(colEl, count);
    };

    colEl.addEventListener('pointerup', endDrag);
    colEl.addEventListener('pointercancel', endDrag);

    colEl.scrollTop = (count + initialValue) * WHEEL_ITEM_H;
    updateWheelStyles(colEl);
  }

  function openDurationPicker(taskId){
    const task = state.days[selectedDate].find(t => t.id === taskId);
    if(!task) return;
    pickerTaskId = taskId;

    const totalMin = parseDurationToMinutes(task.duration);
    const h = Math.min(23, Math.floor(totalMin / 60));
    const m = Math.min(59, Math.round(totalMin % 60));

    const hoursCol = document.getElementById('hoursWheel');
    const hoursList = document.getElementById('hoursWheelList');
    const minutesCol = document.getElementById('minutesWheel');
    const minutesList = document.getElementById('minutesWheelList');

    document.getElementById('durationPickerOverlay').classList.add('open');

    requestAnimationFrame(() => {
      initWheel(hoursCol, hoursList, 24, h);
      initWheel(minutesCol, minutesList, 60, m);
    });
  }

  function closeDurationPicker(){
    document.getElementById('durationPickerOverlay').classList.remove('open');
    pickerTaskId = null;
  }

  async function commitDurationPicker(){
    if(!pickerTaskId) return;
    const hoursCol = document.getElementById('hoursWheel');
    const minutesCol = document.getElementById('minutesWheel');
    const h = hoursCol._value || 0;
    const m = minutesCol._value || 0;

    const task = state.days[selectedDate].find(t => t.id === pickerTaskId);
    if(task){
      if(h > 0 && m > 0) task.duration = `${h} ساعة و ${m} دقيقة`;
      else if(h > 0) task.duration = `${h} ساعة`;
      else if(m > 0) task.duration = `${m} دقيقة`;
      else task.duration = '';
    }
    closeDurationPicker();
    render();
    await saveData();
  }

  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(()=> toastEl.classList.remove('show'), 2200);
  }

  function applyLoadedState(parsed){
    if(!parsed) return;
    if(parsed.keywords) state.keywords = parsed.keywords;
    if(parsed.drafts) state.drafts = parsed.drafts;
    if(parsed.days) state.days = parsed.days;
    if(parsed.filters) state.filters = parsed.filters;
    if(parsed.timers) state.timers = parsed.timers;
    if(parsed.darkMode !== undefined){
      state.darkMode = parsed.darkMode;
      document.body.classList.toggle('dark-mode', state.darkMode);
      const icon = document.getElementById('themeIcon');
      if(icon) icon.textContent = state.darkMode ? 'light_mode' : 'dark_mode';
    }
  }

  // نسخة محلية احتياطية (offline fallback) - مش المصدر الأساسي بعد دلوقتي
  function saveLocalBackup(){
    try{ localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(state)); }catch(e){}
  }
  function loadLocalBackup(){
    try{
      const res = localStorage.getItem(LOCAL_BACKUP_KEY);
      return res ? JSON.parse(res) : null;
    }catch(e){ return null; }
  }

  async function loadData(){
    await ensureAuth();

    if(!currentUserId){
      // تعذر الاتصال بـ Supabase (مفيش نت مثلًا) - استخدم آخر نسخة محفوظة محليًا
      showToast('تعذر الاتصال بالسيرفر، شغال بنسخة محلية');
      applyLoadedState(loadLocalBackup());
      return;
    }

    try{
      const { data, error } = await supabaseClient
        .from('user_data')
        .select('data')
        .eq('user_id', currentUserId)
        .maybeSingle();

      if(error) throw error;

      if(data && data.data){
        applyLoadedState(data.data);
        saveLocalBackup(); // حدّث النسخة المحلية بأحدث بيانات من السيرفر
      } else {
        // أول مرة للمستخدم ده: لو عنده بيانات قديمة في localStorage، ارفعها لـ Supabase
        const legacy = loadLocalBackup();
        if(legacy){
          applyLoadedState(legacy);
          await saveData();
        }
      }
    }catch(e){
      console.warn('تعذر التحميل من Supabase، هنستخدم النسخة المحلية:', e);
      applyLoadedState(loadLocalBackup());
    }
  }

  let saveInFlight = false;
  let savePending = false;

  async function saveData(){
    saveLocalBackup(); // حفظ فوري محلي مايفوتش أي تحديث حتى لو النت وقع

    if(!currentUserId){
      showToast('تعذر الحفظ على السيرفر (بدون اتصال)، اتحفظ محليًا فقط');
      return;
    }

    // لو في عملية حفظ شغالة، أجّل الطلب الجديد بدل ما نبعت طلبات متزاحمة
    if(saveInFlight){
      savePending = true;
      return;
    }
    saveInFlight = true;

    try{
      const { error } = await supabaseClient
        .from('user_data')
        .upsert(
          { user_id: currentUserId, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      if(error) throw error;
    }catch(e){
      console.error('Save failed:', e);
      showToast('تعذر الحفظ على السيرفر، حاول تاني');
    }finally{
      saveInFlight = false;
      if(savePending){
        savePending = false;
        saveData();
      }
    }
  }

  function getDayTimers(date){
    if(!state.timers[date]) state.timers[date] = [];
    return state.timers[date];
  }

  function getElapsedMs(t){
    return t.elapsedMs + (t.running ? (Date.now() - t.startedAt) : 0);
  }

  function formatElapsed(ms){
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2,'0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatHM(ms){
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if(h > 0 && m > 0) return `${h}س ${m}د`;
    if(h > 0) return `${h}س`;
    if(m > 0) return `${m}د`;
    return '0د';
  }

  function getLastNDays(n, endDate){
    const end = endDate || todayStr();
    const list = [];
    for(let i = n - 1; i >= 0; i--){
      list.push(addDays(end, -i));
    }
    return list;
  }

  function computeWeekStats(){
    const weekDays = getLastNDays(7);
    let totalMs = 0;
    let doneCount = 0;
    let totalTaskCount = 0;
    const taskTimeMap = {};
    const dayTotals = {};
    let longestTask = null;

    weekDays.forEach(date => {
      const tasks = state.days[date] || [];
      let dayMs = 0;
      tasks.forEach(t => {
        totalTaskCount++;
        if(t.done) doneCount++;
        const ms = parseDurationToMinutes(t.duration) * 60000;
        if(ms > 0){
          totalMs += ms;
          dayMs += ms;
          taskTimeMap[t.name] = (taskTimeMap[t.name] || 0) + ms;
          if(!longestTask || ms > longestTask.ms){
            longestTask = { ms, name: t.name, date };
          }
        }
      });
      dayTotals[date] = dayMs;
    });

    let streak = 0;
    let cursor = todayStr();
    while(true){
      const tasks = state.days[cursor] || [];
      if(tasks.length === 0 || !tasks.every(t => t.done)) break;
      streak++;
      cursor = addDays(cursor, -1);
    }

    let bestDay = null, bestDayMs = -1;
    weekDays.forEach(date => {
      if(dayTotals[date] > bestDayMs){ bestDayMs = dayTotals[date]; bestDay = date; }
    });
    if(bestDayMs <= 0) bestDay = null;

    const topTasks = Object.entries(taskTimeMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const freqMap = {};
    Object.values(state.days).forEach(tasks => {
      tasks.forEach(t => { freqMap[t.name] = (freqMap[t.name] || 0) + 1; });
    });
    const topFrequent = Object.entries(freqMap).sort((a,b) => b[1] - a[1]).slice(0, 5);

    const recentNames = new Set();
    getLastNDays(14).forEach(date => {
      (state.days[date] || []).forEach(t => recentNames.add(t.name));
    });
    const neglected = state.keywords.filter(k => !recentNames.has(k.name)).slice(0, 8);

    return {
      totalMs, doneCount, totalTaskCount,
      topTasks, longestTask, streak, bestDay, bestDayMs,
      topFrequent, neglected
    };
  }

  function renderStatsModal(){
    const s = computeWeekStats();
    const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;
    const avgDailyMs = s.totalMs / 7;

    let html = `
      <div class="stat-block">
        <div class="stat-block-title"><span class="material-icons">local_fire_department</span>أكتر مهمة قضيت وقت عليها الأسبوع دا</div>
        ${s.topTasks.length ? `
          <ul class="stat-list">
            ${s.topTasks.map(([name, ms]) => `
              <li><span class="stat-list-name">${escapeHtml(name)}</span><span class="stat-list-value">${formatHM(ms)}</span></li>
            `).join('')}
          </ul>
        ` : `<div class="stat-empty">لسه محددتش مدة لأي مهمة الأسبوع دا</div>`}
      </div>
    `;

    html += `
      <div class="stat-cols">
        <div class="stat-block">
          <div class="stat-block-title"><span class="material-icons">schedule</span>إجمالي الوقت</div>
          <div class="stat-highlight">${formatHM(s.totalMs)}</div>
          <div class="stat-sub">متوسط ${formatHM(avgDailyMs)} في اليوم</div>
        </div>
        <div class="stat-block">
          <div class="stat-block-title"><span class="material-icons">task_alt</span>نسبة الإنجاز</div>
          <div class="stat-highlight">${completionPct}%</div>
          <div class="stat-sub">${s.doneCount} من ${s.totalTaskCount} مهمة</div>
        </div>
      </div>
    `;

    html += `
      <div class="stat-cols">
        <div class="stat-block">
          <div class="stat-block-title"><span class="material-icons">timer</span>أطول مهمة</div>
          ${s.longestTask ? `
            <div class="stat-highlight">${formatHM(s.longestTask.ms)}</div>
            <div class="stat-sub">${escapeHtml(s.longestTask.name)} - ${fmtDay(s.longestTask.date)}</div>
          ` : `<div class="stat-empty">لا يوجد بعد</div>`}
        </div>
        <div class="stat-block">
          <div class="stat-block-title"><span class="material-icons">emoji_events</span>أكتر يوم إنتاجية</div>
          ${s.bestDay ? `
            <div class="stat-highlight">${formatHM(s.bestDayMs)}</div>
            <div class="stat-sub">${fmtDay(s.bestDay)}</div>
          ` : `<div class="stat-empty">لا يوجد بعد</div>`}
        </div>
      </div>
    `;

    html += `
      <div class="stat-block">
        <div class="stat-block-title"><span class="material-icons">bolt</span>سلسلة الإنجاز</div>
        <div class="stat-highlight">${s.streak} ${s.streak === 1 ? 'يوم' : 'أيام'} متتالية</div>
        <div class="stat-sub">${s.streak > 0 ? 'خلّصت فيهم كل مهامك المحددة' : 'خلص كل مهامك النهاردة عشان تبدأ سلسلة'}</div>
      </div>
    `;

    html += `
      <div class="stat-block">
        <div class="stat-block-title"><span class="material-icons">repeat</span>أكتر مهام بتتكرر</div>
        ${s.topFrequent.length ? `
          <ul class="stat-list">
            ${s.topFrequent.map(([name, count]) => `
              <li><span class="stat-list-name">${escapeHtml(name)}</span><span class="stat-list-value">${count} ${count === 1 ? 'مرة' : 'مرات'}</span></li>
            `).join('')}
          </ul>
        ` : `<div class="stat-empty">لا توجد بيانات كفاية</div>`}
      </div>
    `;

    html += `
      <div class="stat-block">
        <div class="stat-block-title"><span class="material-icons">inventory_2</span>مهام في البنك ملهاش نصيب مؤخرًا</div>
        ${s.neglected.length ? `
          <ul class="stat-list">
            ${s.neglected.map(k => `<li><span class="stat-list-name">${escapeHtml(k.name)}</span></li>`).join('')}
          </ul>
        ` : `<div class="stat-empty">كل مهام البنك بتتضاف بانتظام 👌</div>`}
      </div>
    `;

    document.getElementById('statsBody').innerHTML = html;
  }

  // ===== إدارة نافذة الحساب (ربط/تسجيل دخول/خروج) =====
  function renderAccountModal(errorMsg){
    const bodyEl = document.getElementById('accountBody');
    if(!bodyEl) return;

    // حالة 1: مسجل بحساب حقيقي بالفعل
    if(!isAnonymousUser && currentUserEmail){
      bodyEl.innerHTML = `
        <div class="account-status is-linked">
          <span class="material-icons">account_circle</span>
          <div class="account-status-text">
            <strong>${currentUserEmail}</strong>
            <span>حسابك متزامن ومتاح من أي جهاز</span>
          </div>
        </div>
        <button class="account-secondary-btn" id="signOutBtn" style="width:100%;">تسجيل الخروج</button>
      `;
      const signOutBtn = document.getElementById('signOutBtn');
      if(signOutBtn) signOutBtn.onclick = signOutUser;
      return;
    }

    // حالة 2: مستخدم مجهول - نعرض فورم "احفظ حسابك" أو "دخول لحساب موجود"
    const errorHtml = errorMsg ? `<div class="account-error">${errorMsg}</div>` : '';

    if(accountModalMode === 'signin'){
      bodyEl.innerHTML = `
        <div class="account-status">
          <span class="material-icons">person_outline</span>
          <div class="account-status-text">
            <strong>ضيف حالياً</strong>
            <span>بياناتك محفوظة على الجهاز ده بس</span>
          </div>
        </div>
        <div class="account-hint">تسجيل الدخول لحساب موجود هيوديك لبيانات الحساب ده، مش بيانات الجهاز الحالي.</div>
        ${errorHtml}
        <div class="account-form">
          <input type="email" class="account-input" id="accEmail" placeholder="الإيميل" />
          <input type="password" class="account-input" id="accPassword" placeholder="كلمة المرور" />
          <button class="account-primary-btn" id="accSubmitBtn">تسجيل الدخول</button>
        </div>
        <div class="account-switch-line">مفيش حساب محفوظ لسه؟ <button id="accSwitchMode">احفظ الحساب الحالي بدل كده</button></div>
      `;
      document.getElementById('accSubmitBtn').onclick = () => {
        const email = document.getElementById('accEmail').value.trim();
        const password = document.getElementById('accPassword').value;
        signInExisting(email, password);
      };
      document.getElementById('accSwitchMode').onclick = () => { accountModalMode = 'save'; renderAccountModal(); };
    } else {
      bodyEl.innerHTML = `
        <div class="account-status">
          <span class="material-icons">person_outline</span>
          <div class="account-status-text">
            <strong>ضيف حالياً</strong>
            <span>بياناتك متخزنة، بس لو مسحت بيانات المتصفح هتفقدها</span>
          </div>
        </div>
        <div class="account-hint">احفظ إيميل وباسورد عشان توصل لبياناتك دي من أي جهاز تاني، ومتفقدهاش لو مسحت الكاش.</div>
        ${errorHtml}
        <div class="account-form">
          <input type="email" class="account-input" id="accEmail" placeholder="الإيميل" />
          <input type="password" class="account-input" id="accPassword" placeholder="كلمة المرور (6 أحرف على الأقل)" />
          <button class="account-primary-btn" id="accSubmitBtn">احفظ الحساب</button>
        </div>
        <div class="account-switch-line">عندك حساب محفوظ بالفعل؟ <button id="accSwitchMode">سجّل دخول بيه</button></div>
      `;
      document.getElementById('accSubmitBtn').onclick = () => {
        const email = document.getElementById('accEmail').value.trim();
        const password = document.getElementById('accPassword').value;
        linkEmailAccount(email, password);
      };
      document.getElementById('accSwitchMode').onclick = () => { accountModalMode = 'signin'; renderAccountModal(); };
    }
  }

  async function linkEmailAccount(email, password){
    if(!email || !password){
      renderAccountModal('اكتب الإيميل وكلمة المرور الأول');
      return;
    }
    if(password.length < 6){
      renderAccountModal('كلمة المرور لازم تكون 6 أحرف على الأقل');
      return;
    }
    try{
      const { error } = await supabaseClient.auth.updateUser({ email, password });
      if(error) throw error;
      const { data: { user } } = await supabaseClient.auth.getUser();
      applyAuthUser(user);
      showToast('تم حفظ الحساب. لو Supabase محتاج تأكيد إيميل، تحقق من بريدك');
      renderAccountModal();
    }catch(e){
      console.error('Link account error:', e);
      renderAccountModal(e.message || 'حصل خطأ، حاول تاني');
    }
  }

  async function signInExisting(email, password){
    if(!email || !password){
      renderAccountModal('اكتب الإيميل وكلمة المرور الأول');
      return;
    }
    try{
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if(error) throw error;
      applyAuthUser(data.user);
      showToast('تم تسجيل الدخول');
      closeAccountModal();
      await loadData();
      render();
    }catch(e){
      console.error('Sign in error:', e);
      renderAccountModal(e.message === 'Invalid login credentials' ? 'الإيميل أو كلمة المرور غلط' : (e.message || 'حصل خطأ، حاول تاني'));
    }
  }

  async function signOutUser(){
    if(!confirm('متأكد من تسجيل الخروج؟ هتحتاج تسجّل دخول تاني عشان توصل لنفس البيانات.')) return;
    try{
      await supabaseClient.auth.signOut();
      currentUserId = null;
      isAnonymousUser = true;
      currentUserEmail = null;
      accountModalMode = 'save';
      await ensureAuth();
      closeAccountModal();
      await loadData();
      render();
      showToast('تم تسجيل الخروج');
    }catch(e){
      console.error('Sign out error:', e);
      showToast('حصل خطأ أثناء تسجيل الخروج');
    }
  }

  function openAccountModal(){
    accountModalMode = 'save';
    renderAccountModal();
    document.getElementById('accountOverlay').classList.add('open');
  }
  function closeAccountModal(){
    document.getElementById('accountOverlay').classList.remove('open');
  }

  function openStatsModal(){
    renderStatsModal();
    document.getElementById('statsOverlay').classList.add('open');
  }
  function closeStatsModal(){
    document.getElementById('statsOverlay').classList.remove('open');
  }

  // ===== إدارة نافذة الـ Drafts والبحث الذكي فيها =====
  function renderDraftsModal(){
    const listEl = document.getElementById('draftsModalList');
    const searchVal = normalizeArabic(draftsSearchQuery.trim());

    const filteredDrafts = searchVal 
      ? state.drafts.filter(d => normalizeArabic(d.name).includes(searchVal))
      : state.drafts;

    if(filteredDrafts.length === 0){
      listEl.innerHTML = `<div class="empty-state">مفيش مسودات (Drafts) محفوظة حالياً.</div>`;
      return;
    }

    let html = '';
    filteredDrafts.forEach(d => {
      html += `
        <div style="background: var(--paper); border: 1px solid var(--paper-line); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <span style="font-size: 0.92rem; font-weight: 700; color: var(--ink);">${highlightMatch(d.name, draftsSearchQuery)}</span>
          <div style="display: flex; gap: 6px;">
            <button class="icon-btn" data-action="restore-draft" data-id="${d.id}" title="استعادة لبنك المهام"><span class="material-icons">unarchive</span></button>
            <button class="icon-btn" data-action="delete-draft-permanently" data-id="${d.id}" title="حذف نهائي"><span class="material-icons">delete_forever</span></button>
          </div>
        </div>
      `;
    });
    listEl.innerHTML = html;

    listEl.querySelectorAll('button[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if(action === 'restore-draft'){
          const draftItem = state.drafts.find(x => x.id === id);
          if(draftItem){
            state.drafts = state.drafts.filter(x => x.id !== id);
            state.keywords.push(draftItem);
            renderDraftsModal();
            render();
            await saveData();
            showToast('تمت استعادة المهمة لبنك المهام');
          }
        } else if(action === 'delete-draft-permanently'){
          if(confirm('متأكد من حذف هذه المسودة نهائياً؟')){
            state.drafts = state.drafts.filter(x => x.id !== id);
            renderDraftsModal();
            await saveData();
            showToast('تم الحذف النهائي');
          }
        }
      };
    });
  }

  function openDraftsModal(){
    draftsSearchQuery = '';
    const searchInput = document.getElementById('draftsSearchInput');
    if(searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('draftsSearchClear');
    if(clearBtn) clearBtn.style.display = 'none';

    renderDraftsModal();
    document.getElementById('draftsOverlay').classList.add('open');
  }
  function closeDraftsModal(){
    document.getElementById('draftsOverlay').classList.remove('open');
  }

  function renderCalendarModal(){
    const d = fromISO(selectedDate);
    const year = d.getFullYear();
    const month = d.getMonth();

    const titleEl = document.getElementById('calMonthTitle');
    if(titleEl) titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;

    const gridEl = document.getElementById('calGrid');
    if(!gridEl) return;

    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDayOfWeek = firstDayOfMonth.getDay();

    let gridHtml = '';
    const weekdays = ['أ', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
    weekdays.forEach(w => {
      gridHtml += `<div style="text-align:center; font-size:0.78rem; font-weight:700; color:var(--ink-soft); padding:4px 0;">${w}</div>`;
    });

    const prevMonthDays = new Date(year, month, 0).getDate();
    for(let i = startDayOfWeek - 1; i >= 0; i--){
      const dayNum = prevMonthDays - i;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      const dateStr = `${prevYear}-${String(prevMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
      const hasTasks = (state.days[dateStr] && state.days[dateStr].length > 0);
      gridHtml += `
        <button class="cal-day other-month ${dateStr === selectedDate ? 'selected' : ''}" data-date="${dateStr}">
          <span>${dayNum}</span>
          ${hasTasks ? '<span class="cal-day-dot"></span>' : ''}
        </button>
      `;
    }

    for(let day = 1; day <= daysInMonth; day++){
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const isToday = dateStr === todayStr();
      const isSelected = dateStr === selectedDate;
      const hasTasks = (state.days[dateStr] && state.days[dateStr].length > 0);
      gridHtml += `
        <button class="cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}">
          <span>${day}</span>
          ${hasTasks ? '<span class="cal-day-dot"></span>' : ''}
        </button>
      `;
    }

    const totalCellsSoFar = startDayOfWeek + daysInMonth;
    const totalGridCells = totalCellsSoFar > 35 ? 42 : 35;
    const nextMonthDaysCount = totalGridCells - totalCellsSoFar;
    for(let day = 1; day <= nextMonthDaysCount; day++){
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      const dateStr = `${nextYear}-${String(nextMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const hasTasks = (state.days[dateStr] && state.days[dateStr].length > 0);
      gridHtml += `
        <button class="cal-day other-month ${dateStr === selectedDate ? 'selected' : ''}" data-date="${dateStr}">
          <span>${day}</span>
          ${hasTasks ? '<span class="cal-day-dot"></span>' : ''}
        </button>
      `;
    }

    gridEl.innerHTML = gridHtml;

    const prevBtn = document.getElementById('calPrevMonth');
    const nextBtn = document.getElementById('calNextMonth');
    if(prevBtn){
      prevBtn.onclick = () => {
        const newD = new Date(year, month - 1, 1);
        selectedDate = toISO(newD);
        renderCalendarModal();
      };
    }
    if(nextBtn){
      nextBtn.onclick = () => {
        const newD = new Date(year, month + 1, 1);
        selectedDate = toISO(newD);
        renderCalendarModal();
      };
    }

    gridEl.querySelectorAll('.cal-day').forEach(btn => {
      btn.onclick = () => {
        selectedDate = btn.dataset.date;
        closeCalendarModal();
        render();
      };
    });
  }

  function openCalendarModal(){
    renderCalendarModal();
    document.getElementById('calendarOverlay').classList.add('open');
  }
  function closeCalendarModal(){
    document.getElementById('calendarOverlay').classList.remove('open');
  }

  function renderTimerPanel(){
    const timers = getDayTimers(selectedDate);
    let html = `<div class="timer-panel-card">`;
    html += `
      <div class="timer-panel-title">
        <span class="material-icons">timer</span>
        تايمرز اليوم
      </div>
      <div class="timer-add-row">
        <input type="text" id="newTimerInput" placeholder="اسم المهمة اللي هتشتغل عليها..." maxlength="60" />
        <button class="timer-add-btn" id="addTimerBtn" title="ابدأ تايمر جديد">
          <span class="material-icons">add</span>
        </button>
      </div>
    `;

    if(timers.length === 0){
      html += `<div class="timer-empty">مفيش تايمرز لسه النهاردة.<br>اكتب اسم المهمة وابدأ.</div>`;
    } else {
      html += `<div class="timer-list">`;
      timers.forEach(t => {
        html += `
          <div class="timer-item ${t.running ? 'running' : ''}">
            <div class="timer-item-top">
              <span class="timer-name">${escapeHtml(t.name)}</span>
              <span class="timer-status-dot"></span>
            </div>
            <div class="timer-item-bottom">
              <span class="timer-clock" id="timerClock_${t.id}">${formatElapsed(getElapsedMs(t))}</span>
              <div class="timer-controls">
                <button class="timer-btn timer-toggle-btn ${t.running ? 'is-running' : ''}" data-action="toggle-timer" data-id="${t.id}" title="${t.running ? 'إيقاف مؤقت' : 'تشغيل'}">
                  <span class="material-icons">${t.running ? 'pause' : 'play_arrow'}</span>
                </button>
                <button class="timer-btn timer-delete-btn" data-action="delete-timer" data-id="${t.id}" title="حذف">
                  <span class="material-icons">delete</span>
                </button>
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }
    html += `</div>`;
    timerPanelEl.innerHTML = html;

    const addBtn = document.getElementById('addTimerBtn');
    const newInput = document.getElementById('newTimerInput');
    const handleAddTimer = async () => {
      const val = newInput.value.trim();
      if(!val) return;
      getDayTimers(selectedDate).push({
        id: uid(),
        name: val,
        elapsedMs: 0,
        running: true,
        startedAt: Date.now()
      });
      newInput.value = '';
      renderTimerPanel();
      await saveData();
    };
    addBtn.onclick = handleAddTimer;
    newInput.onkeydown = (e) => { if(e.key === 'Enter') handleAddTimer(); };

    timerPanelEl.querySelectorAll('button[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const list = getDayTimers(selectedDate);
        const t = list.find(x => x.id === id);
        if(!t) return;

        if(action === 'toggle-timer'){
          if(t.running){
            t.elapsedMs = getElapsedMs(t);
            t.running = false;
            t.startedAt = null;
          } else {
            t.running = true;
            t.startedAt = Date.now();
          }
          renderTimerPanel();
          await saveData();
        }
        else if(action === 'delete-timer'){
          if(confirm(`متأكد إنك عايز تحذف تايمر "${t.name}"؟`)){
            state.timers[selectedDate] = list.filter(x => x.id !== id);
            renderTimerPanel();
            await saveData();
          }
        }
      };
    });
  }

  function tickTimers(){
    const timers = state.timers[selectedDate];
    if(!timers) return;
    timers.forEach(t => {
      if(t.running){
        const el = document.getElementById(`timerClock_${t.id}`);
        if(el) el.textContent = formatElapsed(getElapsedMs(t));
      }
    });
  }

  function normalizeArabic(str){
    return String(str || '')
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670]/g, '')
      .replace(/[إأآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .trim();
  }

  function highlightMatch(name, query){
    const q = query.trim();
    if(!q) return escapeHtml(name);
    const idx = name.toLowerCase().indexOf(q.toLowerCase());
    if(idx === -1) return escapeHtml(name);
    const before = escapeHtml(name.slice(0, idx));
    const match = escapeHtml(name.slice(idx, idx + q.length));
    const after = escapeHtml(name.slice(idx + q.length));
    return `${before}<mark class="search-highlight">${match}</mark>${after}`;
  }

  function buildFilterDropdown(id, selectedId){
    const options = [{ id: '', name: 'بدون فلتر' }, ...state.filters];
    const current = options.find(o => o.id === (selectedId || '')) || options[0];
    return `
      <div class="custom-select" id="${id}" data-value="${selectedId || ''}">
        <button type="button" class="custom-select-trigger">
          <span class="custom-select-label">${escapeHtml(current.name)}</span>
          <span class="material-icons custom-select-caret">expand_more</span>
        </button>
        <div class="custom-select-menu">
          ${options.map(o => `<div class="custom-select-option ${o.id === (selectedId || '') ? 'active' : ''}" data-value="${o.id}">${escapeHtml(o.name)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  function wireCustomSelects(){
    document.querySelectorAll('.custom-select').forEach(sel => {
      const trigger = sel.querySelector('.custom-select-trigger');
      const menu = sel.querySelector('.custom-select-menu');
      trigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = sel.classList.contains('open');
        document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
        if(!isOpen) sel.classList.add('open');
      };
      menu.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.onclick = (e) => {
          e.stopPropagation();
          sel.dataset.value = opt.dataset.value;
          sel.querySelector('.custom-select-label').textContent = opt.textContent;
          menu.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
          sel.classList.remove('open');
        };
      });
    });
  }

  function reorderArrayById(arr, draggedId, targetId){
    if(!arr) return;
    const fromIndex = arr.findIndex(x => x.id === draggedId);
    const toIndex = arr.findIndex(x => x.id === targetId);
    if(fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
  }

  function wireDragAndDrop(selector, onReorder){
    let draggedId = null;
    document.querySelectorAll(selector).forEach(row => {
      row.addEventListener('dragstart', () => {
        draggedId = row.dataset.dragId;
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        document.querySelectorAll(selector).forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if(row.dataset.dragId !== draggedId) row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const targetId = row.dataset.dragId;
        if(draggedId && targetId && draggedId !== targetId){
          onReorder(draggedId, targetId);
        }
      });
    });
  }

  function render(){
    const today = todayStr();
    const isToday = selectedDate === today;
    const dayTasks = state.days[selectedDate] || [];
    const doneCount = dayTasks.filter(t => t.done).length;
    const totalMinutes = dayTasks.reduce((sum, t) => sum + (t.done ? parseDurationToMinutes(t.duration) : 0), 0);
    const totalHoursText = formatMinutes(totalMinutes);

    let html = '';

    html += `
      <div class="date-nav">
        <button class="nav-btn" id="prevBtn" aria-label="اليوم السابق"><span class="material-icons">chevron_right</span></button>
        <div class="date-display">
          <div class="day-name">${fmtDay(selectedDate)}</div>
          <div class="day-sub">${dayTasks.length ? `${doneCount} من ${dayTasks.length} خلصت${totalHoursText ? ` • ${totalHoursText}` : ''}` : 'مفيش مهام متسجلة لليوم ده'}</div>
        </div>
        <button class="nav-btn" id="nextBtn" aria-label="اليوم التالي" ${isToday ? 'disabled' : ''}><span class="material-icons">chevron_left</span></button>
      </div>
    `;
    if(!isToday){
      html += `<button class="today-btn" id="todayBtn">العودة لليوم</button>`;
    }

    // Keyword Bank Section
    html += `<button class="bank-toggle" data-action="toggle-bank" type="button">
      <span class="bank-toggle-label">بنك المهام (Keywords)</span>
      <span class="bank-toggle-arrow ${bankOpen ? 'open' : ''}"><span class="material-icons">expand_more</span></span>
    </button>`;

    if(bankOpen || closingBank){
      html += `<div class="bank-content ${justOpenedBank ? 'animate-in' : ''} ${closingBank ? 'animate-out' : ''}">`;

      html += `
        <div class="add-row-group">
          <div class="add-row">
            <input type="text" id="newKeywordInput" placeholder="أكتب مهمة جديدة..." maxlength="80" />
            ${buildFilterDropdown('newKeywordFilterCustom', '')}
            <button class="add-btn icon-only" id="addKeywordBtn" title="إضافة مهمة"><span class="material-icons">add</span></button>
          </div>
          <div class="add-row">
            <input type="text" id="newFilterInput" placeholder="أضف فلتر جديد..." maxlength="40" />
            <button class="add-btn icon-only" id="addFilterBtn" title="إضافة فلتر"><span class="material-icons">add</span></button>
          </div>
        </div>
      `;

      html += `
        <div class="bank-search">
          <span class="material-icons bank-search-icon">search</span>
          <input type="text" id="bankSearchInput" placeholder="دور على مهمة في البنك..." value="${escapeAttr(bankSearchQuery)}" />
          ${bankSearchQuery ? `<button class="bank-search-clear" id="bankSearchClear" title="مسح البحث"><span class="material-icons">close</span></button>` : ``}
        </div>
      `;

      html += `<div class="filter-chips">`;
      html += `<button class="filter-chip ${activeFilter === 'all' ? 'active' : ''}" data-action="select-filter" data-filter-id="all">الكل</button>`;
      state.filters.forEach(f => {
        html += `
          <span class="filter-chip-wrap ${activeFilter === f.id ? 'active' : ''}">
            <button class="filter-chip-label" data-action="select-filter" data-filter-id="${f.id}">${escapeHtml(f.name)}</button>
            <button class="filter-chip-x" data-action="delete-filter" data-id="${f.id}" title="حذف الفلتر"><span class="material-icons">close</span></button>
          </span>
        `;
      });
      html += `</div>`;

      const filterMatched = activeFilter === 'all'
        ? state.keywords
        : state.keywords.filter(k => k.filterId === activeFilter);

      const searchNormalized = normalizeArabic(bankSearchQuery.trim());
      const visibleKeywords = searchNormalized
        ? filterMatched.filter(k => normalizeArabic(k.name).includes(searchNormalized))
        : filterMatched;

      if(visibleKeywords.length === 0){
        let emptyMsg = 'بنك المهام فاضي. ضيف مهامك الأساسية من فوق.';
        if(state.keywords.length > 0 && searchNormalized) emptyMsg = 'مفيش نتائج مطابقة للبحث.';
        else if(state.keywords.length > 0) emptyMsg = 'مفيش مهام في الفلتر ده.';
        html += `<div class="empty-state">${emptyMsg}</div>`;
      } else {
        const slicedKeywords = visibleKeywords.slice(0, bankDisplayLimit);
        html += `<div class="keyword-list">`;
        slicedKeywords.forEach(k => {
          if(editingKeywordId === k.id){
             html += `
              <div class="keyword-row editing">
                <input class="edit-input" id="editKeywordInput" value="${escapeAttr(k.name)}" />
                ${buildFilterDropdown('editKeywordFilterCustom', k.filterId || '')}
                <button class="icon-btn" data-action="save-keyword" title="حفظ"><span class="material-icons">check</span></button>
                <button class="icon-btn" data-action="cancel-keyword" title="إلغاء"><span class="material-icons">close</span></button>
              </div>
            `;
          } else {
            const alreadyAdded = dayTasks.some(t => t.name === k.name);
            html += `
              <div class="keyword-row" draggable="true" data-drag-id="${k.id}">
                <span class="drag-handle material-icons" title="اسحب لإعادة الترتيب">drag_indicator</span>
                <button class="add-to-day-btn ${alreadyAdded ? 'added' : ''}" data-action="add-to-day" data-name="${escapeAttr(k.name)}" ${alreadyAdded ? 'disabled' : ''} title="${alreadyAdded ? 'مضافة بالفعل النهاردة' : 'إضافة لمهام اليوم'}"><span class="material-icons">${alreadyAdded ? 'check' : 'add'}</span></button>
                <span class="keyword-name">${highlightMatch(k.name, bankSearchQuery)}</span>
                <button class="icon-btn" data-action="edit-keyword" data-id="${k.id}" title="تعديل في البنك"><span class="material-icons">edit</span></button>
                <button class="icon-btn" data-action="delete-keyword" data-id="${k.id}" title="نقل إلى Draft"><span class="material-icons">archive</span></button>
              </div>
            `;
          }
        });

        if(visibleKeywords.length > 10){
          const showAll = bankDisplayLimit >= visibleKeywords.length;
          html += `
            <button class="keyword-row" data-action="${showAll ? 'bank-show-less' : 'bank-show-more'}" style="background: var(--paper); border: 1.5px dashed var(--pen); color: var(--pen); cursor: pointer; font-weight: 700; align-items: center; gap: 4px;">
              <span class="material-icons" style="font-size: 18px;">${showAll ? 'expand_less' : 'expand_more'}</span>
              <span class="keyword-name">${showAll ? 'اعرض أقل' : 'اعرض المزيد'}</span>
            </button>
          `;
        }

        html += `</div>`;
      }

      html += `</div>`; 
    }

    // Daily Tasks Section
    html += `<div class="section-title" style="margin-top: 32px;">مهام اليوم</div>`;
    
    if(dayTasks.length === 0){
      html += `
        <div class="empty-state">
          مفيش مهام متضافة لليوم ده.<br>
          اضغط (+) من بنك المهام فوق عشان تضيف مهمة.
        </div>
      `;
    } else {
      html += `<div class="task-list">`;
      dayTasks.forEach(t => {
        html += `
          <div class="task-row ${t.done?'done':''}" draggable="true" data-drag-id="${t.id}">
            <span class="drag-handle material-icons" title="اسحب لإعادة الترتيب">drag_indicator</span>
            <div class="task-main" data-action="toggle-task" data-id="${t.id}">
              <span class="task-name">${escapeHtml(t.name)}</span>
              <button class="icon-btn timer-start-btn" data-action="start-timer-from-task" data-id="${t.id}" title="ابدأ تايمر لهذه المهمة">
                <span class="material-icons">play_circle_outline</span>
              </button>
              <button class="clock-btn" data-action="toggle-duration" data-id="${t.id}" title="أضف/عدّل المدة">
                <span class="material-icons">schedule</span>
              </button>
              ${t.duration ? `<span class="duration-text">: ${escapeHtml(t.duration)}</span>` : ``}
              <button class="icon-btn" data-action="delete-task" data-id="${t.id}" title="حذف من اليوم"><span class="material-icons">delete</span></button>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    contentEl.innerHTML = html;
    
    justOpenedBank = false;

    attachEvents();
    if(timerPanelRenderedForDate !== selectedDate){
      renderTimerPanel();
      timerPanelRenderedForDate = selectedDate;
    }
  }

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s){ return escapeHtml(s); }

  function attachEvents(){
    document.getElementById('prevBtn').onclick = () => { selectedDate = addDays(selectedDate, -1); render(); };
    const nextBtn = document.getElementById('nextBtn');
    if(nextBtn) nextBtn.onclick = () => { if(selectedDate < todayStr()){ selectedDate = addDays(selectedDate, 1); render(); } };
    const todayBtn = document.getElementById('todayBtn');
    if(todayBtn) todayBtn.onclick = () => { selectedDate = todayStr(); render(); };

    contentEl.onclick = async (e) => {
      const btn = e.target.closest('button[data-action]');

      if(!btn){
        if(e.target.closest('input')) return;
        const mainEl = e.target.closest('.task-main[data-action="toggle-task"]');
        if(mainEl){
          const taskId = mainEl.dataset.id;
          const task = state.days[selectedDate].find(t => t.id === taskId);
          if(task){
            task.done = !task.done;
            render();
            await saveData();
          }
        }
        return;
      }
      
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if(action === 'toggle-bank'){
        if(bankOpen){
          bankOpen = false;
          closingBank = true;
          bankDisplayLimit = 10;
          render();
          bankCloseTimeoutId = setTimeout(() => {
            closingBank = false;
            bankCloseTimeoutId = null;
            render();
          }, 240);
        } else {
          if(bankCloseTimeoutId){ clearTimeout(bankCloseTimeoutId); bankCloseTimeoutId = null; }
          closingBank = false;
          bankOpen = true;
          justOpenedBank = true;
          render();
        }
      }
      else if(action === 'bank-show-more'){
        bankDisplayLimit += 10;
        render();
      }
      else if(action === 'bank-show-less'){
        bankDisplayLimit = 10;
        render();
      }
      else if(action === 'toggle-duration'){
        openDurationPicker(id);
      }
      else if(action === 'delete-task'){
        state.days[selectedDate] = state.days[selectedDate].filter(t => t.id !== id);
        if(pickerTaskId === id) closeDurationPicker();
        render();
        await saveData();
        showToast('تم الحذف من اليوم');
      }
      else if(action === 'start-timer-from-task'){
        const task = state.days[selectedDate].find(x => x.id === id);
        if(!task) return;
        const timers = getDayTimers(selectedDate);
        let t = timers.find(x => x.name === task.name);
        if(t){
          if(t.running){
            showToast(`تايمر "${task.name}" شغال بالفعل`);
          } else {
            t.running = true;
            t.startedAt = Date.now();
            showToast(`كمّلنا تايمر "${task.name}"`);
          }
        } else {
          t = { id: uid(), name: task.name, elapsedMs: 0, running: true, startedAt: Date.now() };
          timers.push(t);
          showToast(`بدأ تايمر لـ "${task.name}"`);
        }
        renderTimerPanel();
        timerPanelRenderedForDate = selectedDate;
        await saveData();
      }
      else if(action === 'add-to-day'){
        const name = btn.dataset.name;
        if(!state.days[selectedDate]) state.days[selectedDate] = [];
        const exists = state.days[selectedDate].some(t => t.name === name);
        if(exists){
          showToast('المهمة دي متضافة بالفعل النهاردة');
          return;
        }
        state.days[selectedDate].push({ id: uid(), name: name, done: false });
        render();
        await saveData();
        showToast('تمت الإضافة لمهام اليوم');
      }
      else if(action === 'select-filter'){
        activeFilter = btn.dataset.filterId;
        bankDisplayLimit = 10;
        render();
      }
      else if(action === 'delete-filter'){
        if(confirm('متأكد إنك عايز تحذف الفلتر ده؟ المهام اللي فيه هترجع بدون فلتر (وتفضل ظاهرة في الكل).')){
          state.filters = state.filters.filter(f => f.id !== id);
          state.keywords.forEach(k => { if(k.filterId === id) k.filterId = null; });
          if(activeFilter === id) activeFilter = 'all';
          bankDisplayLimit = 10;
          render();
          await saveData();
          showToast('تم حذف الفلتر');
        }
      }
      else if(action === 'delete-keyword'){
        // بدل الحذف النهائي، بننقلها للـ Drafts عشان البيانات متضيعش
        const kw = state.keywords.find(k => k.id === id);
        if(kw){
          state.keywords = state.keywords.filter(k => k.id !== id);
          state.drafts.push(kw);
          render();
          await saveData();
          showToast('تم نقل المهمة إلى الـ Drafts بنجاح');
        }
      }
      else if(action === 'edit-keyword'){
        editingKeywordId = id;
        render();
        const input = document.getElementById('editKeywordInput');
        if(input){ input.focus(); input.select(); }
      }
      else if(action === 'save-keyword'){
        const input = document.getElementById('editKeywordInput');
        const filterSelect = document.getElementById('editKeywordFilterCustom');
        const val = input.value.trim();
        if(val){
          const kw = state.keywords.find(k => k.id === editingKeywordId);
          if(kw){
            kw.name = val;
            kw.filterId = filterSelect && filterSelect.dataset.value ? filterSelect.dataset.value : null;
          }
        }
        editingKeywordId = null;
        render();
        await saveData();
      }
      else if(action === 'cancel-keyword'){
        editingKeywordId = null;
        render();
      }
    };

    const bankSearchInput = document.getElementById('bankSearchInput');
    if(bankSearchInput){
      bankSearchInput.oninput = (e) => {
        bankSearchQuery = e.target.value;
        bankDisplayLimit = 10;
        const cursorPos = e.target.selectionStart;
        render();
        const newInput = document.getElementById('bankSearchInput');
        if(newInput){
          newInput.focus();
          newInput.setSelectionRange(cursorPos, cursorPos);
        }
      };
    }
    const bankSearchClear = document.getElementById('bankSearchClear');
    if(bankSearchClear){
      bankSearchClear.onclick = () => {
        bankSearchQuery = '';
        bankDisplayLimit = 10;
        render();
        const newInput = document.getElementById('bankSearchInput');
        if(newInput) newInput.focus();
      };
    }

    const addKeywordBtn = document.getElementById('addKeywordBtn');
    const newKeywordInput = document.getElementById('newKeywordInput');
    const newKeywordFilter = document.getElementById('newKeywordFilterCustom');
    
    if(addKeywordBtn && newKeywordInput){
      const handleAdd = () => {
        const val = newKeywordInput.value.trim();
        if(!val) return;
        pendingTaskName = val;
        pendingTaskFilterId = newKeywordFilter && newKeywordFilter.dataset.value ? newKeywordFilter.dataset.value : null;
        
        const displayEl = document.getElementById('pendingTaskNameDisplay');
        if(displayEl) displayEl.textContent = `"${val}"`;
        
        document.getElementById('addChoiceOverlay').classList.add('open');
      };
      addKeywordBtn.onclick = handleAdd;
      newKeywordInput.onkeydown = (e) => { if(e.key === 'Enter') handleAdd(); };
    }

    const addFilterBtn = document.getElementById('addFilterBtn');
    const newFilterInput = document.getElementById('newFilterInput');

    if(addFilterBtn && newFilterInput){
      const handleAddFilter = async () => {
        const val = newFilterInput.value.trim();
        if(!val) return;
        const exists = state.filters.some(f => f.name === val);
        if(exists){
          showToast('الفلتر ده موجود بالفعل');
          return;
        }
        state.filters.push({ id: uid(), name: val });
        newFilterInput.value = '';
        render();
        await saveData();
        document.getElementById('newFilterInput').focus();
      };
      addFilterBtn.onclick = handleAddFilter;
      newFilterInput.onkeydown = (e) => { if(e.key === 'Enter') handleAddFilter(); };
    }
    
    const editInput = document.getElementById('editKeywordInput');
    if(editInput){
      editInput.onkeydown = (e) => {
        if(e.key === 'Enter') document.querySelector('button[data-action="save-keyword"]').click();
        if(e.key === 'Escape') document.querySelector('button[data-action="cancel-keyword"]').click();
      };
    }

    wireCustomSelects();

    wireDragAndDrop('.keyword-row[data-drag-id]', (draggedId, targetId) => {
      reorderArrayById(state.keywords, draggedId, targetId);
      render();
      saveData();
    });
    wireDragAndDrop('.task-row[data-drag-id]', (draggedId, targetId) => {
      reorderArrayById(state.days[selectedDate], draggedId, targetId);
      render();
      saveData();
    });
  }

  function closeAddChoiceModal(){
    document.getElementById('addChoiceOverlay').classList.remove('open');
    pendingTaskName = '';
    pendingTaskFilterId = null;
  }

  (async function init(){
    await loadData();
    render();
    setInterval(tickTimers, 1000);
    document.addEventListener('click', () => {
      document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    });

    document.getElementById('themeBtn').onclick = async () => {
      state.darkMode = !state.darkMode;
      document.body.classList.toggle('dark-mode', state.darkMode);
      document.getElementById('themeIcon').textContent = state.darkMode ? 'light_mode' : 'dark_mode';
      await saveData();
    };

    document.getElementById('statsBtn').onclick = openStatsModal;
    document.getElementById('closeStatsBtn').onclick = closeStatsModal;
    const statsOverlay = document.getElementById('statsOverlay');
    statsOverlay.addEventListener('click', (e) => {
      if(e.target === statsOverlay) closeStatsModal();
    });

    document.getElementById('calendarBtn').onclick = openCalendarModal;
    document.getElementById('closeCalendarBtn').onclick = closeCalendarModal;
    const calendarOverlay = document.getElementById('calendarOverlay');
    calendarOverlay.addEventListener('click', (e) => {
      if(e.target === calendarOverlay) closeCalendarModal();
    });

    // أحداث زر ونافذة الـ Drafts والبحث الذكي
    document.getElementById('draftsBtn').onclick = openDraftsModal;
    document.getElementById('closeDraftsBtn').onclick = closeDraftsModal;
    const draftsOverlay = document.getElementById('draftsOverlay');
    draftsOverlay.addEventListener('click', (e) => {
      if(e.target === draftsOverlay) closeDraftsModal();
    });

    document.getElementById('accountBtn').onclick = openAccountModal;
    document.getElementById('closeAccountBtn').onclick = closeAccountModal;
    const accountOverlay = document.getElementById('accountOverlay');
    accountOverlay.addEventListener('click', (e) => {
      if(e.target === accountOverlay) closeAccountModal();
    });

    const draftsSearchInput = document.getElementById('draftsSearchInput');
    const draftsSearchClear = document.getElementById('draftsSearchClear');
    if(draftsSearchInput){
      draftsSearchInput.oninput = (e) => {
        draftsSearchQuery = e.target.value;
        if(draftsSearchQuery) draftsSearchClear.style.display = 'flex';
        else draftsSearchClear.style.display = 'none';
        renderDraftsModal();
      };
    }
    if(draftsSearchClear){
      draftsSearchClear.onclick = () => {
        draftsSearchQuery = '';
        draftsSearchInput.value = '';
        draftsSearchClear.style.display = 'none';
        renderDraftsModal();
        draftsSearchInput.focus();
      };
    }

    // أحداث أزرار الاختيار في الـ Modal الجديد
    document.getElementById('choiceTodayBtn').onclick = async () => {
      if(!pendingTaskName) return;
      if(!state.days[selectedDate]) state.days[selectedDate] = [];
      const exists = state.days[selectedDate].some(t => t.name === pendingTaskName);
      if(!exists){
        state.days[selectedDate].push({ id: uid(), name: pendingTaskName, done: false });
        showToast('تمت الإضافة لمهام اليوم فقط');
      } else {
        showToast('المهمة دي موجودة بالفعل في مهام اليوم');
      }
      const input = document.getElementById('newKeywordInput');
      if(input) input.value = '';
      closeAddChoiceModal();
      render();
      await saveData();
    };

    document.getElementById('choiceBankBtn').onclick = async () => {
      if(!pendingTaskName) return;
      state.keywords.push({ id: uid(), name: pendingTaskName, filterId: pendingTaskFilterId });
      showToast('تمت الإضافة لبنك المهام');
      const input = document.getElementById('newKeywordInput');
      if(input) input.value = '';
      closeAddChoiceModal();
      render();
      await saveData();
    };

    document.getElementById('choiceBothBtn').onclick = async () => {
      if(!pendingTaskName) return;
      state.keywords.push({ id: uid(), name: pendingTaskName, filterId: pendingTaskFilterId });
      if(!state.days[selectedDate]) state.days[selectedDate] = [];
      const exists = state.days[selectedDate].some(t => t.name === pendingTaskName);
      if(!exists){
        state.days[selectedDate].push({ id: uid(), name: pendingTaskName, done: false });
      }
      showToast('تمت الإضافة للبنك ولمهام اليوم');
      const input = document.getElementById('newKeywordInput');
      if(input) input.value = '';
      closeAddChoiceModal();
      render();
      await saveData();
    };

    document.getElementById('closeAddChoiceBtn').onclick = closeAddChoiceModal;
    const addChoiceOverlay = document.getElementById('addChoiceOverlay');
    addChoiceOverlay.addEventListener('click', (e) => {
      if(e.target === addChoiceOverlay) closeAddChoiceModal();
    });

    const pickerOverlay = document.getElementById('durationPickerOverlay');
    document.getElementById('pickerCancelBtn').onclick = closeDurationPicker;
    document.getElementById('pickerDoneBtn').onclick = commitDurationPicker;
    pickerOverlay.addEventListener('click', (e) => {
      if(e.target === pickerOverlay) closeDurationPicker();
    });

    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape'){
        if(statsOverlay.classList.contains('open')) closeStatsModal();
        if(calendarOverlay.classList.contains('open')) closeCalendarModal();
        if(draftsOverlay.classList.contains('open')) closeDraftsModal();
        if(accountOverlay.classList.contains('open')) closeAccountModal();
        if(pickerOverlay.classList.contains('open')) closeDurationPicker();
        if(addChoiceOverlay.classList.contains('open')) closeAddChoiceModal();
      }
    });
  })();
})();
