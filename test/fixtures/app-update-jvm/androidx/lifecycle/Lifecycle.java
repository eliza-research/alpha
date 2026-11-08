package androidx.lifecycle;
public class Lifecycle {
 public enum State {DESTROYED,INITIALIZED,CREATED,STARTED,RESUMED;public boolean isAtLeast(State state){return compareTo(state)>=0;}}
 private final State state;
 public Lifecycle(State state){this.state=state;}
 public State getCurrentState(){return state;}
}
