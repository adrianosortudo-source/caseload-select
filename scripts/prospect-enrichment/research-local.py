import argparse,json,sqlite3,zlib,pathlib,hashlib
ROOT=pathlib.Path(__file__).resolve().parent
p=argparse.ArgumentParser(description='Search the local law-firm research archive. No network connection is used.')
p.add_argument('--root',type=pathlib.Path,default=ROOT);p.add_argument('query',nargs='?');p.add_argument('--table');p.add_argument('--id');p.add_argument('--output',type=pathlib.Path);p.add_argument('--verify',action='store_true')
a=p.parse_args();ROOT=a.root;db=sqlite3.connect('file:'+str(ROOT/'research.sqlite3')+'?mode=ro',uri=True)
if a.verify:
 n=0
 for blob,h in db.execute('SELECT payload,md5 FROM records'):
  assert hashlib.md5(zlib.decompress(blob)).hexdigest()==h,'Stored row hash mismatch';n+=1
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 print(json.dumps({'rows_verified':n,'integrity':'ok','network_used':False}));raise SystemExit
if a.id:
 matches=[]
 for table,blob in db.execute('SELECT table_name,payload FROM records WHERE table_name=?',(a.table or 'prospect_research_candidates',)):
  raw=zlib.decompress(blob).decode();row=json.loads(raw)
  if a.id in [str(row.get(k,'')) for k in ('id','candidate_id','revision_id','identity_key')]:matches.append(raw)
 result="["+",".join(matches)+"]"
 if a.output:a.output.write_text(result,encoding='utf-8');print('Saved',len(matches),'records to',str(a.output))
 else:print(result)
else:
 q=a.query or input('Search law-firm research: ').strip()
 if not q:raise SystemExit
 terms=[word for word in q.split() if any(char.isalnum() for char in word)]
 if not terms:print('Enter a firm name or research words.');raise SystemExit(1)
 safe=' AND '.join('"'+word.replace('"','""')+'"' for word in terms)
 rows=db.execute('SELECT table_name,source_ctid,substr(content,1,250) FROM research_search WHERE research_search MATCH ? LIMIT 20',(safe,)).fetchall()
 for table,tid,preview in rows:print(table,tid,preview)
 print(str(len(rows))+' results shown. Use --id with a candidate or revision ID to retrieve exact records.')
