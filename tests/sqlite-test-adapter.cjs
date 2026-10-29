// Test only. Production still uses the project's better-sqlite3 dependency.
const {DatabaseSync}=require('node:sqlite');
const Module=require('node:module'),load=Module._load;
Module._load=function(name,...args){if(name==='better-sqlite3')return class {
 constructor(){this.db=new DatabaseSync(':memory:')}
 pragma(sql){return this.db.exec('PRAGMA '+sql)}
 exec(sql){return this.db.exec(sql)}
 prepare(sql){return this.db.prepare(sql)}
 transaction(fn){return (...params)=>{this.db.exec('BEGIN');try{const r=fn(...params);this.db.exec('COMMIT');return r}catch(e){this.db.exec('ROLLBACK');throw e}}}
 };return load.call(this,name,...args)};
