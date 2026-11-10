package ai.elizaresearch.alphaphone;
import java.util.*;
public final class AccessibilityBoundsTest {
 private static void check(int[] expected,int[] source,int[]...frames){
  int[] copy=source.clone();List<int[]> clips=Arrays.asList(frames);
  if(!Arrays.equals(expected,AccessibilityBounds.clip(source,clips)))throw new AssertionError("Unexpected visible bounds");
  if(!Arrays.equals(copy,source))throw new AssertionError("Original bounds mutated");
 }
 public static void main(String[] args){
  // Captured API35/WebView124 scene: the offscreen Apps label is below Home.
  check(new int[]{0,0,0,0},new int[]{372,2251,708,2339},new int[]{0,0,1080,2400},new int[]{0,136,1084,2047});
  // The visible sliver of its button stays included, rather than hiding partial clipping.
  check(new int[]{372,2036,708,2047},new int[]{372,2036,708,2301},new int[]{0,136,1084,2047});
  // The composer is outside Home's scroll container and remains an actionable control.
  check(new int[]{63,2104,183,2222},new int[]{63,2104,183,2222},new int[]{0,0,1080,2400});
  check(new int[]{20,30,70,80},new int[]{10,20,100,120},new int[]{0,0,90,100},new int[]{20,30,70,80});
  check(new int[]{0,0,0,0},new int[]{100,20,120,40},new int[]{0,0,100,100});
  check(new int[]{0,0,0,0},new int[]{0,2401,30,2450},new int[]{0,0,1080,2400});
  // A real visible overlap is retained for the caller's order/overlap checks to reject.
  check(new int[]{50,90,80,120},new int[]{50,90,80,120},new int[]{0,0,100,150});
  System.out.println("PASS native accessibility bounds");
 }
}
