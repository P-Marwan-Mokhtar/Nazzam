// ============================================================
// templates.js — مودال القوالب الجاهزة (ميزة Pro): بحث + تعديل + حذف + إضافة لليوم
// ============================================================

import { emptyStateHtml, escapeAttr, escapeHtml, fmtDay, highlightMatch, normalizeArabic, uid } from './utils.js';
import { showToast, showUndoToast, state, taskTypeKey, ui, TASK_TYPES } from './state.js';
import { isHHMM, saveData } from './dataStore.js';
import { render } from './render.js';
import { t } from './i18n.js';
import { gateFree, enforceTaskNameLimit } from './upgrade.js';

// القوالب (state.templates) بتتشال/تتعدل هنا بس — العرض مش جزء من بنك المهام.
// بنرسم القايمة برة الـ contentEl فالـ contentActions (اللي مربوطة بـ contentEl) مش
// بتشتغل هنا؛ الأزرار بيتبقى ليها onclick مباشر (نفس نمط مودال المسودات drafts.js).
// مزامنة فلتر صندوق البحث المدمج: اسم الحالي + علامة الخيار النشط.
// ربط الزر/الخيارات/الإغلاق الخارجي مرة واحدة بالأسفل (عناصر ثابتة).
function syncTemplatesFilterUI(){
  const label = document.getElementById('templatesFilterLabel');
  if(label) label.textContent = ui.templatesTab === 'day' ? t('template.short_days') : t('template.short_tasks');
  document.querySelectorAll('#templatesFilterMenu [data-tfilter]').forEach(b => {
    b.classList.toggle('active', (b.dataset.tfilter === 'day') === (ui.templatesTab === 'day'));
  });
}

{
  const filterBtn = document.getElementById('templatesFilterBtn');
  const filterMenu = document.getElementById('templatesFilterMenu');
  const closeMenu = () => { if(filterMenu) filterMenu.hidden = true; };
  if(filterBtn && filterMenu){
    filterBtn.onclick = (e) => {
      e.stopPropagation();
      filterMenu.hidden = !filterMenu.hidden;
      // النقر خارج القائمة المفتوحة يقفلها (مؤجلًا حتى لا تقفلها ضغطة الفتح نفسها)
      if(!filterMenu.hidden){
        setTimeout(() => {
          document.addEventListener('click', closeMenu, { once: true });
        }, 0);
      }
    };
    filterMenu.querySelectorAll('[data-tfilter]').forEach(opt => {
      opt.onclick = (e) => {
        e.stopPropagation();
        ui.templatesTab = opt.dataset.tfilter === 'day' ? 'day' : 'task';
        ui.editingTemplateId = null;
        closeMenu();
        renderTemplatesModal();
      };
    });
  }
}

export function renderTemplatesModal(){
  const listEl = document.getElementById('templatesModalList');
  if(!listEl) return;

  const searchVal = normalizeArabic(ui.templatesSearchQuery.trim());

  // صف التعديل مشترك بين النوعين (إعادة تسمية فقط) — يُبنى من مكان واحد
  const editingRowHtml = (tp) => `
    <div class="template-modal-row editing">
      <input type="text" class="edit-input template-edit-input" id="templateEditNameInput" value="${escapeHtml(tp.name)}" maxlength="80" />
      <div class="template-edit-actions">
        <button class="icon-btn" id="templateEditSaveBtn" type="button" title="${t('c.save')}"><span class="material-icons">check</span></button>
        <button class="icon-btn" id="templateEditCancelBtn" type="button" title="${t('c.cancel')}"><span class="material-icons">close</span></button>
      </div>
    </div>
  `;
  const taskRowHtml = (tp) => {
    if(ui.editingTemplateId === tp.id) return editingRowHtml(tp);
    return `
      <div class="template-modal-row">
        <span class="material-icons tc-${taskTypeKey(tp.type)}">${TASK_TYPES[taskTypeKey(tp.type)].icon}</span>
        <span class="template-modal-name" title="${escapeHtml(tp.name)}">${highlightMatch(tp.name, ui.templatesSearchQuery)}</span>
        <div class="template-modal-actions">
          <button class="icon-btn" data-id="${escapeAttr(tp.id)}" data-action="add" title="${t('task.add_to_today')}"><span class="material-icons">add</span></button>
          <button class="icon-btn" data-id="${escapeAttr(tp.id)}" data-action="edit" title="${t('c.edit')}"><span class="material-icons">edit</span></button>
          <button class="icon-btn" data-id="${escapeAttr(tp.id)}" data-action="delete" title="${t('template.remove')}"><span class="material-icons">delete_outline</span></button>
        </div>
      </div>
    `;
  };
  const dayRowHtml = (tp) => {
    if(ui.editingTemplateId === tp.id) return editingRowHtml(tp);
    const count = Array.isArray(tp.items) ? tp.items.length : 0;
    return `
      <div class="template-modal-row">
        <span class="material-icons tc-task">calendar_month</span>
        <span class="template-modal-name" title="${escapeAttr(tp.name)}">${highlightMatch(tp.name, ui.templatesSearchQuery)} <small class="template-day-count">(${count})</small></span>
        <div class="template-modal-actions">
          <button class="icon-btn" data-id="${escapeAttr(tp.id)}" data-action="apply-day" title="${t('template.apply_day')}"><span class="material-icons">event_available</span></button>
          <button class="icon-btn" data-id="${escapeAttr(tp.id)}" data-action="edit" title="${t('c.edit')}"><span class="material-icons">edit</span></button>
          <button class="icon-btn" data-id="${escapeAttr(tp.id)}" data-action="delete" title="${t('template.remove')}"><span class="material-icons">delete_outline</span></button>
        </div>
      </div>
    `;
  };
  const matchSearch = (tp) => !searchVal || normalizeArabic(tp.name || '').includes(searchVal);
  const taskTpls = state.templates.filter(tp => tp.kind !== 'day');
  const dayRoutines = state.templates.filter(tp => tp.kind === 'day');

  // تبويب واحد ظاهر فقط (قرار senior UI/UX): التبديل يصفر التعديل العالق
  // حتى لا يعلق صف تحرير من تبويب داخل تبويب آخر.
  if(ui.templatesTab !== 'day') ui.templatesTab = 'task';

  // مزامنة فلتر صندوق البحث (الاسم الحالي + علامة النشط) — تُستدعى مع كل
  // رسم لأن العناصر ثابتة في DOM. القائمة نفسها تُربط مرة واحدة بالأسفل.
  syncTemplatesFilterUI();

  let html = '';
  if(ui.templatesTab === 'day'){
    const items = dayRoutines.filter(matchSearch);
    // زر الحفظ انتقل لشريط اليوم (أيقونة جنب الفلاتر — سياق الفعل الطبيعي)،
    // فاللوحة هنا للروتينات المحفوظة فقط.
    html += items.length
      ? items.map(dayRowHtml).join('')
      : emptyStateHtml(
          dayRoutines.length === 0 ? 'calendar_month' : 'search_off',
          dayRoutines.length === 0 ? t('template.empty_days') : t('template.no_results'),
          dayRoutines.length === 0 ? t('template.add_day_hint') : t('template.no_results_hint')
        );
  } else {
    const items = taskTpls.filter(matchSearch);
    html += items.length
      ? items.map(taskRowHtml).join('')
      : emptyStateHtml(
          taskTpls.length === 0 ? 'content_copy' : 'search_off',
          taskTpls.length === 0 ? t('template.empty') : t('template.no_results'),
          taskTpls.length === 0 ? t('template.add_hint') : t('template.no_results_hint')
        );
  }
  listEl.innerHTML = html;

  const editing = ui.editingTemplateId;
  listEl.querySelectorAll('.template-modal-actions button[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if(action === 'add'){
        if(!gateFree('templates')) return;
        const tpl = state.templates.find(x => x.id === id);
        if(!tpl) return;
        if(!state.days[ui.selectedDate]) state.days[ui.selectedDate] = [];
        // لو القالب ده مضاف بالفعل في نفس اليوم → افتح نافذة استبدال
        if(state.days[ui.selectedDate].some(t => t.name === tpl.name)){
          openReplaceDialog({
            kind: 'replace-day',
            templateId: tpl.id,
            name: tpl.name,
            bodyTitle: t('template.replace_day_title', {name: tpl.name}),
            bodyHint: t('template.replace_day_hint'),
            confirmLabel: t('template.replace_day_confirm', {name: tpl.name})
          });
          return;
        }
        const newTask = { id: uid(), name: tpl.name, done: false, createdAt: Date.now() };
        // القالب قد يدخل اسمًا جديدًا — حد المهام الفريدة للمجانية
        if(!enforceTaskNameLimit(newTask.name)) return;
        if(tpl.type) newTask.type = tpl.type;
        if(tpl.priority) newTask.priority = tpl.priority;
        if(tpl.duration) newTask.duration = tpl.duration;
        if(tpl.note) newTask.note = tpl.note;
        if(tpl.subtasks && tpl.subtasks.length) newTask.subtasks = tpl.subtasks.map(s => ({ id: uid(), title: s.title, done: false }));
        state.days[ui.selectedDate].push(newTask);
        render();
        await saveData();
        showToast(t('template.used_toast'));
      } else if(action === 'edit'){
        ui.editingTemplateId = id;
        renderTemplatesModal();
        const inp = document.getElementById('templateEditNameInput');
        if(inp){ inp.focus(); inp.select(); }
      } else if(action === 'apply-day'){
        await applyDayRoutine(id);
      } else if(action === 'delete'){
        // حذف فوري + توست تراجع، متسق مع باقي حذف التطبيق
        const removedTpl = state.templates.find(x => x.id === id);
        const removedIndex = state.templates.indexOf(removedTpl);
        state.templates = state.templates.filter(x => x.id !== id);
        renderTemplatesModal();
        await saveData();
        showUndoToast(t('template.removed_toast'), async () => {
          if(removedTpl){
            const restored = [...state.templates];
            restored.splice(Math.min(removedIndex, restored.length), 0, removedTpl);
            state.templates = restored;
            renderTemplatesModal();
            await saveData();
          }
        });
      }
    };
  });

  if(editing){
    const nameInput = document.getElementById('templateEditNameInput');
    if(nameInput){
      nameInput.onkeydown = (e) => {
        if(e.key === 'Enter') document.getElementById('templateEditSaveBtn')?.click();
        if(e.key === 'Escape') document.getElementById('templateEditCancelBtn')?.click();
      };
    }
    const saveBtn = document.getElementById('templateEditSaveBtn');
    if(saveBtn) saveBtn.onclick = () => saveTemplateEdit();
    const cancelBtn = document.getElementById('templateEditCancelBtn');
    if(cancelBtn) cancelBtn.onclick = () => { ui.editingTemplateId = null; renderTemplatesModal(); };
  }
}

// فتح نافذة تأكيد استبدال القالب المكرر (فوق مودال القوالب).
function openReplaceDialog(conf){
  ui.replaceConfirm = conf;
  document.getElementById('templatesReplaceBodyTitle').textContent = conf.bodyTitle;
  document.getElementById('templatesReplaceBodyHint').textContent = conf.bodyHint;
  if(conf.confirmLabel){
    const labelEl = document.querySelector('#templatesReplaceConfirmBtn span:last-child');
    if(labelEl) labelEl.textContent = conf.confirmLabel;
  } else {
    const labelEl = document.querySelector('#templatesReplaceConfirmBtn span:last-child');
    if(labelEl) labelEl.textContent = t('template.replace_confirm');
  }
  document.getElementById('templatesReplaceOverlay').classList.add('open');
}

// إغلاق نافذة تأكيد استبدال القالب المكرر (يستخدمه إغلاق خارجي و Escape).
export function closeReplaceDialog(){
  ui.replaceConfirm = null;
  document.getElementById('templatesReplaceOverlay').classList.remove('open');
}

// تنفيذ عملية الاستبدال بعد تأكيد المستخدم في نافذة التكرار.
async function applyReplaceConfirm(){
  const conf = ui.replaceConfirm;
  if(!conf) return;
  closeReplaceDialog();

  if(conf.kind === 'replace-day'){
    // استبدال بيانات المهمة الموجودة في اليوم ببيانات القالب (نفس id المهمة)
    // مع لقطة تراجع: الاستبدال كان يمسح مهامًا فرعية/ملاحظة منجزة بلا رجعة
    const tpl = state.templates.find(x => x.id === conf.templateId);
    const dayTask = (state.days[ui.selectedDate] || []).find(t => t.name === conf.name);
    if(tpl && dayTask){
      const snapshot = JSON.parse(JSON.stringify(dayTask));
      if(tpl.type) dayTask.type = tpl.type; else delete dayTask.type;
      if(tpl.priority) dayTask.priority = tpl.priority; else delete dayTask.priority;
      if(tpl.duration) dayTask.duration = tpl.duration; else delete dayTask.duration;
      if(tpl.note) dayTask.note = tpl.note; else delete dayTask.note;
      if(tpl.subtasks && tpl.subtasks.length) dayTask.subtasks = tpl.subtasks.map(s => ({ id: uid(), title: s.title, done: false }));
      else delete dayTask.subtasks;
      render();
      await saveData();
      showUndoToast(t('template.replaced_toast'), async () => {
        const cur = state.days[ui.selectedDate] || [];
        const i = cur.findIndex(x => x.id === snapshot.id);
        if(i !== -1) cur[i] = snapshot;
        else cur.push(snapshot);
        render();
        await saveData();
      });
    }
  } else if(conf.kind === 'replace-template'){
    // استبدال بيانات القالب القديم ببيانات المهمة اللي هيتحفظ
    const oldTpl = state.templates.find(x => x.id === conf.templateId);
    if(oldTpl){
      const newData = { ...conf.newData };
      if(newData.subtasks && newData.subtasks.length){
        newData.subtasks = newData.subtasks.map(s => ({ id: uid(), title: s.title, done: false }));
      }
      Object.assign(oldTpl, newData);
      await saveData();
      showToast(t('template.replaced_toast'));
    }
  }
  renderTemplatesModal();
}

async function saveTemplateEdit(){
  const tpl = state.templates.find(x => x.id === ui.editingTemplateId);
  if(!tpl) return;
  const inp = document.getElementById('templateEditNameInput');
  const val = inp ? inp.value.trim() : '';
  if(val){
    if(state.templates.some(x => x.id !== tpl.id && normalizeArabic(x.name) === normalizeArabic(val))){
      showToast(t('template.duplicate_exists'));
      return;
    }
    if(val !== tpl.name) tpl.name = val;
  }
  ui.editingTemplateId = null;
  renderTemplatesModal();
  await saveData();
}

// حفظ مهام اليوم المعروض كقالب يوم (روتين): لقطة أسماء + خواص + أوقات الجدول.
// تُستبعد النسخ المشتقة (_dupOf) لأنها تُعاد توليدها من الأوقات عند التطبيق.
// الاسم تلقائي ("روتين السبت") وقابل لإعادة التسمية من نفس المودال
// (تدفق التعديل الموجود — لا واجهة تسمية جديدة).
export async function saveDayRoutine(){
  if(!gateFree('templates')) return;
  const date = ui.selectedDate;
  const dayList = (state.days[date] || []).filter(t => t && !t._dupOf && t.name && t.name.trim());
  if(!dayList.length){ showToast(t('template.routine_empty_day')); return; }
  // سقف عدد العناصر يطابق تعقيم الاستيراد (MAX_ROUTINE_ITEMS)
  const items = dayList.slice(0, 30).map(t => {
    const it = { name: t.name.trim() };
    if(t.type) it.type = t.type;
    if(t.priority) it.priority = t.priority;
    if(t.duration) it.duration = t.duration;
    if(isHHMM(t.startTime)) it.startTime = t.startTime;
    if(t.note) it.note = t.note;
    if(Array.isArray(t.subtasks) && t.subtasks.length){
      it.subtasks = t.subtasks.filter(s => s && s.title).map(s => ({ title: s.title }));
    }
    return it;
  });
  const base = t('template.routine_name', { date: fmtDay(date) });
  let name = base, n = 2;
  while(state.templates.some(x => normalizeArabic(x.name) === normalizeArabic(name))){ name = `${base} (${n++})`; }
  state.templates.push({ id: uid(), name, kind: 'day', items });
  renderTemplatesModal();
  await saveData();
  showToast(t('template.routine_saved'));
}

// تطبيق روتين يوم على اليوم المعروض: عناصر موقوتة (startTime) → الجدول
// الزمني تلقائيًا (نفس حقول المهمة)، والباقي → قائمة اليوم (ويلتقطها
// البانل الجانبي وحده). نفس قواعد الإضافة المفردة: تخطي الموجود بالاسم +
// فحص حد المجانية مسبقًا على كل الأسماء الجديدة (بدل مقاطعة منتصف التطبيق
// بمودال)، مع لقطة تراجع واحدة للعملية كلها.
export async function applyDayRoutine(id){
  if(!gateFree('templates')) return;
  const tpl = state.templates.find(x => x.id === id && x.kind === 'day');
  if(!tpl || !Array.isArray(tpl.items) || !tpl.items.length) return;
  const date = ui.selectedDate;
  if(!state.days[date]) state.days[date] = [];
  const dayList = state.days[date];
  const fresh = tpl.items.filter(it => it && it.name && !dayList.some(x => x.name === it.name && !x._dupOf));
  for(const it of fresh){ if(!enforceTaskNameLimit(it.name)) return; }
  const snapshot = JSON.parse(JSON.stringify(dayList));
  let added = 0;
  for(const it of fresh){
    const nt = { id: uid(), name: it.name, done: false, createdAt: Date.now() };
    if(it.type) nt.type = it.type;
    if(it.priority) nt.priority = it.priority;
    if(it.duration) nt.duration = it.duration;
    if(isHHMM(it.startTime)) nt.startTime = it.startTime;
    if(it.note) nt.note = it.note;
    if(Array.isArray(it.subtasks) && it.subtasks.length){
      nt.subtasks = it.subtasks.map(s => ({ id: uid(), title: s.title, done: false }));
    }
    dayList.push(nt);
    added++;
  }
  if(!added){ showToast(t('template.routine_all_exist')); return; }
  render();
  await saveData();
  showUndoToast(t('template.routine_applied'), async () => {
    state.days[date] = snapshot;
    render();
    await saveData();
  });
}

function wireSearchReset(){
  const clearBtn = document.getElementById('templatesSearchClear');
  if(clearBtn) clearBtn.style.display = ui.templatesSearchQuery ? 'flex' : 'none';
}

export function openTemplatesModal(){
  if(!gateFree('templates')) return;
  ui.templatesSearchQuery = '';
  ui.editingTemplateId = null;
  ui.templatesTab = 'task';
  const searchInput = document.getElementById('templatesSearchInput');
  if(searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('templatesSearchClear');
  if(clearBtn) clearBtn.style.display = 'none';

  renderTemplatesModal();
  document.getElementById('templatesOverlay').classList.add('open');
}

export function closeTemplatesModal(){
  ui.editingTemplateId = null;
  const menu = document.getElementById('templatesFilterMenu');
  if(menu) menu.hidden = true;
  document.getElementById('templatesOverlay').classList.remove('open');
}

// لما المستخدم يعمل "حفظ كقالب" لمهمة واسمها موجود كقالب بالفعل، بنفتح
// نافذة الاستبدال عشان يقرر: يبدّل القالب القديم بالبيانات الجديدة ولا يلغي.
export function openTemplateReplaceConfirm(templateId, newData, name){
  openReplaceDialog({
    kind: 'replace-template',
    templateId,
    name,
    newData,
    bodyTitle: t('template.replace_template_title', {name}),
    bodyHint: t('template.replace_template_hint'),
    confirmLabel: t('template.replace_template_confirm', {name})
  });
}

// ربط أزرار نافذة استبدال القالب المكرر (مرة واحدة عند تحميل الموديول).
{
  const overlay = document.getElementById('templatesReplaceOverlay');
  if(overlay){
    const confirmBtn = document.getElementById('templatesReplaceConfirmBtn');
    if(confirmBtn) confirmBtn.onclick = () => applyReplaceConfirm();
    const keepBtn = document.getElementById('templatesReplaceKeepBtn');
    if(keepBtn) keepBtn.onclick = () => closeReplaceDialog();
    const closeBtn = document.getElementById('templatesReplaceCloseBtn');
    if(closeBtn) closeBtn.onclick = () => closeReplaceDialog();
    overlay.addEventListener('click', (e) => {
      if(e.target === overlay) closeReplaceDialog();
    });
  }
}