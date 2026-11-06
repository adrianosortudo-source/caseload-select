import sqlite3,zlib,json,hashlib,pathlib
root=pathlib.Path(r'D:\00_Work\01_CaseLoad_Select\07_Prospects\LocalResearch\migration-20261106')
c=sqlite3.connect('file:'+str(root/'research.sqlite3')+'?mode=ro',uri=True)
parts=[]
for blob, in c.execute("SELECT payload FROM records WHERE table_name='prospect_research_candidate_content_chunks'"):
 r=json.loads(zlib.decompress(blob));parts.append(r)
parts.sort(key=lambda r:(r['revision_id'],r['chunk_offset']))
prev=None;n=0;chars=0;sha=None;expected=None;total=None
for r in parts:
 if r['revision_id']!=prev:
  if prev is not None:assert chars==total and sha.hexdigest()==expected
  prev=r['revision_id'];chars=0;sha=hashlib.sha256();expected=r['content_sha256'];total=r['total_characters'];n+=1
 assert r['chunk_offset']==chars and r['content_sha256']==expected and r['total_characters']==total
 sha.update(r['chunk'].encode());chars+=len(r['chunk'])
if prev is not None:assert chars==total and sha.hexdigest()==expected
receipt={'verified_revision_contents':n,'chunks':len(parts),'sha256_and_unicode_lengths':'passed'}
(root/'content-verification.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
