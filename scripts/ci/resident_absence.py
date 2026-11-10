"""Read-only fail-closed global socket-fixture admission; never stops an agent."""
import base64,hashlib,re
SOCKET='ai.elizaresearch.alphaphone.agent.v1'
# No known-runtime marker is embedded in this helper's own argv. Read each full
# NUL-delimited cmdline directly; never depend on ps width/ARGS truncation.
PROC_SCAN="command -v base64 >/dev/null || exit 40; for p in /proc/[0-9]*; do [ -d \"$p\" ] || continue; if value=$(base64 <\"$p/cmdline\" 2>/dev/null); then printf '%s|' \"${p##*/}\"; printf '%s' \"$value\" | tr -d '\\r\\n'; printf '\\n'; else [ ! -d \"$p\" ] || exit 41; fi; done"

def require(ok,message):
 if not ok:raise RuntimeError(message)

def visibility(uid_text,groups_text,mounts):
 require(re.fullmatch(r'[0-9]+',uid_text.strip()) is not None,'Unknown diagnostic UID')
 require(re.fullmatch(r'[0-9]+(?:\s+[0-9]+)*',groups_text.strip()) is not None,'Unknown diagnostic groups')
 uid=int(uid_text);groups={int(x) for x in groups_text.split()}
 rows=[line.split() for line in mounts.splitlines() if len(line.split())>=2 and line.split()[1]=='/proc']
 require(len(rows)==1 and len(rows[0])==6 and rows[0][2]=='proc','Unknown or ambiguous proc mount')
 options=rows[0][3].split(',');values={}
 for option in options:
  key,_,value=option.partition('=');require(key not in values,'Duplicate proc mount option');values[key]=value
 require('subset' not in values,'Restricted proc subset not admitted')
 hidepid=values.get('hidepid','0');require(hidepid in ('0','off','1','noaccess','2','invisible'),'Unknown proc hidepid mode')
 gid=values.get('gid');require(gid is None or re.fullmatch(r'[0-9]+',gid) is not None,'Unknown proc visibility group')
 unrestricted=hidepid in ('0','off')
 exempt=gid is not None and int(gid) in groups
 require(uid==0 or unrestricted or exempt,'Diagnostic identity not exempt from proc hiding')
 return {'shellUid':uid,'procHidepid':hidepid,'procExemptGid':int(gid) if gid is not None else None,'visibilityBasis':'root' if uid==0 else 'unrestricted-proc' if unrestricted else 'proc-gid-membership'}

def assert_no_resident(run):
 # Prove mount visibility without enabling root or changing any privilege.
 visibility_proof=visibility(run('shell','id','-u'),run('shell','id','-G'),run('shell','cat','/proc/mounts'))
 processes=run('shell',PROC_SCAN)
 require(len(processes)<20*1024*1024,'Unexpectedly large full process inventory')
 seen=set()
 for row in processes.splitlines():
  require(re.fullmatch(r'[0-9]+\|[A-Za-z0-9+/=]*',row) is not None,'Malformed full process inventory')
  pid,encoded=row.split('|',1);require(pid not in seen,'Duplicate process inventory PID');seen.add(pid)
  try:raw=base64.b64decode(encoded,validate=True)
  except ValueError:raise RuntimeError('Invalid process inventory encoding') from None
  require(not raw or raw.endswith(b'\0'),'Partial process command line observation')
  argv=raw.replace(b'\0',b' ')
  require(not re.search(rb'agent-bundle\.(?:js|cjs)|libeliza_bun|libeliza_ld_musl|(?:^|\s)[^\s]*/files/agent/(?:bun|node)(?:\s|$)',argv),'Resident runtime process present; preserve it and refuse fixture')
 require(len(seen)>20,'Incomplete full process inventory')
 services=run('shell','dumpsys','activity','services')
 require('ACTIVITY MANAGER SERVICES' in services,'Unreadable all-user service inventory')
 require('ElizaAgentService' not in services,'Resident agent service present; refusing global socket fixture')
 sockets=run('shell','cat','/proc/net/unix')
 require(re.match(r'^Num\s+RefCount\s+Protocol\s+Flags\s+Type\s+St\s+Inode(?:\s+Path)?',sockets),'Unreadable Unix socket inventory')
 require(SOCKET not in sockets,'Resident abstract socket present; do not replace or stop it')
 return {'status':'PASS',**visibility_proof,'fullCmdlineProcessCount':len(seen),'socket':SOCKET,'servicesSha256':hashlib.sha256(services.encode()).hexdigest(),'processInventorySha256':hashlib.sha256(processes.encode()).hexdigest(),'unixInventorySha256':hashlib.sha256(sockets.encode()).hexdigest(),'scope':'visibility-qualified shell full /proc cmdline readback across users in shared Android process/network namespaces; exclusive external device lease required'}
