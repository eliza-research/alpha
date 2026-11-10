package ai.elizaresearch.alphaphone;

/**
 * The listener owner (AlphaLocalAgentPlugin.invocationOwner) held in memory, so the shared
 * SenseInvocation owner callback stays cheap under its lock. Every provider or Cloud credential
 * commit calls invalidate() before and after it writes, so a value read before or during a write is
 * never returned once that write has finished. The stored state also stops supporting an owner when
 * its Cloud credential expires, with no write: each owner carries that wall-clock deadline and is
 * read again at or after it. A failed read is returned but never cached.
 */
final class InvocationOwnerCache {
 /** An owner and the first wall-clock millisecond at which the stored state may no longer support it. */
 static final class Owner {final String value;final long validUntil;Owner(String value,long validUntil){this.value=value;this.validUntil=validUntil;}}
 interface Reader {Owner read()throws Exception;}
 /** Cache deadline for a Cloud credential's expiresAt (NativeProviderAdmission refuses it once expiresAt <= now): never later than the expiry, and immediate for a value it cannot read. */
 static long deadline(Object expiresAt){
  if(!(expiresAt instanceof Number))return Long.MIN_VALUE;double at=((Number)expiresAt).doubleValue();
  return Double.isFinite(at)?(long)Math.floor(at):Long.MIN_VALUE;
 }
 private final Object lock=new Object();
 private long version;private Owner cached;
 String get(Reader reader,long now){
  final long seen;
  synchronized(lock){if(cached!=null){if(now<cached.validUntil)return cached.value;cached=null;}seen=version;}
  final Owner read;
  try{read=reader.read();}catch(Exception unavailable){return null;}
  if(read==null)return null;
  synchronized(lock){if(version==seen&&now<read.validUntil)cached=read;}
  return read.value;
 }
 void invalidate(){synchronized(lock){version++;cached=null;}}
}
