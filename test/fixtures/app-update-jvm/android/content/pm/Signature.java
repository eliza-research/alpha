package android.content.pm;
public class Signature {
 private final byte[] encoded;
 public Signature(byte[] encoded){this.encoded=encoded;}
 public byte[] toByteArray(){return encoded;}
}
