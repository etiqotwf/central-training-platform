'use strict';
const {parentPort,workerData}=require('worker_threads');
(async()=>{const bytes=Buffer.from(workerData.data,'base64');let text='';if(workerData.ext==='txt')text=bytes.toString('utf8');if(workerData.ext==='docx')text=(await require('mammoth').extractRawText({buffer:bytes})).value;if(workerData.ext==='pdf'){const r=await require('pdf-parse')(bytes);if(r.numpages>50)throw Error('too many pages');text=r.text}if(text.length>40000)throw Error('too long');parentPort.postMessage({text})})().catch(()=>parentPort.postMessage({error:true}));
