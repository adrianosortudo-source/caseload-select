import pathlib,json,urllib.request,urllib.error,sqlite3,zlib,hashlib,time,datetime,sys
ROOT=pathlib.Path(r'D:\00_Work\01_CaseLoad_Select\07_Prospects\LocalResearch\migration-20261106')
ROOT.mkdir(parents=True,exist_ok=True)
REF='ssxryjxifwiivghglqer'
TOKEN=pathlib.Path(r'C:\Users\adria\.supabase-tokens\caseload.txt').read_text().strip()
def sql(q):
 req=urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',data=json.dumps({'query':q,'read_only':True}).encode(),headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'})
 for attempt in range(3):
  try:
   with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
  except urllib.error.HTTPError as e:
   if e.code in (429,502,503,504) and attempt<2:time.sleep(3*(attempt+1));continue
   raise RuntimeError('database_read_http_'+str(e.code)) from None
  except (TimeoutError,urllib.error.URLError):
   if attempt==2:raise RuntimeError('database_read_connection_failed') from None
   time.sleep(3)
def qi(s):return '"'+s.replace('"','""')+'"'
con=sqlite3.connect(ROOT/'research.sqlite3')
con.executescript('''CREATE TABLE IF NOT EXISTS records(table_name TEXT,source_ctid TEXT,payload BLOB,md5 TEXT,PRIMARY KEY(table_name,source_ctid)); CREATE TABLE IF NOT EXISTS blocks(table_name TEXT,start_block INTEGER,end_block INTEGER,row_count INTEGER,digest TEXT,verified INTEGER DEFAULT 0,PRIMARY KEY(table_name,start_block)); CREATE TABLE IF NOT EXISTS metadata(name TEXT PRIMARY KEY,payload TEXT);''')
meta=sql("SELECT c.relname AS name,pg_relation_size(c.oid)/8192+1 AS blocks,pg_total_relation_size(c.oid) AS total_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relname LIKE 'prospect_%' OR c.relname LIKE 'gta_prospect%') ORDER BY pg_total_relation_size(c.oid)")
con.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)',('source_tables',json.dumps(meta)))
for name,q in [('columns',"SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND (table_name LIKE 'prospect_%' OR table_name LIKE 'gta_prospect%') ORDER BY table_name,ordinal_position"),('functions',"SELECT n.nspname,p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prospect_candidate_private' OR (n.nspname='public' AND p.proname LIKE '%prospect%')"),('constraints',"SELECT c.relname,conname,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname LIKE 'prospect_%' OR c.relname LIKE 'gta_prospect%')"),('indexes',"SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND (tablename LIKE 'prospect_%' OR tablename LIKE 'gta_prospect%')"),('triggers',"SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND (c.relname LIKE 'prospect_%' OR c.relname LIKE 'gta_prospect%')")]:
 if not con.execute('SELECT 1 FROM metadata WHERE name=?',(name,)).fetchone():con.execute('INSERT INTO metadata VALUES (?,?)',(name,json.dumps(sql(q))))
con.commit()
for table in meta:
 name=table['name'];qualified='public.'+qi(name)
 for start in range(0,table['blocks'],512):
  end=start+512
  if con.execute('SELECT 1 FROM blocks WHERE table_name=? AND start_block=?',(name,start)).fetchone():continue
  where=f"ctid >= '({start},0)'::tid AND ctid < '({end},0)'::tid"
  data=sql(f"SELECT coalesce(json_agg(x),'[]'::json) AS rows FROM (SELECT ctid::text AS tid,row_to_json(t)::text AS j FROM {qualified} t WHERE {where} ORDER BY ctid) x")[0]['rows']
  digest=hashlib.md5();rows=[]
  for item in data:
   raw=item['j'].encode();h=hashlib.md5(raw).hexdigest();digest.update(h.encode());rows.append((name,item['tid'],zlib.compress(raw),h))
  con.executemany('INSERT INTO records VALUES (?,?,?,?)',rows)
  con.execute('INSERT INTO blocks(table_name,start_block,end_block,row_count,digest) VALUES(?,?,?,?,?)',(name,start,end,len(rows),digest.hexdigest()));con.commit()
  if start%8192==0:print(json.dumps({'table':name,'block':start,'rows_saved':con.execute('SELECT count(*) FROM records WHERE table_name=?',(name,)).fetchone()[0]}),flush=True)
 print('EXPORTED '+name,flush=True)
for name,start,end,count,digest in con.execute('SELECT table_name,start_block,end_block,row_count,digest FROM blocks WHERE verified=0').fetchall():
 result=sql(f"SELECT count(*) AS n,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY ctid),'')) AS digest FROM public.{qi(name)} t WHERE ctid >= '({start},0)'::tid AND ctid < '({end},0)'::tid")[0]
 if result['n']!=count or result['digest']!=digest:raise RuntimeError('SOURCE_CHANGED:'+name+':'+str(start))
 con.execute('UPDATE blocks SET verified=1 WHERE table_name=? AND start_block=?',(name,start));con.commit()
for table in meta:
 name=table['name'];n=sql('SELECT count(*) n FROM public.'+qi(name))[0]['n'];local=con.execute('SELECT count(*) FROM records WHERE table_name=?',(name,)).fetchone()[0]
 if n!=local:raise RuntimeError('COUNT_MISMATCH:'+name)
print('SOURCE_HASHES_AND_COUNTS_VERIFIED',flush=True)
con.executescript("CREATE VIRTUAL TABLE IF NOT EXISTS research_search USING fts5(table_name UNINDEXED,source_ctid UNINDEXED,content,tokenize='unicode61'); DELETE FROM research_search;")
for name,tid,blob,h in con.execute("SELECT table_name,source_ctid,payload,md5 FROM records WHERE table_name IN ('prospect_research_candidate_history','gta_prospect_firms','prospect_enrichment_packages','prospect_enrichment_manifest_hold_evidence')").fetchall():
 raw=zlib.decompress(blob)
 if hashlib.md5(raw).hexdigest()!=h:raise RuntimeError('LOCAL_HASH_MISMATCH')
 con.execute('INSERT INTO research_search VALUES(?,?,?)',(name,tid,raw.decode()))
con.commit()
check=con.execute('PRAGMA integrity_check').fetchone()[0]
manifest={'state':'export_verified_local_search_ready','project':REF,'completed_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'integrity_check':check,'tables':con.execute('SELECT table_name,count(*) FROM records GROUP BY table_name').fetchall(),'source_block_hashes_verified':con.execute('SELECT count(*) FROM blocks WHERE verified=1').fetchone()[0],'search_rows':con.execute('SELECT count(*) FROM research_search').fetchone()[0],'online_data_removed':False,'portal_cutover_completed':False}
con.close()
manifest['sqlite_bytes']=(ROOT/'research.sqlite3').stat().st_size
manifest['sqlite_sha256']=hashlib.file_digest(open(ROOT/'research.sqlite3','rb'),'sha256').hexdigest()
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest),flush=True)
