import {iconStyle} from '../icon-style';
import React from "react";
import templateHtml from "./template.html?raw";
/* Minimal renderer for the prototype's .dc.html template: {{holes}}, sc-if, sc-for, events, refs. */

  var h = React.createElement;
  var EVENTS = { onsubmit:"onSubmit", onerror:"onError", onload:"onLoad", onfocuscapture: "onFocusCapture", onfocus: "onFocus", onblur: "onBlur", onclick: "onClick", oncontextmenu: "onContextMenu", onpointermove: "onPointerMove", onpointerdown: "onPointerDown", onpointerup: "onPointerUp", onpointerleave: "onPointerLeave", onpointercancel: "onPointerCancel", onlostpointercapture: "onLostPointerCapture", onchange: "onChange", onkeydown: "onKeyDown", oninput: "onInput" };
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(path, scope) {
    if (path === "true") return true;
    if (path === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    var parts = path.split("."); var cur = scope;
    for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = cur[parts[i]]; }
    return cur;
  }
  function interp(str, scope) { return str.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? "" : String(v); }); }
  function camel(k) { if (k.indexOf("--") === 0) return k; return k.replace(/^-(webkit|moz|ms)-/, function (_, v) { return v.charAt(0).toUpperCase() + v.slice(1) + "-"; }).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }
  const boxStyle = document.createElement("span").style;
  // The template repeats the same style strings on every render, so each distinct string is parsed
  // once and its frozen result shared. Interpolated values (heights, offsets) keep producing new
  // strings, so the cache is emptied when it reaches its limit.
  const STYLE_CACHE_LIMIT = 4096;
  const styleCache = new Map();
  function parseStyle(s) {
    var cached = styleCache.get(s);
    if (cached) return cached;
    var o = {};
    // Native captures use data URLs, whose semicolon belongs inside url(...).
    // Split declarations only outside CSS strings and function arguments.
    var declarations = [], start = 0, depth = 0, quote = "", escaped = false;
    for (var at = 0; at < s.length; at++) {
      var c = s[at];
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === ";" && depth === 0) { declarations.push(s.slice(start, at)); start = at + 1; }
    }
    declarations.push(s.slice(start));
    declarations.forEach(function (decl) {
      var i = decl.indexOf(":"); if (i < 0) return;
      var k = decl.slice(0, i).trim(); var v = decl.slice(i + 1).trim();
      if (k && v) {
        // React must not alternate shorthand padding/margin with longhands on
        // reused template nodes. Expand valid box shorthands in source order.
        if (k === "padding" || k === "margin") {
          boxStyle.cssText = ""; boxStyle.setProperty(k, v);
          const sides = ["top", "right", "bottom", "left"];
          const values = sides.map(side => boxStyle.getPropertyValue(k + "-" + side));
          if (values.every(Boolean)) { sides.forEach((side, index) => { o[camel(k + "-" + side)] = values[index]; }); return; }
        }
        o[camel(k)] = v;
      }
    });
    if (styleCache.size >= STYLE_CACHE_LIMIT) styleCache.clear();
    styleCache.set(s, Object.freeze(o));
    return o;
  }
  function props(el, scope, key) {
    var p = { key: key };
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i]; var n = a.name; var raw = a.value;
      var m = raw.match(WHOLE);
      var val = m ? lookup(m[1], scope) : (raw.indexOf("{{") >= 0 ? interp(raw, scope) : raw);
      if (n === "aria-label" && raw === "{{name}}: summarize this file" && scope.files?.pv?.askLabel) val = scope.files.pv.askLabel;
      if (n === "aria-label" && raw === "Stop and save" && scope.notes?.rec?.primaryLabel) val = scope.notes.rec.primaryLabel;
      if (n === "d" && raw === "{{ic.stop}}" && scope.notes?.rec?.primaryIcon) val = scope.notes.rec.primaryIcon;
      if (n === "class") n = "className";
      else if (n === "for") n = "htmlFor";
      else if (EVENTS[n]) n = EVENTS[n];
      else if (n === "viewbox") n = "viewBox";
      else if (n === "srcdoc") n = "srcDoc";
      else if (n === "referrerpolicy") n = "referrerPolicy";
      else if (n === "enterkeyhint") n = "enterKeyHint";
      else if (n === "autocomplete") n = "autoComplete";
      else if (n === "popovertarget") n = "popoverTarget";
      else if (n === "popovertargetaction") n = "popoverTargetAction";
      else if (n === "tabindex") n = "tabIndex";
      else if (n === "maxlength") n = "maxLength";
      else if (n === "minlength") n = "minLength";
      else if (n === "readonly") n = "readOnly";
      if (n === "style") { p.style = typeof val === "string" ? parseStyle(val) : val; continue; }
      if (n === "value" && el.tagName.toLowerCase() === "input") { p.value = val == null ? "" : val; continue; }
      p[n] = val;
    }
    return p;
  }
  function kids(nodes, scope) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var r = node(nodes[i], scope, i);
      if (r == null) continue;
      if (Array.isArray(r)) out.push(h(React.Fragment, { key: "f" + i }, r)); else out.push(r);
    }
    return out;
  }
  function node(n, scope, key) {
    if (n.nodeType === 3) {
      var t = n.nodeValue;
      if (!t.trim() && /\n/.test(t)) return null;
      var whole = t.trim().match(WHOLE);
      var value = whole ? lookup(whole[1], scope) : null;
      if (React.isValidElement(value)) return h(React.Fragment, { key: key }, value);
      return t.indexOf("{{") >= 0 ? interp(t, scope) : t;
    }
    if (n.nodeType !== 1) return null;
    var tag = n.tagName.toLowerCase();
    if (tag === "sc-if") {
      var m = (n.getAttribute("value") || "").match(WHOLE);
      var ok = m ? lookup(m[1], scope) : false;
      return ok ? h(React.Fragment, { key: key }, kids(n.childNodes, scope)) : null;
    }
    // A React element from the scope, with template-rendered children passed as named props:
    // <sc-element value="{{el}}"><sc-slot name="cards">…</sc-slot></sc-element>.
    if (tag === "sc-element") {
      var em = (n.getAttribute("value") || "").match(WHOLE);
      var element = em ? lookup(em[1], scope) : null;
      if (!React.isValidElement(element)) return null;
      var slots = { key: key };
      for (var c = 0; c < n.childNodes.length; c++) {
        var slot = n.childNodes[c];
        if (slot.nodeType === 1 && slot.tagName.toLowerCase() === "sc-slot") slots[slot.getAttribute("name")] = h(React.Fragment, null, kids(slot.childNodes, scope));
      }
      return React.cloneElement(element, slots);
    }
    if (tag === "sc-for") {
      var lm = (n.getAttribute("list") || "").match(WHOLE);
      var list = (lm ? lookup(lm[1], scope) : []) || [];
      var as = n.getAttribute("as") || "item";
      var km = (n.getAttribute("key") || "").match(WHOLE);
      return h(React.Fragment, { key: key }, list.map(function (item, i) {
        var s = Object.create(scope); s[as] = item; s.$index = i;
        var itemKey = km ? lookup(km[1], s) : i;
        return h(React.Fragment, { key: itemKey == null ? i : itemKey }, kids(n.childNodes, s));
      }));
    }
    // Resolve both static IC references and dynamic row paths through one display map.
    if (tag === "svg" && n.getAttribute("viewBox") === "0 0 24 24" && n.children.length === 1 && n.children[0].localName === "path") {
      var asset = scope.iconAssets?.[props(n.children[0], scope, 0).d];
      if (asset) {
        var original = props(n, scope, key);
        var icon = { key: key, "data-alpha-icon": asset };
        Object.keys(original).forEach(function (name) {
          if (["className", "id", "title", "role", "tabIndex"].includes(name) || name.startsWith("aria-") || /^on[A-Z]/.test(name)) icon[name] = original[name];
        });
        if (icon["aria-label"] && !icon.role) icon.role = "img";
        if (!icon["aria-label"] && !icon["aria-labelledby"] && !icon.role) icon["aria-hidden"] = "true";
        var libraryStyle = iconStyle(asset, !!original.style?.fill && original.style.fill !== "none");
        icon.style = Object.assign({}, libraryStyle, original.style, { mask: libraryStyle.mask, WebkitMask: libraryStyle.WebkitMask, backgroundColor: "currentColor" });
        if (original.width) icon.style.width = original.width;
        if (original.height) icon.style.height = original.height;
        // Class-sized icons retain their established dimensions unless explicitly sized.
        if (original.className && !original.width && !original.style?.width) delete icon.style.width;
        if (original.className && !original.height && !original.style?.height) delete icon.style.height;
        // Keep an existing badge/backplate separate from the glyph mask.
        if (original.className?.split(/\s+/).some(function (name) { return name !== "i"; }) || original.style?.background || original.style?.backgroundColor) {
          var outer = Object.assign({}, icon, { style: original.style });
          delete outer["data-alpha-icon"];
          return h("span", outer, h("span", { "aria-hidden": "true", "data-alpha-icon": asset, style: Object.assign({}, libraryStyle, { display: "block", width: "100%", height: "100%" }) }));
        }
        return h("span", icon);
      }
    }
    var isSvg = n.namespaceURI === "http://www.w3.org/2000/svg";
    var tname = isSvg ? n.localName : tag;
    var c = kids(n.childNodes, scope);
    var built = props(n, scope, key);
    // A drawing with no name of its own is decoration for the control or text beside it. Without
    // this it is announced as an unlabelled image (uncatalogued icon paths, the map drawing).
    if (tag === "svg" && !built["aria-label"] && !built["aria-labelledby"] && !built.role && built["aria-hidden"] === undefined) built["aria-hidden"] = "true";
    return h.apply(null, [tname, built].concat(c));
  }

  const templateElement = document.createElement("template");
  templateElement.innerHTML = templateHtml;
  var tpl = templateElement.content;
  // Keep reference nodes in an inert template document: cloning into the live
  // document can request literal {{...}} image URLs before bindings resolve.
  const phoneTpl = document.createElement("template").content;
  const phoneRoot = phoneTpl.ownerDocument.importNode(tpl.querySelector('.os'), false);
  phoneRoot.classList.add('alpha-phone');
  phoneRoot.appendChild(phoneTpl.ownerDocument.importNode(tpl.querySelector('[data-screen]'), true));
  phoneTpl.appendChild(phoneRoot);
  export class DCLogic extends React.Component {
    constructor(p) { super(p); this.state = {}; }
    render() { var vals = this.renderVals(); var out = kids((this.props.phoneSurface ? phoneTpl : tpl).childNodes, vals); return h(React.Fragment, null, out); }
  };
