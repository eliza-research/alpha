package ai.elizaresearch.alphaphone;

import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;

/** Host-JVM check of StorageBrowser over a temporary folder (spec files-browser, Design.cfg). */
public final class StorageBrowserTest {
 static void check(boolean ok,String what){if(!ok)throw new AssertionError(what);}
 static String text(File f)throws Exception{return new String(Files.readAllBytes(f.toPath()),"UTF-8");}
 public static void main(String[] args)throws Exception{
  File root=Files.createTempDirectory("alpha-storage").toFile();
  try{
   StorageBrowser b=new StorageBrowser(root);
   new File(root,"Download").mkdirs();new File(root,"Documents").mkdirs();
   StorageBrowser.write(new File(root,"Download/a.pdf"),"download");
   StorageBrowser.write(new File(root,"Documents/a.pdf"),"document");
   check(b.trashList(0L).isEmpty()&&b.emptyTrash(Arrays.asList())==0&&!new File(root,StorageBrowser.TRASH).exists(),"reading Trash does not create it");
   // NoOverwriteWithoutConfirm: a clash keeps both.
   List<StorageBrowser.Outcome> moved=b.transfer(Arrays.asList("Download/a.pdf"),"Documents",false);
   check(moved.get(0).status.equals("moved")&&moved.get(0).to.equals("Documents/a (1).pdf"),"move keeps both: "+moved.get(0).to);
   check(text(new File(root,"Documents/a.pdf")).equals("document")&&text(new File(root,"Documents/a (1).pdf")).equals("download"),"nothing overwritten");
   check(!new File(root,"Download/a.pdf").exists(),"moved, not duplicated");
   // A selection row that is gone is skipped, not invented.
   check(b.transfer(Arrays.asList("Download/a.pdf"),"Documents",false).get(0).status.equals("missing"),"missing skipped");
   // Copy keeps the source.
   check(b.transfer(Arrays.asList("Documents/a.pdf"),"Download",true).get(0).to.equals("Download/a.pdf"),"copy");
   check(new File(root,"Documents/a.pdf").exists(),"copy keeps source");
   // TrashReversible: restore to origin; the folder is recreated; a clash keeps both.
   String id=b.trash(Arrays.asList("Documents/a.pdf"),1000L).get(0).to;
   check(b.list("").stream().noneMatch(r->r.name.startsWith(".")),"trash is hidden from listings");
   check(b.trashList(1000L).size()==1&&b.trashList(1000L).get(0).origin.equals("Documents"),"origin recorded");
   StorageBrowser.write(new File(root,"Documents/a.pdf"),"new");
   List<StorageBrowser.Outcome> back=b.restore(Arrays.asList(id));
   check(back.get(0).status.equals("restored")&&back.get(0).to.equals("Documents/a (2).pdf"),"restore keeps both: "+back.get(0).to);
   check(text(new File(root,"Documents/a.pdf")).equals("new"),"restore does not overwrite");
   String gone=b.trash(Arrays.asList("Documents"),1000L).get(0).to;
   check(b.restore(Arrays.asList(gone)).get(0).to.equals("Documents"),"folder restored");
   // Retention: 30 days, then removed at the next listing.
   String old=b.trash(Arrays.asList("Download/a.pdf"),0L).get(0).to;
   check(b.trashList(StorageBrowser.RETENTION_MS).stream().noneMatch(r->r.id.equals(old)),"expired after 30 days");
   // Empty deletes only what is in trash.
   b.trash(Arrays.asList("Documents/a.pdf"),5000L);
   try{b.emptyTrash(null);check(false,"Empty names the confirmed items");}catch(IllegalArgumentException expected){}
   List<String> confirmed=new java.util.ArrayList<>();for(StorageBrowser.TrashRow r:b.trashList(5000L))confirmed.add(r.id);
   check(b.emptyTrash(confirmed)==1&&b.trashList(5000L).isEmpty()&&new File(root,"Documents/a (1).pdf").exists(),"empty");
   // Paths cannot leave the volume or name the trash; a folder cannot move into itself.
   for(String bad:new String[]{"../x","Documents/../../x",".Trash-alpha","a//b"}){
    try{b.resolve(bad,false);check(false,"refused "+bad);}catch(IllegalArgumentException expected){}
   }
   new File(root,"Documents/Sub").mkdirs();
   check(b.transfer(Arrays.asList("Documents"),"Documents/Sub",false).get(0).status.equals("invalid"),"no move into itself");
   check(b.createFolder("Documents","Sub").equals("Documents/Sub (1)"),"new folder keeps both");
   try{b.rename("Documents/Sub (1)","Sub");check(false,"rename refuses a clash");}catch(IllegalStateException expected){}
   for(String hidden:new String[]{".Sub",".Trash-alpha"}){try{b.rename("Documents/Sub (1)",hidden);check(false,"rename refuses "+hidden);}catch(IllegalArgumentException expected){}}
   check(new File(root,"Documents/Sub (1)").isDirectory(),"a refused rename changes nothing");
   // The Downloads category: files directly in Download/, newest first; no folders, no hidden entries.
   File download=new File(root,"Download");
   for(File f:download.listFiles())StorageBrowser.deleteRecursive(f);
   StorageBrowser.write(new File(download,"old.pdf"),"o");StorageBrowser.write(new File(download,"new.txt"),"n");StorageBrowser.write(new File(download,".hidden"),"h");
   new File(download,"Folder").mkdirs();StorageBrowser.write(new File(download,"Folder/inner.txt"),"i");
   new File(download,"old.pdf").setLastModified(1_700_000_000_000L);new File(download,"new.txt").setLastModified(1_800_000_000_000L);
   List<StorageBrowser.Row> downloads=b.files("Download",2000);
   check(downloads.size()==2&&downloads.get(0).path.equals("Download/new.txt")&&downloads.get(1).path.equals("Download/old.pdf"),"downloads lists Download/ files newest first");
   check(b.files("Download",1).size()==1,"downloads is bounded");
   check(new StorageBrowser(Files.createTempDirectory("alpha-empty").toFile()).files("Download",2000).isEmpty(),"no Download folder is an empty category");
   // A copy that fails part way leaves no partial "Folder (1)" behind.
   File tree=new File(root,"Tree");new File(tree,"a").mkdirs();StorageBrowser.write(new File(tree,"a/one.txt"),"1");StorageBrowser.write(new File(tree,"b.txt"),"2");
   File unreadable=new File(tree,"zz.txt");StorageBrowser.write(unreadable,"3");
   if(unreadable.setReadable(false,false)&&!unreadable.canRead()){
    List<StorageBrowser.Outcome> partial=b.transfer(Arrays.asList("Tree"),"Documents",true);
    check(partial.get(0).status.equals("failed")&&!new File(root,"Documents/Tree").exists(),"a failed copy leaves nothing: "+Arrays.toString(new File(root,"Documents").list()));
    unreadable.setReadable(true,false);
   }
   // The agent's folder filter walks the tree: hidden folders and the trash are skipped.
   new File(root,"Documents/Bank statements/2025").mkdirs();new File(root,".hidden/Bank").mkdirs();
   new File(root,"Documents/Bank statements").setLastModified(1_750_000_000_000L);
   List<StorageBrowser.Row> found=b.folders("","bank",0,0,500,20000);
   check(found.size()==1&&found.get(0).path.equals("Documents/Bank statements")&&found.get(0).directory&&found.get(0).children==1,"folder filter finds visible folders by name");
   check(b.folders("Download","bank",0,0,500,20000).isEmpty(),"folder filter stays under the folder");
   check(b.folders("","bank",1_760_000_000_000L,0,500,20000).isEmpty(),"folder filter applies the date range");
   check(b.folders("","",0,0,500,20000).stream().noneMatch(r->r.path.startsWith(".")||r.path.contains("/.")),"no hidden folders");
   System.out.println("PASS storage browser");
  }finally{StorageBrowser.deleteRecursive(root);}
 }
}
