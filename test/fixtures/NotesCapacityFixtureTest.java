package ai.elizaresearch.alphaphone;
import java.nio.charset.StandardCharsets;
import org.json.*;
public final class NotesCapacityFixtureTest {
 public static void main(String[] args)throws Exception{
  int cap=32*1024*1024;
  JSONObject originalRecord=new JSONObject().put("id","kept").put("kind","text").put("title","Kept €").put("body","Saved content");
  JSONObject envelope=new JSONObject().put("version",2).put("collectionId","fixture-collection").put("records",new JSONArray().put(originalRecord)).put("deleted",new JSONArray());
  JSONObject original=new JSONObject().put("version",1).put("currentRaw",envelope.toString()).put("archive",new JSONObject().put("v1",JSONObject.NULL).put("v2",JSONObject.NULL).put("daily",JSONObject.NULL));
  String seeded=NotesCapacityFixture.collection(original.toString(),"capacity-target",cap);
  if(seeded.getBytes(StandardCharsets.UTF_8).length!=cap-NotesCapacityFixture.HEADROOM)throw new AssertionError("Wrong near-cap byte count");
  JSONObject saved=new JSONObject(seeded),body=new JSONObject(saved.getString("currentRaw"));JSONArray records=body.getJSONArray("records");
  if(records.length()!=66||!records.getJSONObject(0).toString().equals(originalRecord.toString()))throw new AssertionError("Prior records changed");
  for(int i=0;i<records.length();i++)if(records.getJSONObject(i).getString("body").length()>NotesCapacityFixture.RECORD_BYTES)throw new AssertionError("Unbounded fixture body");
  JSONObject target=records.getJSONObject(1);if(!target.getString("body").isEmpty())throw new AssertionError("Editor must start small");
  target.put("body","E".repeat(NotesCapacityFixture.EDIT_BYTES));saved.put("currentRaw",body.toString());
  if(saved.toString().getBytes(StandardCharsets.UTF_8).length<=cap)throw new AssertionError("Small edit does not cross real cap");
  java.nio.file.Path directory=java.nio.file.Files.createTempDirectory("notes-snapshot-");
  try{
   try(NotesCapacityFixture.Snapshot snapshot=NotesCapacityFixture.Snapshot.save(directory.toFile(),seeded)){
    if(!snapshot.matches(seeded)||snapshot.matches(seeded+"x")||snapshot.matches(null)||!seeded.equals(snapshot.exactValue()))throw new AssertionError("Snapshot identity changed");
   }
   String unicode="a".repeat(4095)+"😀€";
   try(NotesCapacityFixture.Snapshot snapshot=NotesCapacityFixture.Snapshot.save(directory.toFile(),unicode)){
    if(!snapshot.matches(unicode)||!unicode.equals(snapshot.exactValue()))throw new AssertionError("Chunk boundary broke UTF-8");
    java.nio.file.Path file;try(java.util.stream.Stream<java.nio.file.Path> files=java.nio.file.Files.list(directory)){file=files.findFirst().orElseThrow();}
    java.nio.file.Files.writeString(file,"changed");boolean rejected=false;try{snapshot.exactValue();}catch(java.io.IOException expected){rejected=true;}
    if(!rejected)throw new AssertionError("Changed snapshot admitted for CAS");
   }
   try(java.util.stream.Stream<java.nio.file.Path> files=java.nio.file.Files.list(directory)){if(files.count()!=0)throw new AssertionError("Private snapshot left behind");}
  }finally{java.nio.file.Files.delete(directory);}
  System.out.println("PASS bounded Notes capacity fixture");
 }
}
