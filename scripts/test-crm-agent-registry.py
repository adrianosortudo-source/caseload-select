"""Runs the actual registry Lua with Lua 5.1 and synthetic Redis primitives.
Requires lupa==2.6; no network or external database is used by this script.
"""
import json
import re
from pathlib import Path
from lupa.lua51 import LuaRuntime

source = (Path(__file__).resolve().parents[1] / 'src/lib/crm-agent-registry.ts').read_text()
script = re.search(r'CRM_AGENT_REGISTRY_LUA = `([\s\S]*?)`;', source).group(1)
lua = LuaRuntime(unpack_returned_tuples=True)
db, expires, audit = {}, {}, []
now = 1_800_000_000_000

def command(cmd, *args):
    key = args[0]
    if key in expires and expires[key] <= now:
        db.pop(key, None)
    if cmd == 'GET': return db.get(key)
    if cmd == 'EXISTS': return int(key in db)
    if cmd == 'DEL': return int(db.pop(key, None) is not None)
    if cmd == 'SET':
        db[key] = args[1]
        if len(args) > 2:
            assert args[2] == 'PX'
            expires[key] = now + int(args[3])
        return 'OK'
    if cmd == 'XADD':
        assert args[1:5] == ('MAXLEN', '~', 10000, '*')
        audit.append(dict(zip(args[5::2], args[6::2])))
        return str(len(audit))
    raise AssertionError('Unexpected Redis command')

lua.globals().redis = lua.table_from({'call': command})
lua.globals().cjson = lua.table_from({
    'decode': lambda s: lua.table_from(json.loads(s)),
    'encode': lambda t: json.dumps(dict(t.items())),
})
run_lua = lua.eval('function(KEYS, ARGV) ' + script + ' end')
grant = dict(enabled=True, capability='crm_console_read_qa', origin='https://admin.caseloadselect.ca',
             version='synthetic-version-1', expiresAt=now + 86_400_000, workflowSha='a'*40)
prefix = 'agent:{crm-console-read-qa}:v1:'
checks = 0

def check(value):
    global checks
    assert value
    checks += 1

def set_grant(**changes):
    db[prefix+'grant'] = json.dumps(grant | changes)

def call(op='issue', token='hash1', previous='none', jti='jti1', run='100', rotating=False, sha='a'*40):
    keys = [prefix+k for k in ['grant', 'session:'+token, 'jti:'+jti, 'run:'+run+':1', 'audit', 'session:'+previous]]
    arg = dict(op=op, rotating=rotating, sha=sha, runId=run, runAttempt='1', jtiSha256=jti)
    value = run_lua(lua.table_from(keys), lua.table_from([json.dumps(arg), now]))
    return json.loads(value) if value else None

check(call() is None)  # missing grant
set_grant(enabled=False); check(call() is None)
set_grant(origin='https://app.caseloadselect.ca'); check(call() is None)
set_grant(expiresAt=now); check(call() is None)
set_grant(); check(call(sha='b'*40) is None)
session = call(); check(session is not None)
check(session['expiresAt'] - now == 900_000)
check(session['deadline'] - now == 3_600_000)
check(call(op='verify') is not None)
check(call(token='another', run='101') is None)  # jti replay across runs
check(call(token='another', jti='new') is None)  # second bootstrap same run
check(call(token='hash2', previous='hash1', jti='jti2', rotating=True) is None)  # early renewal
now += 600_000
check(call(token='hash2', previous='hash1', jti='jti2', rotating=True, run='102') is None)
rotated = call(token='hash2', previous='hash1', jti='jti2', rotating=True)
check(rotated is not None and rotated['deadline'] == session['deadline'])
check(call(op='verify', token='hash1') is None)  # immediate old-token invalidation
check(call(op='verify', token='hash2') is not None)
check(call(token='hash3', previous='hash1', jti='jti3', rotating=True) is None)  # concurrent rotation loser
set_grant(enabled=False); check(call(op='verify', token='hash2') is None)
set_grant(version='synthetic-version-2'); check(call(op='verify', token='hash2') is None)
set_grant(); db.pop(prefix+'session:hash2'); check(call(op='verify', token='hash2') is None)  # individual revocation
check(call(token='hash3', jti='jti3') is None)  # cannot rebootstrap after revocation
short = call(token='short', jti='short-jti', run='200'); check(short is not None)
now += 900_000; check(call(op='verify', token='short') is None)  # exact expiry
check(call(token='expired-renewal', previous='short', jti='jti4', run='200', rotating=True) is None)

# Rotate repeatedly; never extend the absolute first-issuance job deadline.
active = 'cap0'; cap = call(token=active, jti='cap0', run='300'); check(cap is not None)
for i in range(1, 6):
    now += 600_000
    nxt = 'cap'+str(i)
    cap = call(token=nxt, previous=active, jti=nxt, run='300', rotating=True)
    check(cap is not None)
    active = nxt
check(cap['expiresAt'] == cap['deadline'])
now = cap['deadline']
check(call(op='verify', token=active) is None)
check(call(token='beyond-cap', previous=active, jti='beyond-cap', run='300', rotating=True) is None)
check(call(token='cap-restart', jti='cap-restart', run='300') is None)
check(all(set(event) == {'event', 'capability', 'runId', 'runAttempt'} for event in audit))
check(not any('synthetic-secret' in str(value) for value in db.values()))
db[prefix+'grant'] = 'invalid-json'; check(call(run='400') is None)
print(f'CRM_REGISTRY_LUA_PASS ({checks} synthetic assertions, actual Lua 5.1)')
