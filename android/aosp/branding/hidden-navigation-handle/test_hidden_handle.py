from pathlib import Path
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, unittest, xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'system-entry'))
from portable_tools import java_binary, android_api_jar
REPO=next(p for p in ROOT.parents if (p/'app.config.json').is_file())
DATA=Path(os.environ.get('ALPHA_HIDDEN_HANDLE_INPUTS',ROOT/'.cache')).resolve()
MANIFEST=json.loads((ROOT/'manifest.json').read_text())
ROW=MANIFEST['files'][0]
SOURCE=DATA/'staged'/ROW['path']

COMMON={
 'androidx/annotation/ColorInt.java':'package androidx.annotation; public @interface ColorInt {}',
 'android/annotation/Nullable.java':'package android.annotation; public @interface Nullable {}',
 'androidx/core/content/ContextCompat.java':'package androidx.core.content; public class ContextCompat { public static int getColor(android.content.Context c,int id){return id;} }',
 'com/android/launcher3/R.java':'package com.android.launcher3; public final class R { public static final class id { public static final int stashed_handle=1,stashed_bubble_handle=2; } public static final class bool { public static final int config_alpha_home_back_only=3; } public static final class color { public static final int taskbar_stashed_handle_light_color=4,taskbar_stashed_handle_dark_color=5; }}',
 'com/android/launcher3/LauncherAnimUtils.java':'''package com.android.launcher3;
import android.util.Property;import android.view.View;
public class LauncherAnimUtils {
 public static final Property<View,Float> SCALE_PROPERTY=new Property<View,Float>(Float.class,"scale") { public Float get(View v){return 1f;} public void set(View v,Float f){} };
 public static final Property<View,Integer> VIEW_BACKGROUND_COLOR=new Property<View,Integer>(Integer.class,"backgroundColor") { public Integer get(View v){return 0;} public void set(View v,Integer color){v.setBackgroundColor(color);} };
}''',
}
STUBS={
 'android/animation/Animator.java':'package android.animation; public class Animator {}',
 'android/animation/AnimatorListenerAdapter.java':'package android.animation; public class AnimatorListenerAdapter { public void onAnimationEnd(Animator a){} }',
 'android/animation/ObjectAnimator.java':'''package android.animation; public class ObjectAnimator extends Animator {
 public static <T> ObjectAnimator ofArgb(T t,android.util.Property<T,Integer> p,int... values){return new ObjectAnimator();}
 public static ObjectAnimator ofPropertyValuesHolder(Object t,PropertyValuesHolder... values){return new ObjectAnimator();}
 public void addListener(AnimatorListenerAdapter a){} public ObjectAnimator setDuration(long t){return this;}
 public void setAutoCancel(boolean b){} public void start(){} public void cancel(){}
}''',
 'android/animation/PropertyValuesHolder.java':'package android.animation; public class PropertyValuesHolder { public static <T> PropertyValuesHolder ofFloat(android.util.Property<T,Float> p,float... values){return new PropertyValuesHolder();} }',
 'android/content/res/Resources.java':'package android.content.res; public class Resources { public boolean alpha; public boolean getBoolean(int id){return alpha;} }',
 'android/content/Context.java':'package android.content; public class Context { public android.content.res.Resources resources=new android.content.res.Resources(); public android.content.res.Resources getResources(){return resources;} }',
 'android/graphics/Canvas.java':'package android.graphics; public class Canvas { public int draws; }',
 'android/graphics/Rect.java':'package android.graphics; public class Rect { public void set(Rect r){} public void offset(int x,int y){} }',
 'android/util/AttributeSet.java':'package android.util; public interface AttributeSet {}',
 'android/util/Property.java':'package android.util; public abstract class Property<T,V> { public Property(Class<V> c,String name){} public abstract V get(T t); public abstract void set(T t,V v); }',
 'android/view/View.java':'''package android.view; public class View {
 private int id=-1;private final android.content.Context context;public int background;
 public View(android.content.Context c,android.util.AttributeSet a,int style,int res){context=c;}
 public void draw(android.graphics.Canvas c){c.draws++;} public int getId(){return id;} public void setId(int i){id=i;}
 public android.content.res.Resources getResources(){return context.getResources();}
 public void getLocationOnScreen(int[] a){a[0]=0;a[1]=0;}
 public float getTranslationX(){return 0;} public float getTranslationY(){return 0;}
 public void setBackgroundColor(int c){background=c;}
}''',
}

def files_for(root, sources):
 result=[]
 for name,text in sources.items():
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);result.append(str(p))
 return result

class HiddenHandleTest(unittest.TestCase):
 def test_exact_patch_and_hash_roundtrip_without_unrelated_source_changes(self):
  self.assertEqual(hashlib.sha256((ROOT/MANIFEST['patch']).read_bytes()).hexdigest(),MANIFEST['patchSha256'])
  self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(),ROW['afterSha256'])
  before=DATA/'baseline'/ROW['path']
  self.assertEqual(hashlib.sha256(before.read_bytes()).hexdigest(),ROW['beforeSha256'])
  text=SOURCE.read_text().replace('import android.graphics.Canvas;\n','')
  start=text.index('    /** Hide only the taskbar navigation indicator for Alpha;')
  end=text.index('    /**\n     * Updates mSampledRegion',start)
  self.assertEqual(text[:start]+text[end:],before.read_text(),'all existing color, scale, sampling, constructors and behavior bytes remain exact')
  with tempfile.TemporaryDirectory(prefix='alpha-nav-patch-')as d:
   shutil.copytree(DATA/'baseline',Path(d)/'baseline')
   subprocess.run(['git','apply','--check',str(ROOT/MANIFEST['patch'])],cwd=Path(d)/'baseline',check=True)
   subprocess.run(['git','apply',str(ROOT/MANIFEST['patch'])],cwd=Path(d)/'baseline',check=True)
   self.assertEqual((Path(d)/'baseline'/ROW['path']).read_bytes(),SOURCE.read_bytes())

 def test_actual_draw_suppresses_only_alpha_taskbar_and_preserves_bubble_default_and_other_ids(self):
  with tempfile.TemporaryDirectory(prefix='alpha-nav-jvm-')as d:
   root=Path(d);files=files_for(root,{**STUBS,**COMMON})
   h=root/'DrawTest.java';h.write_text('''
import android.content.Context;import android.graphics.Canvas;
import com.android.launcher3.R;import com.android.launcher3.taskbar.StashedHandleView;
public class DrawTest {
 public static void main(String[] args){
  int checks=0;for(boolean enabled:new boolean[]{false,true})for(int id:new int[]{-1,0,R.id.stashed_handle,R.id.stashed_bubble_handle,999}){
   Context c=new Context();c.resources.alpha=enabled;StashedHandleView v=new StashedHandleView(c);v.setId(id);
   v.updateHandleColor(true,false);int background=v.background;Canvas canvas=new Canvas();v.draw(canvas);
   int expected=enabled&&id==R.id.stashed_handle?0:1;
   if(canvas.draws!=expected||v.getId()!=id||v.background!=background)throw new AssertionError("draw-only predicate");checks++;
   c.resources.alpha=!enabled;Canvas changed=new Canvas();v.draw(changed);
   expected=!enabled&&id==R.id.stashed_handle?0:1;
   if(changed.draws!=expected)throw new AssertionError("resource change must not leave sticky visibility");checks++;
  }
  System.out.println("PASS actual StashedHandleView draw: "+checks+" cases");
 }
}''');files += [str(SOURCE),str(h)]
   subprocess.run([java_binary('javac'),'--release','11','-d',d,*files],check=True,capture_output=True)
   self.assertIn('PASS actual StashedHandleView draw: 20 cases',subprocess.check_output([java_binary('java'),'-cp',d,'DrawTest'],text=True))

 def test_actual_view_compiles_against_real_android36_api(self):
  api=android_api_jar(36);self.assertTrue(api.is_file())
  with tempfile.TemporaryDirectory(prefix='alpha-nav-api-')as d:
   files=files_for(Path(d),COMMON)+[str(SOURCE)]
   subprocess.run([java_binary('javac'),'--release','17','-classpath',str(api),'-d',d,*files],check=True,capture_output=True)

 def test_draw_guard_does_not_change_native_controls_or_gesture_geometry(self):
  text=SOURCE.read_text();start=text.index('    public void draw(Canvas canvas)');end=text.index('    /**\n     * Updates mSampledRegion',start);draw=text[start:end]
  self.assertIn('getId() == R.id.stashed_handle',draw)
  self.assertIn('getBoolean(R.bool.config_alpha_home_back_only)',draw)
  self.assertEqual(draw.count('super.draw(canvas)'),1)
  for forbidden in ['setVisibility','setAlpha','setLayoutParams','setEnabled','setId','setFocusable','setImportantForAccessibility','setOnTouchListener','onTouchEvent','WindowInsets','setBackgroundColor','startActivity','setDimensions']:
   self.assertNotIn(forbidden,draw)

 def test_existing_alpha_flag_and_fallback_resources_keep_scope(self):
  branding=ROOT.parent
  flag=ET.parse(branding/'overlay/packages/apps/Launcher3/res/values/alpha-navigation.xml').getroot()
  self.assertEqual([n.text for n in flag.findall('bool')if n.attrib.get('name')=='config_alpha_home_back_only'],['true'])
  home_patch=(branding/'home-back-keyboard.patch').read_text()
  self.assertIn('<bool name="config_alpha_home_back_only">false</bool>',home_patch)
  overlay=ET.parse(branding/'overlay/frameworks/base/packages/SystemUI/res/values/alpha-navigation.xml').getroot()
  colors={n.attrib['name']:n.text for n in overlay.findall('color')}
  self.assertEqual(colors,{'navigation_bar_home_handle_dark_color':'#00000000','navigation_bar_home_handle_light_color':'#00000000'})
  self.assertEqual([n.text for n in overlay.findall('string')if n.attrib.get('name')=='config_navBarLayout'],['back[1WC];home;ime_switcher[1WC]'])
  self.assertEqual(len(list(overlay)),3,'no navigation dimensions, button colors or other controls overridden')

if __name__=='__main__':unittest.main(verbosity=2)
