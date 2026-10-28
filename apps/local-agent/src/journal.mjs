import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';

/** Single-device durable reservation: ambiguous OS launches are never repeated after restart. */
export class LocalActionJournal {
  constructor(path) {
    this.db = new DatabaseSync(path);
    if(path !== ':memory:') chmodSync(path,0o600);
    this.db.exec('CREATE TABLE IF NOT EXISTS actions (key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL)');
  }
  reserve(key,payloadHash) {
    const old = this.db.prepare('SELECT payload_hash,status,result FROM actions WHERE key=?').get(key);
    if(old) return { fresh:false,payloadHash:old.payload_hash,status:old.status,result:old.result?JSON.parse(old.result):null };
    this.db.prepare('INSERT INTO actions(key,payload_hash,status,created_at) VALUES(?,?,?,?)').run(key,payloadHash,'reserved',new Date().toISOString());
    return { fresh:true,payloadHash,status:'reserved' };
  }
  finish(key,result,failed=false) { this.db.prepare('UPDATE actions SET status=?,result=? WHERE key=?').run(failed?'failed':'submitted',JSON.stringify(result),key); }
  close(){this.db.close()}
}
