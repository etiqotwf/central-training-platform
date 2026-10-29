const {parentPort,workerData}=require('worker_threads');try{parentPort.postMessage({result:require('./dqn').train(workerData)})}catch(e){parentPort.postMessage({error:e.message})}
