'use strict';
// Deterministic course plan builder. No AI provider or external service is called.
const fail=message=>{throw new Error(message)};
function buildRuleBasedPlan({courseTitle,count,hours,content,sourceTitle,level,notes,questionsPerTest=null}){
   const clean=String(content||'').replace(/\r/g,'').replace(/[ \t]+/g,' ').trim();
   const paragraphs=clean.split(/\n+/).map(x=>x.replace(/^\s*[#*\-]+\s*/,'').trim()).filter(x=>x.length>=24);
   const sentences=clean.split(/(?<=[.!؟?])\s+|\n+/).map(x=>x.trim()).filter(x=>x.length>=24);
   const units=(paragraphs.length>=count?paragraphs:sentences.length?sentences:paragraphs).slice(0,3000);
   if(!units.length)fail('لم يتم العثور على فقرات نصية كافية داخل المادة.');
   const groups=Array.from({length:count},(_,i)=>{const a=Math.floor(i*units.length/count),b=Math.floor((i+1)*units.length/count);return units.slice(a,Math.max(a+1,b))});
   const totalMinutes=Math.round(hours*60),base=Math.floor(totalMinutes/count),extra=totalMinutes%count;
   const baseLevel=String(level||'مبتدئ').includes('متقدم')?3:String(level||'').includes('متوسط')?2:1;
   const levelName=n=>n===1?'تمهيدي':n===2?'متوسط':'متقدم';
   const clip=(v,n=220)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n);
   const cleanTitle=(items,i)=>{const candidate=items.find(x=>x.length>=18&&x.length<=64)||items[0]||'';let line=clip(candidate,150).replace(/[.!؟:؛،]+$/,'');if(line.length>64)line=line.split(/\s+/).slice(0,7).join(' ');return line.length>=8?line:`المحور التدريبي ${i+1}`};
   const makeQuestions=(chosen,title,difficulty,sessionIndex)=>{
     const anchors=chosen.flatMap(x=>x.split(/(?<=[.!؟?])\s+/).map(v=>v.trim()).filter(v=>v.length>=24));if(!anchors.length)anchors.push(...chosen.filter(x=>x.length>=24));const distractorPool=units.filter(x=>!chosen.includes(x)&&x.length>=24);
     const wanted=questionsPerTest===null||questionsPerTest===undefined?(difficulty===1?2:difficulty===2?3:5):Math.max(1,Math.min(30,Number(questionsPerTest)||5));
     return Array.from({length:wanted},(_,j)=>{
       const anchor=clip(anchors[j%Math.max(1,anchors.length)]||chosen[0]||title,220);
       const distractors=[];
       for(let k=0;k<distractorPool.length&&distractors.length<2;k++){
         const candidate=clip(distractorPool[(sessionIndex*3+j+k)%distractorPool.length],220);
         if(candidate&&candidate!==anchor&&!distractors.includes(candidate))distractors.push(candidate);
       }
       while(distractors.length<2){const fallback=distractors.length===0?'هذه العبارة لا تشرح الفكرة المحددة في المقطع.':'لا توجد في هذا الاختيار معلومة تدعم موضوع السؤال.';distractors.push(fallback)}
       const opts=[anchor,...distractors],rotation=(sessionIndex+j)%opts.length,options=opts.map((_,k)=>opts[(k+rotation)%opts.length]),correct=options.indexOf(anchor);
       const prompts=difficulty===1
         ?[`بعد مذاكرتك لموضوع «${title}»، ما الفكرة الأساسية التي يوضحها المرجع؟`,`أي عبارة مما يلي تلخص معلومة صحيحة من موضوع «${title}»؟`,`أثناء مراجعتك لـ«${title}»، أي معلومة ينبغي أن تتذكرها؟`]
         :difficulty===2
         ?[`أي اختيار يربط بدقة بين الفكرة والمعلومة الواردة في «${title}»؟`,`ما التفسير الأقرب لما يوضحه المرجع في موضوع «${title}»؟`,`أي عبارة تساعدك على شرح العلاقة بين عناصر «${title}»؟`]
         :[`استنادًا إلى تفاصيل المرجع في «${title}»، أي استنتاج تدعمه المعلومات الواردة؟`,`إذا طبّقت ما ذاكرته عن «${title}»، فأي تفسير يظل متسقًا مع المرجع؟`,`أي اختيار يقدم قراءة أدق للمعلومة الواردة في «${title}»؟`];
       return {text:prompts[j%prompts.length],options,correct,skill:difficulty===1?'تذكر وفهم المعلومة':difficulty===2?'الفهم والربط بين الأفكار':'تحليل المعلومة واختيار الاستنتاج المدعوم'};
     });
   };
   const sessions=groups.map((items,i)=>{
     const chosen=items.length?items:[units[Math.min(units.length-1,i%units.length)]];
     const title=cleanTitle(chosen,i),secondPool=chosen.length>1?chosen.slice(1):units.filter(x=>!chosen.includes(x)).slice(0,1),secondTopic=secondPool.length?cleanTitle(secondPool,i+1):title;
     const difficulty=Math.min(3,baseLevel+Math.min(2,Math.floor((i*3)/count)));
     const topics=chosen.slice(0,6).map(x=>clip(x,180));
     const objective=`أن تتمكن من شرح «${title}» بلغتك، وتحديد فكرته الأساسية وربطها بالمعلومات الواردة في المرجع.`;
     const task=difficulty===1
       ?`مهمتك: اشرح بأسلوبك موضوع «${title}» في 5 إلى 7 جمل. وضّح الفكرة الأساسية، ثم اذكر مثالًا بسيطًا من واقعك يبيّن أنك فهمتها.\n\nما ستسلّمه: شرحك المكتوب ومثالك التطبيقي.\nمعيار الإنجاز: وضوح الشرح، صحة الفكرة، وارتباط المثال بالموضوع.`
       :difficulty===2
       ?`مهمتك: اشرح «${title}» بأسلوبك، ثم اربطه بموضوع «${secondTopic}» أو بأحد المفاهيم الواردة في الجلسة. قارن بين الفكرتين، ووضّح متى تكون كل واحدة مفيدة.\n\nما ستسلّمه: شرح منظم ومقارنة قصيرة مدعومة بنقطتين من المرجع.\nمعيار الإنجاز: دقة الفهم، جودة الربط، والاستشهاد بمعلومات من المادة.`
       :`مهمتك: حلّل «${title}» وطبّق ما تعلمته على موقف عملي من اختيارك. اشرح خطواتك، وبيّن لماذا اخترت هذا التطبيق، ثم ناقش نتيجة محتملة أو خطأ قد يحدث وكيف تتجنبه.\n\nما ستسلّمه: تحليل منظم، تطبيق عملي، وتبرير لقراراتك.\nمعيار الإنجاز: عمق التحليل، صحة التطبيق، وقوة التبرير اعتمادًا على المرجع.`;
     const assignment=difficulty===1
       ?`واجب المذاكرة قبل الجلسة التالية: ذاكر موضوع «${title}» من المرجع. اكتب ملخصًا من 5 نقاط، وحدد 3 مصطلحات أو أفكار أساسية، واكتب بجانب كل واحدة شرحًا مبسطًا لها. أحضر سؤالًا واحدًا تريد مناقشته.`
       :difficulty===2
       ?`واجب المذاكرة قبل الجلسة التالية: راجع «${title}» و«${secondTopic}». أعد جدول مقارنة يوضح أوجه التشابه والاختلاف، ثم اكتب مثالًا يشرح العلاقة بينهما. استعد لشرح اختيارك في بداية الجلسة القادمة.`
       :`واجب المذاكرة قبل الجلسة التالية: ذاكر «${title}» بتركيز، واستخرج من المرجع فكرتين يمكن تطبيقهما عمليًا. اكتب حالة أو مشكلة واقعية، ثم وضّح كيف ستستخدم الفكرتين لمعالجتها وما حدود هذا الحل.`;
     const excerpt=chosen.join('\n').slice(0,5200);
     return {title,objectives:[objective,`أن تقدم دليلًا عمليًا على فهمك للمحور في صورة شرح أو تطبيق مناسب لمستوى ${levelName(difficulty)}.`],topics,instructor_notes:`دليل المحاضر للجلسة ${i+1} — المصدر: ${sourceTitle||courseTitle}\n\nالمحتوى المرجعي الموزع على الجلسة:\n${excerpt}\n\nالهدف من الجلسة: ${objective}\nمستوى التدرج: ${levelName(difficulty)}. ابدأ بالمفاهيم الأساسية، ثم انتقل إلى الشرح والتطبيق وفق مستوى الجلسة.`,duration_minutes:base+(i<extra?1:0),difficulty:levelName(difficulty),learning_goal:objective,task,assignment,questions:makeQuestions(chosen,title,difficulty,i)};
   });
   return {summary:`برنامج «${courseTitle}» مبني على ${sourceTitle||'المادة العلمية'}، مع تدرج تلقائي من ${levelName(baseLevel)} إلى مستويات أعلى بحسب ترتيب الجلسات. لكل جلسة شرح للمحاضر، مهمة ينجزها المتدرب بنفسه، واجب مذاكرة، واختبار قصير ${questionsPerTest===null||questionsPerTest===undefined?'من 2 أو 3 أو 5 أسئلة وفق مستوى الصعوبة':`من ${Math.max(1,Math.min(30,Number(questionsPerTest)||5))} سؤالًا حسب العدد المحدد`}. هذا تنظيم قائم على قواعد برمجية ومحتوى المصدر، وليس توليدًا بنموذج ذكاء اصطناعي. ${notes?`ملاحظات الإدارة: ${String(notes).slice(0,500)}`:''}`,total_hours:Number((totalMinutes/60).toFixed(2)),sessions};
 }

module.exports=buildRuleBasedPlan;
