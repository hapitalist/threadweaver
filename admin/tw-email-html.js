/* tw-email-html.js (Thread Weaver admin email pages; copied from Joy Looper's joy-ghost-html.js, 20 Oct 2026)
 * - turns the editor's Lexical state into the HTML Ghost's renderer would make (used for the email body).
 *
 * This is Ghost's own renderer (@tryghost/kg-lexical-html-renderer 1.5.1, MIT, (c) Ghost
 * Foundation), ported line for line to run against the LIVE Koenig editor on the page instead
 * of bundling a second copy of Lexical. Every card (image, gallery, bookmark, callout, toggle,
 * button, file, audio, video, product, header, signup, call-to-action, paywall ...) is rendered
 * by the card's own exportDOM - Ghost's code, shipped inside the Koenig bundle. Only the glue
 * that walks paragraphs, headings, lists, quotes and inline text is here, copied from
 * convert-to-html-string.js, TextContent.js, transformers/element/*.js and kg-utils slugify.
 *
 * The one difference from the original: it cannot import Lexical's $isTextNode & co, so it
 * asks each node what it is (type names and methods). Everything else is Ghost's logic.
 *
 * Use: TWEmailHTML.render(editorInstance, {target: 'html' | 'email'}) -> Promise<string>
 * (also exposed as JoyGhostHTML so code ported from Joy works unchanged)
 */
(function () {
  'use strict';

  var FORMAT_TAG_MAP = {
    bold: 'STRONG', italic: 'EM', strikethrough: 'S', underline: 'U',
    code: 'CODE', subscript: 'SUB', superscript: 'SUP', highlight: 'MARK'
  };

  function type(n) { try { return n.getType(); } catch (e) { return ''; } }
  function isKoenigCard(n) {
    return !!n && typeof n.isKoenigCard === 'function' && n.isKoenigCard() === true &&
      typeof n.exportDOM === 'function';
  }
  function isLineBreak(n) { return type(n) === 'linebreak'; }
  function isLink(n) { return !!n && typeof n.getURL === 'function' && typeof n.getChildren === 'function'; }
  function isText(n) {
    return !!n && typeof n.getFormat === 'function' && typeof n.hasFormat === 'function' &&
      typeof n.getChildren !== 'function';
  }
  function isElement(n) { return !!n && typeof n.getChildren === 'function' && !isKoenigCard(n); }
  function isParagraph(n) { return type(n) === 'paragraph'; }
  function isHeading(n) { var t = type(n); return (t === 'heading' || t === 'extended-heading') && typeof n.getTag === 'function'; }
  function isQuote(n) { var t = type(n); return t === 'quote' || t === 'extended-quote'; }
  function isAside(n) { return type(n) === 'aside'; }
  function isList(n) { return type(n) === 'list' && typeof n.getTag === 'function'; }
  function isListItem(n) { return type(n) === 'listitem'; }
  // The renderer strips unfinished @-link searches before rendering (registerRemoveAtLinkNodesTransform).
  function isAtLinkSearch(n) { return type(n) === 'at-link-search'; }
  function isAtLink(n) { return type(n) === 'at-link'; }

  // @tryghost/kg-utils slugify, the 4.0+ branch Ghost uses today
  function slugify(input) {
    if (typeof input !== 'string' || input.trim() === '') return '';
    return encodeURIComponent(input.trim().toLowerCase()
      .replace(/[\][!"#$%&'()*+,./:;<=>?@\\^_{|}~]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-|-{2,}|-$/g, ''));
  }
  function generateId(text, options) {
    if (!options.usedIdAttributes) options.usedIdAttributes = {};
    var id = slugify(text);
    var dedup = id;
    if (options.usedIdAttributes[id] !== undefined) {
      dedup += '-' + options.usedIdAttributes[id];
      options.usedIdAttributes[id] += 1;
    } else {
      options.usedIdAttributes[id] = 1;
    }
    return dedup;
  }

  /* TextContent.js */
  function TextContent(exportChildren, options) {
    if (!options.dom) throw new Error('TextContent requires a dom property in the options argument');
    this.exportChildren = exportChildren; this.options = options; this.nodes = [];
  }
  TextContent.prototype.addNode = function (n) { this.nodes.push(n); };
  TextContent.prototype.isEmpty = function () { return this.nodes.length === 0; };
  TextContent.prototype.clear = function () { this.nodes = []; };
  TextContent.prototype._buildAnchorElement = function (anchor, node) {
    if (node.getURL()) anchor.setAttribute('href', node.getURL());
    if (node.getRel && node.getRel()) anchor.setAttribute('rel', node.getRel() || '');
    anchor.innerHTML = this.exportChildren(node, this.options);
  };
  TextContent.prototype.render = function () {
    var document = this.options.dom.window.document;
    var root = document.createElement('div');
    var currentNode = root;
    var openFormats = [];
    for (var i = 0; i < this.nodes.length; i++) {
      var node = this.nodes[i];
      if (isLineBreak(node)) { currentNode.append(document.createElement('BR')); continue; }
      if (isLink(node)) {
        var anchor = document.createElement('A');
        this._buildAnchorElement(anchor, node);
        currentNode.append(anchor);
        continue;
      }
      if (isText(node)) {
        if (node.getFormat() === 0) { currentNode.append(node.getTextContent()); continue; }
        var formatsToOpen = [];
        Object.keys(FORMAT_TAG_MAP).forEach(function (format) {
          if (node.hasFormat(format) && openFormats.indexOf(format) === -1) formatsToOpen.push(format);
        });
        var remainingNodes = this.nodes.slice(i + 1);
        var nextLinkNodeIndex = remainingNodes.findIndex(function (n) { return isLink(n); });
        var remainingSortNodes = nextLinkNodeIndex === -1 ? remainingNodes : remainingNodes.slice(0, nextLinkNodeIndex);
        var remainingSortedTextNodes = remainingSortNodes.filter(function (n) { return isText(n); });
        formatsToOpen.sort(function (a, b) {
          var aIndex = remainingSortedTextNodes.findIndex(function (n) { return n.hasFormat(a); });
          var bIndex = remainingSortedTextNodes.findIndex(function (n) { return n.hasFormat(b); });
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
        formatsToOpen.forEach(function (format) {
          var formatTag = document.createElement(FORMAT_TAG_MAP[format]);
          currentNode.append(formatTag);
          currentNode = formatTag;
          openFormats.push(format);
        });
        currentNode.append(node.getTextContent());
        var nextNode = remainingNodes.find(function (n) { return isText(n) || isLink(n); });
        openFormats.slice().forEach(function (format) {
          if (!nextNode || isLink(nextNode) || (isText(nextNode) && !nextNode.hasFormat(format))) {
            currentNode = currentNode.parentNode;
            openFormats.pop();
          }
        });
        continue;
      }
    }
    return root.innerHTML;
  };

  /* transformers/element/*.js */
  function exportList(node, options, exportChildren) {
    if (!isList(node)) return null;
    var tag = node.getTag();
    var start = node.getStart ? node.getStart() : null;
    var liOpen = false;
    function exportListContent(listNode) {
      var output = [];
      listNode.getChildren().forEach(function (child) {
        if (!isListItem(child)) return;
        var listChildren = child.getChildren();
        if (isList(listChildren[0])) {
          output.push(exportList(listChildren[0], options, exportChildren));
          if (liOpen) { output.push('</li>'); liOpen = false; }
        } else {
          if (liOpen) { output.push('</li>'); liOpen = false; }
          output.push('<li>' + exportChildren(child, options));
          liOpen = true;
        }
      });
      if (liOpen) { output.push('</li>'); liOpen = false; }
      return output.join('');
    }
    var listContent = exportListContent(node);
    if (start !== 1 && start !== null && start !== undefined) return '<' + tag + ' start="' + start + '">' + listContent + '</' + tag + '>';
    return '<' + tag + '>' + listContent + '</' + tag + '>';
  }
  var elementTransformers = [
    function paragraph(node, options, exportChildren) {
      if (!isParagraph(node)) return null;
      return '<p>' + exportChildren(node) + '</p>';
    },
    function heading(node, options, exportChildren) {
      if (!isHeading(node)) return null;
      var tag = node.getTag();
      var id = generateId(node.getTextContent(), options);
      return '<' + tag + ' id="' + id + '">' + exportChildren(node) + '</' + tag + '>';
    },
    function list(node, options, exportChildren) { return exportList(node, options, exportChildren); },
    function blockquote(node, options, exportChildren) {
      if (!isQuote(node)) return null;
      if (options.target === 'email') {
        var c = exportChildren(node);
        if (c.indexOf('<p>') !== 0) c = '<p>' + c + '</p>';
        return '<blockquote>' + c + '</blockquote>';
      }
      return '<blockquote>' + exportChildren(node) + '</blockquote>';
    },
    function aside(node, options, exportChildren) {
      if (!isAside(node)) return null;
      if (options.target === 'email') {
        var c = exportChildren(node);
        if (c.indexOf('<p>') !== 0) c = '<p>' + c + '</p>';
        return '<blockquote class="kg-blockquote-alt">' + c + '</blockquote>';
      }
      return '<blockquote class="kg-blockquote-alt">' + exportChildren(node) + '</blockquote>';
    }
  ];

  /* convert-to-html-string.js */
  function exportChildren(node, options) {
    var output = [];
    var textContent = new TextContent(exportChildren, options);
    node.getChildren().forEach(function (child) {
      if (isAtLinkSearch(child)) return;
      if (!textContent.isEmpty() && !isLineBreak(child) && !isText(child) && !isLink(child)) {
        output.push(textContent.render());
        textContent.clear();
      }
      if (isLineBreak(child) || isText(child) || isLink(child)) textContent.addNode(child);
      else if (isElement(child)) output.push(exportChildren(child, options));
    });
    if (!textContent.isEmpty()) output.push(textContent.render());
    return output.join('');
  }
  function exportTopLevelElementOrDecorator(node, editor, options) {
    if (isKoenigCard(node)) {
      var res = node.exportDOM(editor, options) || {};
      var element = res.element;
      switch (res.type) {
        case 'inner': return element && 'innerHTML' in element ? element.innerHTML : '';
        case 'value': return element && typeof element.value === 'string' ? element.value : '';
        default: return element && 'outerHTML' in element ? element.outerHTML : '';
      }
    }
    if (isElement(node)) {
      for (var i = 0; i < elementTransformers.length; i++) {
        var r = elementTransformers[i](node, options, function (n) { return exportChildren(n, options); });
        if (r !== null) return r;
      }
    }
    return isElement(node) ? exportChildren(node, options) : null;
  }

  // Cards that hold a small editor of their own (callout, toggle, header, product, call to action,
  // captions) keep what is typed into it there, and only write it into the card when the post is
  // turned into JSON. Ghost makes its HTML on the server from the saved JSON, so it always has those
  // words; reading the live editor did not, and a callout typed in the same sitting came out empty
  // (28 Sep). So the post is read back from its own JSON first - the same thing the server reads.
  function savedState(editor) {
    var live = editor.getEditorState();
    try { return editor.parseEditorState(JSON.stringify(live.toJSON())); } catch (e) { return live; }
  }

  async function render(editor, userOptions) {
    var options = Object.assign({target: 'html', dom: {window: window}}, userOptions || {});
    options.usedIdAttributes = options.usedIdAttributes || {};
    var state = savedState(editor);
    // cards that need data fetched before they can render (the renderer does this first too)
    var renderData = new Map();
    var dynamic = [];
    state.read(function () {
      var root = state._nodeMap.get('root');
      root.getChildren().forEach(function (n) { if (isKoenigCard(n) && n.hasDynamicData && n.hasDynamicData()) dynamic.push(n); });
    });
    for (var d = 0; d < dynamic.length; d++) {
      if (!dynamic[d].getDynamicData) continue;
      var got = await dynamic[d].getDynamicData(options);
      renderData.set(got.key, got.data);
    }
    options.renderData = renderData;
    var html = '';
    state.read(function () {
      var root = state._nodeMap.get('root');
      var children = root.getChildren();
      var out = [];
      children.forEach(function (child) {
        var r = exportTopLevelElementOrDecorator(child, editor, options);
        if (r !== null) out.push(r);
      });
      var last = children[children.length - 1];
      if (last && isParagraph(last) && last.getTextContent().trim() === '') out.pop();
      html = out.join('');
    });
    return html;
  }

  window.TWEmailHTML = window.JoyGhostHTML = { render: render, version: 'port of kg-lexical-html-renderer 1.5.1' };
})();
