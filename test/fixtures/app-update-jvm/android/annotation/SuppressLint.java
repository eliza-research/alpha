package android.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Source annotation used by Android lint, with no effect in the updater fixture. */
@Retention(RetentionPolicy.CLASS)
@Target(ElementType.LOCAL_VARIABLE)
public @interface SuppressLint {
 String[] value();
}
