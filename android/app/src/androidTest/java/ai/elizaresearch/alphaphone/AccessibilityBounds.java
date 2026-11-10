package ai.elizaresearch.alphaphone;

/** Pure rectangle intersection used by the native accessibility fixture. Empty means invisible. */
final class AccessibilityBounds {
 static int[] clip(int[] bounds,Iterable<int[]> frames){
  int left=bounds[0],top=bounds[1],right=bounds[2],bottom=bounds[3];
  for(int[] frame:frames){
   left=Math.max(left,frame[0]);top=Math.max(top,frame[1]);
   right=Math.min(right,frame[2]);bottom=Math.min(bottom,frame[3]);
   if(left>=right||top>=bottom)return new int[]{0,0,0,0};
  }
  return left>=right||top>=bottom?new int[]{0,0,0,0}:new int[]{left,top,right,bottom};
 }
}
