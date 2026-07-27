(function(){
  const DAY_NAMES = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  const MONTH_NAMES = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

  /* ===== Supabase Config =====
     غيّر القيمتين دول ببيانات مشروعك من Supabase Dashboard > Settings > API
  */
  const SUPABASE_URL = 'https://txdgfvxnjofpmiaiwsax.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_-yUhuWCFab5f0jLN6kY3kQ_SGJRPYgy';

  /* ===== Cloudflare Turnstile Config =====
     غيّر القيمة دي بالـ Site Key بتاعك من Cloudflare Dashboard > Turnstile
     (السيكرت كي بتاع Turnstile بيتحط في Supabase Dashboard مش هنا) */
  const TURNSTILE_SITE_KEY = '0x4AAAAAAD-WN3zH063FV-FK';
  let turnstileWidgetId = null;
  let turnstileResolve = null; // آخر resolve مفعّل - بيتغير مع كل نداء جديد لـ getTurnstileToken

  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let currentUserId = null; // بيتحدد بعد تسجيل الدخول (مجهول أو حقيقي)
  let isAnonymousUser = true; // هل الحساب الحالي مجهول ولا مربوط بإيميل حقيقي
  let currentUserEmail = null;
  let accountModalMode = 'save'; // 'save' | 'signin' | 'forgot' | 'forgot-sent'
  let accountFormBusy = false; // true أثناء انتظار رد من Supabase
  const LOCAL_BACKUP_KEY = 'habit-data-v2'; // نسخة احتياطية محلية في حالة قطع النت
  const FIRST_VISIT_ACCOUNT_KEY = 'nazam-account-prompt-seen'; // بيتسجل أول ما المستخدم يقفل شاشة الحساب أول مرة
  const MISSED_POPUP_SHOWN_KEY = 'nazam-missed-popup-last-shown'; // آخر يوم اتعرض فيه بوب أب مهام الأمس

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
        handleOAuthReturnIfAny();
        return;
      }
      const captchaToken = await getTurnstileToken();
      const { data, error } = await supabaseClient.auth.signInAnonymously(
        captchaToken ? { options: { captchaToken } } : undefined
      );
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

  /* ===== Cloudflare Turnstile (invisible CAPTCHA) =====
     بيرندر widget مخفي مرة واحدة، وبيرجّع Promise بالتوكن كل ما نحتاجه
     قبل أي عملية auth حساسة (sign in / sign up / password reset). */
  function getTurnstileToken(){
    return new Promise((resolve) => {
      if(typeof turnstile === 'undefined' || TURNSTILE_SITE_KEY === 'YOUR_TURNSTILE_SITE_KEY'){
        // لسه متظبطش الـ Site Key، أو المكتبة لسه بتتحمل - كمّل من غيره في وضع التطوير
        resolve(null);
        return;
      }
      const container = document.getElementById('turnstileContainer');
      if(!container){ resolve(null); return; }

      // آخر resolve هو اللي بيستحق التوكن الجديد؛ الكول باك ثابت ومربوط بالـ widget مرة واحدة بس
      turnstileResolve = resolve;

      if(turnstileWidgetId === null){
        turnstileWidgetId = turnstile.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          size: 'invisible',
          retry: 'auto',
          callback: (token) => { if(turnstileResolve) turnstileResolve(token); },
          'error-callback': () => { if(turnstileResolve) turnstileResolve(null); },
          'expired-callback': () => { if(turnstileResolve) turnstileResolve(null); }
        });
        turnstile.execute(turnstileWidgetId);
      } else {
        // إعادة استخدام نفس الـ widget: reset الأول عشان نمسح أي حالة تنفيذ سابقة، وبعدين execute
        turnstile.reset(turnstileWidgetId);
        turnstile.execute(turnstileWidgetId);
      }
    });
  }

  /* بيتأكد لو المستخدم راجع لتوه من صفحة Google (بعد OAuth) عشان يعرض
     رسالة نجاح مرة واحدة بس، مش في كل مرة الجلسة بترجع تتحمل من جديد. */
  function handleOAuthReturnIfAny(){
    const params = new URLSearchParams(window.location.search);
    if(params.get('authreturn') === 'google' && !isAnonymousUser){
      showToast('تم تسجيل الدخول بنجاح بنجاح عبر Google');
      params.delete('authreturn');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? ('?' + newSearch) : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
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
  let justChangedFilter = false; // true لمرة واحدة بس لما تتغيّر الفلتر، عشان مهام البنك اللي تحتها تعمل fade-in
  let closingBank = false;
  let bankCloseTimeoutId = null;
  let bankSearchQuery = '';
  let draftsSearchQuery = '';
  let bankDisplayLimit = 10;
  let timerPanelRenderedForDate = null;
  let statsViewOpen = false; // لما تبقى true، #content بيعرض شاشة الإحصائيات بدل مهام اليوم
  let justReturnedFromStats = false; // true لمرة واحدة بس لما نرجع من شاشة الإحصائيات، عشان نشغّل أنيميشن الدخول مرة واحدة فقط
  let statsChartInstances = []; // مراجع لكل الـ Chart.js instances عشان نقدر نمسحها قبل كل رسم جديد

  let pendingTaskName = '';
  let pendingTaskFilterId = null;
  let pendingNewTimerName = ''; // اسم التايمر المنتظر اختيار نوعه (مفتوح / محدد)
  let pickerMode = 'task'; // 'task' لتحديد هدف المهمة، 'timer' لتحديد مدة تايمر جديد
  let alertAudioCtx = null;
  let openDurationPopoverTaskId = null; // المهمة اللي فاتح لها بوب أب (الهدف/الوقت الفعلي) دلوقتي
  let openClockChoiceTaskId = null; // المهمة اللي فاتح لها اختيار (هدف / وقت فعلي) من أيقونة الساعة

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
    pickerMode = 'task';
    pickerTaskId = taskId;

    const totalMin = parseDurationToMinutes(task.duration);
    const h = Math.min(23, Math.floor(totalMin / 60));
    const m = Math.min(59, Math.round(totalMin % 60));

    const titleEl = document.getElementById('pickerTitle');
    if(titleEl) titleEl.textContent = 'مدة المهمة';

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

  // نفس عجلة اختيار المدة، لكن لتحديد "الوقت الفعلي" اللي اتقضى في المهمة يدويًا (ملهاش علاقة بالتايمر)
  function openActualDurationPicker(taskId){
    const task = state.days[selectedDate].find(t => t.id === taskId);
    if(!task) return;
    pickerMode = 'actual';
    pickerTaskId = taskId;

    const totalMin = parseDurationToMinutes(task.actualDuration);
    const h = Math.min(23, Math.floor(totalMin / 60));
    const m = Math.min(59, Math.round(totalMin % 60));

    const titleEl = document.getElementById('pickerTitle');
    if(titleEl) titleEl.textContent = 'الوقت الفعلي';

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

  // نفس عجلة اختيار المدة، لكن لتحديد مدة تايمر جديد (وقت محدد) بدل هدف مهمة
  function openTimerDurationPicker(name){
    pickerMode = 'timer';
    pickerTaskId = null;

    const titleEl = document.getElementById('pickerTitle');
    if(titleEl) titleEl.textContent = 'مدة التايمر';

    const hoursCol = document.getElementById('hoursWheel');
    const hoursList = document.getElementById('hoursWheelList');
    const minutesCol = document.getElementById('minutesWheel');
    const minutesList = document.getElementById('minutesWheelList');

    document.getElementById('durationPickerOverlay').classList.add('open');

    requestAnimationFrame(() => {
      initWheel(hoursCol, hoursList, 24, 0);
      initWheel(minutesCol, minutesList, 60, 15); // افتراضي 15 دقيقة
    });
  }

  function closeDurationPicker(){
    document.getElementById('durationPickerOverlay').classList.remove('open');
    pickerTaskId = null;
    if(pickerMode === 'timer') pendingNewTimerName = '';
    pickerMode = 'task';
  }

  async function commitDurationPicker(){
    const hoursCol = document.getElementById('hoursWheel');
    const minutesCol = document.getElementById('minutesWheel');
    const h = hoursCol._value || 0;
    const m = minutesCol._value || 0;

    if(pickerMode === 'timer'){
      const targetMs = (h * 60 + m) * 60000;
      if(targetMs <= 0){
        showToast('يرجى تحديد مدة أكبر من صفر');
        return;
      }
      const name = pendingNewTimerName;
      if(!name){ closeDurationPicker(); return; }
      ensureAudioContext();
      getDayTimers(selectedDate).push({
        id: uid(),
        name,
        elapsedMs: 0,
        running: true,
        startedAt: Date.now(),
        mode: 'countdown',
        targetMs,
        alerted: false
      });
      showToast(`بدأ تايمر محدد لـ "${name}"`);
      pendingNewTimerName = '';
      pickerMode = 'task';
      document.getElementById('durationPickerOverlay').classList.remove('open');
      renderTimerPanel();
      timerPanelRenderedForDate = selectedDate;
      await saveData();
      return;
    }

    if(!pickerTaskId) return;
    const task = state.days[selectedDate].find(t => t.id === pickerTaskId);
    if(task){
      const label = h > 0 && m > 0 ? `${h} ساعة و ${m} دقيقة` : (h > 0 ? `${h} ساعة` : (m > 0 ? `${m} دقيقة` : ''));
      if(pickerMode === 'actual') task.actualDuration = label;
      else task.duration = label;
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
      showToast('تعذّر الاتصال بالخادم، يعمل التطبيق حاليًا بنسخة محلية');
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
      showToast('تعذّر الحفظ على الخادم (لا يوجد اتصال)، تم الحفظ محليًا فقط');
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
      showToast('تعذّر الحفظ على الخادم، يرجى المحاولة مرة أخرى');
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
    const today = todayStr();
    const weekDays = getLastNDays(7);
    let totalMs = 0;
    let doneCount = 0;
    let totalTaskCount = 0;
    let missedCount = 0; // مهام اتضافت ليوم فات ومتعملهاش check
    const taskTimeMap = {};
    const dayTotals = {};
    const dayTaskCounts = {};
    const dayDoneCounts = {};
    const filterTotals = {}; // filterId -> ms (لرسم توزيع الوقت حسب التصنيف)
    let longestTask = null;

    // خريطة من اسم المهمة لتصنيفها (filterId) بناءً على بنك المهام
    const nameToFilterId = {};
    state.keywords.forEach(k => { if(k.filterId) nameToFilterId[k.name] = k.filterId; });

    weekDays.forEach(date => {
      const tasks = state.days[date] || [];
      let dayMs = 0;
      let dayDone = 0;
      const isPastDay = date < today;
      tasks.forEach(t => {
        totalTaskCount++;
        if(t.done){ doneCount++; dayDone++; }
        else if(isPastDay){ missedCount++; }
        const ms = parseDurationToMinutes(t.actualDuration) * 60000;
        if(ms > 0){
          totalMs += ms;
          dayMs += ms;
          taskTimeMap[t.name] = (taskTimeMap[t.name] || 0) + ms;
          if(!longestTask || ms > longestTask.ms){
            longestTask = { ms, name: t.name, date };
          }
          const fId = nameToFilterId[t.name];
          if(fId) filterTotals[fId] = (filterTotals[fId] || 0) + ms;
        }
      });
      dayTotals[date] = dayMs;
      dayTaskCounts[date] = tasks.length;
      dayDoneCounts[date] = dayDone;
    });

    // بنحسب الأيام السابقة (من غير النهاردة) اللي خلصت فيها كل مهامها بالكامل
    let streak = 0;
    let cursor = addDays(todayStr(), -1);
    while(true){
      const tasks = state.days[cursor] || [];
      if(tasks.length === 0 || !tasks.every(t => t.done)) break;
      streak++;
      cursor = addDays(cursor, -1);
    }
    // لو النهاردة كمان خلصت كل مهامها، بتتضاف للسلسلة. لو لسه ما خلصتش، السلسلة بتفضل زي ما هي (ومش بترجع صفر إلا بكرة لو النهاردة فاتت من غير ما تخلص)
    const todayTasksForStreak = state.days[todayStr()] || [];
    if(todayTasksForStreak.length > 0 && todayTasksForStreak.every(t => t.done)) streak++;

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
      totalMs, doneCount, totalTaskCount, missedCount,
      topTasks, longestTask, streak, bestDay, bestDayMs,
      topFrequent, neglected,
      weekDays, dayTotals, dayTaskCounts, dayDoneCounts, filterTotals
    };
  }

  // يمسح كل الـ Chart.js instances القديمة قبل ما نرسم شارتات جديدة (عشان نتجنب تسريب الذاكرة/أخطاء إعادة استخدام الـ canvas)
  function destroyStatsCharts(){
    statsChartInstances.forEach(c => { try{ c.destroy(); }catch(e){} });
    statsChartInstances = [];
  }

  // شاشة الإحصائيات: بتتعرض مكان مهام اليوم في #content، وبترسم كل البيانات بشارتات Chart.js
  function renderStatsView(){
    const s = computeWeekStats();
    const completionPct = s.totalTaskCount > 0 ? Math.round((s.doneCount / s.totalTaskCount) * 100) : 0;

    // بنجيب الألوان مباشرة بناءً على state.darkMode (بدل ما نعتمد على قراءة الـ CSS variables من المتصفح)
    // عشان نضمن ألوان صح ١٠٠٪ في كل وضع من غير أي مشاكل توقيت أو قراءة خاطئة
    const isDark = !!state.darkMode;
    const penColor = isDark ? '#e06046' : '#C5482E';
    const doneColor = isDark ? '#489970' : '#3E7A5C';
    const inkColor = isDark ? '#e6edf3' : '#22303D';
    const inkSoftColor = isDark ? '#8b98a5' : '#5B6B78';
    const paperLineColor = isDark ? '#2c333c' : '#DCD8C8';
    const penSoftColor = isDark ? '#38221e' : '#E8DCD6';

    const shortDayLabel = (dateStr) => DAY_NAMES[fromISO(dateStr).getDay()];

    const weekLabels = s.weekDays.map(shortDayLabel);
    const weekHours = s.weekDays.map(d => +(s.dayTotals[d] / 3600000).toFixed(2));
    const weekTaskCounts = s.weekDays.map(d => s.dayTaskCounts[d] || 0);
    const weekCompletionPct = s.weekDays.map(d => {
      const total = s.dayTaskCounts[d] || 0;
      const done = s.dayDoneCounts[d] || 0;
      return total > 0 ? Math.round((done / total) * 100) : 0;
    });

    const topTasksLabels = s.topTasks.map(([name]) => name);
    const topTasksHours = s.topTasks.map(([,ms]) => +(ms / 3600000).toFixed(2));

    const filterEntries = state.filters
      .map(f => ({ name: f.name, ms: s.filterTotals[f.id] || 0 }))
      .filter(f => f.ms > 0);

    let html = `
      <div class="stats-view">
        <div class="stats-view-header">
          <button class="nav-btn" id="statsBackBtn" aria-label="رجوع لمهام اليوم"><span class="material-icons">arrow_forward</span></button>
          <h2>إحصائيات الأسبوع</h2>
          <span style="width:36px;"></span>
        </div>

        <div class="stats-summary-row">
          <div class="stats-summary-pill">
            <span class="material-icons">schedule</span>
            <strong>${formatHM(s.totalMs)}</strong>
            <small>إجمالي الوقت</small>
          </div>
          <div class="stats-summary-pill">
            <span class="material-icons">task_alt</span>
            <strong>${completionPct}%</strong>
            <small>نسبة الإنجاز</small>
          </div>
          <div class="stats-summary-pill">
            <span class="material-icons">bolt</span>
            <strong>${s.streak}</strong>
            <small>${s.streak === 1 ? 'يوم متتالي' : 'أيام متتالية'}</small>
          </div>
          <div class="stats-summary-pill">
            <span class="material-icons" style="color: var(--missed);">event_busy</span>
            <strong style="color: var(--missed);">${s.missedCount}</strong>
            <small>${s.missedCount === 1 ? 'مهمة فائتة' : 'مهام فائتة'}</small>
          </div>
        </div>

        <div class="chart-grid">
          <div class="chart-card">
            <div class="chart-card-title"><span class="material-icons">task_alt</span>نسبة الإنجاز الأسبوعي</div>
            <div class="chart-card-body">
              ${s.totalTaskCount ? `<canvas id="chartCompletion"></canvas>` : `<div class="stat-empty">لا توجد مهام مسجلة هذا الأسبوع</div>`}
            </div>
          </div>

          <div class="chart-card">
            <div class="chart-card-title"><span class="material-icons">local_fire_department</span>أكثر المهام استهلاكًا للوقت</div>
            <div class="chart-card-body">
              ${topTasksLabels.length ? `<canvas id="chartTopTasks"></canvas>` : `<div class="stat-empty">لم تُحدَّد مدة لأي مهمة هذا الأسبوع</div>`}
            </div>
          </div>

          <div class="chart-card">
            <div class="chart-card-title"><span class="material-icons">show_chart</span>اتجاه الوقت خلال الأسبوع</div>
            <div class="chart-card-body"><canvas id="chartWeekTrend"></canvas></div>
          </div>

          <div class="chart-card">
            <div class="chart-card-title"><span class="material-icons">insights</span>أداء يومي (عدد المهام / الإنجاز)</div>
            <div class="chart-card-body"><canvas id="chartDailyPerf"></canvas></div>
          </div>

          ${filterEntries.length >= 3 ? `
          <div class="chart-card chart-card-wide">
            <div class="chart-card-title"><span class="material-icons">category</span>توزيع الوقت حسب التصنيف</div>
            <div class="chart-card-body"><canvas id="chartFilters"></canvas></div>
          </div>` : ``}
        </div>

        <div class="stat-block">
          <div class="stat-block-title"><span class="material-icons">inventory_2</span>مهام في البنك لم تُستخدم مؤخرًا</div>
          ${s.neglected.length ? `
            <ul class="stat-list">
              ${s.neglected.map(k => `<li><span class="stat-list-name">${escapeHtml(k.name)}</span></li>`).join('')}
            </ul>
          ` : `<div class="stat-empty">جميع مهام البنك تُضاف بانتظام 👌</div>`}
        </div>
      </div>
    `;

    contentEl.innerHTML = html;

    const backBtn = document.getElementById('statsBackBtn');
    if(backBtn) backBtn.onclick = () => { statsViewOpen = false; justReturnedFromStats = true; render(); };

    destroyStatsCharts();

    if(typeof Chart === 'undefined') return; // لو مكتبة Chart.js متحملتش لأي سبب

    Chart.defaults.font.family = "'Tajawal', sans-serif";
    Chart.defaults.color = inkColor;

    // 1) دونات: نسبة الإنجاز
    const ctxCompletion = document.getElementById('chartCompletion');
    if(ctxCompletion){
      statsChartInstances.push(new Chart(ctxCompletion, {
        type: 'doughnut',
        data: {
          labels: ['تم إنجازها', 'لم تنجز بعد'],
          datasets: [{
            data: [s.doneCount, Math.max(0, s.totalTaskCount - s.doneCount)],
            backgroundColor: [doneColor, penSoftColor],
            borderColor: 'transparent'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } } }
        }
      }));
    }

    // 2) بار: أكثر المهام استهلاكًا للوقت
    const ctxTopTasks = document.getElementById('chartTopTasks');
    if(ctxTopTasks){
      statsChartInstances.push(new Chart(ctxTopTasks, {
        type: 'bar',
        data: {
          labels: topTasksLabels,
          datasets: [{
            label: 'ساعات',
            data: topTasksHours,
            backgroundColor: penColor,
            borderRadius: 6,
            maxBarThickness: 40
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: inkColor } },
            y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor } }
          }
        }
      }));
    }

    // 3) خط: اتجاه الوقت خلال الأسبوع
    const ctxTrend = document.getElementById('chartWeekTrend');
    if(ctxTrend){
      statsChartInstances.push(new Chart(ctxTrend, {
        type: 'line',
        data: {
          labels: weekLabels,
          datasets: [{
            label: 'ساعات في اليوم',
            data: weekHours,
            borderColor: penColor,
            backgroundColor: penColor + '33',
            fill: true,
            tension: 0.4,
            pointBackgroundColor: penColor
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: inkColor } },
            y: { beginAtZero: true, grid: { color: paperLineColor }, ticks: { color: inkColor } }
          }
        }
      }));
    }

    // 4) بار + خط مدمج: عدد المهام ونسبة الإنجاز لكل يوم
    const ctxDaily = document.getElementById('chartDailyPerf');
    if(ctxDaily){
      statsChartInstances.push(new Chart(ctxDaily, {
        data: {
          labels: weekLabels,
          datasets: [
            {
              type: 'bar',
              label: 'عدد المهام',
              data: weekTaskCounts,
              backgroundColor: inkSoftColor + '99',
              borderRadius: 6,
              yAxisID: 'y'
            },
            {
              type: 'line',
              label: 'نسبة الإنجاز %',
              data: weekCompletionPct,
              borderColor: penColor,
              backgroundColor: penColor,
              tension: 0.4,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', rtl: true, labels: { color: inkColor, font: { size: 11 } } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: inkColor } },
            y: { beginAtZero: true, position: 'left', grid: { color: paperLineColor }, ticks: { color: inkColor, precision: 0 } },
            y1: { beginAtZero: true, max: 100, position: 'right', grid: { display: false }, ticks: { color: inkColor, callback: v => v + '%' } }
          }
        }
      }));
    }

    // 5) رادار: توزيع الوقت حسب التصنيف (لو فيه 3 تصنيفات أو أكتر بوقت مسجل)
    const ctxFilters = document.getElementById('chartFilters');
    if(ctxFilters){
      statsChartInstances.push(new Chart(ctxFilters, {
        type: 'radar',
        data: {
          labels: filterEntries.map(f => f.name),
          datasets: [{
            label: 'ساعات',
            data: filterEntries.map(f => +(f.ms / 3600000).toFixed(2)),
            borderColor: doneColor,
            backgroundColor: doneColor + '33',
            pointBackgroundColor: doneColor
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            r: {
              grid: { color: paperLineColor },
              angleLines: { color: paperLineColor },
              pointLabels: { color: inkColor, font: { size: 11 } },
              ticks: { color: inkColor, backdropColor: 'transparent' }
            }
          }
        }
      }));
    }
  }

  // ===== إدارة نافذة الحساب (ربط/تسجيل دخول/خروج) =====
  function isValidEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function mapAuthError(e){
    const msg = (e && e.message) || '';
    if(msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    if(msg.includes('already registered') || msg.includes('already been registered')) return 'هذا البريد الإلكتروني مستخدم بالفعل، حاول تسجيل الدخول بدلًا من ذلك';
    if(msg.includes('Email not confirmed')) return 'يجب تأكيد بريدك الإلكتروني أولًا، يرجى مراجعة رسالة التأكيد في بريدك';
    if(msg.includes('Password should be at least')) return 'يجب ألا تقل كلمة المرور عن 6 أحرف';
    if(msg.toLowerCase().includes('rate limit') || msg.includes('Too Many') || msg.includes('429')) return 'محاولات كثيرة جدًا خلال وقت قصير، يرجى الانتظار قليلًا والمحاولة مرة أخرى';
    if(msg.toLowerCase().includes('captcha')) return 'تعذّر التحقق الأمني، يرجى تحديث الصفحة والمحاولة مرة أخرى';
    if(msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'يرجى التأكد من اتصال الإنترنت والمحاولة مرة أخرى';
    return msg || 'حدث خطأ، يرجى المحاولة مرة أخرى';
  }

  function setAccountFormBusy(busy){
    accountFormBusy = busy;
    const btn = document.getElementById('accSubmitBtn');
    if(btn){ btn.disabled = busy; btn.classList.toggle('is-loading', busy); }
    const googleBtn = document.getElementById('accGoogleBtn');
    if(googleBtn) googleBtn.disabled = busy;
  }

  function wirePasswordToggle(inputId, toggleId){
    const input = document.getElementById(inputId);
    const toggle = document.getElementById(toggleId);
    if(!input || !toggle) return;
    toggle.onclick = () => {
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      toggle.querySelector('.material-icons').textContent = isPass ? 'visibility_off' : 'visibility';
    };
  }

  function wireEnterSubmit(formSelector, submitFn){
    const form = document.querySelector(formSelector);
    if(!form) return;
    form.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if(e.key === 'Enter'){ e.preventDefault(); if(!accountFormBusy) submitFn(); }
      });
    });
  }

  const GOOGLE_ICON_SVG = `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.4 5.9 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.4 5.9 29.5 4 24 4c-7.5 0-13.9 4.2-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.3 35.4 26.8 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.9 39.7 16.4 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.3 5.2C40.9 36.3 44 30.8 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>`;

  function googleBlockHtml(){
    return `
      <div class="account-divider"><span>أو</span></div>
      <button class="account-google-btn" id="accGoogleBtn" type="button">
        ${GOOGLE_ICON_SVG}
        <span>المتابعة عبر Google</span>
      </button>
    `;
  }

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

    const errorHtml = errorMsg ? `<div class="account-error">${errorMsg}</div>` : '';

    // حالة: نسيت كلمة المرور
    if(accountModalMode === 'forgot'){
      bodyEl.innerHTML = `
        <div class="account-hint">أدخل البريد الإلكتروني المرتبط بحسابك، وسنرسل إليك رابطًا لإعادة تعيين كلمة المرور.</div>
        ${errorHtml}
        <div class="account-form" id="accForm">
          <input type="email" class="account-input" id="accEmail" placeholder="البريد الإلكتروني" autocomplete="email" />
          <button class="account-primary-btn" id="accSubmitBtn">إرسال رابط إعادة التعيين</button>
        </div>
        <div class="account-switch-line"><button id="accSwitchMode">العودة إلى تسجيل الدخول</button></div>
      `;
      document.getElementById('accSwitchMode').onclick = () => { accountModalMode = 'signin'; renderAccountModal(); };
      const submit = () => handleForgotPassword(document.getElementById('accEmail').value.trim());
      document.getElementById('accSubmitBtn').onclick = submit;
      wireEnterSubmit('#accForm', submit);
      return;
    }

    // حالة: اتبعت رسالة تصفير الباسورد
    if(accountModalMode === 'forgot-sent'){
      bodyEl.innerHTML = `
        <div class="account-status is-linked">
          <span class="material-icons">mark_email_read</span>
          <div class="account-status-text">
            <strong>تم إرسال الرابط</strong>
            <span>افتح بريدك الإلكتروني واضغط على رابط إعادة تعيين كلمة المرور</span>
          </div>
        </div>
        <div class="account-switch-line"><button id="accSwitchMode">العودة إلى تسجيل الدخول</button></div>
      `;
      document.getElementById('accSwitchMode').onclick = () => { accountModalMode = 'signin'; renderAccountModal(); };
      return;
    }

    // حالة 2: مستخدم مجهول - نعرض فورم "احفظ حسابك" أو "دخول لحساب موجود"
    if(accountModalMode === 'signin'){
      bodyEl.innerHTML = `
        <div class="account-status">
          <span class="material-icons">person_outline</span>
          <div class="account-status-text">
            <strong>حساب مؤقت (زائر)</strong>
            <span>بياناتك محفوظة على هذا الجهاز فقط</span>
          </div>
        </div>
        <div class="account-hint">تسجيل الدخول إلى حساب موجود سينقلك إلى بيانات ذلك الحساب، وليس بيانات هذا الجهاز.</div>
        ${errorHtml}
        <div class="account-form" id="accForm">
          <input type="email" class="account-input" id="accEmail" placeholder="البريد الإلكتروني" autocomplete="email" />
          <div class="account-pass-wrap">
            <input type="password" class="account-input" id="accPassword" placeholder="كلمة المرور" autocomplete="current-password" />
            <button type="button" class="account-pass-toggle" id="accPassToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
          </div>
          <button class="account-primary-btn" id="accSubmitBtn">تسجيل الدخول</button>
        </div>
        <div class="account-switch-line"><button id="accForgotBtn">نسيت كلمة المرور؟</button></div>
        ${googleBlockHtml()}
        <div class="account-switch-line">لا يوجد حساب محفوظ بعد؟ <button id="accSwitchMode">احفظ حسابك الحالي بدلًا من ذلك</button></div>
      `;
      wirePasswordToggle('accPassword', 'accPassToggle');
      const submit = () => {
        const email = document.getElementById('accEmail').value.trim();
        const password = document.getElementById('accPassword').value;
        signInExisting(email, password);
      };
      document.getElementById('accSubmitBtn').onclick = submit;
      wireEnterSubmit('#accForm', submit);
      document.getElementById('accSwitchMode').onclick = () => { accountModalMode = 'save'; renderAccountModal(); };
      document.getElementById('accForgotBtn').onclick = () => { accountModalMode = 'forgot'; renderAccountModal(); };
      document.getElementById('accGoogleBtn').onclick = signInWithGoogle;
    } else {
      bodyEl.innerHTML = `
        <div class="account-status">
          <span class="material-icons">person_outline</span>
          <div class="account-status-text">
            <strong>حساب مؤقت (زائر)</strong>
            <span>بياناتك محفوظة حاليًا، لكنك ستفقدها إذا مسحت بيانات المتصفح</span>
          </div>
        </div>
        <div class="account-hint">احفظ بريدًا إلكترونيًا وكلمة مرور لتتمكن من الوصول إلى بياناتك من أي جهاز آخر، ولن تفقدها حتى لو مسحت ذاكرة التخزين المؤقت.</div>
        ${errorHtml}
        <div class="account-form" id="accForm">
          <input type="email" class="account-input" id="accEmail" placeholder="البريد الإلكتروني" autocomplete="email" />
          <div class="account-pass-wrap">
            <input type="password" class="account-input" id="accPassword" placeholder="كلمة المرور (6 أحرف على الأقل)" autocomplete="new-password" />
            <button type="button" class="account-pass-toggle" id="accPassToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
          </div>
          <div class="account-pass-wrap">
            <input type="password" class="account-input" id="accPasswordConfirm" placeholder="تأكيد كلمة المرور" autocomplete="new-password" />
            <button type="button" class="account-pass-toggle" id="accPassConfirmToggle" tabindex="-1"><span class="material-icons">visibility</span></button>
          </div>
          <button class="account-primary-btn" id="accSubmitBtn">احفظ الحساب</button>
        </div>
        ${googleBlockHtml()}
        <div class="account-switch-line">لديك حساب محفوظ بالفعل؟ <button id="accSwitchMode">سجّل الدخول به</button></div>
      `;
      wirePasswordToggle('accPassword', 'accPassToggle');
      wirePasswordToggle('accPasswordConfirm', 'accPassConfirmToggle');
      const submit = () => {
        const email = document.getElementById('accEmail').value.trim();
        const password = document.getElementById('accPassword').value;
        const passwordConfirm = document.getElementById('accPasswordConfirm').value;
        linkEmailAccount(email, password, passwordConfirm);
      };
      document.getElementById('accSubmitBtn').onclick = submit;
      wireEnterSubmit('#accForm', submit);
      document.getElementById('accSwitchMode').onclick = () => { accountModalMode = 'signin'; renderAccountModal(); };
      document.getElementById('accGoogleBtn').onclick = signInWithGoogle;
    }
  }

  async function linkEmailAccount(email, password, passwordConfirm){
    if(!email || !password){
      renderAccountModal('يرجى إدخال البريد الإلكتروني وكلمة المرور أولًا');
      return;
    }
    if(!isValidEmail(email)){
      renderAccountModal('صيغة البريد الإلكتروني غير صحيحة');
      return;
    }
    if(password.length < 6){
      renderAccountModal('يجب ألا تقل كلمة المرور عن 6 أحرف');
      return;
    }
    if(password !== passwordConfirm){
      renderAccountModal('كلمة المرور وتأكيدها غير متطابقين');
      return;
    }
    setAccountFormBusy(true);
    try{
      const { error } = await supabaseClient.auth.updateUser({ email, password });
      if(error) throw error;
      const { data: { user } } = await supabaseClient.auth.getUser();
      applyAuthUser(user);
      showToast('تم حفظ الحساب بنجاح. إذا استلزم الأمر تأكيد البريد الإلكتروني، يرجى التحقق من بريدك');
      renderAccountModal();
    }catch(e){
      console.error('Link account error:', e);
      renderAccountModal(mapAuthError(e));
    }finally{
      setAccountFormBusy(false);
    }
  }

  async function signInExisting(email, password){
    if(!email || !password){
      renderAccountModal('يرجى إدخال البريد الإلكتروني وكلمة المرور أولًا');
      return;
    }
    if(!isValidEmail(email)){
      renderAccountModal('صيغة البريد الإلكتروني غير صحيحة');
      return;
    }
    setAccountFormBusy(true);
    try{
      const captchaToken = await getTurnstileToken();
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email, password,
        options: captchaToken ? { captchaToken } : undefined
      });
      if(error) throw error;
      applyAuthUser(data.user);
      showToast('تم تسجيل الدخول بنجاح');
      closeAccountModal();
      await loadData();
      render();
    }catch(e){
      console.error('Sign in error:', e);
      renderAccountModal(mapAuthError(e));
    }finally{
      setAccountFormBusy(false);
    }
  }

  async function handleForgotPassword(email){
    if(!email || !isValidEmail(email)){
      renderAccountModal('يرجى إدخال بريد إلكتروني صحيح أولًا');
      return;
    }
    setAccountFormBusy(true);
    try{
      const captchaToken = await getTurnstileToken();
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href,
        captchaToken: captchaToken || undefined
      });
      if(error) throw error;
      accountModalMode = 'forgot-sent';
      renderAccountModal();
    }catch(e){
      console.error('Forgot password error:', e);
      renderAccountModal(mapAuthError(e));
    }finally{
      setAccountFormBusy(false);
    }
  }

  async function signInWithGoogle(){
    try{
      const url = new URL(window.location.href);
      url.searchParams.set('authreturn', 'google');
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: url.toString() }
      });
      if(error) throw error;
      // المتصفح هيتحول لصفحة Google تلقائيًا؛ الرجوع هيتمسك في ensureAuth عن طريق handleOAuthReturnIfAny
    }catch(e){
      console.error('Google sign-in error:', e);
      renderAccountModal(mapAuthError(e));
    }
  }

  async function signOutUser(){
    if(!confirm('هل أنت متأكد من تسجيل الخروج؟ ستحتاج إلى تسجيل الدخول مرة أخرى للوصول إلى البيانات نفسها.')) return;
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
      showToast('تم تسجيل الخروج بنجاح');
    }catch(e){
      console.error('Sign out error:', e);
      showToast('حدث خطأ أثناء تسجيل الخروج');
    }
  }

  // بتشيك لو فيه مهام من امبارح متعملتلهاش check، وتعرضها مرة واحدة بس لكل يوم
  function checkMissedTasksPopup(){
    try{
      const today = todayStr();
      if(localStorage.getItem(MISSED_POPUP_SHOWN_KEY) === today) return; // اتعرض النهاردة خلاص
      localStorage.setItem(MISSED_POPUP_SHOWN_KEY, today);

      const yesterday = addDays(today, -1);
      const yTasks = state.days[yesterday] || [];
      const missed = yTasks.filter(t => !t.done);
      if(missed.length === 0) return; // خلص كل حاجة أو مفيش مهام أصلاً، مفيش داعي نضايقه

      const listEl = document.getElementById('missedTasksList');
      if(listEl) listEl.innerHTML = missed.map(t => `<li><span class="stat-list-name">${escapeHtml(t.name)}</span></li>`).join('');
      document.getElementById('missedTasksOverlay').classList.add('open');
    }catch(e){}
  }

  function closeMissedTasksModal(){
    const el = document.getElementById('missedTasksOverlay');
    if(el) el.classList.remove('open');
  }

  function openAccountModal(){
    accountModalMode = 'save';
    renderAccountModal();
    document.getElementById('accountOverlay').classList.add('open');
  }
  function closeAccountModal(){
    try{ localStorage.setItem(FIRST_VISIT_ACCOUNT_KEY, '1'); }catch(e){}
    document.getElementById('accountOverlay').classList.remove('open');
  }

  // ===== إدارة نافذة الـ Drafts والبحث الذكي فيها =====
  function renderDraftsModal(){
    const listEl = document.getElementById('draftsModalList');
    const searchVal = normalizeArabic(draftsSearchQuery.trim());

    const filteredDrafts = searchVal 
      ? state.drafts.filter(d => normalizeArabic(d.name).includes(searchVal))
      : state.drafts;

    if(filteredDrafts.length === 0){
      listEl.innerHTML = `<div class="empty-state">لا توجد مسودات محفوظة حاليًا.</div>`;
      return;
    }

    let html = '';
    filteredDrafts.forEach(d => {
      html += `
        <div style="background: var(--paper); border: 1px solid var(--paper-line); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <span style="font-size: 0.92rem; font-weight: 700; color: var(--ink);">${highlightMatch(d.name, draftsSearchQuery)}</span>
          <div style="display: flex; gap: 6px;">
            <button class="icon-btn" data-action="restore-draft" data-id="${d.id}" title="استعادة إلى بنك المهام"><span class="material-icons">unarchive</span></button>
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
            showToast('تمت استعادة المهمة إلى بنك المهام');
          }
        } else if(action === 'delete-draft-permanently'){
          if(confirm('هل أنت متأكد من حذف هذه المسودة نهائيًا؟')){
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
        مؤقتات اليوم
      </div>
      <div class="timer-add-row">
        <input type="text" id="newTimerInput" placeholder="اسم المهمة التي ستعمل عليها..." maxlength="60" />
        <button class="timer-add-btn" id="addTimerBtn" title="ابدأ مؤقتًا جديدًا">
          <span class="material-icons">add</span>
        </button>
      </div>
    `;

    if(timers.length === 0){
      html += `<div class="timer-empty">لا توجد مؤقتات حتى الآن اليوم.<br>اكتب اسم المهمة وابدأ.</div>`;
    } else {
      html += `<div class="timer-list">`;
      timers.forEach(t => {
        const isCountdown = t.mode === 'countdown';
        const remainingMs = isCountdown ? Math.max(0, t.targetMs - getElapsedMs(t)) : getElapsedMs(t);
        const ended = isCountdown && remainingMs <= 0;
        html += `
          <div class="timer-item ${t.running ? 'running' : ''} ${ended ? 'countdown-ended' : ''}">
            <div class="timer-item-top">
              <span class="timer-name">${escapeHtml(t.name)}</span>
              ${isCountdown ? `<span class="timer-target-label"><span class="material-icons">hourglass_bottom</span>${formatHM(t.targetMs)}</span>` : ``}
              <span class="timer-status-dot"></span>
            </div>
            <div class="timer-item-bottom">
              <span class="timer-clock" id="timerClock_${t.id}">${formatElapsed(remainingMs)}</span>
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
      newInput.value = '';
      await requestNewTimer(val);
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
          ensureAudioContext();
          if(t.running){
            t.elapsedMs = getElapsedMs(t);
            t.running = false;
            t.startedAt = null;
          } else {
            if(t.mode === 'countdown' && t.elapsedMs >= t.targetMs){
              // التايمر خلص بالفعل، إعادة تشغيله تبدأ العد من الأول
              t.elapsedMs = 0;
              t.alerted = false;
            }
            t.running = true;
            t.startedAt = Date.now();
          }
          renderTimerPanel();
          await saveData();
        }
        else if(action === 'delete-timer'){
          if(confirm(`هل أنت متأكد من رغبتك في حذف المؤقت "${t.name}"؟`)){
            state.timers[selectedDate] = list.filter(x => x.id !== id);
            renderTimerPanel();
            await saveData();
          }
        }
      };
    });
  }

  /* ===== صوت التنبيه لما التايمر المحدد يخلص ===== */
  function ensureAudioContext(){
    try{
      if(!alertAudioCtx) alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if(alertAudioCtx.state === 'suspended') alertAudioCtx.resume();
    }catch(e){ /* المتصفح مايدعمش الصوت */ }
  }

  function playAlertSound(){
    try{
      ensureAudioContext();
      if(!alertAudioCtx) return;
      const ctx = alertAudioCtx;
      const now = ctx.currentTime;
      [0, 0.24, 0.48].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.28, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.22);
      });
    }catch(e){ /* تجاهل مشاكل الصوت */ }
  }

  /* ===== طلب تايمر جديد: يسأل مفتوح ولا محدد لو مفيش تايمر بنفس الاسم شغال ===== */
  async function requestNewTimer(name){
    const timers = getDayTimers(selectedDate);
    let t = timers.find(x => x.name === name);
    if(t){
      ensureAudioContext();
      if(t.running){
        showToast(`تايمر "${name}" شغال بالفعل`);
      } else {
        if(t.mode === 'countdown' && t.elapsedMs >= t.targetMs){
          t.elapsedMs = 0;
          t.alerted = false;
        }
        t.running = true;
        t.startedAt = Date.now();
        showToast(`كمّلنا تايمر "${name}"`);
      }
      renderTimerPanel();
      timerPanelRenderedForDate = selectedDate;
      await saveData();
      return;
    }
    pendingNewTimerName = name;
    const displayEl = document.getElementById('pendingTimerNameDisplay');
    if(displayEl) displayEl.textContent = `"${name}"`;
    document.getElementById('timerTypeOverlay').classList.add('open');
  }

  function closeTimerTypeModal(){
    document.getElementById('timerTypeOverlay').classList.remove('open');
    pendingNewTimerName = '';
  }

  function tickTimers(){
    const timers = state.timers[selectedDate];
    let timersChanged = false;
    if(timers){
      timers.forEach(t => {
        if(!t.running) return;
        const elapsed = getElapsedMs(t);
        const el = document.getElementById(`timerClock_${t.id}`);
        if(t.mode === 'countdown'){
          const remaining = t.targetMs - elapsed;
          if(el) el.textContent = formatElapsed(Math.max(0, remaining));
          if(remaining <= 0 && !t.alerted){
            t.alerted = true;
            t.running = false;
            t.elapsedMs = t.targetMs;
            t.startedAt = null;
            timersChanged = true;
            playAlertSound();
            showToast(`⏰ خلص وقت "${t.name}"`);
            renderTimerPanel();
            timerPanelRenderedForDate = selectedDate;
          }
        } else {
          if(el) el.textContent = formatElapsed(elapsed);
        }
      });
    }

    if(timersChanged) saveData();
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

  /* ===== بوب أب الهدف / الوقت الفعلي (بيطلع فوق الشارة، ملوش علاقة بالتايمر) ===== */
  function showDurationPopover(taskId, badgeEl){
    const task = (state.days[selectedDate] || []).find(x => x.id === taskId);
    if(!task) return;
    const targetMin = parseDurationToMinutes(task.duration);
    const targetMs = targetMin * 60000;
    const actualMin = parseDurationToMinutes(task.actualDuration);
    const actualMs = actualMin * 60000;
    const isOver = targetMs > 0 && actualMs >= targetMs;

    const pop = document.getElementById('durationPopover');
    pop.innerHTML = `
      <div class="duration-popover-row">
        <span class="duration-popover-label"><span class="material-icons">flag</span>الهدف</span>
        <span class="duration-popover-value">${formatHM(targetMs)}</span>
      </div>
      <div class="duration-popover-row ${isOver ? 'is-over' : ''}">
        <span class="duration-popover-label"><span class="material-icons">timelapse</span>الوقت الفعلي</span>
        <span class="duration-popover-value">${formatHM(actualMs)}</span>
      </div>
    `;

    pop.classList.add('open');
    const rect = badgeEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = rect.top - popRect.height - 8;
    if(top < 8) top = rect.bottom + 8; // لو مفيش مكان فوق، تظهر تحت الشارة
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    openDurationPopoverTaskId = taskId;
  }

  function hideDurationPopover(){
    const pop = document.getElementById('durationPopover');
    if(pop) pop.classList.remove('open');
    openDurationPopoverTaskId = null;
  }

  /* ===== بوب أب اختيار (الهدف / الوقت الفعلي) لما تدوس على أيقونة الساعة ===== */
  function showClockChoicePopover(taskId, anchorEl){
    const pop = document.getElementById('clockChoicePopover');
    pop.innerHTML = `
      <button class="clock-choice-btn" data-choice="target" type="button">
        <span class="material-icons">flag</span>الهدف
      </button>
      <button class="clock-choice-btn" data-choice="actual" type="button">
        <span class="material-icons">timelapse</span>الوقت الفعلي
      </button>
    `;
    pop.classList.add('open');

    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = rect.top - popRect.height - 8;
    if(top < 8) top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    openClockChoiceTaskId = taskId;

    pop.querySelector('[data-choice="target"]').onclick = () => {
      hideClockChoicePopover();
      openDurationPicker(taskId);
    };
    pop.querySelector('[data-choice="actual"]').onclick = () => {
      hideClockChoicePopover();
      openActualDurationPicker(taskId);
    };
  }

  function hideClockChoicePopover(){
    const pop = document.getElementById('clockChoicePopover');
    if(pop) pop.classList.remove('open');
    openClockChoiceTaskId = null;
  }

  function render(){
    hideDurationPopover();
    hideClockChoicePopover();
    if(statsViewOpen){
      renderStatsView();
      return;
    }
    const today = todayStr();
    const isToday = selectedDate === today;
    const isPastDay = selectedDate < today;
    const dayTasks = state.days[selectedDate] || [];
    const doneCount = dayTasks.filter(t => t.done).length;
    const totalActualMinutes = dayTasks.reduce((sum, t) => sum + parseDurationToMinutes(t.actualDuration), 0);
    const totalHoursText = totalActualMinutes > 0 ? `الوقت الفعلي: ${formatMinutes(totalActualMinutes)}` : '';

    let html = '';

    html += `<div class="day-view ${justReturnedFromStats ? 'animate-in' : ''}">`;

    html += `
      <div class="date-nav">
        <button class="nav-btn" id="prevBtn" aria-label="اليوم السابق"><span class="material-icons">chevron_right</span></button>
        <div class="date-display">
          <div class="day-name">${fmtDay(selectedDate)}</div>
          <div class="day-sub">${dayTasks.length ? `${doneCount} من ${dayTasks.length} أُنجزت${totalHoursText ? ` • ${totalHoursText}` : ''}` : 'لا توجد مهام مسجّلة لهذا اليوم'}</div>
        </div>
        <button class="nav-btn" id="nextBtn" aria-label="اليوم التالي" ${isToday ? 'disabled' : ''}><span class="material-icons">chevron_left</span></button>
      </div>
    `;
    if(!isToday){
      html += `<button class="today-btn" id="todayBtn">العودة إلى اليوم</button>`;
    }

    // Keyword Bank Section
    html += `<button class="bank-toggle" data-action="toggle-bank" type="button">
      <span class="bank-toggle-label">بنك المهام</span>
      <span class="bank-toggle-arrow ${bankOpen ? 'open' : ''}"><span class="material-icons">expand_more</span></span>
    </button>`;

    if(bankOpen || closingBank){
      html += `<div class="bank-content ${justOpenedBank ? 'animate-in' : ''} ${closingBank ? 'animate-out' : ''}">`;

      html += `
        <div class="add-row-group">
          <div class="add-row">
            <input type="text" id="newKeywordInput" placeholder="اكتب مهمة جديدة..." maxlength="80" />
            ${buildFilterDropdown('newKeywordFilterCustom', '')}
            <button class="add-btn icon-only" id="addKeywordBtn" title="إضافة مهمة"><span class="material-icons">add</span></button>
          </div>
          <div class="add-row add-row-filter">
            <input type="text" id="newFilterInput" placeholder="أضف فلتر جديد..." maxlength="40" />
            <button class="add-btn icon-only" id="addFilterBtn" title="إضافة فلتر"><span class="material-icons">add</span></button>
          </div>
        </div>
      `;

      html += `
        <div class="bank-search">
          <span class="material-icons bank-search-icon">search</span>
          <input type="text" id="bankSearchInput" placeholder="ابحث عن مهمة في البنك..." value="${escapeAttr(bankSearchQuery)}" />
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
        let emptyMsg = 'بنك المهام فارغ. أضف مهامك الأساسية أعلاه.';
        if(state.keywords.length > 0 && searchNormalized) emptyMsg = 'لا توجد نتائج مطابقة للبحث.';
        else if(state.keywords.length > 0) emptyMsg = 'لا توجد مهام في هذا الفلتر.';
        html += `<div class="empty-state">${emptyMsg}</div>`;
      } else {
        const slicedKeywords = visibleKeywords.slice(0, bankDisplayLimit);
        html += `<div class="keyword-list ${justChangedFilter ? 'animate-in' : ''}">`;
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
                <button class="add-to-day-btn ${alreadyAdded ? 'added' : ''}" data-action="add-to-day" data-name="${escapeAttr(k.name)}" ${alreadyAdded ? 'disabled' : ''} title="${alreadyAdded ? 'مُضافة بالفعل اليوم' : 'إضافة إلى مهام اليوم'}"><span class="material-icons">${alreadyAdded ? 'check' : 'add'}</span></button>
                <div class="keyword-main">
                  <span class="keyword-name" title="${escapeAttr(k.name)}">${highlightMatch(k.name, bankSearchQuery)}</span>
                  <div class="keyword-icons">
                    <button class="icon-btn" data-action="edit-keyword" data-id="${k.id}" title="تعديل في البنك"><span class="material-icons">edit</span></button>
                    <button class="icon-btn" data-action="delete-keyword" data-id="${k.id}" title="نقل إلى المسودات"><span class="material-icons">archive</span></button>
                  </div>
                </div>
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
          لا توجد مهام مُضافة لهذا اليوم.<br>
          اضغط (+) من بنك المهام أعلاه لإضافة مهمة.
        </div>
      `;
    } else {
      html += `<div class="task-list">`;
      dayTasks.forEach(t => {
        const targetMin = parseDurationToMinutes(t.duration);
        const actualMin = parseDurationToMinutes(t.actualDuration);
        const pct = targetMin > 0 ? Math.round((actualMin / targetMin) * 100) : 0;
        const barPct = Math.min(100, Math.max(0, pct));

        html += `
          <div class="task-row ${t.done?'done':''} ${(!t.done && isPastDay)?'missed':''}" draggable="true" data-drag-id="${t.id}">
            <span class="drag-handle material-icons" title="اسحب لإعادة الترتيب">drag_indicator</span>
            <div class="task-main" data-action="toggle-task" data-id="${t.id}">
              <span class="task-name" title="${escapeAttr(t.name)}">${escapeHtml(t.name)}</span>
              <div class="task-icons">
              <button class="icon-btn timer-start-btn" data-action="start-timer-from-task" data-id="${t.id}" title="ابدأ مؤقتًا لهذه المهمة">
                <span class="material-icons">play_circle_outline</span>
              </button>
              <button class="clock-btn" data-action="toggle-duration" data-id="${t.id}" title="حدد الهدف أو الوقت الفعلي">
                <span class="material-icons">schedule</span>
              </button>
              ${(t.duration || t.actualDuration) ? `
                <button class="duration-badge ${targetMin > 0 && pct >= 100 ? 'over' : ''}" id="durationBadge_${t.id}" data-action="toggle-duration-view" data-id="${t.id}" title="اضغط لعرض الهدف والوقت الفعلي">
                  ${targetMin > 0 ? `
                    <span class="duration-badge-bar"><span class="duration-badge-fill" id="taskBarFill_${t.id}" style="width:${barPct}%"></span></span>
                    <span class="duration-badge-pct" id="taskBarPct_${t.id}">${pct}%</span>
                  ` : `
                    <span class="duration-badge-actual-only"><span class="material-icons">timelapse</span>${formatHM(actualMin*60000)}</span>
                  `}
                </button>
              ` : ``}
              <button class="icon-btn" data-action="delete-task" data-id="${t.id}" title="حذف من اليوم"><span class="material-icons">delete</span></button>
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    html += `</div>`;

    contentEl.innerHTML = html;
    
    justOpenedBank = false;
    justReturnedFromStats = false;
    justChangedFilter = false;

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
        if(openClockChoiceTaskId === id){
          hideClockChoicePopover();
        } else {
          showClockChoicePopover(id, btn);
        }
      }
      else if(action === 'toggle-duration-view'){
        if(openDurationPopoverTaskId === id){
          hideDurationPopover();
        } else {
          showDurationPopover(id, btn);
        }
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
        await requestNewTimer(task.name);
      }
      else if(action === 'add-to-day'){
        const name = btn.dataset.name;
        if(!state.days[selectedDate]) state.days[selectedDate] = [];
        const exists = state.days[selectedDate].some(t => t.name === name);
        if(exists){
          showToast('هذه المهمة مُضافة بالفعل إلى جدول اليوم');
          return;
        }
        state.days[selectedDate].push({ id: uid(), name: name, done: false });
        render();
        await saveData();
        showToast('تمت الإضافة إلى مهام اليوم');
      }
      else if(action === 'select-filter'){
        const newFilter = btn.dataset.filterId;
        if(newFilter !== activeFilter) justChangedFilter = true;
        activeFilter = newFilter;
        bankDisplayLimit = 10;
        render();
      }
      else if(action === 'delete-filter'){
        if(confirm('هل أنت متأكد من رغبتك في حذف هذا الفلتر؟ ستعود المهام التابعة له بلا تصنيف (وستبقى ظاهرة ضمن الكل).')){
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
          showToast('تم نقل المهمة إلى المسودات بنجاح');
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
          showToast('هذا الفلتر موجود بالفعل');
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
    // ارسم الواجهة فورًا بحالة فاضية عشان المستخدم الجديد يشوف الصفحة على طول
    // من غير ما يستنى Turnstile + تسجيل الدخول المجهول + جلب البيانات من Supabase
    render();
    setInterval(tickTimers, 1000);

    // لأول زيارة بس: اعرض شاشة الحساب من غير ما تنتظر تحميل البيانات
    // ولو المستخدم قفلها (بأي طريقة) مش هتظهرله تاني تلقائيًا
    try{
      if(!localStorage.getItem(FIRST_VISIT_ACCOUNT_KEY)){
        openAccountModal();
      }
    }catch(e){}
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
      if(openDurationPopoverTaskId && !e.target.closest('.duration-popover') && !e.target.closest('.duration-badge')){
        hideDurationPopover();
      }
      if(openClockChoiceTaskId && !e.target.closest('.clock-choice-popover') && !e.target.closest('.clock-btn')){
        hideClockChoicePopover();
      }
    });

    document.getElementById('themeBtn').onclick = async () => {
      state.darkMode = !state.darkMode;
      document.body.classList.toggle('dark-mode', state.darkMode);
      document.getElementById('themeIcon').textContent = state.darkMode ? 'light_mode' : 'dark_mode';
      if(statsViewOpen) renderStatsView(); // نعيد رسم الشارتات بالألوان الصح لو المستخدم بيبدّل الوضع وهو فاتح شاشة الإحصائيات
      await saveData();
    };

    document.getElementById('statsBtn').onclick = () => {
      const wasOpen = statsViewOpen;
      statsViewOpen = !statsViewOpen;
      if(wasOpen) justReturnedFromStats = true;
      render();
    };

    document.getElementById('calendarBtn').onclick = openCalendarModal;
    document.getElementById('closeCalendarBtn').onclick = closeCalendarModal;
    const calendarOverlay = document.getElementById('calendarOverlay');
    calendarOverlay.addEventListener('click', (e) => {
      if(e.target === calendarOverlay) closeCalendarModal();
    });

    const closeMissedTasksBtn = document.getElementById('closeMissedTasksBtn');
    const missedTasksOverlay = document.getElementById('missedTasksOverlay');
    if(closeMissedTasksBtn && missedTasksOverlay){
      closeMissedTasksBtn.onclick = closeMissedTasksModal;
      missedTasksOverlay.addEventListener('click', (e) => {
        if(e.target === missedTasksOverlay) closeMissedTasksModal();
      });
    }
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
        showToast('تمت الإضافة إلى مهام اليوم فقط');
      } else {
        showToast('هذه المهمة موجودة بالفعل في مهام اليوم');
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
      showToast('تمت الإضافة إلى بنك المهام');
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
      showToast('تمت الإضافة إلى البنك وإلى مهام اليوم');
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

    // أحداث Modal اختيار نوع المؤقت (مفتوح / محدد)
    document.getElementById('timerTypeOpenBtn').onclick = async () => {
      if(!pendingNewTimerName) return;
      ensureAudioContext();
      getDayTimers(selectedDate).push({
        id: uid(),
        name: pendingNewTimerName,
        elapsedMs: 0,
        running: true,
        startedAt: Date.now(),
        mode: 'open'
      });
      showToast(`بدأ تايمر مفتوح لـ "${pendingNewTimerName}"`);
      closeTimerTypeModal();
      renderTimerPanel();
      timerPanelRenderedForDate = selectedDate;
      await saveData();
    };
    document.getElementById('timerTypeFixedBtn').onclick = () => {
      const name = pendingNewTimerName;
      document.getElementById('timerTypeOverlay').classList.remove('open');
      openTimerDurationPicker(name);
      pendingNewTimerName = name; // يفضل محفوظ لحد ما يتم اختيار المدة
    };
    document.getElementById('closeTimerTypeBtn').onclick = closeTimerTypeModal;
    const timerTypeOverlay = document.getElementById('timerTypeOverlay');
    timerTypeOverlay.addEventListener('click', (e) => {
      if(e.target === timerTypeOverlay) closeTimerTypeModal();
    });

    const pickerOverlay = document.getElementById('durationPickerOverlay');
    document.getElementById('pickerCancelBtn').onclick = closeDurationPicker;
    document.getElementById('pickerDoneBtn').onclick = commitDurationPicker;
    pickerOverlay.addEventListener('click', (e) => {
      if(e.target === pickerOverlay) closeDurationPicker();
    });

    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape'){
        if(statsViewOpen){ statsViewOpen = false; justReturnedFromStats = true; render(); }
        if(calendarOverlay.classList.contains('open')) closeCalendarModal();
        if(missedTasksOverlay && missedTasksOverlay.classList.contains('open')) closeMissedTasksModal();
        if(draftsOverlay.classList.contains('open')) closeDraftsModal();
        if(accountOverlay.classList.contains('open')) closeAccountModal();
        if(pickerOverlay.classList.contains('open')) closeDurationPicker();
        if(addChoiceOverlay.classList.contains('open')) closeAddChoiceModal();
        if(timerTypeOverlay.classList.contains('open')) closeTimerTypeModal();
        if(openDurationPopoverTaskId) hideDurationPopover();
        if(openClockChoiceTaskId) hideClockChoicePopover();
      }
    });

    // دلوقتي بس نحمّل البيانات الحقيقية (Turnstile + anonymous auth + Supabase) في الخلفية،
    // ولما توصل نعيد الرسم عشان تظهر مهام اليوم وبنك المهام الفعليين
    await loadData();
    timerPanelRenderedForDate = null; // نجبر لوحة التايمر تترسم تاني بالبيانات الحقيقية (كانت اترسمت فاضية قبل ما البيانات توصل)
    render();
    checkMissedTasksPopup();
  })();
})();
