// ============================================================
// templates.js — مودال القوالب الجاهزة (ميزة Pro): بحث + تعديل + حذف + إضافة لليوم
// ============================================================

import { emptyStateHtml, escapeHtml, highlightMatch, normalizeArabic, uid } from './utils.js';
import { showToast, showUndoToast, state, ui, TASK_TYPES } from './state.js';
import { saveData } from './dataStore.js';
import { render } from './render.js';
import { t } from './i18n.js';
import { gateFree } from './upgrade.js';

// القوالب (state.templates) بتتشال/تتعدل هنا بس — العرض مش جزء من بنك المهام.
// بنرسم القايمة برة الـ contentEl فالـ contentActions (اللي مربوطة بـ contentEl) مش
// بتشتغل هنا؛ الأزرار بيتبقى ليها onclick مباشر (نفس نمط مودال المسودات drafts.js).
export function renderTemplatesModal(){
  const listEl = document.getElementById('templatesModalList');
  if(!listEl) return;

  const searchVal = normalizeArabic(ui.templatesSearchQuery.trim());
  const filtered = searchVal
    ? state.templates.filter(tp => normalizeArabic(tp.name).includes(searchVal))
    : state.templates;

  if(filtered.length === 0){
    listEl.innerHTML = emptyStateHtml(
      state.templates.length === 0 ? 'content_copy' : 'search_off',
      state.templates.length === 0 ? t('template.empty') : t('template.no_results'),
      state.templates.length === 0 ? t('template.add_hint') : t('template.no_results_hint')
    );
    if(state.templates.length > 0) wireSearchReset();
    return;
  }

  let html = '';
  filtered.forEach(tp => {
    if(ui.editingTemplateId === tp.id){
      html += `
        <div class="template-modal-row editing">
          <input type="text" class="edit-input template-edit-input" id="templateEditNameInput" value="${escapeHtml(tp.name)}" maxlength="80" />
          <div class="template-edit-actions">
            <button class="add-btn" id="templateEditSaveBtn" type="button"><span class="material-icons">check</span>${t('c.save')}</button>
            <button class="icon-btn" id="templateEditCancelBtn" type="button" title="${t('c.cancel')}"><span class="material-icons">close</span></button>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="template-modal-row">
          <span class="material-icons tc-${tp.type || 'task'}">${TASK_TYPES[tp.type || 'task'].icon}</span>
          <span class="template-modal-name" title="${escapeHtml(tp.name)}">${highlightMatch(tp.name, ui.templatesSearchQuery)}</span>
          <div class="template-modal-actions">
            <button class="icon-btn" data-id="${tp.id}" data-action="add" title="${t('task.add_to_today')}"><span class="material-icons">add</span></button>
            <button class="icon-btn" data-id="${tp.id}" data-action="edit" title="${t('c.edit')}"><span class="material-icons">edit</span></button>
            <button class="icon-btn" data-id="${tp.id}" data-action="delete" title="${t('template.remove')}"><span class="material-icons">delete_outline</span></button>
          </div>
        </div>
      `;
    }
  });
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
    const tpl = state.templates.find(x => x.id === conf.templateId);
    const dayTask = (state.days[ui.selectedDate] || []).find(t => t.name === conf.name);
    if(tpl && dayTask){
      if(tpl.type) dayTask.type = tpl.type; else delete dayTask.type;
      if(tpl.priority) dayTask.priority = tpl.priority; else delete dayTask.priority;
      if(tpl.duration) dayTask.duration = tpl.duration; else delete dayTask.duration;
      if(tpl.note) dayTask.note = tpl.note; else delete dayTask.note;
      if(tpl.subtasks && tpl.subtasks.length) dayTask.subtasks = tpl.subtasks.map(s => ({ id: uid(), title: s.title, done: false }));
      else delete dayTask.subtasks;
      render();
      await saveData();
      showToast(t('template.replaced_toast'));
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

function wireSearchReset(){
  const clearBtn = document.getElementById('templatesSearchClear');
  if(clearBtn) clearBtn.style.display = ui.templatesSearchQuery ? 'flex' : 'none';
}

export function openTemplatesModal(){
  if(!gateFree('templates')) return;
  ui.templatesSearchQuery = '';
  ui.editingTemplateId = null;
  const searchInput = document.getElementById('templatesSearchInput');
  if(searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('templatesSearchClear');
  if(clearBtn) clearBtn.style.display = 'none';

  renderTemplatesModal();
  document.getElementById('templatesOverlay').classList.add('open');
}

export function closeTemplatesModal(){
  ui.editingTemplateId = null;
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