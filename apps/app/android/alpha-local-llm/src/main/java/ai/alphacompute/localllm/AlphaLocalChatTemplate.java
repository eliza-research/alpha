package ai.alphacompute.localllm;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Pure-JVM prompt formatter and structured tool-call parser for Gemma 4 and Qwen 3.5 local GGUF models.
 */
public final class AlphaLocalChatTemplate {
    private static final Pattern GEMMA_THOUGHT = Pattern.compile("<\\|thought\\|?>[\\s\\S]*?<\\|?thought\\|?>");
    private static final Pattern QWEN_THINK = Pattern.compile("<think>[\\s\\S]*?</think>");
    private static final Pattern GEMMA_WRAPPED_CALL = Pattern.compile("<\\|tool_call>\\s*call:([A-Za-z0-9_.-]+)(\\{[\\s\\S]*?\\})\\s*<tool_call\\|>");
    private static final Pattern GEMMA_DIRECT_CALL = Pattern.compile("<\\|call:([A-Za-z0-9_.-]+)(\\{[\\s\\S]*?\\})\\|>");
    private static final Pattern QWEN_TOOL_BLOCK = Pattern.compile("<tool_call>([\\s\\S]*?)</tool_call>");
    private static final Pattern QWEN_FUNCTION_BLOCK = Pattern.compile("^<function=([^>\\s]+)>([\\s\\S]*?)</function>$");
    private static final Pattern QWEN_PARAMETER = Pattern.compile("<parameter=([^>\\s]+)>([\\s\\S]*?)</parameter>");
    private static final Pattern GEMMA_QUOTED_STRING = Pattern.compile("<\\|\"\\|>([\\s\\S]*?)<\\|\"\\|>");
    private static final Pattern UNQUOTED_KEY = Pattern.compile("([{,]\\s*)([A-Za-z_][A-Za-z0-9_-]*)\\s*:");

    /** Single chat turn in an OpenAI-style conversation. */
    public record ChatMessage(String role, String content, String name, String toolCallId, List<ParsedToolCall> toolCalls) {
        /** Creates a plain role/content message without tool metadata. */
        public static ChatMessage of(String role, String content) {
            return new ChatMessage(role, content == null ? "" : content, null, null, List.of());
        }
    }

    /** Function tool offered to the local model. */
    public record ToolSpec(String name, String description, JSONObject parameters) {}

    /** Structured tool invocation parsed from model output. */
    public record ParsedToolCall(String id, String name, JSONObject arguments) {
        /** Serializes this tool call to structured JSON. */
        public JSONObject toStructuredJson() throws JSONException {
            return new JSONObject()
                .put("id", id)
                .put("name", name)
                .put("arguments", arguments);
        }

        /** Serializes this tool call in OpenAI {@code tool_calls} wire format. */
        public JSONObject toOpenAiJson() throws JSONException {
            return new JSONObject()
                .put("id", id)
                .put("type", "function")
                .put("function", new JSONObject()
                    .put("name", name)
                    .put("arguments", arguments.toString()));
        }
    }

    /** Token accounting for one local completion. */
    public record TokenUsage(int promptTokens, int completionTokens, int totalTokens) {
        /** Serializes token usage to camelCase structured JSON. */
        public JSONObject toStructuredJson() throws JSONException {
            return new JSONObject()
                .put("promptTokens", promptTokens)
                .put("completionTokens", completionTokens)
                .put("totalTokens", totalTokens);
        }

        /** Serializes token usage to snake_case OpenAI JSON. */
        public JSONObject toOpenAiJson() throws JSONException {
            return new JSONObject()
                .put("prompt_tokens", promptTokens)
                .put("completion_tokens", completionTokens)
                .put("total_tokens", totalTokens);
        }
    }

    /** Structured completion result produced from raw local model text. */
    public record ParsedCompletion(String text, List<ParsedToolCall> toolCalls, String finishReason, TokenUsage usage) {
        /** Serializes to Alpha's structured completion envelope. */
        public JSONObject toStructuredJson() throws JSONException {
            JSONArray calls = new JSONArray();
            for (ParsedToolCall call : toolCalls) {
                calls.put(call.toStructuredJson());
            }
            return new JSONObject()
                .put("text", text)
                .put("toolCalls", calls)
                .put("finishReason", finishReason)
                .put("usage", usage.toStructuredJson());
        }

        /** Serializes to an OpenAI-compatible {@code chat.completion} JSON payload. */
        public JSONObject toOpenAiJson(String modelId) throws JSONException {
            JSONObject message = new JSONObject()
                .put("role", "assistant")
                .put("content", text.isEmpty() && !toolCalls.isEmpty() ? JSONObject.NULL : text);
            if (!toolCalls.isEmpty()) {
                JSONArray calls = new JSONArray();
                for (ParsedToolCall call : toolCalls) {
                    calls.put(call.toOpenAiJson());
                }
                message.put("tool_calls", calls);
            }
            JSONObject choice = new JSONObject()
                .put("index", 0)
                .put("message", message)
                .put("finish_reason", finishReason);
            return new JSONObject()
                .put("object", "chat.completion")
                .put("model", modelId)
                .put("choices", new JSONArray().put(choice))
                .put("usage", usage.toOpenAiJson());
        }
    }

    private AlphaLocalChatTemplate() {}

    /** Returns the canonical family name ({@code gemma4} or {@code qwen35}) for a model id or family label. */
    public static String normalizeFamily(String familyOrModelId) {
        if (familyOrModelId == null) return "gemma4";
        String lower = familyOrModelId.trim().toLowerCase(Locale.ROOT);
        if (lower.contains("qwen")) return "qwen35";
        return "gemma4";
    }

    /** Returns textual stop markers for the given model family. */
    public static List<String> stopSequences(String familyOrModelId) {
        if ("qwen35".equals(normalizeFamily(familyOrModelId))) {
            return List.of("<|im_end|>", "<|endoftext|>");
        }
        return List.of("<end_of_turn>", "<eos>");
    }

    /** Formats a conversation and optional tool declarations into a prompt string for {@code familyOrModelId}. */
    public static String formatPrompt(String familyOrModelId, List<ChatMessage> messages, List<ToolSpec> tools) {
        String family = normalizeFamily(familyOrModelId);
        List<ChatMessage> safeMessages = messages == null ? List.of() : messages;
        List<ToolSpec> safeTools = tools == null ? List.of() : tools;
        if ("qwen35".equals(family)) {
            return formatQwenPrompt(safeMessages, safeTools);
        }
        return formatGemma4Prompt(safeMessages, safeTools);
    }

    private static String formatGemma4Prompt(List<ChatMessage> messages, List<ToolSpec> tools) {
        StringBuilder systemText = new StringBuilder();
        List<ChatMessage> nonSystem = new ArrayList<>();
        for (ChatMessage msg : messages) {
            if ("system".equalsIgnoreCase(msg.role()) || "developer".equalsIgnoreCase(msg.role())) {
                if (systemText.length() > 0) systemText.append("\n\n");
                systemText.append(msg.content());
            } else {
                nonSystem.add(msg);
            }
        }
        if (!tools.isEmpty()) {
            if (systemText.length() > 0) systemText.append("\n\n");
            systemText.append("Available tools:\n");
            for (ToolSpec tool : tools) {
                systemText.append("<|tool_declaration>declaration:")
                    .append(tool.name())
                    .append("{description:")
                    .append(JSONObject.quote(tool.description() == null ? "" : tool.description()))
                    .append(",parameters:")
                    .append(tool.parameters() == null ? "{}" : tool.parameters().toString())
                    .append("}<tool_declaration|>\n");
            }
            systemText.append("When invoking a tool, emit <|tool_call>call:TOOL_NAME{...json_args...}<tool_call|>.");
        }
        StringBuilder out = new StringBuilder();
        if (systemText.length() > 0) {
            out.append("<start_of_turn>system\n")
                .append(systemText)
                .append("<end_of_turn>\n");
        }
        for (ChatMessage msg : nonSystem) {
            String role = msg.role() == null ? "user" : msg.role().toLowerCase(Locale.ROOT);
            if ("assistant".equals(role) || "model".equals(role)) {
                out.append("<start_of_turn>model\n");
                if (msg.content() != null && !msg.content().isEmpty()) {
                    out.append(msg.content());
                }
                if (msg.toolCalls() != null) {
                    for (ParsedToolCall call : msg.toolCalls()) {
                        out.append("<|tool_call>call:")
                            .append(call.name())
                            .append(call.arguments().toString())
                            .append("<tool_call|>");
                    }
                }
                out.append("<end_of_turn>\n");
            } else if ("tool".equals(role)) {
                String toolName = msg.name() != null && !msg.name().isEmpty() ? msg.name() : "tool";
                out.append("<start_of_turn>user\n<|tool_response>response:")
                    .append(toolName)
                    .append("{result:")
                    .append(JSONObject.quote(msg.content() == null ? "" : msg.content()))
                    .append("}<tool_response|><end_of_turn>\n");
            } else {
                out.append("<start_of_turn>user\n")
                    .append(msg.content() == null ? "" : msg.content())
                    .append("<end_of_turn>\n");
            }
        }
        out.append("<start_of_turn>model\n");
        return out.toString();
    }

    private static String formatQwenPrompt(List<ChatMessage> messages, List<ToolSpec> tools) {
        StringBuilder systemText = new StringBuilder();
        List<ChatMessage> nonSystem = new ArrayList<>();
        for (ChatMessage msg : messages) {
            if ("system".equalsIgnoreCase(msg.role()) || "developer".equalsIgnoreCase(msg.role())) {
                if (systemText.length() > 0) systemText.append("\n\n");
                systemText.append(msg.content());
            } else {
                nonSystem.add(msg);
            }
        }
        if (!tools.isEmpty()) {
            if (systemText.length() > 0) systemText.append("\n\n");
            systemText.append("# Tools\n<tools>\n");
            for (ToolSpec tool : tools) {
                try {
                    JSONObject fn = new JSONObject()
                        .put("type", "function")
                        .put("function", new JSONObject()
                            .put("name", tool.name())
                            .put("description", tool.description() == null ? "" : tool.description())
                            .put("parameters", tool.parameters() == null ? new JSONObject() : tool.parameters()));
                    systemText.append(fn.toString()).append('\n');
                } catch (JSONException ignored) {
                }
            }
            systemText.append("</tools>\nFor each tool call return <tool_call>\n{\"name\": \"...\", \"arguments\": {...}}\n</tool_call>.");
        }
        StringBuilder out = new StringBuilder();
        if (systemText.length() > 0) {
            out.append("<|im_start|>system\n")
                .append(systemText)
                .append("<|im_end|>\n");
        }
        for (ChatMessage msg : nonSystem) {
            String role = msg.role() == null ? "user" : msg.role().toLowerCase(Locale.ROOT);
            if ("assistant".equals(role) || "model".equals(role)) {
                out.append("<|im_start|>assistant\n");
                if (msg.content() != null && !msg.content().isEmpty()) {
                    out.append(msg.content());
                }
                if (msg.toolCalls() != null) {
                    for (ParsedToolCall call : msg.toolCalls()) {
                        out.append("\n<tool_call>\n{\"name\":")
                            .append(JSONObject.quote(call.name()))
                            .append(",\"arguments\":")
                            .append(call.arguments().toString())
                            .append("}\n</tool_call>");
                    }
                }
                out.append("<|im_end|>\n");
            } else if ("tool".equals(role)) {
                out.append("<|im_start|>user\n<tool_response>\n")
                    .append(msg.content() == null ? "" : msg.content())
                    .append("\n</tool_response><|im_end|>\n");
            } else {
                out.append("<|im_start|>user\n")
                    .append(msg.content() == null ? "" : msg.content())
                    .append("<|im_end|>\n");
            }
        }
        out.append("<|im_start|>assistant\n");
        return out.toString();
    }

    /** Parses raw model text into clean assistant text, structured tool calls, finish reason, and usage. */
    public static ParsedCompletion parseOutput(
        String familyOrModelId,
        String rawOutput,
        int promptTokens,
        int completionTokens
    ) {
        String family = normalizeFamily(familyOrModelId);
        String cleaned = stripStopMarkers(rawOutput == null ? "" : rawOutput);
        cleaned = GEMMA_THOUGHT.matcher(cleaned).replaceAll("");
        cleaned = QWEN_THINK.matcher(cleaned).replaceAll("");

        List<ParsedToolCall> calls = new ArrayList<>();
        String visibleText;
        if ("qwen35".equals(family)) {
            visibleText = extractQwenCalls(cleaned, calls);
        } else {
            visibleText = extractGemmaCalls(cleaned, calls);
        }
        String finishReason = calls.isEmpty() ? "stop" : "tool_calls";
        int p = Math.max(0, promptTokens);
        int c = Math.max(0, completionTokens);
        return new ParsedCompletion(visibleText.trim(), List.copyOf(calls), finishReason, new TokenUsage(p, c, p + c));
    }

    /** Parses an OpenAI-style {@code messages} JSON array into typed {@link ChatMessage} records. */
    public static List<ChatMessage> parseMessages(JSONArray rawMessages) throws JSONException {
        List<ChatMessage> out = new ArrayList<>();
        if (rawMessages == null) return out;
        for (int i = 0; i < rawMessages.length(); i++) {
            JSONObject item = rawMessages.getJSONObject(i);
            String role = item.optString("role", "user");
            String content = extractMessageContent(item.opt("content"));
            String name = item.has("name") && !item.isNull("name") ? item.optString("name", null) : null;
            String toolCallId = item.has("tool_call_id") && !item.isNull("tool_call_id") ? item.optString("tool_call_id", null) : null;
            List<ParsedToolCall> calls = new ArrayList<>();
            JSONArray rawCalls = item.optJSONArray("tool_calls");
            if (rawCalls != null) {
                for (int j = 0; j < rawCalls.length(); j++) {
                    JSONObject call = rawCalls.optJSONObject(j);
                    if (call == null) continue;
                    JSONObject fn = call.optJSONObject("function");
                    String fnName = fn != null ? fn.optString("name", "") : call.optString("name", "");
                    Object rawArgs = fn != null ? fn.opt("arguments") : call.opt("arguments");
                    JSONObject parsedArgs = parseJsonObject(rawArgs instanceof String s ? s : rawArgs == null ? "{}" : rawArgs.toString());
                    if (!fnName.isEmpty()) {
                        calls.add(new ParsedToolCall(call.optString("id", "call_" + (j + 1)), fnName, parsedArgs));
                    }
                }
            }
            out.add(new ChatMessage(role, content, name, toolCallId, List.copyOf(calls)));
        }
        return out;
    }

    /** Parses an OpenAI-style {@code tools} JSON array into typed {@link ToolSpec} records. */
    public static List<ToolSpec> parseTools(JSONArray rawTools) {
        List<ToolSpec> out = new ArrayList<>();
        if (rawTools == null) return out;
        for (int i = 0; i < rawTools.length(); i++) {
            JSONObject item = rawTools.optJSONObject(i);
            if (item == null) continue;
            JSONObject fn = item.optJSONObject("function");
            JSONObject src = fn != null ? fn : item;
            String name = src.optString("name", "").trim();
            if (name.isEmpty()) continue;
            String description = src.optString("description", "");
            JSONObject params = src.optJSONObject("parameters");
            out.add(new ToolSpec(name, description, params == null ? new JSONObject() : params));
        }
        return out;
    }

    private static String extractMessageContent(Object rawContent) {
        if (rawContent == null || rawContent == JSONObject.NULL) return "";
        if (rawContent instanceof String text) return text;
        if (rawContent instanceof JSONArray parts) {
            StringBuilder joined = new StringBuilder();
            for (int i = 0; i < parts.length(); i++) {
                JSONObject part = parts.optJSONObject(i);
                if (part == null) continue;
                if ("text".equals(part.optString("type", ""))) {
                    joined.append(part.optString("text", ""));
                }
            }
            return joined.toString();
        }
        return rawContent.toString();
    }

    private static String stripStopMarkers(String text) {
        String out = text;
        for (String marker : List.of("<end_of_turn>", "<eos>", "<|im_end|>", "<|endoftext|>")) {
            int idx = out.indexOf(marker);
            if (idx >= 0) {
                out = out.substring(0, idx);
            }
        }
        return out;
    }

    private static String extractGemmaCalls(String input, List<ParsedToolCall> out) {
        String afterWrapped = replaceGemmaMatches(GEMMA_WRAPPED_CALL, input, out);
        return replaceGemmaMatches(GEMMA_DIRECT_CALL, afterWrapped, out);
    }

    private static String replaceGemmaMatches(Pattern pattern, String input, List<ParsedToolCall> out) {
        Matcher matcher = pattern.matcher(input);
        StringBuffer remaining = new StringBuffer();
        while (matcher.find()) {
            String fnName = matcher.group(1);
            String rawArgs = matcher.group(2);
            JSONObject args = parseGemmaArguments(rawArgs);
            if (args != null) {
                out.add(new ParsedToolCall("call_local_" + (out.size() + 1), fnName, args));
                matcher.appendReplacement(remaining, "");
            } else {
                matcher.appendReplacement(remaining, Matcher.quoteReplacement(matcher.group(0)));
            }
        }
        matcher.appendTail(remaining);
        return remaining.toString();
    }

    private static String extractQwenCalls(String input, List<ParsedToolCall> out) {
        Matcher matcher = QWEN_TOOL_BLOCK.matcher(input);
        StringBuffer remaining = new StringBuffer();
        while (matcher.find()) {
            String body = matcher.group(1).trim();
            ParsedToolCall parsed = parseQwenCallBody(body, out.size() + 1);
            if (parsed != null) {
                out.add(parsed);
                matcher.appendReplacement(remaining, "");
            } else {
                matcher.appendReplacement(remaining, Matcher.quoteReplacement(matcher.group(0)));
            }
        }
        matcher.appendTail(remaining);
        return remaining.toString();
    }

    private static ParsedToolCall parseQwenCallBody(String body, int index) {
        Matcher fnMatcher = QWEN_FUNCTION_BLOCK.matcher(body);
        if (fnMatcher.matches()) {
            String name = fnMatcher.group(1).trim();
            String paramsText = fnMatcher.group(2);
            JSONObject args = new JSONObject();
            Matcher paramMatcher = QWEN_PARAMETER.matcher(paramsText);
            while (paramMatcher.find()) {
                String key = paramMatcher.group(1).trim();
                String rawVal = paramMatcher.group(2).replaceFirst("^\\r?\\n", "").replaceFirst("\\r?\\n$", "");
                try {
                    args.put(key, parsePrimitiveOrJson(rawVal));
                } catch (JSONException ignored) {
                }
            }
            return new ParsedToolCall("call_local_" + index, name, args);
        }
        try {
            JSONObject json = new JSONObject(body);
            String name = json.optString("name", "").trim();
            if (name.isEmpty()) return null;
            Object rawArgs = json.opt("arguments");
            JSONObject args;
            if (rawArgs instanceof JSONObject obj) {
                args = obj;
            } else if (rawArgs instanceof String str) {
                args = parseJsonObject(str);
            } else {
                args = new JSONObject();
            }
            return new ParsedToolCall("call_local_" + index, name, args);
        } catch (JSONException malformed) {
            return null;
        }
    }

    private static JSONObject parseGemmaArguments(String raw) {
        if (raw == null) return null;
        String trimmed = raw.trim();
        try {
            return new JSONObject(trimmed);
        } catch (JSONException ignored) {
        }
        Matcher quoted = GEMMA_QUOTED_STRING.matcher(trimmed);
        StringBuffer normalized = new StringBuffer();
        while (quoted.find()) {
            quoted.appendReplacement(normalized, Matcher.quoteReplacement(JSONObject.quote(quoted.group(1))));
        }
        quoted.appendTail(normalized);
        String jsonified = UNQUOTED_KEY.matcher(normalized.toString()).replaceAll("$1\"$2\":");
        try {
            return new JSONObject(jsonified);
        } catch (JSONException failed) {
            return null;
        }
    }

    private static JSONObject parseJsonObject(String raw) {
        if (raw == null || raw.isBlank()) return new JSONObject();
        try {
            return new JSONObject(raw);
        } catch (JSONException failed) {
            return new JSONObject();
        }
    }

    private static Object parsePrimitiveOrJson(String raw) {
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return raw;
        if ("true".equals(trimmed)) return Boolean.TRUE;
        if ("false".equals(trimmed)) return Boolean.FALSE;
        if ("null".equals(trimmed)) return JSONObject.NULL;
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
            try {
                return trimmed.startsWith("{") ? new JSONObject(trimmed) : new JSONArray(trimmed);
            } catch (JSONException ignored) {
                return raw;
            }
        }
        if (trimmed.matches("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?")) {
            try {
                return trimmed.contains(".") ? Double.parseDouble(trimmed) : Long.parseLong(trimmed);
            } catch (NumberFormatException ignored) {
                return raw;
            }
        }
        return raw;
    }
}
