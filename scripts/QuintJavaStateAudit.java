import com.sun.source.tree.*;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;
import javax.lang.model.element.Modifier;
import javax.tools.*;

/** Parse Java syntax trees for source ownership and mutation candidates. */
public final class QuintJavaStateAudit {
  private static final Set<String> MUTATIONS = Set.of("put", "putAll", "remove", "clear", "add", "addAll", "poll", "offer", "push", "pop", "set", "merge", "compute", "computeIfAbsent", "replace", "replaceAll", "incrementAndGet", "decrementAndGet", "compareAndSet", "getAndSet", "complete", "completeExceptionally", "cancel", "abort");
  private static final Set<String> ASYNC = Set.of("post", "postDelayed", "execute", "submit", "schedule", "scheduleAtFixedRate", "scheduleWithFixedDelay", "thenApply", "thenAccept", "thenRun", "whenComplete", "addListener", "removeListener", "linkToDeath", "unlinkToDeath", "await", "start");

  private static Map<String, Object> row(Object... pairs) {
    Map<String, Object> value = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) value.put((String) pairs[i], pairs[i + 1]);
    return value;
  }
  private static String shortText(Object value) {
    String text = String.valueOf(value).replaceAll("\\s+", " ");
    return text.substring(0, Math.min(180, text.length()));
  }
  private static String rootOf(ExpressionTree tree) {
    if (tree instanceof IdentifierTree identifier) return identifier.getName().toString();
    if (tree instanceof MemberSelectTree member) {
      if (member.getExpression().toString().equals("this")) return "this." + member.getIdentifier();
      return rootOf(member.getExpression());
    }
    if (tree instanceof ArrayAccessTree array) return rootOf(array.getExpression());
    if (tree instanceof ParenthesizedTree parentheses) return rootOf(parentheses.getExpression());
    if (tree instanceof TypeCastTree cast) return rootOf(cast.getExpression());
    return null;
  }

  private static final class Scanner extends TreePathScanner<Void, Void> {
    final CompilationUnitTree unit;
    final SourcePositions positions;
    final List<Map<String, Object>> declarations = new ArrayList<>();
    final List<Map<String, Object>> writes = new ArrayList<>();
    final List<Map<String, Object>> asynchronous = new ArrayList<>();
    String owner = "<module>";

    Scanner(CompilationUnitTree unit, SourcePositions positions) {
      this.unit = unit;
      this.positions = positions;
    }
    long line(Tree tree) {
      return unit.getLineMap().getLineNumber(Math.max(0, positions.getStartPosition(unit, tree)));
    }
    List<String> guards() {
      List<String> result = new ArrayList<>();
      for (TreePath path = getCurrentPath().getParentPath(); path != null; path = path.getParentPath()) {
        Tree tree = path.getLeaf();
        if (tree instanceof MethodTree || tree instanceof LambdaExpressionTree) break;
        if (tree instanceof IfTree branch) result.add(shortText(branch.getCondition()));
        if (tree instanceof WhileLoopTree loop) result.add(shortText(loop.getCondition()));
        if (tree instanceof DoWhileLoopTree loop) result.add(shortText(loop.getCondition()));
        if (tree instanceof ConditionalExpressionTree conditional) result.add(shortText(conditional.getCondition()));
        if (tree instanceof SynchronizedTree monitor) result.add("synchronized " + shortText(monitor.getExpression()));
      }
      Collections.reverse(result);
      return result.size() > 3 ? result.subList(result.size() - 3, result.size()) : result;
    }
    void write(Tree tree, ExpressionTree target, String operation) {
      writes.add(row("line", line(tree), "owner", owner, "root", rootOf(target), "target", shortText(target), "operation", operation, "guards", guards()));
    }
    @Override public Void visitClass(ClassTree tree, Void unused) {
      String previous = owner;
      String name = tree.getSimpleName().toString();
      if (name.isEmpty()) name = "Anonymous@" + line(tree);
      owner = previous.equals("<module>") ? name : previous + "." + name;
      try { return super.visitClass(tree, unused); }
      finally { owner = previous; }
    }
    @Override public Void visitMethod(MethodTree tree, Void unused) {
      String previous = owner;
      owner += "." + tree.getName() + "@" + line(tree);
      try { return super.visitMethod(tree, unused); }
      finally { owner = previous; }
    }
    @Override public Void visitLambdaExpression(LambdaExpressionTree tree, Void unused) {
      String previous = owner;
      owner += ".lambda@" + line(tree);
      try { return super.visitLambdaExpression(tree, unused); }
      finally { owner = previous; }
    }
    @Override public Void visitVariable(VariableTree tree, Void unused) {
      boolean field = getCurrentPath().getParentPath().getLeaf() instanceof ClassTree;
      boolean readonly = tree.getModifiers().getFlags().contains(Modifier.FINAL);
      String reason = readonly ? null : field ? "writable-field" : "mutable-binding";
      String type = tree.getType() == null ? "" : tree.getType().toString();
      ExpressionTree initializer = tree.getInitializer();
      if (initializer instanceof NewArrayTree || initializer instanceof NewClassTree
          || type.matches(".*(?:Map|List|Set|Queue|Deque|Atomic|Future|Promise|Controller|Handler|Executor|Lock|Semaphore|Latch).*")) reason = "mutable-reference";
      declarations.add(row("line", line(tree), "owner", owner, "name", tree.getName().toString(), "kind", field ? "class-field" : "binding", "reason", reason, "readonly", readonly));
      return super.visitVariable(tree, unused);
    }
    @Override public Void visitAssignment(AssignmentTree tree, Void unused) {
      write(tree, tree.getVariable(), "=");
      return super.visitAssignment(tree, unused);
    }
    @Override public Void visitCompoundAssignment(CompoundAssignmentTree tree, Void unused) {
      write(tree, tree.getVariable(), tree.getKind().name());
      return super.visitCompoundAssignment(tree, unused);
    }
    @Override public Void visitUnary(UnaryTree tree, Void unused) {
      if (Set.of(Tree.Kind.POSTFIX_INCREMENT, Tree.Kind.POSTFIX_DECREMENT, Tree.Kind.PREFIX_INCREMENT, Tree.Kind.PREFIX_DECREMENT).contains(tree.getKind())) write(tree, tree.getExpression(), tree.getKind().name());
      return super.visitUnary(tree, unused);
    }
    @Override public Void visitMethodInvocation(MethodInvocationTree tree, Void unused) {
      ExpressionTree selected = tree.getMethodSelect();
      String name = selected instanceof MemberSelectTree member ? member.getIdentifier().toString() : selected.toString();
      if (selected instanceof MemberSelectTree member && (MUTATIONS.contains(name) || name.startsWith("put"))) write(tree, member.getExpression(), "." + name + "()");
      if (ASYNC.contains(name)) asynchronous.add(row("line", line(tree), "owner", owner, "operation", name));
      return super.visitMethodInvocation(tree, unused);
    }
    Map<String, Object> result() {
      Set<Map<String, Object>> matched = Collections.newSetFromMap(new IdentityHashMap<>());
      List<Map<String, Object>> candidates = new ArrayList<>();
      for (Map<String, Object> declaration : declarations) {
        String name = (String) declaration.get("name"), scope = (String) declaration.get("owner");
        boolean field = declaration.get("kind").equals("class-field");
        List<Map<String, Object>> related = new ArrayList<>();
        for (Map<String, Object> write : writes) {
          String writer = (String) write.get("owner"), target = (String) write.get("root");
          if ((name.equals(target) || (field && ("this." + name).equals(target))) && (writer.equals(scope) || writer.startsWith(scope + "."))) {
            matched.add(write);
            Map<String, Object> observation = new LinkedHashMap<>(write);
            observation.remove("root");
            related.add(observation);
          }
        }
        if (declaration.get("reason") != null || !related.isEmpty()) {
          Map<String, Object> candidate = new LinkedHashMap<>(declaration);
          candidate.put("writes", related);
          candidates.add(candidate);
        }
      }
      List<Map<String, Object>> unassigned = new ArrayList<>();
      for (Map<String, Object> write : writes) if (!matched.contains(write)) {
        Map<String, Object> observation = new LinkedHashMap<>(write);
        observation.remove("root");
        unassigned.add(observation);
      }
      return row("parseErrors", new ArrayList<>(), "candidates", candidates, "asynchronous", asynchronous, "writeSites", writes.size(), "unassignedWrites", unassigned);
    }
  }

  private static void json(PrintWriter out, Object value) {
    if (value == null) { out.print("null"); return; }
    if (value instanceof String text) {
      out.print('"');
      for (int i = 0; i < text.length(); i++) {
        char c = text.charAt(i);
        if (c == '"' || c == '\\') { out.print('\\'); out.print(c); }
        else if (c < 32) out.printf("\\u%04x", (int)c);
        else out.print(c);
      }
      out.print('"');
    } else if (value instanceof Map<?, ?> map) {
      out.print('{');
      boolean comma = false;
      for (var entry : map.entrySet()) {
        if (comma) out.print(',');
        comma = true;
        json(out, entry.getKey().toString());
        out.print(':');
        json(out, entry.getValue());
      }
      out.print('}');
    } else if (value instanceof Iterable<?> values) {
      out.print('[');
      boolean comma = false;
      for (Object item : values) {
        if (comma) out.print(',');
        comma = true;
        json(out, item);
      }
      out.print(']');
    } else out.print(value);
  }

  private static final class Source extends SimpleJavaFileObject {
    final String text;
    final String sha256;
    Source(Path path) throws Exception {
      super(path.toUri(), JavaFileObject.Kind.SOURCE);
      byte[] bytes = Files.readAllBytes(path);
      text = new String(bytes, StandardCharsets.UTF_8);
      sha256 = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return text; }
  }

  public static void main(String[] args) throws Exception {
    Path root = Path.of(args[1]).toAbsolutePath().normalize();
    List<Path> paths = Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8).stream().map(Path::of).toList();
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) throw new IllegalStateException("A full JDK is required for Java source parsing");
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    Map<String, Map<String, Object>> results = new LinkedHashMap<>();
    List<Source> sources = new ArrayList<>();
    Map<String, String> sourceHashes = new HashMap<>();
    for (Path path : paths) {
      Source source = new Source(path);
      sources.add(source);
      sourceHashes.put(path.toUri().toString(), source.sha256);
    }
    try (var manager = compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
      var task = (JavacTask) compiler.getTask(null, manager, diagnostics, List.of("-proc:none", "--release", "21"), null, sources);
      SourcePositions positions = Trees.instance(task).getSourcePositions();
      for (CompilationUnitTree unit : task.parse()) {
        String name = root.relativize(Path.of(unit.getSourceFile().toUri())).toString().replace('\\', '/');
        Scanner scanner = new Scanner(unit, positions);
        scanner.scan(unit, null);
        Map<String, Object> result = scanner.result();
        result.put("consumedSha256", sourceHashes.get(unit.getSourceFile().toUri().toString()));
        results.put(name, result);
      }
      for (Diagnostic<? extends JavaFileObject> diagnostic : diagnostics.getDiagnostics()) {
        if (diagnostic.getKind() != Diagnostic.Kind.ERROR || diagnostic.getSource() == null) continue;
        String name = root.relativize(Path.of(diagnostic.getSource().toUri())).toString().replace('\\', '/');
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> errors = (List<Map<String, Object>>) results.get(name).get("parseErrors");
        errors.add(row("line", diagnostic.getLineNumber(), "message", diagnostic.getMessage(Locale.ROOT)));
      }
    }
    try (var out = new PrintWriter(System.out, true, StandardCharsets.UTF_8)) { json(out, results); }
  }
}
