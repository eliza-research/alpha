// @bun
import{createHash as L,randomBytes as O,randomUUID as F,timingSafeEqual as H}from"crypto";import*as t from"fs";import{connect as ie,createServer as G}from"net";import*as y from"path";import{spawn as N}from"child_process";import{createHash as R}from"crypto";import{win32 as A}from"path";var b=`Import-Module ($PSHOME+'\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
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
`;function _(e){if(/error CS\d+|Cannot add type/i.test(e))return"WINDOWS_LEASE_COMPILE";if(e.includes("Wrong state SID"))return"WINDOWS_LEASE_STATE_OWNER";if(e.includes("Untrusted existing state ACL"))return"WINDOWS_LEASE_STATE_ACL";if(/Untrusted owner\/ACL|Unexpected ACL principal or rule|Current SID access absent/.test(e))return"WINDOWS_LEASE_PRIVATE_ACL";if(e.includes("Local drive path required"))return"WINDOWS_LEASE_PATH_KIND";if(e.includes("Canonical path required"))return"WINDOWS_LEASE_PATH_CANONICAL";if(e.includes("Non-directory or reparse ancestor"))return"WINDOWS_LEASE_PATH_REPARSE";if(/Pin directory ancestor|State ACL handle|Protect state DACL/.test(e))return"WINDOWS_LEASE_DIRECTORY";if(/Helper source size|Helper source hash/.test(e))return"WINDOWS_LEASE_BOOTSTRAP";if(e.includes("Source identity mismatch"))return"WINDOWS_LEASE_SOURCE_MISMATCH";if(e.includes("CREATE_NEW private file"))return"WINDOWS_LEASE_RESERVATION";if(/Worker identity|Process identity|Process times/.test(e))return"WINDOWS_LEASE_WORKER";return"WINDOWS_LEASE_HELPER_FAILED"}function T(e){let n=new Set(["WINDOWS_LEASE_COMPILE","WINDOWS_LEASE_STATE_OWNER","WINDOWS_LEASE_STATE_ACL","WINDOWS_LEASE_PRIVATE_ACL","WINDOWS_LEASE_PATH_KIND","WINDOWS_LEASE_PATH_CANONICAL","WINDOWS_LEASE_PATH_REPARSE","WINDOWS_LEASE_DIRECTORY","WINDOWS_LEASE_BOOTSTRAP","WINDOWS_LEASE_SOURCE_MISMATCH","WINDOWS_LEASE_RESERVATION","WINDOWS_LEASE_WORKER","WINDOWS_LEASE_HELPER_FAILED","WINDOWS_LEASE_STARTUP_DEADLINE","WINDOWS_LEASE_OUTPUT_LIMIT","WINDOWS_LEASE_INVALID_RESPONSE","WINDOWS_LEASE_TRANSPORT"]),r="WINDOWS_LEASE_HELPER_FAILED";try{if(e instanceof Error&&"code"in e){let i=e.code;if(typeof i==="string"&&n.has(i))r=i}}catch{}return`Windows worker helper unavailable (${r})`}class W extends Error{code;constructor(e,n){let r=_(n);super(`Windows lease ${e} helper closed (${r})`);this.code=r}}function k(e){if(process.platform!=="win32")throw Error("Windows backend on non-Windows host");let n=process.env.SystemRoot;if(!n||!A.isAbsolute(n))throw Error("Trusted Windows installation unavailable");let i=`$ErrorActionPreference='Stop';$line=[Console]::ReadLine();if($null -eq $line -or $line.Length -gt 2097152){throw 'Helper source size'};$bytes=[Convert]::FromBase64String($line);$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($actual -ne '${R("sha256").update(b).digest("hex")}'){throw 'Helper source hash'};& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($bytes)))`,a=N(A.join(n,"System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(i,"utf16le").toString("base64")],{windowsHide:!0,stdio:["pipe","pipe","pipe"]}),l="",f,g=[],c=[],p=(o)=>{f??=o;for(let s of g.splice(0))s.reject(f)},w=()=>p(Object.assign(Error("Windows helper transport failed"),{code:"WINDOWS_LEASE_TRANSPORT"}));a.on("error",w),a.stdin.on("error",w);let S="";a.stderr.setEncoding("utf8"),a.stderr.on("data",(o)=>{if(S.length<65536)S+=o.slice(0,65536-S.length)});let v=new Promise((o,s)=>{a.once("close",(d)=>{let u=new W(e.op,S);if(S="",d===0)o();else s(f??u);p(u)})});v.catch(()=>{}),a.stdout.setEncoding("utf8"),a.stdout.on("data",(o)=>{if(l+=o,Buffer.byteLength(l)>16384){p(Object.assign(Error("Helper output limit"),{code:"WINDOWS_LEASE_OUTPUT_LIMIT"})),a.kill();return}while(l.includes(`
`)){let s=l.indexOf(`
`),d=l.slice(0,s);l=l.slice(s+1);try{let u=JSON.parse(d),h=g.shift();if(h)h.resolve(u);else c.push(u)}catch{p(Object.assign(Error("Invalid helper response"),{code:"WINDOWS_LEASE_INVALID_RESPONSE"})),a.kill()}}}),a.stdin.write(Buffer.from(b).toString("base64")+`
`+JSON.stringify(e)+`
`);async function m(){if(f)throw f;if(c.length)return c.shift();return await new Promise((o,s)=>{let d=setTimeout(()=>{p(Object.assign(Error("Helper startup deadline"),{code:"WINDOWS_LEASE_STARTUP_DEADLINE"})),a.kill()},15000);g.push({resolve:(u)=>{clearTimeout(d),o(u)},reject:(u)=>{clearTimeout(d),s(u)}})})}async function P(o){if(o)a.stdin.end(o+`
`);else a.stdin.end();let s;try{await Promise.race([v,new Promise((d,u)=>{s=setTimeout(()=>{a.kill(),u(Error("Helper drain deadline"))},5000)})])}finally{clearTimeout(s)}}return{child:a,next:m,finish:P}}var D={platform:"win32",async publishWorkflowSource(e,n){let r=k({op:"publish",path:e,source:Buffer.from(n).toString("base64")});try{if((await r.next()).ok!==!0)throw Error("Publication unconfirmed")}finally{await r.finish()}},async inspectWorkerLease(e){let n=k({op:"inspect",identity:e});try{let r=await n.next();if(r.state==="absent")return{state:"absent"};if(r.state==="live"&&typeof r.generation==="string"&&typeof r.pid==="number")return{state:"live",generation:r.generation,pid:r.pid};return{state:"unknown",reason:"Windows worker reservation unresolved"}}catch(r){return{state:"unknown",reason:T(r)}}finally{await n.finish().catch(()=>{})}},async acquireWorkerLease(e){let n=k({op:"acquire",identity:e,workerPid:process.pid}),r;try{if(r=await n.next(),r.ready!==!0||typeof r.generation!=="string")throw Error("Lease not admitted")}catch(a){throw await n.finish("abandon").catch(()=>{}),Object.assign(Error(`Windows worker admission unresolved; preserve reservation and do not replay. ${T(a)}`,{cause:a}),{code:"WORKFLOW_WORKER_UNRESOLVED"})}let i=!1;return{generation:r.generation,async finishCanonicalResult(){if(i)return;if(i=!0,n.child.stdin.write(`finish
`),(await n.next()).finished!==!0)throw Error("Lease completion unconfirmed");await n.finish()},async abandon(){if(i)return;i=!0,await n.finish("abandon")}}}};function E(e){let n=t.openSync(e,"r");try{t.fsyncSync(n)}finally{t.closeSync(n)}}var B=(e)=>L("sha256").update(e).digest("hex");function I(e){let n=t.lstatSync(e);if(!n.isDirectory()||n.isSymbolicLink()||n.uid!==process.getuid?.()||(n.mode&63)!==0||t.realpathSync(e)!==e)throw Error("Untrusted worker lease directory");return n}function M(e){let n=t.realpathSync(e.rootDir),r=t.lstatSync(n);if(r.uid!==process.getuid?.()||(r.mode&18)!==0)throw Error("Untrusted workflow state root");let i=y.join(n,".worker-owners");try{t.mkdirSync(i,{mode:448}),E(n)}catch(a){if(a.code!=="EEXIST")throw a}return I(i),y.join(i,B(e.runId))}function U(e){I(e);let n=y.join(e,"owner.json"),r=t.lstatSync(n);if(!r.isFile()||r.isSymbolicLink()||r.uid!==process.getuid?.()||(r.mode&63)!==0||r.size>16384)throw Error("Untrusted worker identity");let i=JSON.parse(t.readFileSync(n,"utf8"));if(i.uid!==process.getuid?.()||!Number.isSafeInteger(i.pid)||i.pid<=0||typeof i.generation!=="string"||!/^\w{64}$/.test(i.capability)||typeof i.endpoint!=="string")throw Error("Invalid worker identity");return i}function q(){let e=`/proc/${process.pid}`,n=t.readFileSync(`${e}/stat`,"utf8"),r=n.lastIndexOf(")"),i=n.slice(r+2).trim().split(/\s+/)[19];if(r<0||!i||!/^\d+$/.test(i))throw Error("Invalid worker process start");let a=t.realpathSync(`${e}/exe`),l=t.openSync(`${e}/exe`,"r");try{let f=t.fstatSync(l,{bigint:!0});if(!f.isFile()||f.size>128n*1024n*1024n)throw Error("Invalid worker executable");let g=L("sha256"),c=Buffer.alloc(65536);for(;;){let p=t.readSync(l,c,0,c.length,null);if(p===0)break;g.update(c.subarray(0,p))}return{pid:process.pid,uid:process.getuid?.(),startTicks:i,executable:a,device:String(f.dev),inode:String(f.ino),sha256:g.digest("hex")}}finally{t.closeSync(l)}}async function C(e){if(process.platform==="win32")return D.acquireWorkerLease(e);let n=process.platform==="linux"&&e.sourcePath?q():void 0,r=e.sourcePath?t.realpathSync(e.sourcePath):void 0;if(r&&L("sha256").update(t.readFileSync(r)).digest("hex")!==e.sourceSha256)throw Error("Worker source identity mismatch");let i=M(e);try{t.mkdirSync(i,{mode:448}),E(y.dirname(i))}catch(o){if(o.code==="EEXIST")throw Object.assign(Error("Workflow has an existing worker or unknown outcome; no duplicate executor started"),{code:"WORKFLOW_WORKER_UNRESOLVED"});throw o}let a=I(i),l=F(),f=O(32).toString("hex"),g=t.realpathSync(e.socketRoot);I(g);let c=y.join(g,`${O(10).toString("hex")}.sock`);if(Buffer.byteLength(c)>100)throw Error("Worker socket path too long");let p=new Set,w=G((o)=>{if(p.size>=4){o.destroy();return}p.add(o);let s="",d=setTimeout(()=>o.destroy(),1000);o.on("error",()=>{}),o.once("close",()=>{clearTimeout(d),p.delete(o)}),o.on("data",(u)=>{if(s+=u,Buffer.byteLength(s)>4096){o.destroy();return}if(!s.endsWith(`
`))return;try{let h=JSON.parse(s),x=Buffer.from(String(h.capability));if(x.length!==64||!H(x,Buffer.from(f))||typeof h.challenge!=="string"||h.challenge.length>64){o.destroy();return}o.end(`${JSON.stringify({generation:l,challenge:h.challenge})}
`)}catch{o.destroy()}})});await new Promise((o,s)=>{w.once("error",s),w.listen(c,o)}),t.chmodSync(c,384);let S=t.lstatSync(c),v={schemaVersion:n?2:1,...n?{nativeIdentity:n,sourcePath:r}:{},generation:l,uid:process.getuid?.(),pid:process.pid,executable:t.realpathSync(process.execPath),runId:e.runId,versionId:e.versionId,sourceSha256:e.sourceSha256,endpoint:c,capability:f},m=t.openSync(y.join(i,"owner.json"),"wx",384);try{t.writeFileSync(m,JSON.stringify(v)),t.fsyncSync(m)}finally{t.closeSync(m)}E(i),E(y.dirname(i));let P=!1;return{generation:l,async finishCanonicalResult(){if(P)return;P=!0;let o=I(i);if(o.dev!==a.dev||o.ino!==a.ino||U(i).generation!==l)throw Error("Worker owner replaced; preserve it");let s=`${i}.settled-${l}`;t.renameSync(i,s),E(y.dirname(i));for(let d of p)d.destroy();if(await new Promise((d,u)=>w.close((h)=>h?u(h):d())),t.existsSync(c)){let d=t.lstatSync(c);if(d.dev!==S.dev||d.ino!==S.ino)throw Error("Worker endpoint replaced");t.unlinkSync(c)}},async abandon(){for(let o of p)o.destroy();await new Promise((o)=>w.close(()=>o()))}}}Object.assign(globalThis,{__elizaAcquireWorkerLease:C});

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
