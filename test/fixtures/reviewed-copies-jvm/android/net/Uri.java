package android.net;

import java.util.List;

public final class Uri {
 private final String authority;
 private final List<String> segments;
 public Uri(String authority,List<String> segments){this.authority=authority;this.segments=List.copyOf(segments);}
 public String getScheme(){return "content";}
 public String getAuthority(){return authority;}
 public List<String> getPathSegments(){return segments;}
 public String getLastPathSegment(){return segments.isEmpty()?null:segments.get(segments.size()-1);}
}
