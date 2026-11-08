package android.media;
public class MediaExtractor { public static final int SAMPLE_FLAG_SYNC=1;
 public void setDataSource(String p)throws java.io.IOException{throw new java.io.IOException("host stub");}
 public int getTrackCount(){return 0;} public MediaFormat getTrackFormat(int t){return new MediaFormat();} public void selectTrack(int t){}
 public int readSampleData(java.nio.ByteBuffer b,int o){return -1;} public long getSampleTime(){return 0;} public int getSampleFlags(){return 0;} public boolean advance(){return false;} public void release(){} }
