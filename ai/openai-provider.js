'use strict';
// Fixed endpoint: credentials and prompts never pass through the browser.
module.exports=async function generate({instructions,input,schema,maxOutput,fetchImpl=fetch}){
 const key=String(process.env.OPENAI_API_KEY||'').trim();
 if(!key)throw Object.assign(Error('أضف OPENAI_API_KEY في إعدادات الخادم أولاً.'),{status:503});
 let response;
 try{response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(55000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',store:false,instructions,input:JSON.stringify(input),max_output_tokens:maxOutput,text:{format:{type:'json_schema',name:'platform_result',strict:true,schema}}})})}catch{throw Object.assign(Error('تعذر الاتصال بخدمة الذكاء الاصطناعي. حاول لاحقاً.'),{status:502})}
 if(!response.ok){const status=response.status;throw Object.assign(Error(status===429?'حد استخدام خدمة الذكاء الاصطناعي أو رصيدها غير متاح حالياً.':status===401||status===403?'راجع مفتاح OpenAI وصلاحياته على الخادم.':'تعذر إكمال الطلب من مزود الذكاء الاصطناعي.'),{status:502})}
 const data=await response.json();const usage={input:Number(data.usage?.input_tokens)||0,output:Number(data.usage?.output_tokens)||0};
 const raw=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 try{if(data.status!=='completed'||!raw||raw.length>45000)throw Error();return {value:JSON.parse(raw),usage}}catch{throw Object.assign(Error('النتيجة لم تكتمل بصيغة صالحة. جرّب تقليل عدد الأسئلة أو حجم الطلب.'),{status:502,usage})}
};
