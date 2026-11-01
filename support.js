/* morphdom 2.7.4, MIT License, https://github.com/patrick-steele-idem/morphdom (full license in vendor/morphdom-LICENSE.txt) */
(function(global,factory){typeof exports==="object"&&typeof module!=="undefined"?module.exports=factory():typeof define==="function"&&define.amd?define(factory):(global=global||self,global.morphdom=factory())})(this,function(){"use strict";var DOCUMENT_FRAGMENT_NODE=11;function morphAttrs(fromNode,toNode){var toNodeAttrs=toNode.attributes;var attr;var attrName;var attrNamespaceURI;var attrValue;var fromValue;if(toNode.nodeType===DOCUMENT_FRAGMENT_NODE||fromNode.nodeType===DOCUMENT_FRAGMENT_NODE){return}for(var i=toNodeAttrs.length-1;i>=0;i--){attr=toNodeAttrs[i];attrName=attr.name;attrNamespaceURI=attr.namespaceURI;attrValue=attr.value;if(attrNamespaceURI){attrName=attr.localName||attrName;fromValue=fromNode.getAttributeNS(attrNamespaceURI,attrName);if(fromValue!==attrValue){if(attr.prefix==="xmlns"){attrName=attr.name}fromNode.setAttributeNS(attrNamespaceURI,attrName,attrValue)}}else{fromValue=fromNode.getAttribute(attrName);if(fromValue!==attrValue){fromNode.setAttribute(attrName,attrValue)}}}var fromNodeAttrs=fromNode.attributes;for(var d=fromNodeAttrs.length-1;d>=0;d--){attr=fromNodeAttrs[d];attrName=attr.name;attrNamespaceURI=attr.namespaceURI;if(attrNamespaceURI){attrName=attr.localName||attrName;if(!toNode.hasAttributeNS(attrNamespaceURI,attrName)){fromNode.removeAttributeNS(attrNamespaceURI,attrName)}}else{if(!toNode.hasAttribute(attrName)){fromNode.removeAttribute(attrName)}}}}var range;var NS_XHTML="http://www.w3.org/1999/xhtml";var doc=typeof document==="undefined"?undefined:document;var HAS_TEMPLATE_SUPPORT=!!doc&&"content"in doc.createElement("template");var HAS_RANGE_SUPPORT=!!doc&&doc.createRange&&"createContextualFragment"in doc.createRange();function createFragmentFromTemplate(str){var template=doc.createElement("template");template.innerHTML=str;return template.content.childNodes[0]}function createFragmentFromRange(str){if(!range){range=doc.createRange();range.selectNode(doc.body)}var fragment=range.createContextualFragment(str);return fragment.childNodes[0]}function createFragmentFromWrap(str){var fragment=doc.createElement("body");fragment.innerHTML=str;return fragment.childNodes[0]}function toElement(str){str=str.trim();if(HAS_TEMPLATE_SUPPORT){return createFragmentFromTemplate(str)}else if(HAS_RANGE_SUPPORT){return createFragmentFromRange(str)}return createFragmentFromWrap(str)}function compareNodeNames(fromEl,toEl){var fromNodeName=fromEl.nodeName;var toNodeName=toEl.nodeName;var fromCodeStart,toCodeStart;if(fromNodeName===toNodeName){return true}fromCodeStart=fromNodeName.charCodeAt(0);toCodeStart=toNodeName.charCodeAt(0);if(fromCodeStart<=90&&toCodeStart>=97){return fromNodeName===toNodeName.toUpperCase()}else if(toCodeStart<=90&&fromCodeStart>=97){return toNodeName===fromNodeName.toUpperCase()}else{return false}}function createElementNS(name,namespaceURI){return!namespaceURI||namespaceURI===NS_XHTML?doc.createElement(name):doc.createElementNS(namespaceURI,name)}function moveChildren(fromEl,toEl){var curChild=fromEl.firstChild;while(curChild){var nextChild=curChild.nextSibling;toEl.appendChild(curChild);curChild=nextChild}return toEl}function syncBooleanAttrProp(fromEl,toEl,name){if(fromEl[name]!==toEl[name]){fromEl[name]=toEl[name];if(fromEl[name]){fromEl.setAttribute(name,"")}else{fromEl.removeAttribute(name)}}}var specialElHandlers={OPTION:function(fromEl,toEl){var parentNode=fromEl.parentNode;if(parentNode){var parentName=parentNode.nodeName.toUpperCase();if(parentName==="OPTGROUP"){parentNode=parentNode.parentNode;parentName=parentNode&&parentNode.nodeName.toUpperCase()}if(parentName==="SELECT"&&!parentNode.hasAttribute("multiple")){if(fromEl.hasAttribute("selected")&&!toEl.selected){fromEl.setAttribute("selected","selected");fromEl.removeAttribute("selected")}parentNode.selectedIndex=-1}}syncBooleanAttrProp(fromEl,toEl,"selected")},INPUT:function(fromEl,toEl){syncBooleanAttrProp(fromEl,toEl,"checked");syncBooleanAttrProp(fromEl,toEl,"disabled");if(fromEl.value!==toEl.value){fromEl.value=toEl.value}if(!toEl.hasAttribute("value")){fromEl.removeAttribute("value")}},TEXTAREA:function(fromEl,toEl){var newValue=toEl.value;if(fromEl.value!==newValue){fromEl.value=newValue}var firstChild=fromEl.firstChild;if(firstChild){var oldValue=firstChild.nodeValue;if(oldValue==newValue||!newValue&&oldValue==fromEl.placeholder){return}firstChild.nodeValue=newValue}},SELECT:function(fromEl,toEl){if(!toEl.hasAttribute("multiple")){var selectedIndex=-1;var i=0;var curChild=fromEl.firstChild;var optgroup;var nodeName;while(curChild){nodeName=curChild.nodeName&&curChild.nodeName.toUpperCase();if(nodeName==="OPTGROUP"){optgroup=curChild;curChild=optgroup.firstChild}else{if(nodeName==="OPTION"){if(curChild.hasAttribute("selected")){selectedIndex=i;break}i++}curChild=curChild.nextSibling;if(!curChild&&optgroup){curChild=optgroup.nextSibling;optgroup=null}}}fromEl.selectedIndex=selectedIndex}}};var ELEMENT_NODE=1;var DOCUMENT_FRAGMENT_NODE$1=11;var TEXT_NODE=3;var COMMENT_NODE=8;function noop(){}function defaultGetNodeKey(node){if(node){return node.getAttribute&&node.getAttribute("id")||node.id}}function morphdomFactory(morphAttrs){return function morphdom(fromNode,toNode,options){if(!options){options={}}if(typeof toNode==="string"){if(fromNode.nodeName==="#document"||fromNode.nodeName==="HTML"||fromNode.nodeName==="BODY"){var toNodeHtml=toNode;toNode=doc.createElement("html");toNode.innerHTML=toNodeHtml}else{toNode=toElement(toNode)}}else if(toNode.nodeType===DOCUMENT_FRAGMENT_NODE$1){toNode=toNode.firstElementChild}var getNodeKey=options.getNodeKey||defaultGetNodeKey;var onBeforeNodeAdded=options.onBeforeNodeAdded||noop;var onNodeAdded=options.onNodeAdded||noop;var onBeforeElUpdated=options.onBeforeElUpdated||noop;var onElUpdated=options.onElUpdated||noop;var onBeforeNodeDiscarded=options.onBeforeNodeDiscarded||noop;var onNodeDiscarded=options.onNodeDiscarded||noop;var onBeforeElChildrenUpdated=options.onBeforeElChildrenUpdated||noop;var skipFromChildren=options.skipFromChildren||noop;var addChild=options.addChild||function(parent,child){return parent.appendChild(child)};var childrenOnly=options.childrenOnly===true;var fromNodesLookup=Object.create(null);var keyedRemovalList=[];function addKeyedRemoval(key){keyedRemovalList.push(key)}function walkDiscardedChildNodes(node,skipKeyedNodes){if(node.nodeType===ELEMENT_NODE){var curChild=node.firstChild;while(curChild){var key=undefined;if(skipKeyedNodes&&(key=getNodeKey(curChild))){addKeyedRemoval(key)}else{onNodeDiscarded(curChild);if(curChild.firstChild){walkDiscardedChildNodes(curChild,skipKeyedNodes)}}curChild=curChild.nextSibling}}}function removeNode(node,parentNode,skipKeyedNodes){if(onBeforeNodeDiscarded(node)===false){return}if(parentNode){parentNode.removeChild(node)}onNodeDiscarded(node);walkDiscardedChildNodes(node,skipKeyedNodes)}function indexTree(node){if(node.nodeType===ELEMENT_NODE||node.nodeType===DOCUMENT_FRAGMENT_NODE$1){var curChild=node.firstChild;while(curChild){var key=getNodeKey(curChild);if(key){fromNodesLookup[key]=curChild}indexTree(curChild);curChild=curChild.nextSibling}}}indexTree(fromNode);function handleNodeAdded(el){onNodeAdded(el);var curChild=el.firstChild;while(curChild){var nextSibling=curChild.nextSibling;var key=getNodeKey(curChild);if(key){var unmatchedFromEl=fromNodesLookup[key];if(unmatchedFromEl&&compareNodeNames(curChild,unmatchedFromEl)){curChild.parentNode.replaceChild(unmatchedFromEl,curChild);morphEl(unmatchedFromEl,curChild)}else{handleNodeAdded(curChild)}}else{handleNodeAdded(curChild)}curChild=nextSibling}}function cleanupFromEl(fromEl,curFromNodeChild,curFromNodeKey){while(curFromNodeChild){var fromNextSibling=curFromNodeChild.nextSibling;if(curFromNodeKey=getNodeKey(curFromNodeChild)){addKeyedRemoval(curFromNodeKey)}else{removeNode(curFromNodeChild,fromEl,true)}curFromNodeChild=fromNextSibling}}function morphEl(fromEl,toEl,childrenOnly){var toElKey=getNodeKey(toEl);if(toElKey){delete fromNodesLookup[toElKey]}if(!childrenOnly){var beforeUpdateResult=onBeforeElUpdated(fromEl,toEl);if(beforeUpdateResult===false){return}else if(beforeUpdateResult instanceof HTMLElement){fromEl=beforeUpdateResult;indexTree(fromEl)}morphAttrs(fromEl,toEl);onElUpdated(fromEl);if(onBeforeElChildrenUpdated(fromEl,toEl)===false){return}}if(fromEl.nodeName!=="TEXTAREA"){morphChildren(fromEl,toEl)}else{specialElHandlers.TEXTAREA(fromEl,toEl)}}function morphChildren(fromEl,toEl){var skipFrom=skipFromChildren(fromEl,toEl);var curToNodeChild=toEl.firstChild;var curFromNodeChild=fromEl.firstChild;var curToNodeKey;var curFromNodeKey;var fromNextSibling;var toNextSibling;var matchingFromEl;outer:while(curToNodeChild){toNextSibling=curToNodeChild.nextSibling;curToNodeKey=getNodeKey(curToNodeChild);while(!skipFrom&&curFromNodeChild){fromNextSibling=curFromNodeChild.nextSibling;if(curToNodeChild.isSameNode&&curToNodeChild.isSameNode(curFromNodeChild)){curToNodeChild=toNextSibling;curFromNodeChild=fromNextSibling;continue outer}curFromNodeKey=getNodeKey(curFromNodeChild);var curFromNodeType=curFromNodeChild.nodeType;var isCompatible=undefined;if(curFromNodeType===curToNodeChild.nodeType){if(curFromNodeType===ELEMENT_NODE){if(curToNodeKey){if(curToNodeKey!==curFromNodeKey){if(matchingFromEl=fromNodesLookup[curToNodeKey]){if(fromNextSibling===matchingFromEl){isCompatible=false}else{fromEl.insertBefore(matchingFromEl,curFromNodeChild);if(curFromNodeKey){addKeyedRemoval(curFromNodeKey)}else{removeNode(curFromNodeChild,fromEl,true)}curFromNodeChild=matchingFromEl;curFromNodeKey=getNodeKey(curFromNodeChild)}}else{isCompatible=false}}}else if(curFromNodeKey){isCompatible=false}isCompatible=isCompatible!==false&&compareNodeNames(curFromNodeChild,curToNodeChild);if(isCompatible){morphEl(curFromNodeChild,curToNodeChild)}}else if(curFromNodeType===TEXT_NODE||curFromNodeType==COMMENT_NODE){isCompatible=true;if(curFromNodeChild.nodeValue!==curToNodeChild.nodeValue){curFromNodeChild.nodeValue=curToNodeChild.nodeValue}}}if(isCompatible){curToNodeChild=toNextSibling;curFromNodeChild=fromNextSibling;continue outer}if(curFromNodeKey){addKeyedRemoval(curFromNodeKey)}else{removeNode(curFromNodeChild,fromEl,true)}curFromNodeChild=fromNextSibling}if(curToNodeKey&&(matchingFromEl=fromNodesLookup[curToNodeKey])&&compareNodeNames(matchingFromEl,curToNodeChild)){if(!skipFrom){addChild(fromEl,matchingFromEl)}morphEl(matchingFromEl,curToNodeChild)}else{var onBeforeNodeAddedResult=onBeforeNodeAdded(curToNodeChild);if(onBeforeNodeAddedResult!==false){if(onBeforeNodeAddedResult){curToNodeChild=onBeforeNodeAddedResult}if(curToNodeChild.actualize){curToNodeChild=curToNodeChild.actualize(fromEl.ownerDocument||doc)}addChild(fromEl,curToNodeChild);handleNodeAdded(curToNodeChild)}}curToNodeChild=toNextSibling;curFromNodeChild=fromNextSibling}cleanupFromEl(fromEl,curFromNodeChild,curFromNodeKey);var specialElHandler=specialElHandlers[fromEl.nodeName];if(specialElHandler){specialElHandler(fromEl,toEl)}}var morphedNode=fromNode;var morphedNodeType=morphedNode.nodeType;var toNodeType=toNode.nodeType;if(!childrenOnly){if(morphedNodeType===ELEMENT_NODE){if(toNodeType===ELEMENT_NODE){if(!compareNodeNames(fromNode,toNode)){onNodeDiscarded(fromNode);morphedNode=moveChildren(fromNode,createElementNS(toNode.nodeName,toNode.namespaceURI))}}else{morphedNode=toNode}}else if(morphedNodeType===TEXT_NODE||morphedNodeType===COMMENT_NODE){if(toNodeType===morphedNodeType){if(morphedNode.nodeValue!==toNode.nodeValue){morphedNode.nodeValue=toNode.nodeValue}return morphedNode}else{morphedNode=toNode}}}if(morphedNode===toNode){onNodeDiscarded(fromNode)}else{if(toNode.isSameNode&&toNode.isSameNode(morphedNode)){return}morphEl(morphedNode,toNode,childrenOnly);if(keyedRemovalList){for(var i=0,len=keyedRemovalList.length;i<len;i++){var elToRemove=fromNodesLookup[keyedRemovalList[i]];if(elToRemove){removeNode(elToRemove,elToRemove.parentNode,false)}}}}if(!childrenOnly&&morphedNode!==fromNode&&fromNode.parentNode){if(morphedNode.actualize){morphedNode=morphedNode.actualize(fromNode.ownerDocument||doc)}fromNode.parentNode.replaceChild(morphedNode,fromNode)}return morphedNode}}var morphdom=morphdomFactory(morphAttrs);return morphdom});
/* Local runtime for the .dc.html boards.
   Renders {{holes}}, <sc-for>, <sc-if> and on* handlers from the board template,
   and patches the page with morphdom on every setState. */
(function () {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var BOOL = { checked: 1, disabled: 1, selected: 1, readonly: 1, required: 1, multiple: 1 };
  var EVENTS = { click: 1, change: 1, input: 1, mousemove: 1, mouseleave: 1, mouseenter: 1, focus: 1, blur: 1, keydown: 1, keyup: 1, submit: 1 };
  var HOLE = /\{\{\s*([^{}]+?)\s*\}\}/g;

  // Site theme (assets/theme.css next to this script); night pages get html.sx-night.
  (function () {
    var me = document.currentScript, base = me && me.src ? me.src.replace(/support\.js(\?.*)?$/, '') : '';
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = base + 'assets/theme.css';
    (document.head || document.documentElement).appendChild(link);
    if (/\/night\//.test(location.pathname)) document.documentElement.classList.add('sx-night');
    // first page of a visit: a short logo intro
    try {
      if (!sessionStorage.getItem('sx_intro') && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        sessionStorage.setItem('sx_intro', '1');
        var intro = document.createElement('div'); intro.id = 'sx-intro'; intro.setAttribute('aria-hidden', 'true');
        intro.innerHTML = '<img src="' + base + 'assets/streax-mark.png" alt="" width="64" height="64"><span>Streax</span>';
        (document.body || document.documentElement).appendChild(intro);
        setTimeout(function () { if (intro.parentNode) intro.parentNode.removeChild(intro); }, 1600);
      }
    } catch (e) {}
  })();

  var early = document.createElement('style');
  early.textContent = 'x-dc{display:none!important}';
  (document.head || document.documentElement).appendChild(early);

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (s) {
    var next = typeof s === 'function' ? s(this.state, this.props) : s;
    if (next) this.state = Object.assign({}, this.state, next);
    if (this.__schedule) this.__schedule();
  };
  DCLogic.prototype.renderVals = function () { return {}; };
  window.DCLogic = DCLogic;
  // Hide images that fail to load (for example a brand icon that is not available), so the initials underneath show.
  document.addEventListener('error', function (e) { var t = e.target; if (t && t.tagName === 'IMG') t.style.visibility = 'hidden'; }, true);
  window.addEventListener('unhandledrejection', function (e) {
    if (/clipboard|writeText|permission/i.test(String(e.reason && (e.reason.message || e.reason)))) e.preventDefault();
  });

  function lookup(path, scopes, vals) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), head = parts[0], base, found = false;
    for (var i = 0; i < scopes.length; i++) { if (scopes[i].name === head) { base = scopes[i].value; found = true; break; } }
    if (!found) base = vals ? vals[head] : undefined;
    for (var j = 1; j < parts.length && base != null; j++) base = base[parts[j]];
    return base;
  }
  function pureHole(s) { var m = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(s || ''); return m ? m[1] : null; }
  function subst(s, scopes, vals) {
    if (!s || s.indexOf('{{') === -1) return s;
    return s.replace(HOLE, function (_, p) { var v = lookup(p, scopes, vals); return v == null ? '' : String(v); });
  }
  function holeValue(attr, scopes, vals) { var p = pureHole(attr); return p == null ? attr : lookup(p, scopes, vals); }

  function renderChildren(node, scopes, vals, out, reg) {
    var kids = node.childNodes;
    for (var k = 0; k < kids.length; k++) {
      var child = kids[k];
      if (child.nodeType === 3) { out.appendChild(document.createTextNode(subst(child.nodeValue, scopes, vals))); continue; }
      if (child.nodeType !== 1) continue;
      var tag = child.localName;
      if (tag === 'helmet' || tag === 'script') continue;
      if (tag === 'sc-for') {
        var list = holeValue(child.getAttribute('list'), scopes, vals), as = child.getAttribute('as') || 'item';
        if (Array.isArray(list)) {
          for (var i = 0; i < list.length; i++) renderChildren(child, [{ name: as, value: list[i] }].concat(scopes), vals, out, reg);
        }
        continue;
      }
      if (tag === 'sc-if') {
        if (holeValue(child.getAttribute('value'), scopes, vals)) renderChildren(child, scopes, vals, out, reg);
        continue;
      }
      var el = child.namespaceURI === SVGNS ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
      var attrs = child.attributes, textValue = null;
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name, raw = attrs[a].value;
        if (name.indexOf('hint-') === 0) continue;
        if (name.length > 2 && name.indexOf('on') === 0 && EVENTS[name.slice(2)]) {
          var fn = holeValue(raw, scopes, vals);
          if (typeof fn === 'function') { reg.push(fn); el.setAttribute('data-dc-' + name.slice(2), String(reg.length - 1)); }
          continue;
        }
        if (BOOL[name] && pureHole(raw) != null) { if (holeValue(raw, scopes, vals)) el.setAttribute(name, ''); continue; }
        if (tag === 'textarea' && name === 'value') { textValue = subst(raw, scopes, vals); continue; }
        el.setAttribute(name, subst(raw, scopes, vals));
      }
      if (tag === 'textarea') { el.textContent = textValue != null ? textValue : subst(child.textContent, scopes, vals); out.appendChild(el); continue; }
      renderChildren(child, scopes, vals, el, reg);
      out.appendChild(el);
    }
  }

  function isToggle(t) { return t && (t.type === 'checkbox' || t.type === 'radio' || t.localName === 'select'); }

  // Live on-chain figures from the Streax monitor replace the published snapshot
  // for the casinos it tracks. Other casinos keep the snapshot (c.live stays false).
  function applyLive(D, j) {
    var by = {};
    j.casinos.forEach(function (r) { by[r.slug] = r; });
    var n = 0;
    if (D.casinos) {
      D.casinos.forEach(function (c) {
        var r = by[c.slug];
        if (!r) return;
        ['dep', 'depS', 'wal', 'walS', 'cnt', 'cntS', 'depCount', 'pay', 'payS', 'payCount', 'hot', 'hotS', 'net', 'avg'].forEach(function (k) { c[k] = r[k]; });
        if (r.chains) c.chains = r.chains; else delete c.chains;
        if (r.assets) c.assets = r.assets;
        c.live = true; n++;
      });
      if (j.liveOnly) {
        // Snapshot switched off: lists show tracked casinos only. A casino profile
        // keeps its own entry so the page still opens, labeled as not tracked yet.
        var onProfile = /Casino\.dc\.html/.test(location.pathname);
        D.casinos.forEach(function (c) { if (!c.live) c.untracked = true; });
        if (!onProfile) D.casinos = D.casinos.filter(function (c) { return c.live; });
      }
      D.casinos.sort(function (a, b) { return (a.untracked ? 1 : 0) - (b.untracked ? 1 : 0) || b.dep - a.dep; });
      D.casinos.forEach(function (c, i) { c.rank = c.untracked ? 0 : i + 1; });
      if (D.totals) {
        var s = function (k) { return D.casinos.reduce(function (t, c) { return t + (c.untracked ? 0 : c[k] || 0); }, 0); };
        D.totals.operators = D.casinos.filter(function (c) { return !c.untracked; }).length;
        var m = function (v) { return '$' + (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : (v / 1e3).toFixed(2) + 'K'); };
        var dep = s('dep'), pay = s('pay'), hot = s('hot'), wal = s('wal'), cnt = s('depCount') || s('cnt');
        Object.assign(D.totals, { dep: m(dep), depN: dep, pay: m(pay), hot: m(hot), hotN: hot, wallets: (wal / 1e3).toFixed(1) + 'K', walletsN: wal, deposits: Math.round(cnt).toLocaleString('en-US'), depositsN: cnt });
      }
    }
    if (D.idx) {
      var rank = {};
      (D.casinos || []).forEach(function (c) { rank[c.slug] = c; });
      D.idx.forEach(function (x) {
        var c = rank[x[1]], r = by[x[1]];
        if (r) { x[2] = r.depS; if (c) x[3] = c.rank; }
        else if (j.liveOnly) { x[2] = 'not tracked'; x[3] = 999; }
        else if (c) { x[2] = c.depS; x[3] = c.rank; }
      });
      if (D.casinos || j.liveOnly) D.idx.sort(function (a, b) { return a[3] - b[3]; });
    }
    D.live = { n: n || j.casinos.length, at: j.updatedAt, slugs: Object.keys(by) };
    D.liveOnly = !!j.liveOnly;
  }

  function boot() {
    var holder = document.getElementById('dc-tpl');
    var xdc = holder && holder.content ? holder.content.querySelector('x-dc') : document.querySelector('x-dc');
    var scriptEl = document.querySelector('script[type="text/x-dc"][data-dc-script]');
    if (!xdc || !scriptEl) return;
    var props = {};
    try { props = JSON.parse(scriptEl.getAttribute('data-props') || '{}'); } catch (e) { props = {}; }
    var helmet = xdc.querySelector('helmet');
    if (helmet) { Array.prototype.slice.call(helmet.children).forEach(function (n) { document.head.appendChild(n.cloneNode(true)); }); }
    var tpl = holder ? xdc : xdc.cloneNode(true);
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    else if (xdc.parentNode) xdc.parentNode.removeChild(xdc);

    var Comp = new Function('DCLogic', scriptEl.textContent + '\n;return typeof Component !== "undefined" ? Component : null;')(DCLogic);
    if (!Comp) { console.error('No Component class found in board script'); return; }
    // The Netlify Functions in netlify/functions serve the API, so pages always run live.
    props.$local = true;
    // Streax accounts: who is logged in (cached for this tab so the top bar does not flicker), refreshed from the server.
    props.$me = null;
    if (props.$local) { try { var cachedMe = sessionStorage.getItem('sx_me'); if (cachedMe) props.$me = JSON.parse(cachedMe); } catch (e) { props.$me = null; } }
    var inst = new Comp(props);
    window.__sxPage = inst;

    var root = document.createElement('div');
    root.id = 'dc-root';
    var pw = props.$preview && props.$preview.width;
    if (pw && pw < 700) { root.style.display = 'flex'; root.style.justifyContent = 'center'; root.style.padding = '24px 0'; }
    document.body.appendChild(root);

    var handlers = [];
    function draw() {
      var vals = inst.renderVals() || {};
      var reg = [];
      var next = document.createElement('div');
      renderChildren(tpl, [], vals, next, reg);
      handlers = reg;
      if (!root.firstChild) { while (next.firstChild) root.appendChild(next.firstChild); return; }
      window.morphdom(root, next, {
        childrenOnly: true,
        // data-dc-keep marks a container another script draws into (charts); leave it alone.
        onBeforeElUpdated: function (fromEl, toEl) { return !(fromEl.hasAttribute && fromEl.hasAttribute('data-dc-keep')) && !fromEl.isEqualNode(toEl); },
        // nodes the motion script adds (the Home ticker) stay put
        onBeforeNodeDiscarded: function (node) { return !(node.classList && node.classList.contains('sx-keep')); }
      });
    }
    var pending = false;
    inst.__schedule = function () {
      if (pending) return;
      pending = true;
      Promise.resolve().then(function () { pending = false; try { draw(); } catch (e) { console.error(e); } });
    };

    function synth(e, node, type, stop) {
      return {
        type: type, target: e.target, currentTarget: node, nativeEvent: e, relatedTarget: e.relatedTarget || null,
        clientX: e.clientX, clientY: e.clientY, pageX: e.pageX, pageY: e.pageY, key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey,
        stopPropagation: function () { stop.v = true; e.stopPropagation(); }, preventDefault: function () { e.preventDefault(); }
      };
    }
    function dispatch(e, type) {
      var stop = { v: false }, node = e.target;
      while (node && node !== root) {
        if (node.nodeType === 1 && node.hasAttribute('data-dc-' + type)) {
          var fn = handlers[+node.getAttribute('data-dc-' + type)];
          if (fn) fn(synth(e, node, type, stop));
          if (stop.v) break;
        }
        node = node.parentNode;
      }
    }
    function boundary(e, type) {
      var node = e.target, rel = e.relatedTarget;
      while (node && node !== root) {
        if (node.nodeType === 1 && node.hasAttribute('data-dc-' + type) && !(rel && node.contains(rel))) {
          var fn = handlers[+node.getAttribute('data-dc-' + type)];
          if (fn) fn(synth(e, node, type, { v: false }));
        }
        node = node.parentNode;
      }
    }
    root.addEventListener('click', function (e) { dispatch(e, 'click'); });
    root.addEventListener('input', function (e) { if (!isToggle(e.target)) { dispatch(e, 'change'); dispatch(e, 'input'); } });
    root.addEventListener('change', function (e) { if (isToggle(e.target)) dispatch(e, 'change'); });
    root.addEventListener('mousemove', function (e) { dispatch(e, 'mousemove'); });
    root.addEventListener('mouseout', function (e) { boundary(e, 'mouseleave'); });
    root.addEventListener('mouseover', function (e) { boundary(e, 'mouseenter'); });
    root.addEventListener('focusin', function (e) { dispatch(e, 'focus'); });
    root.addEventListener('focusout', function (e) { dispatch(e, 'blur'); });
    root.addEventListener('keydown', function (e) { dispatch(e, 'keydown'); });
    root.addEventListener('keyup', function (e) { dispatch(e, 'keyup'); });
    root.addEventListener('submit', function (e) { dispatch(e, 'submit'); });

    draw();
    if (inst.componentDidMount) inst.componentDidMount();
    // motion layer (assets/motion.js next to this script)
    (function () {
      var me = document.querySelector('script[src*="support.js"]'), base = me ? me.src.replace(/support\.js(\?.*)?$/, '') : '';
      var m = document.createElement('script'); m.src = base + 'assets/motion.js'; m.defer = true; document.body.appendChild(m);
    })();
    if (inst.trustInit) inst.trustInit();
    if (props.$local && typeof fetch === 'function') {
      fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j) return;
        var me = j.user || null;
        props.$auth = j;
        try { if (me) sessionStorage.setItem('sx_me', JSON.stringify(me)); else sessionStorage.removeItem('sx_me'); } catch (e) {}
        props.$me = me;
        if (inst.onMe) inst.onMe(me);
        inst.__schedule();
      }).catch(function () {});
    }
    if (props.$local && typeof fetch === 'function' && inst.D && (inst.D.casinos || inst.D.idx)) {
      fetch('/api/live/casinos', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j || !j.casinos || !j.casinos.length) return;
        applyLive(inst.D, j);
        if (inst.onLive) inst.onLive(inst.D.live);
        inst.__schedule();
      }).catch(function () {});
    }
    window.addEventListener('pagehide', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
