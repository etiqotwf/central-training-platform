/* Platform-wide intelligence layer: deterministic signals + feedback learning + links to grounded AI. */
(()=>{
 let timer=0,seq=0,lastPage='';
 const engineLabel=e=>e.dqn?.mode==='shadow_only'?'Heuristics · Bandit · RL · DQN Shadow':'Heuristics · Bandit · RL';
 async function mount(){
  if(!window.me||!window.currentPage)return;const page=window.currentPage,root=document.querySelector('#pageContent');if(!root||root.querySelector('[data-smart-layer]'))return;
  const my=++seq;let d;try{d=await api('/intelligence/page/'+encodeURIComponent(page))}catch{return}if(my!==seq||page!==window.currentPage||!root.isConnected||root.querySelector('[data-smart-layer]'))return;
  const box=document.createElement('section');box.className='smart-layer';box.dataset.smartLayer='1';box.innerHTML=`<details ${page==='dashboard'?'open':''}><summary><span class="smart-orb">✦</span><div><b>مركز القرار الذكي · ${esc(d.label)}</b><small>${esc(engineLabel(d.engines))} · ${esc(d.decision.reason)}</small></div><em>فتح التحليل</em></summary><div class="smart-body"><div class="smart-decision"><span>${esc(d.decision.icon)}</span><div><small>التوصية الحالية</small><h3>${esc(d.decision.title)}</h3><p>${esc(d.decision.text)}</p></div></div><div class="smart-recs">${d.recommendations.map((x,i)=>`<article><b>${i+1}</b><p>${esc(x)}</p></article>`).join('')}</div><div class="smart-engines"><span class="active">Heuristic · مباشر</span><span class="${d.engines.bandit.mode==='learned'?'active':''}">Contextual Bandit · ${d.engines.bandit.mode==='learned'?'متعلم':'Warm-up'}</span><span class="active">Adaptive RL · فعّال</span><span>DQN · Shadow</span></div><div class="smart-actions"><button class="outline" data-smart-feedback="1" data-smart-action="${esc(d.decision.action)}">👍 مفيد</button><button class="outline" data-smart-feedback="-1" data-smart-action="${esc(d.decision.action)}">👎 غير مفيد</button><button class="primary" data-page="ai-assistant">✦ اسأل المساعد مع المراجع</button>${['learning-path','learning-lab'].includes(page)?'':'<button class="outline" data-page="learning-lab">مختبر التعلم المعزز</button>'}</div><p class="smart-note">القرارات الإدارية الحساسة تظل بمراجعة بشرية. DQN يعمل في وضع Shadow فقط حتى تتوافر أدلة تحقق كافية.</p></div></details>`;
  root.prepend(box);lastPage=page;
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(mount,80)}
 const root=document.querySelector('#pageContent');if(root)new MutationObserver(schedule).observe(root,{childList:true});
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-smart-feedback]');if(!b)return;const reward=Number(b.dataset.smartFeedback);try{await api('/intelligence/feedback',{method:'POST',body:JSON.stringify({page:window.currentPage,action:b.dataset.smartAction,reward})});b.parentElement.querySelectorAll('[data-smart-feedback]').forEach(x=>x.disabled=true);showMessage('تم تسجيل التقييم لتحسين اختيار التوصيات في هذه القائمة.')}catch(err){showMessage(err.message)}});
 schedule();
})();
