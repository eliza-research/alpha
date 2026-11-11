package ai.alphacompute.alphaphone;

import ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Record;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.util.AtomicFile;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;

/** Same-boot record of the exact ordinary installer confirmation received from Android. */
final class UpdateConfirmationReceipt {
 static final String ACTION_CONFIRM_INSTALL="android.content.pm.action.CONFIRM_INSTALL";
 private static final int VERSION=1;
 private static final int MAX_URI=1024;
 private static final class Receipt {
  final String owner,uri;
  final boolean opened;
  Receipt(String owner,String uri,boolean opened){this.owner=owner;this.uri=uri;this.opened=opened;}
 }

 private static String owner(Record record){
  return record.id+":"+record.session+":"+record.boot+":"+record.baselineCode+":"+record.baselineDigest+":"+record.targetCode+":"+record.targetDigest+":"+record.signer;
 }

 private static AtomicFile file(Context context){
  return new AtomicFile(new File(context.getNoBackupFilesDir(),"app-update-confirmation"));
 }

 private static Receipt read(Context context)throws IOException{
  try(FileInputStream stream=file(context).openRead();DataInputStream input=new DataInputStream(stream)){
   if(stream.getChannel().size()>2048)throw new IOException("Invalid update confirmation record");
   if(input.readInt()!=VERSION)throw new IOException("Unknown update confirmation record");
   Receipt receipt=new Receipt(input.readUTF(),input.readUTF(),input.readBoolean());
   if(receipt.owner.length()>320||receipt.uri.length()>MAX_URI||input.read()!=-1)throw new IOException("Invalid update confirmation record");
   return receipt;
  }catch(FileNotFoundException absent){return null;}
 }

 private static void write(Context context,Receipt receipt)throws IOException{
  AtomicFile file=file(context);
  FileOutputStream stream=file.startWrite();
  try{
   DataOutputStream output=new DataOutputStream(stream);
   output.writeInt(VERSION);
   output.writeUTF(receipt.owner);
   output.writeUTF(receipt.uri);
   output.writeBoolean(receipt.opened);
   output.flush();
   stream.getFD().sync();
   file.finishWrite(stream);
  }catch(IOException|RuntimeException failure){file.failWrite(stream);throw failure;}
  // AtomicFile reports some rename errors only in Android logs. A launch needs the exact durable write.
  Receipt stored=read(context);
  if(stored==null||!receipt.owner.equals(stored.owner)||!receipt.uri.equals(stored.uri)||receipt.opened!=stored.opened)
   throw new IOException("Update confirmation write not confirmed");
 }

 private static boolean ordinary(Intent intent,int session){
  if(intent==null||!ACTION_CONFIRM_INSTALL.equals(intent.getAction())||intent.getPackage()==null||intent.getPackage().isBlank()||
    intent.getComponent()!=null||intent.getSelector()!=null||intent.getClipData()!=null||intent.getSourceBounds()!=null||
    intent.getData()!=null||intent.getType()!=null||intent.getIdentifier()!=null||intent.getCategories()!=null||intent.getFlags()!=0)return false;
  var extras=intent.getExtras();
  return extras!=null&&extras.size()==1&&intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1)==session;
 }

 private static boolean systemTarget(Context context,Intent intent){
  var target=context.getPackageManager().resolveActivity(intent,PackageManager.MATCH_SYSTEM_ONLY);
  return target!=null&&target.activityInfo!=null&&intent.getPackage().equals(target.activityInfo.packageName);
 }

 private static Intent decode(Context context,String uri,int session){
  if(!uri.startsWith("intent:#Intent;")||uri.length()>MAX_URI)return null;
  try{
   Intent intent=Intent.parseUri(uri,Intent.URI_INTENT_SCHEME);
   return ordinary(intent,session)&&uri.equals(intent.toUri(Intent.URI_INTENT_SCHEME))&&systemTarget(context,intent)?intent:null;
  }catch(Exception invalid){return null;}
 }

 private static String encode(Context context,Intent intent,int session){
  if(!ordinary(intent,session))return "";
  String uri=intent.toUri(Intent.URI_INTENT_SCHEME);
  Intent parsed=decode(context,uri,session);
  return parsed!=null&&intent.filterEquals(parsed)?uri:"";
 }

 /** False retires an ordinary repeat of a confirmation already launched. */
 static synchronized boolean capture(Context context,Record record,Intent intent)throws IOException{
  Receipt before=read(context);
  String key=owner(record),uri=encode(context,intent,record.session);
  boolean opened=before!=null&&key.equals(before.owner)&&before.opened;
  // An unrepresentable request, such as a distinct developer-verification phase, stays process-local.
  if(opened&&!uri.isEmpty())return false;
  if(before==null||!key.equals(before.owner)||!uri.equals(before.uri))write(context,new Receipt(key,uri,opened));
  return true;
 }

 static synchronized Intent readUnopened(Context context,Record record)throws IOException{
  Receipt receipt=read(context);
  return receipt!=null&&!receipt.opened&&owner(record).equals(receipt.owner)?decode(context,receipt.uri,record.session):null;
 }

 /** Retire cross-process reuse before launch. The current process still owns its original Intent. */
 static synchronized boolean markOpened(Context context,Record record,Intent intent)throws IOException{
  Receipt receipt=read(context);
  if(receipt==null||!owner(record).equals(receipt.owner))return false;
  String uri=encode(context,intent,record.session);
  if(!receipt.uri.equals(uri))return false;
  if(!receipt.opened)write(context,new Receipt(receipt.owner,receipt.uri,true));
  return true;
 }

 static synchronized void retire(Context context,Record record)throws IOException{
  Receipt receipt=read(context);
  if(receipt!=null&&owner(record).equals(receipt.owner))file(context).delete();
 }
}
