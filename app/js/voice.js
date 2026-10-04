// ============================================================
// voice.js — الإدخال الصوتي (Web Speech API — مجاني ومدمج في المتصفح)
// زر الميك في صف إضافة البنك يملأ الحقل (والمستخدم يؤكد بزر + كالمعتاد)،
// وزر المساعد يملأ الشات ويبعته تلقائيًا (لغة التعرف = لغة التطبيق).
// ملاحظة: iOS Safari لا يدعم الواجهة — الزر لا يُرسم أصلًا هناك.
// ============================================================

import { showToast, ui } from './state.js';
import { getLang, t } from './i18n.js';
import { render } from './render.js';

let rec = null;
let onFinalText = null;

export function isVoiceSupported(){
  try{
    return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }catch(e){
    return false;
  }
}

// العربية الفصحى/المصرية تُفهم أفضل بلسان مصري — والواجهة تفضل فصحى كما هي
export function voiceLangTag(){
  return getLang() === 'ar' ? 'ar-EG' : 'en-US';
}

export function isVoiceListening(){
  return !!ui.voiceListening;
}

function paintAssistantMic(){
  const btn = document.getElementById('assistantMicBtn');
  if(!btn) return;
  btn.classList.toggle('listening', ui.voiceListening && ui.voiceTarget === 'assistant');
}

export function stopVoice(){
  try{
    if(rec) rec.stop();
  }catch(e){}
  rec = null;
  onFinalText = null;
  paintAssistantMic();
  if(ui.voiceListening){
    ui.voiceListening = false;
    ui.voiceTarget = null;
    render();
  }
}

// target: 'bank' (يملأ حقل الإضافة — التأكيد يدوي بزر +) | 'assistant' (يملأ ويبعت)
// onFinal: تُستدعى مرة واحدة مع النص النهائي (للبنك null، وللمساعد الإرسال)
export async function toggleVoice(target, onFinal){
  if(!isVoiceSupported()){
    showToast(t('voice.unsupported'));
    return;
  }
  if(ui.voiceListening){
    stopVoice();
    return;
  }
  // فحص العتاد أولًا: يطلع طلب إذن الميكروفون، ويكشف غيابه أو حظره أو السياق
  // غير الآمن — بدل ما ندخل التعرف ويفشل فورًا برسالة عامة
  if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(tr => { try{ tr.stop(); }catch(e){} });
    }catch(err){
      const n = err && err.name;
      if(n === 'NotFoundError' || n === 'OverconstrainedError') showToast(t('voice.no_mic'));
      else if(n === 'NotAllowedError' || n === 'SecurityError') showToast(t('voice.denied'));
      else showToast(t('voice.error'));
      return;
    }
  } else {
    showToast(t('voice.insecure'));
    return;
  }
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  try{
    rec = new Ctor();
  }catch(e){
    showToast(t('voice.error'));
    return;
  }
  onFinalText = (typeof onFinal === 'function') ? onFinal : null;
  rec.lang = voiceLangTag();
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let interim = '';
    let fin = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      const tr = (e.results[i][0] && e.results[i][0].transcript) || '';
      if(e.results[i].isFinal) fin += tr;
      else interim += tr;
    }
    const text = (fin || interim).trim();
    if(!text) return;
    if(target === 'bank'){
      // حماية الكتابة: النص في مسودة ui.addDraft عشان render طارئ ميمسحوش
      ui.addDraft = text;
      const input = document.getElementById('newKeywordInput');
      if(input) input.value = text;
    } else {
      const input = document.getElementById('assistantInput');
      if(input) input.value = text;
    }
    if(fin && onFinalText){
      const cb = onFinalText;
      onFinalText = null;
      cb(fin.trim());
    }
  };
  rec.onerror = (e) => {
    const err = e && e.error;
    stopVoice();
    // aborted = إيقاف مقصود من المستخدم، وno-speech = ضغطة بلا كلام — بلا تنبيه.
    // الباقي برسالة مخصصة: الحظر (صلاحية/متصفح حاجب) مقابل عطل الخدمة.
    if(!err || err === 'aborted' || err === 'no-speech') return;
    if(err === 'not-allowed' || err === 'service-not-allowed'){
      showToast(t('voice.denied'));
    } else {
      showToast(t('voice.net'));
    }
  };
  rec.onend = () => {
    // انتهاء طبيعي (وقفة المستخدم أو مهلة المتصفح): نثبت آخر نص ونقفل الحالة
    if(ui.voiceListening){
      ui.voiceListening = false;
      ui.voiceTarget = null;
      paintAssistantMic();
      render();
    }
  };
  ui.voiceListening = true;
  ui.voiceTarget = target;
  paintAssistantMic();
  render();
  try{
    rec.start();
  }catch(e){
    stopVoice();
    showToast(t('voice.error'));
  }
}
