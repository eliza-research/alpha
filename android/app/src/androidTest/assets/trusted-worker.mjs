// @bun
import{createHash as x,randomBytes as C,randomUUID as G,timingSafeEqual as B}from"crypto";import*as t from"fs";import{connect as ee,createServer as M}from"net";import*as h from"path";import{spawn as _}from"child_process";import{createHash as F}from"crypto";import{win32 as D}from"path";var k=`Import-Module ($PSHOME+'\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module ($PSHOME+'\\Modules\\Microsoft.PowerShell.Management\\Microsoft.PowerShell.Management.psd1') -ErrorAction Stop
Add-Type -TypeDefinition @'
// Native Windows lease security primitives; exercised by the Windows acceptance lane.
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public static class WindowsLeaseNative {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint length);
  [DllImport("advapi32.dll", SetLastError=true)] static extern uint GetSecurityInfo(IntPtr h,int kind,uint fields,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafePipeHandle CreateNamedPipe(string name,uint openMode,uint pipeMode,uint instances,uint outSize,uint inSize,uint timeout,ref SA security);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe,out uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern SafeProcessHandle OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(SafeProcessHandle process,uint access,out SafeFileHandle token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(SafeFileHandle token,int kind,IntPtr buffer,uint length,out uint needed);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(SafeProcessHandle process,out long created,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool MoveFileEx(string from,string to,uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,ref SA security,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FlushFileBuffers(SafeFileHandle file);
  [StructLayout(LayoutKind.Sequential)] struct FileInfo {
    public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME created, accessed, written;
    public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out FileInfo info);
  public sealed class DirectoryChain : IDisposable {
    readonly System.Collections.Generic.List<SafeFileHandle> handles=new System.Collections.Generic.List<SafeFileHandle>();
    public void Dispose(){for(int n=handles.Count-1;n>=0;n--)handles[n].Dispose();handles.Clear();}
    internal void Add(SafeFileHandle h){handles.Add(h);}
  }
  public static DirectoryChain LockPrivateDirectory(string directory) {return LockDirectory(directory,true);}
  static DirectoryChain LockDirectory(string directory,bool requirePrivate) {
    // Local drive paths only; reject UNC, device paths, alternate streams and lexical aliases.
    string full=Path.GetFullPath(directory);
    if(!System.Text.RegularExpressions.Regex.IsMatch(full,@"^[A-Za-z]:\\\\") || full.Substring(2).Contains(":"))throw new ArgumentException("Local drive path required");
    if(!String.Equals(full.TrimEnd('\\\\'),directory.TrimEnd('\\\\'),StringComparison.OrdinalIgnoreCase))throw new ArgumentException("Canonical path required");
    var chain=new DirectoryChain();
    try {
      string current=Path.GetPathRoot(full);
      var parts=full.Substring(current.Length).Split(new[]{'\\\\'},StringSplitOptions.RemoveEmptyEntries);
      for(int n=-1;n<parts.Length;n++) {
        if(n>=0)current=Path.Combine(current,parts[n]);
        var sa=new SA{length=Marshal.SizeOf(typeof(SA))};
        // READ_CONTROL | READ_ATTRIBUTES, shared READ/WRITE but NOT DELETE pins each ancestor identity.
        var handle=CreateFile(current,(n==parts.Length-1 && !requirePrivate)?0x60080u:0x20080u,3,ref sa,3,0x02000000|0x00200000,IntPtr.Zero);
        if(handle.IsInvalid){handle.Dispose();throw Error("Pin directory ancestor");}
        chain.Add(handle);FileInfo info;
        if(!GetFileInformationByHandle(handle,out info))throw Error("Directory identity");
        if((info.attributes&0x10)==0 || (info.attributes&0x400)!=0)throw new InvalidOperationException("Non-directory or reparse ancestor");
        if(n==parts.Length-1 && requirePrivate)VerifyPrivateHandle(handle.DangerousGetHandle());
      }
      return chain;
    } catch {chain.Dispose();throw;}
  }
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetKernelObjectSecurity(IntPtr handle,uint fields,IntPtr descriptor);
  static bool ValidateStateOwnerAndAcl(IntPtr handle) {
    IntPtr owner,group,dacl,sacl,old;uint error=GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out old);
    if(error!=0)throw new Win32Exception((int)error);
    try {
      if(dacl==IntPtr.Zero)throw new InvalidOperationException("Null state DACL");
      uint length=GetSecurityDescriptorLength(old);if(length==0||length>65536)throw new InvalidOperationException("State ACL length");byte[] bytes=new byte[length];Marshal.Copy(old,bytes,0,bytes.Length);
      var acl=new RawSecurityDescriptor(bytes,0);string sid=CurrentSid();
      bool administratorOwner=acl.Owner!=null&&acl.Owner.Value=="S-1-5-32-544";
      using(var identity=WindowsIdentity.GetCurrent()) {
        if(acl.Owner==null||(acl.Owner.Value!=sid&&!(administratorOwner&&new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))))throw new InvalidOperationException("Wrong state SID");
      }
      foreach(GenericAce entry in acl.DiscretionaryAcl){var rule=entry as CommonAce;if(rule==null||rule.IsCallback||(rule.SecurityIdentifier.Value!=sid&&rule.SecurityIdentifier.Value!="S-1-5-18"&&rule.SecurityIdentifier.Value!="S-1-5-32-544"))throw new InvalidOperationException("Untrusted existing state ACL");}
      return administratorOwner;
    } finally {LocalFree(old);}
  }
  static void ApplyPrivateState(IntPtr handle,bool normalizeOwner) {
    IntPtr sd=Descriptor();try {if(!SetKernelObjectSecurity(handle,(normalizeOwner?5u:4u)|0x80000000u,sd))throw Error("Protect state DACL");}finally{LocalFree(sd);}
    VerifyPrivateHandle(handle);
  }
  public static void ProtectExistingDirectory(string directory) {
    using(LockDirectory(directory,false)) {
      var sa=new SA{length=Marshal.SizeOf(typeof(SA))};
      // Current-SID directories need their original READ_CONTROL/WRITE_DAC rights only.
      using(var handle=CreateFile(directory,0x60080,3,ref sa,3,0x02000000|0x00200000,IntPtr.Zero)) {
        if(handle.IsInvalid)throw Error("State ACL handle");
        if(!ValidateStateOwnerAndAcl(handle.DangerousGetHandle())) {
          ApplyPrivateState(handle.DangerousGetHandle(),false);
          return;
        }
        // Only the validated enabled-administrator case requests WRITE_OWNER.
        // Keep original handle and ancestor no-delete pins while opening the mutation handle.
        FileInfo original;if(!GetFileInformationByHandle(handle,out original))throw Error("State directory identity");
        using(var ownerHandle=CreateFile(directory,0xE0080,3,ref sa,3,0x02000000|0x00200000,IntPtr.Zero)) {
          if(ownerHandle.IsInvalid)throw Error("State owner handle");
          FileInfo current;if(!GetFileInformationByHandle(ownerHandle,out current))throw Error("State owner identity");
          if(original.volume!=current.volume||original.indexHigh!=current.indexHigh||original.indexLow!=current.indexLow||(current.attributes&0x10)==0||(current.attributes&0x400)!=0)throw new InvalidOperationException("State directory changed");
          if(!ValidateStateOwnerAndAcl(ownerHandle.DangerousGetHandle()))throw new InvalidOperationException("State owner changed");
          ApplyPrivateState(ownerHandle.DangerousGetHandle(),true);
        }
      }
    }
  }
  public static byte[] ReadPrivateFile(string file,int maximum) {
    using(LockPrivateDirectory(Path.GetDirectoryName(file))) {
      var sa=new SA{length=Marshal.SizeOf(typeof(SA))};
      using(var handle=CreateFile(file,0x80020000,1,ref sa,3,0x00200000,IntPtr.Zero)) {
        if(handle.IsInvalid)throw Error("Read private file");FileInfo info;
        if(!GetFileInformationByHandle(handle,out info))throw Error("Private file identity");
        if((info.attributes&(0x10|0x400))!=0 || info.sizeHigh!=0 || info.sizeLow>maximum)throw new InvalidOperationException("Invalid private file");
        VerifyPrivateHandle(handle.DangerousGetHandle());
        using(var stream=new FileStream(handle,FileAccess.Read)){byte[] bytes=new byte[info.sizeLow];int offset=0;while(offset<bytes.Length){int n=stream.Read(bytes,offset,bytes.Length-offset);if(n==0)throw new EndOfStreamException();offset+=n;}return bytes;}
      }
    }
  }
  public static void PublishImmutableSource(string target,byte[] source) {
    if(source.Length>10*1024*1024)throw new ArgumentException("Source size");
    using(LockPrivateDirectory(Path.GetDirectoryName(target))) {
      string temporary=target+"."+Guid.NewGuid().ToString("N")+".pending";
      WriteNewPrivateFile(temporary,source);
      try {
        try {PublishNoReplace(temporary,target);} catch(Win32Exception e){if(e.NativeErrorCode!=80 && e.NativeErrorCode!=183)throw;}
        byte[] actual=ReadPrivateFile(target,10*1024*1024);
        if(actual.Length!=source.Length)throw new InvalidOperationException("Source identity mismatch");
        for(int n=0;n<source.Length;n++)if(actual[n]!=source[n])throw new InvalidOperationException("Source identity mismatch");
      } finally {if(File.Exists(temporary))File.Delete(temporary);}
    }
  }
  public static long ProcessBirth(uint pid) {
    using(var h=OpenProcess(0x1000,false,pid)){if(h.IsInvalid)throw Error("Process identity");long a,b,c,d;if(!GetProcessTimes(h,out a,out b,out c,out d))throw Error("Process times");return a;}
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CancelIoEx(SafePipeHandle pipe,IntPtr overlapped);
  static async System.Threading.Tasks.Task<T> Bound<T>(System.Threading.Tasks.Task<T> work,IDisposable resource,int milliseconds) {
    var winner=await System.Threading.Tasks.Task.WhenAny(work,System.Threading.Tasks.Task.Delay(milliseconds));
    if(winner!=work){var pipe=resource as System.IO.Pipes.PipeStream;if(pipe!=null){CancelIoEx(pipe.SafePipeHandle,IntPtr.Zero);if(await System.Threading.Tasks.Task.WhenAny(work,System.Threading.Tasks.Task.Delay(1000))!=work)resource.Dispose();}else resource.Dispose();var observed=work.ContinueWith(t=>{var ignored=t.Exception;},System.Threading.Tasks.TaskContinuationOptions.OnlyOnFaulted);throw new TimeoutException("Named pipe deadline");}
    return await work;
  }
  static async System.Threading.Tasks.Task<string> Line(System.IO.Pipes.PipeStream stream) {
    using(var bytes=new MemoryStream()) {byte[] one=new byte[1];while(bytes.Length<4096){int n=await Bound(stream.ReadAsync(one,0,1),stream,1000);if(n==0)throw new EndOfStreamException();if(one[0]==10)return new System.Text.UTF8Encoding(false,true).GetString(bytes.ToArray());bytes.WriteByte(one[0]);}throw new InvalidDataException("Pipe frame too large");}
  }
  static async System.Threading.Tasks.Task<bool> Send(System.IO.Pipes.PipeStream stream,string text) {
    byte[] bytes=System.Text.Encoding.UTF8.GetBytes(text+"\\n");if(bytes.Length>4096)throw new InvalidDataException("Pipe frame too large");await stream.WriteAsync(bytes,0,bytes.Length);return true;
  }
  static bool Hex(string text,int count){return text!=null && System.Text.RegularExpressions.Regex.IsMatch(text,"^[a-f0-9]{"+count+"}$");}
  public static async System.Threading.Tasks.Task<string> Probe(string name,uint pid,long created,string capability,string generation) {
    if(!Hex(capability,64)||!Hex(generation,32)||!System.Text.RegularExpressions.Regex.IsMatch(name,@"^eliza-workflow-[a-f0-9]{64}$"))throw new ArgumentException("Probe identity");
    var sa=new SA{length=Marshal.SizeOf(typeof(SA))};
    // SQOS identification prevents an untrusted server from impersonating this caller.
    using(var file=CreateFile(@"\\\\.\\pipe\\"+name,0xC0020000,0,ref sa,3,0x40000000|0x00100000|0x00010000,IntPtr.Zero)) {
      if(file.IsInvalid)throw Error("Connect lease pipe");
      using(var pipe=new SafePipeHandle(file.DangerousGetHandle(),false)) {
        VerifyPrivateHandle(pipe.DangerousGetHandle());VerifyPeer(pipe,true,pid,created);
        using(var stream=new System.IO.Pipes.NamedPipeClientStream(System.IO.Pipes.PipeDirection.InOut,true,true,pipe)) {
          string challenge=Guid.NewGuid().ToString("N");await Bound(Send(stream,capability+":"+challenge),stream,1000);
          string response=await Bound(Line(stream),stream,1000);
          if(response!=generation+":"+challenge)throw new InvalidDataException("Worker challenge mismatch");
          await Bound(Send(stream,"ack:"+challenge),stream,1000);return generation;
        }
      }
    }
  }
  public static async System.Threading.Tasks.Task Serve(string name,string capability,string generation,uint workerPid,long workerBirth,System.Threading.CancellationToken stop) {
    if(!Hex(capability,64)||!Hex(generation,32)||ProcessBirth(workerPid)!=workerBirth)throw new ArgumentException("Worker identity");
    using(var handle=CreatePrivatePipe(name))
    using(var stream=new System.IO.Pipes.NamedPipeServerStream(System.IO.Pipes.PipeDirection.InOut,true,false,handle)) {
      // Lifetime monitor must stop without deleting the durable reservation on worker exit.
      while(!stop.IsCancellationRequested) {
        var accept=stream.WaitForConnectionAsync();
        while(!accept.IsCompleted) {
          if(stop.IsCancellationRequested || ProcessBirth(workerPid)!=workerBirth){stream.Dispose();try{await accept;}catch{}return;}
          await System.Threading.Tasks.Task.WhenAny(accept,System.Threading.Tasks.Task.Delay(100));
        }
        await accept;
        try {
          uint peer;if(!GetNamedPipeClientProcessId(handle,out peer))throw Error("Client identity");VerifyPeer(handle,false,peer,ProcessBirth(peer));
          string frame=await Bound(Line(stream),stream,1000);string[] fields=frame.Split(':');
          if(fields.Length!=2||!Hex(fields[0],64)||!Hex(fields[1],32))throw new InvalidDataException("Challenge frame");
          int difference=0;for(int n=0;n<64;n++)difference|=fields[0][n]^capability[n];if(difference!=0)throw new InvalidDataException("Capability mismatch");
          await Bound(Send(stream,generation+":"+fields[1]),stream,1000);
          // DisconnectNamedPipe discards unread bytes. Keep the response alive
          // until the authenticated client acknowledges consumption, bounded
          // like every other frame so a stalled client cannot hold the lease.
          string acknowledgement=await Bound(Line(stream),stream,1000);
          if(acknowledgement!="ack:"+fields[1])throw new InvalidDataException("Challenge acknowledgement");
        } catch(EndOfStreamException) { /* A probe can disconnect before sending; keep the original generation. */
        } catch(InvalidDataException) { /* Reject this bounded frame without retiring the lease. */
        } catch(TimeoutException) { /* CancelIoEx settled the pending I/O; retain the original pipe instance. */
        } finally {if(stream.IsConnected)stream.Disconnect();}
      }
    }
  }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFileAttributes(string path);
  public static bool EntryExists(string path) {
    uint attributes=GetFileAttributes(path);if(attributes!=0xffffffff)return true;
    int error=Marshal.GetLastWin32Error();if(error==2)return false;throw new Win32Exception(error,"Lease entry visibility");
  }
  static Exception Error(string operation) {return new Win32Exception(Marshal.GetLastWin32Error(),operation);}
  public static string CurrentSid() {
    using(var identity=WindowsIdentity.GetCurrent()) { if(identity.User==null) throw new InvalidOperationException("Missing current SID"); return identity.User.Value; }
  }
  static IntPtr Descriptor() {
    IntPtr sd;uint size;
    // No inherited/default/Everyone/anonymous rights. SYSTEM is an explicit trusted OS principal.
    string sid=CurrentSid();
    if(!ConvertStringSecurityDescriptorToSecurityDescriptor("O:"+sid+"D:P(A;;FA;;;"+sid+")(A;;FA;;;SY)",1,out sd,out size)) throw Error("Security descriptor");
    return sd;
  }
  public static void VerifyPrivateHandle(IntPtr handle) {
    IntPtr owner,group,dacl,sacl,sd;uint error=GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out sd);
    if(error!=0) throw new Win32Exception((int)error,"GetSecurityInfo");
    try {
      if(dacl==IntPtr.Zero) throw new InvalidOperationException("Null DACL");
      uint length=GetSecurityDescriptorLength(sd);if(length==0 || length>65536) throw new InvalidOperationException("Security descriptor size");
      byte[] bytes=new byte[length];Marshal.Copy(sd,bytes,0,bytes.Length);
      var descriptor=new RawSecurityDescriptor(bytes,0);string sid=CurrentSid();
      if(descriptor.Owner==null || descriptor.Owner.Value!=sid || (descriptor.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0 || descriptor.DiscretionaryAcl==null) throw new InvalidOperationException("Untrusted owner/ACL");
      bool userRule=false;
      foreach(GenericAce ace in descriptor.DiscretionaryAcl) {
        var access=ace as CommonAce;
        if(access==null || access.IsCallback || access.AceQualifier!=AceQualifier.AccessAllowed || (access.AceFlags&AceFlags.Inherited)!=0 || (access.SecurityIdentifier.Value!=sid && access.SecurityIdentifier.Value!="S-1-5-18")) throw new InvalidOperationException("Unexpected ACL principal or rule");
        if(access.SecurityIdentifier.Value==sid) userRule=true;
      }
      if(!userRule) throw new InvalidOperationException("Current SID access absent");
    } finally {LocalFree(sd);}
  }
  public static SafePipeHandle CreatePrivatePipe(string name) {
    if(!System.Text.RegularExpressions.Regex.IsMatch(name,@"^eliza-workflow-[a-f0-9]{64}$")) throw new ArgumentException("Pipe name");
    IntPtr sd=Descriptor();
    try {
      var sa=new SA{length=Marshal.SizeOf(typeof(SA)),descriptor=sd,inherit=0};
      // DUPLEX | FIRST_PIPE_INSTANCE | OVERLAPPED; byte stream; reject remote clients; one instance.
      var handle=CreateNamedPipe(@"\\\\.\\pipe\\"+name,3|0x00080000|0x40000000,8,1,4096,4096,1000,ref sa);
      if(handle.IsInvalid){handle.Dispose();throw Error("CreateNamedPipe");}
      try {VerifyPrivateHandle(handle.DangerousGetHandle());return handle;} catch {handle.Dispose();throw;}
    } finally {LocalFree(sd);}
  }
  // Call BEFORE sending any capability. PID plus creation time and token SID prevent PID-only authentication.
  public static void VerifyPeer(SafePipeHandle pipe,bool server,uint expectedPid,long expectedCreated) {
    uint pid; bool ok=server?GetNamedPipeServerProcessId(pipe,out pid):GetNamedPipeClientProcessId(pipe,out pid);
    if(!ok) throw Error("Named pipe peer PID");
    if(pid!=expectedPid) throw new InvalidOperationException("Wrong peer PID");
    using(var process=OpenProcess(0x1000,false,pid)) {
      if(process.IsInvalid) throw Error("Peer process");
      long created,exited,kernel,user;if(!GetProcessTimes(process,out created,out exited,out kernel,out user))throw Error("Peer creation time");
      if(created!=expectedCreated)throw new InvalidOperationException("Peer PID generation changed");
      SafeFileHandle token;if(!OpenProcessToken(process,8,out token))throw Error("Peer token");
      using(token){uint needed;GetTokenInformation(token,1,IntPtr.Zero,0,out needed);if(needed==0||needed>65536)throw new InvalidOperationException("Token size");
        IntPtr buffer=Marshal.AllocHGlobal((int)needed);try {
          if(!GetTokenInformation(token,1,buffer,needed,out needed))throw Error("TokenUser");
          var sid=new SecurityIdentifier(Marshal.ReadIntPtr(buffer));if(sid.Value!=CurrentSid())throw new InvalidOperationException("Wrong peer SID");
        } finally {Marshal.FreeHGlobal(buffer);}
      }
    }
  }
  // Caller MUST hold the verified non-reparse parent chain against rename/replacement before using paths.
  // This primitive deliberately does not claim that path-based validation alone establishes that precondition.
  public static void WriteNewPrivateFile(string temporary,byte[] bytes) {
    IntPtr sd=Descriptor();try {
      var sa=new SA{length=Marshal.SizeOf(typeof(SA)),descriptor=sd,inherit=0};
      using(var handle=CreateFile(temporary,0xC0000000,1,ref sa,1,0x80000000|0x00200000,IntPtr.Zero)) {
        if(handle.IsInvalid)throw Error("CREATE_NEW private file");VerifyPrivateHandle(handle.DangerousGetHandle());
        using(var stream=new FileStream(handle,FileAccess.ReadWrite)){stream.Write(bytes,0,bytes.Length);stream.Flush();if(!FlushFileBuffers(handle))throw Error("FlushFileBuffers");}
      }
    } finally {LocalFree(sd);}
  }
  public static void PublishNoReplace(string temporary,string target) {
    // No COPY_ALLOWED or REPLACE_EXISTING: same-volume publication fails on any existing target.
    if(!MoveFileEx(temporary,target,8))throw Error("Immutable publication");
  }
}

'@
# Embedded by generate-resources.py; input and capabilities travel only over private stdin.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$inputLine=[Console]::ReadLine()
if($null -eq $inputLine -or $inputLine.Length -gt 16777216){throw 'Invalid helper input'}
$request=$inputLine|ConvertFrom-Json
$inputLine=$null
function PrivateDirectory([string]$path) {
  # Runtime creates the state directory; strengthen only an existing current-SID owned path
  # while native non-reparse ancestor handles prevent path replacement.
  [WindowsLeaseNative]::ProtectExistingDirectory($path)
}
function Emit($value){[Console]::WriteLine(($value|ConvertTo-Json -Compress -Depth 8));[Console]::Out.Flush()}
if($request.op -eq 'publish'){
  # Match the worker-root normalization below: Windows TEMP may use an 8.3 alias.
  # Reject relative/device/UNC inputs before expanding the native full path.
  if($request.path -notmatch '^[A-Za-z]:[\\\\/]'){throw 'Local drive path required'}
  $target=[IO.Path]::GetFullPath($request.path)
  PrivateDirectory ([IO.Path]::GetDirectoryName($target))
  [WindowsLeaseNative]::PublishImmutableSource($target,[Convert]::FromBase64String($request.source))
  Emit @{ok=$true};exit
}
$identity=$request.identity
$root=[IO.Path]::GetFullPath($identity.rootDir)
PrivateDirectory $root
$rootPin=[WindowsLeaseNative]::LockPrivateDirectory($root)
try {
  $hash=[Security.Cryptography.SHA256]::Create()
  try{$key=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity.runId)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  $reservation=Join-Path $root ('.windows-worker-'+$key+'.json')
  if($request.op -eq 'inspect') {
    if(-not [WindowsLeaseNative]::EntryExists($reservation)){Emit @{state='absent'};exit}
    try {
      $record=[Text.Encoding]::UTF8.GetString([WindowsLeaseNative]::ReadPrivateFile($reservation,16384))|ConvertFrom-Json
      if($record.runId -ne $identity.runId -or $record.versionId -ne $identity.versionId -or $record.sourceSha256 -ne $identity.sourceSha256){throw 'Lease identity mismatch'}
      [void][WindowsLeaseNative]::Probe($record.pipe,[uint32]$record.pid,[long]$record.created,$record.capability,$record.generation).GetAwaiter().GetResult()
      Emit @{state='live';generation=$record.generation;pid=$record.workerPid}
    } catch {
      # A canonical finish can atomically settle the record after our initial read.
      # Recheck native visibility under the pinned root; unreadable is never absent.
      $settledDuringProbe=$false
      try {$settledDuringProbe=-not [WindowsLeaseNative]::EntryExists($reservation)}catch{}
      if($settledDuringProbe){Emit @{state='absent'}}
      else {Emit @{state='unknown';reason='Windows worker reservation cannot be authenticated'}}
    }
    exit
  }
  if($request.op -ne 'acquire'){throw 'Unknown operation'}
  $generation=[Guid]::NewGuid().ToString('N')
  $capability=[byte[]]::new(32);$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($capability)}finally{$rng.Dispose()}
  $capability=([BitConverter]::ToString($capability)).Replace('-','').ToLowerInvariant()
  $pipe='eliza-workflow-'+[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  $record=@{schemaVersion=1;generation=$generation;capability=$capability;pipe=$pipe;pid=$PID;created=[WindowsLeaseNative]::ProcessBirth([uint32]$PID);workerPid=$request.workerPid;runId=$identity.runId;versionId=$identity.versionId;sourceSha256=$identity.sourceSha256}
  # CREATE_NEW is the durable exclusive reservation, including when another process starts concurrently.
  # A partial record remains unknown and must never be removed by a retry.
  [WindowsLeaseNative]::WriteNewPrivateFile($reservation,[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Compress)))
  $stop=[Threading.CancellationTokenSource]::new()
  $serving=[WindowsLeaseNative]::Serve($pipe,$capability,$generation,[uint32]$request.workerPid,[WindowsLeaseNative]::ProcessBirth([uint32]$request.workerPid),$stop.Token)
  try {
    if($serving.IsCompleted){[void]$serving.GetAwaiter().GetResult();throw 'Responder unavailable'}
    Emit @{ready=$true;generation=$generation}
    $lineTask=[Console]::In.ReadLineAsync()
    [void][Threading.Tasks.Task]::WhenAny($lineTask,$serving).GetAwaiter().GetResult()
    if(-not $lineTask.IsCompleted){throw 'Lease responder stopped'}
    $command=$lineTask.GetAwaiter().GetResult()
    if($command -eq 'finish') {
      $current=[Text.Encoding]::UTF8.GetString([WindowsLeaseNative]::ReadPrivateFile($reservation,16384))|ConvertFrom-Json
      if($current.generation -ne $generation){throw 'Reservation changed'}
      [WindowsLeaseNative]::PublishNoReplace($reservation,($reservation+'.settled-'+$generation))
      $stop.Cancel();[void]$serving.GetAwaiter().GetResult()
      Emit @{finished=$true}
    } elseif($command -ne 'abandon' -and $null -ne $command){throw 'Invalid completion command'}
    if($command -ne 'finish'){$stop.Cancel();try{[void]$serving.GetAwaiter().GetResult()}catch{}}
    # EOF/abandon/worker loss leaves the original reservation as durable unknown.
  } finally {$stop.Cancel();$stop.Dispose()}
} finally {$rootPin.Dispose()}
`;function H(e){if(/error CS\d+|Cannot add type/i.test(e))return"WINDOWS_LEASE_COMPILE";if(e.includes("Wrong state SID"))return"WINDOWS_LEASE_STATE_OWNER";if(e.includes("Untrusted existing state ACL"))return"WINDOWS_LEASE_STATE_ACL";if(/Untrusted owner\/ACL|Unexpected ACL principal or rule|Current SID access absent/.test(e))return"WINDOWS_LEASE_PRIVATE_ACL";if(e.includes("Local drive path required"))return"WINDOWS_LEASE_PATH_KIND";if(e.includes("Canonical path required"))return"WINDOWS_LEASE_PATH_CANONICAL";if(e.includes("Non-directory or reparse ancestor"))return"WINDOWS_LEASE_PATH_REPARSE";if(/Pin directory ancestor|State ACL handle|Protect state DACL/.test(e))return"WINDOWS_LEASE_DIRECTORY";if(/Helper source size|Helper source hash/.test(e))return"WINDOWS_LEASE_BOOTSTRAP";if(e.includes("Source identity mismatch"))return"WINDOWS_LEASE_SOURCE_MISMATCH";if(e.includes("CREATE_NEW private file"))return"WINDOWS_LEASE_RESERVATION";if(/Worker identity|Process identity|Process times/.test(e))return"WINDOWS_LEASE_WORKER";return"WINDOWS_LEASE_HELPER_FAILED"}function A(e){let n=new Set(["WINDOWS_LEASE_COMPILE","WINDOWS_LEASE_STATE_OWNER","WINDOWS_LEASE_STATE_ACL","WINDOWS_LEASE_PRIVATE_ACL","WINDOWS_LEASE_PATH_KIND","WINDOWS_LEASE_PATH_CANONICAL","WINDOWS_LEASE_PATH_REPARSE","WINDOWS_LEASE_DIRECTORY","WINDOWS_LEASE_BOOTSTRAP","WINDOWS_LEASE_SOURCE_MISMATCH","WINDOWS_LEASE_RESERVATION","WINDOWS_LEASE_WORKER","WINDOWS_LEASE_HELPER_FAILED","WINDOWS_LEASE_STARTUP_DEADLINE","WINDOWS_LEASE_OUTPUT_LIMIT","WINDOWS_LEASE_INVALID_RESPONSE","WINDOWS_LEASE_TRANSPORT"]),o="WINDOWS_LEASE_HELPER_FAILED";try{if(e instanceof Error&&"code"in e){let r=e.code;if(typeof r==="string"&&n.has(r))o=r}}catch{}return`Windows worker helper unavailable (${o})`}class T extends Error{code;constructor(e,n){let o=H(n);super(`Windows lease ${e} helper closed (${o})`);this.code=o}}function L(e){if(process.platform!=="win32")throw Error("Windows backend on non-Windows host");let n=process.env.SystemRoot;if(!n||!D.isAbsolute(n))throw Error("Trusted Windows installation unavailable");let r=`$ErrorActionPreference='Stop';$line=[Console]::ReadLine();if($null -eq $line -or $line.Length -gt 2097152){throw 'Helper source size'};$bytes=[Convert]::FromBase64String($line);$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($actual -ne '${F("sha256").update(k).digest("hex")}'){throw 'Helper source hash'};& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($bytes)))`,a=_(D.join(n,"System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(r,"utf16le").toString("base64")],{windowsHide:!0,stdio:["pipe","pipe","pipe"]}),s="",p,f=[],y=[],u=(d)=>{p??=d;for(let i of f.splice(0))i.reject(p)},m=()=>u(Object.assign(Error("Windows helper transport failed"),{code:"WINDOWS_LEASE_TRANSPORT"}));a.on("error",m),a.stdin.on("error",m);let w="";a.stderr.setEncoding("utf8"),a.stderr.on("data",(d)=>{if(w.length<65536)w+=d.slice(0,65536-w.length)});let S=new Promise((d,i)=>{a.once("close",(c)=>{let l=new T(e.op,w);if(w="",c===0)d();else i(p??l);u(l)})});S.catch(()=>{}),a.stdout.setEncoding("utf8"),a.stdout.on("data",(d)=>{if(s+=d,Buffer.byteLength(s)>16384){u(Object.assign(Error("Helper output limit"),{code:"WINDOWS_LEASE_OUTPUT_LIMIT"})),a.kill();return}while(s.includes(`
`)){let i=s.indexOf(`
`),c=s.slice(0,i);s=s.slice(i+1);try{let l=JSON.parse(c),g=f.shift();if(g)g.resolve(l);else y.push(l)}catch{u(Object.assign(Error("Invalid helper response"),{code:"WINDOWS_LEASE_INVALID_RESPONSE"})),a.kill()}}}),a.stdin.write(Buffer.from(k).toString("base64")+`
`+JSON.stringify(e)+`
`);async function b(){if(p)throw p;if(y.length)return y.shift();return await new Promise((d,i)=>{let c=setTimeout(()=>{u(Object.assign(Error("Helper startup deadline"),{code:"WINDOWS_LEASE_STARTUP_DEADLINE"})),a.kill()},15000);f.push({resolve:(l)=>{clearTimeout(c),d(l)},reject:(l)=>{clearTimeout(c),i(l)}})})}async function E(d){if(d)a.stdin.end(d+`
`);else a.stdin.end();let i;try{await Promise.race([S,new Promise((c,l)=>{i=setTimeout(()=>{a.kill(),l(Error("Helper drain deadline"))},5000)})])}finally{clearTimeout(i)}}return{child:a,next:b,finish:E}}var O={platform:"win32",async publishWorkflowSource(e,n){let o=L({op:"publish",path:e,source:Buffer.from(n).toString("base64")});try{if((await o.next()).ok!==!0)throw Error("Publication unconfirmed")}finally{await o.finish()}},async inspectWorkerLease(e){let n=L({op:"inspect",identity:e});try{let o=await n.next();if(o.state==="absent")return{state:"absent"};if(o.state==="live"&&typeof o.generation==="string"&&typeof o.pid==="number")return{state:"live",generation:o.generation,pid:o.pid};return{state:"unknown",reason:"Windows worker reservation unresolved"}}catch(o){return{state:"unknown",reason:A(o)}}finally{await n.finish().catch(()=>{})}},async acquireWorkerLease(e){let n=L({op:"acquire",identity:e,workerPid:process.pid}),o;try{if(o=await n.next(),o.ready!==!0||typeof o.generation!=="string")throw Error("Lease not admitted")}catch(a){throw await n.finish("abandon").catch(()=>{}),Object.assign(Error(`Windows worker admission unresolved; preserve reservation and do not replay. ${A(a)}`,{cause:a}),{code:"WORKFLOW_WORKER_UNRESOLVED"})}let r=!1;return{generation:o.generation,async finishCanonicalResult(){if(r)return;if(r=!0,n.child.stdin.write(`finish
`),(await n.next()).finished!==!0)throw Error("Lease completion unconfirmed");await n.finish()},async abandon(){if(r)return;r=!0,await n.finish("abandon")},async releaseUnstarted(){if(r)return;if(r=!0,n.child.stdin.write(`finish
`),(await n.next()).finished!==!0)throw Error("Lease release unconfirmed");await n.finish()}}}};function v(e){let n=t.openSync(e,"r");try{t.fsyncSync(n)}finally{t.closeSync(n)}}var U=(e)=>x("sha256").update(e).digest("hex");function P(e){let n=t.lstatSync(e);if(!n.isDirectory()||n.isSymbolicLink()||n.uid!==process.getuid?.()||(n.mode&63)!==0||t.realpathSync(e)!==e)throw Error("Untrusted worker lease directory");return n}function q(e){let n=t.realpathSync(e.rootDir),o=t.lstatSync(n);if(!o.isDirectory()||o.uid!==process.getuid?.())throw Error("Untrusted workflow state root");if((o.mode&18)!==0)t.chmodSync(n,o.mode&4077);let r=h.join(n,".worker-owners");try{t.mkdirSync(r,{mode:448}),v(n)}catch(a){if(a.code!=="EEXIST")throw a}return P(r),h.join(r,U(e.runId))}function N(e){P(e);let n=h.join(e,"owner.json"),o=t.lstatSync(n);if(!o.isFile()||o.isSymbolicLink()||o.uid!==process.getuid?.()||(o.mode&63)!==0||o.size>16384)throw Error("Untrusted worker identity");let r=JSON.parse(t.readFileSync(n,"utf8"));if(r.uid!==process.getuid?.()||!Number.isSafeInteger(r.pid)||r.pid<=0||typeof r.generation!=="string"||!/^\w{64}$/.test(r.capability)||typeof r.endpoint!=="string")throw Error("Invalid worker identity");return r}function V(){let e=`/proc/${process.pid}`,n=t.readFileSync(`${e}/stat`,"utf8"),o=n.lastIndexOf(")"),r=n.slice(o+2).trim().split(/\s+/)[19];if(o<0||!r||!/^\d+$/.test(r))throw Error("Invalid worker process start");let a=t.realpathSync(`${e}/exe`),s=t.openSync(`${e}/exe`,"r");try{let p=t.fstatSync(s,{bigint:!0});if(!p.isFile()||p.size>128n*1024n*1024n)throw Error("Invalid worker executable");let f=x("sha256"),y=Buffer.alloc(65536);for(;;){let u=t.readSync(s,y,0,y.length,null);if(u===0)break;f.update(y.subarray(0,u))}return{pid:process.pid,uid:process.getuid?.(),startTicks:r,executable:a,device:String(p.dev),inode:String(p.ino),sha256:f.digest("hex")}}finally{t.closeSync(s)}}async function R(e){if(process.platform==="win32")return O.acquireWorkerLease(e);let n=process.platform==="linux"&&e.sourcePath?V():void 0,o=e.sourcePath?t.realpathSync(e.sourcePath):void 0;if(o&&x("sha256").update(t.readFileSync(o)).digest("hex")!==e.sourceSha256)throw Error("Worker source identity mismatch");let r=q(e),a=t.realpathSync(e.socketRoot);P(a);let s=h.join(a,`${C(10).toString("hex")}.sock`);if(Buffer.byteLength(s)>100)throw Error("Worker socket path too long");try{t.mkdirSync(r,{mode:448}),v(h.dirname(r))}catch(i){if(i.code==="EEXIST")throw Object.assign(Error("Workflow has an existing worker or unknown outcome; no duplicate executor started"),{code:"WORKFLOW_WORKER_UNRESOLVED"});throw i}let p=h.join(r,"owner.json"),f=G(),y=C(32).toString("hex"),u=new Set,m=M((i)=>{if(u.size>=4){i.destroy();return}u.add(i);let c="",l=setTimeout(()=>i.destroy(),1000);i.on("error",()=>{}),i.once("close",()=>{clearTimeout(l),u.delete(i)}),i.on("data",(g)=>{if(c+=g,Buffer.byteLength(c)>4096){i.destroy();return}if(!c.endsWith(`
`))return;try{let I=JSON.parse(c),W=Buffer.from(String(I.capability));if(W.length!==64||!B(W,Buffer.from(y))||typeof I.challenge!=="string"||I.challenge.length>64){i.destroy();return}i.end(`${JSON.stringify({generation:f,challenge:I.challenge})}
`)}catch{i.destroy()}})}),w=async()=>{for(let i of u)i.destroy();await new Promise((i)=>m.close(()=>i()))},S,b=async()=>{if(await w(),S&&t.existsSync(s)){let i=t.lstatSync(s);if(i.dev!==S.dev||i.ino!==S.ino)throw Error("Worker endpoint replaced");t.unlinkSync(s)}t.rmSync(p,{force:!0}),t.rmdirSync(r),v(h.dirname(r))},E;try{E=P(r),await new Promise((l,g)=>{m.once("error",g),m.listen(s,l)}),S=t.lstatSync(s),t.chmodSync(s,384);let i={schemaVersion:n?2:1,...n?{nativeIdentity:n,sourcePath:o}:{},generation:f,uid:process.getuid?.(),pid:process.pid,executable:t.realpathSync(process.execPath),runId:e.runId,versionId:e.versionId,sourceSha256:e.sourceSha256,endpoint:s,capability:y},c=t.openSync(p,"wx",384);try{t.writeFileSync(c,JSON.stringify(i)),t.fsyncSync(c)}finally{t.closeSync(c)}v(r),v(h.dirname(r))}catch(i){try{await b()}catch{}throw i}let d=!1;return{generation:f,async finishCanonicalResult(){if(d)return;d=!0;let i=P(r);if(i.dev!==E.dev||i.ino!==E.ino||N(r).generation!==f)throw Error("Worker owner replaced; preserve it");let c=`${r}.settled-${f}`;t.renameSync(r,c),v(h.dirname(r));try{t.rmSync(c,{recursive:!0,force:!0}),v(h.dirname(r))}catch{}for(let l of u)l.destroy();if(await new Promise((l,g)=>m.close((I)=>I?g(I):l())),t.existsSync(s)){let l=t.lstatSync(s);if(S&&(l.dev!==S.dev||l.ino!==S.ino))throw Error("Worker endpoint replaced");t.unlinkSync(s)}},async abandon(){await w()},async releaseUnstarted(){if(d)return;d=!0;let i=P(r);if(i.dev!==E.dev||i.ino!==E.ino||N(r).generation!==f)throw Error("Worker owner replaced; preserve it");await b()}}}Object.assign(globalThis,{__elizaAcquireWorkerLease:R});

// Instrumentation-only trusted harness. Not authored workflow or a production route.
import {readFileSync,writeFileSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const payload=JSON.parse(readFileSync(process.argv[2],'utf8'));
const endpoint=new URL(payload.endpoint);
if(endpoint.hostname!=='127.0.0.1'||endpoint.protocol!=='http:'||endpoint.pathname!=='/synthetic-survivor'||!endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('Invalid synthetic endpoint');
const require=createRequire(payload.dependencyRoot+'/node_modules/smthrs/package.json');
const {runWorkflow}=await import(pathToFileURL(require.resolve('smthrs')).href);
const {Effect}=await import(pathToFileURL(require.resolve('effect')).href);
let calls=0;
globalThis.__elizaSmithers={agent:{id:'instrumentation-owned-model',generate:async()=>{
 if(payload.replay||++calls!==1)throw Error('Unexpected replay');
 // Outlast ResidentWorkflowCrashInstrumentedTest.HeldModel's 240 s hold across the resident restarts.
 const response=await fetch(endpoint,{method:'POST',headers:{'Authorization':'Bearer synthetic-resident-recovery-only','Content-Type':'application/json'},body:JSON.stringify({runId:payload.runId}),signal:AbortSignal.timeout(300000)});
 if(!response.ok)throw Error('Synthetic endpoint failed');
 const text=await response.text();if(text!==JSON.stringify({value:1}))throw Error('Synthetic response differs');return{text};
}}};
process.env.ELIZA_SMTHRS_DB_PATH=payload.rootDir+'/runs.sqlite';
if(createHash('sha256').update(readFileSync(payload.sourcePath)).digest('hex')!==payload.workerLease.sourceSha256)throw Error('Source identity differs');
const lease=await globalThis.__elizaAcquireWorkerLease(payload.workerLease);
try {
 const workflow=(await import(pathToFileURL(payload.sourcePath).href)).default;
 const result=await Effect.runPromise(runWorkflow(workflow,{runId:payload.runId,input:{},rootDir:payload.rootDir,workflowPath:payload.sourcePath}));
 if(result.status==='finished'&&result.output===undefined){
  const engineRequire=createRequire(require.resolve('@smthrs/engine/engine'));
  const {resolveSchema,__engineInternals}=await import(pathToFileURL(require.resolve('@smthrs/engine/engine')).href);
  const {loadRunOutputRowsEffect}=await import(pathToFileURL(engineRequire.resolve('@smthrs/db/snapshot')).href);
  const table=__engineInternals.resolveWorkflowOutputTable(workflow,resolveSchema(workflow.db));
  if(table)result.output=await Effect.runPromise(loadRunOutputRowsEffect(workflow.db,table,payload.runId));
 }
 if(result.status!=='finished'||calls!==(payload.replay?0:1)||!Array.isArray(result.output)||result.output.length!==1||result.output[0].value!==1||result.output[0].runId!==payload.runId||result.output[0].nodeId!=='effect'||result.output[0].iteration!==0)throw Error('Canonical output differs');
 const fd=openSync(payload.rootDir+(payload.replay?'/trusted-replay-result.json':'/trusted-result.json'),'wx',0o600);try{writeFileSync(fd,JSON.stringify({status:result.status,output:result.output,calls}));fsyncSync(fd);}finally{closeSync(fd);}
 await lease.finishCanonicalResult();
 process.exit(0);
} catch(error){await lease.abandon();throw error;}
