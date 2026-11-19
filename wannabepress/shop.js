// shop.js - the Wannabe Press shop, right on the page. 18 Nov 2026.
// Russell: "I asked for a shop on Wannabe press netlify and it's still going to my gumroad store."
// Every buy link on the site is /shop/#<key>. Pressing one opens that book's checkout here: the price and what you get
// come from the shop itself (the shop function, store 'wannabe'), a pick when there is one (which hardcover, which pin),
// where it ships when it ships. Pay goes to Stripe Checkout; Stripe sends the buyer back to /shop/?o=<order>, where the
// order is confirmed and its BookFunnel links are shown (they are emailed too). A free ebook asks only for an email.
(function(){
  var FN = 'https://fnioslsnlzyjpumdknva.supabase.co/functions/v1/shop';
  var KEY = 'sb_publishable_z_D2OoQU99an2CFfMa58Uw_wwENE7kX';
  var cat = null, catP = null;
  function call(body){
    return fetch(FN, {method:'POST', headers:{'content-type':'application/json', apikey: KEY}, body: JSON.stringify(body)})
      .then(function(r){ return r.json(); }).catch(function(){ return null; });
  }
  function load(){ if (!catP) catP = call({action:'catalog', store:'wannabe'}).then(function(d){ cat = d; return d; }); return catP; }
  function find(k){ return cat && cat.products ? cat.products.filter(function(p){ return p.key === k; })[0] : null; }
  function money(c){ return '$' + (c % 100 ? (c/100).toFixed(2) : String(c/100)); }
  function el(t, cls, txt){ var e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function keyOf(a){ var m = (a.getAttribute('href') || '').match(/^\/shop\/#(wp-[a-z0-9-]+)$/); return m ? m[1] : null; }

  // ---- the checkout dialog ----
  var dlg = null, last = null;
  function close(){ if (!dlg) return; dlg.remove(); dlg = null; document.body.style.overflow = ''; if (last) try { last.focus(); } catch(e){} }
  function open(k, from){
    last = from || document.activeElement;
    load().then(function(){
      var p = find(k);
      close();
      dlg = el('div', 'shopdlg'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
      var box = el('div', 'shopbox'); dlg.appendChild(box);
      var x = el('button', 'shopx', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = close; box.appendChild(x);
      document.body.appendChild(dlg); document.body.style.overflow = 'hidden';
      dlg.addEventListener('click', function(e){ if (e.target === dlg) close(); });
      dlg.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
      if (!cat || !cat.ok) { box.appendChild(el('p', null, 'The shop did not load. Check your connection and try again.')); x.focus(); return; }
      if (!p) { box.appendChild(el('p', null, 'That one is not in the shop any more.')); x.focus(); return; }
      var h = el('h3', null, p.name); h.id = 'shopdlgT'; dlg.setAttribute('aria-labelledby', 'shopdlgT'); box.appendChild(h);
      if (p.gets) box.appendChild(el('p', 'shopgets', p.gets));
      box.appendChild(el('p', 'shopprice', p.free ? 'Free' : money(p.cents) + (p.shipping ? ' + shipping' : '')));
      if (!p.available || !cat.open) { box.appendChild(el('p', 'shopsoon', 'Coming back soon.')); x.focus(); return; }
      var form = el('form', 'shopform'); box.appendChild(form);
      var sel = null, ship = null, mail = null;
      if (p.choices) {
        var l1 = el('label', null, 'Which one?'); sel = el('select'); sel.id = 'shopChoice'; l1.htmlFor = 'shopChoice'; sel.required = true;
        var o0 = el('option', null, 'Choose...'); o0.value = ''; sel.appendChild(o0);
        p.choices.forEach(function(c){ var o = el('option', null, c); o.value = c; sel.appendChild(o); });
        form.appendChild(l1); form.appendChild(sel);
      }
      if (p.shipping) {
        var l2 = el('label', null, 'Where are we shipping it?'); ship = el('select'); ship.id = 'shopShip'; l2.htmlFor = 'shopShip'; ship.required = true;
        [['', 'Choose...'], ['us', 'In the US (' + money(p.shipping.us) + ' shipping)'], ['intl', 'Outside the US (' + money(p.shipping.intl) + ' shipping)']]
          .forEach(function(a){ var o = el('option', null, a[1]); o.value = a[0]; ship.appendChild(o); });
        form.appendChild(l2); form.appendChild(ship);
      }
      if (p.free) {
        var l3 = el('label', null, 'Your email (the book goes there)'); mail = el('input'); mail.type = 'email'; mail.id = 'shopMail';
        mail.autocomplete = 'email'; mail.required = true; l3.htmlFor = 'shopMail'; form.appendChild(l3); form.appendChild(mail);
      }
      var go = el('button', 'btn red shopgo', p.free ? 'Send it to me' : 'Buy it · ' + money(p.cents)); go.type = 'submit'; form.appendChild(go);
      var msg = el('p', 'shopmsg'); msg.setAttribute('role', 'alert'); form.appendChild(msg);
      if (p.shipping) form.appendChild(el('p', 'shopnote', 'You pay on Stripe’s secure checkout and give your shipping address there.'));
      else if (!p.free) form.appendChild(el('p', 'shopnote', 'You pay on Stripe’s secure checkout. Your downloads arrive by email and on the page you come back to, as BookFunnel links that send each file to your Kindle, phone or reading app.'));
      form.onsubmit = function(e){
        e.preventDefault(); msg.textContent = '';
        if (sel && !sel.value) { msg.textContent = 'Pick which one you want.'; sel.focus(); return; }
        if (ship && !ship.value) { msg.textContent = 'Pick where we are shipping it.'; ship.focus(); return; }
        if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value.trim())) { msg.textContent = 'Type the email to send it to.'; mail.focus(); return; }
        go.disabled = true; go.textContent = p.free ? 'Sending...' : 'Opening checkout...';
        call({action:'checkout', key: p.key, choice: sel ? sel.value : undefined, ship: ship ? ship.value : undefined, email: mail ? mail.value.trim() : undefined})
          .then(function(d){
            if (d && d.ok && d.url) { location.href = d.url; return; }
            go.disabled = false; go.textContent = p.free ? 'Send it to me' : 'Buy it · ' + money(p.cents);
            msg.textContent = (d && d.error) || 'That did not go through. Try again in a moment.';
          });
      };
      (sel || ship || mail || go).focus();
    });
  }

  // every buy link on every page opens its checkout here
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href^="/shop/#wp-"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault(); open(keyOf(a), a);
  });

  // the shop page: real prices from the shop, "coming back soon" where it cannot be bought yet
  if (/^\/shop\/?$/.test(location.pathname)) {
    load().then(function(){
      document.querySelectorAll('a.shopitem').forEach(function(a){
        var p = find(keyOf(a)); var pr = a.querySelector('.price'); if (!pr) return;
        if (!p) return;
        pr.textContent = !p.available ? 'Coming back soon' : (p.free ? 'Free' : money(p.cents));
      });
      var h = location.hash.replace('#', ''); if (/^wp-/.test(h)) open(h);
    });
    // back from Stripe (or a free one): confirm the order and show the downloads
    var tok = (location.search.match(/[?&]o=([a-f0-9]{30,64})/) || [])[1];
    if (tok) {
      var sec = document.getElementById('shopdone'), box = document.getElementById('shopdoneIn');
      if (sec && box) {
        sec.hidden = false; var tries = 0;
        (function look(){
          call({action:'status', o: tok}).then(function(d){
            box.textContent = '';
            if (!d || !d.ok) { box.appendChild(el('p', null, 'We could not find that order. If you paid, you are safe: the receipt Stripe emailed you has the details. Just reply to it.')); return; }
            if (d.status === 'pending_payment' || d.status === 'paid' || d.status === 'delivering') {
              box.appendChild(el('h3', null, 'Thank you!'));
              if (++tries < 12) { box.appendChild(el('p', null, d.status === 'pending_payment' ? 'Waiting for Stripe to confirm the payment...' : 'Paid. Getting your downloads ready...')); setTimeout(look, 3000); return; }
              box.appendChild(el('p', null, 'This is taking longer than usual. You do not need to do anything or pay again: your downloads arrive by email within a few minutes.')); return;
            }
            if (d.status === 'abandoned') { box.appendChild(el('p', null, 'This order was never paid for, so nothing was charged.')); return; }
            if (d.status === 'refunded') { box.appendChild(el('p', null, 'This order was refunded.')); return; }
            if (d.status === 'failed') { box.appendChild(el('p', null, 'You are paid up, and something went wrong on our side sending your order. Reply to your Stripe receipt and we will sort it out.')); return; }
            box.appendChild(el('h3', null, 'Thank you!'));
            box.appendChild(el('p', null, (d.name ? 'Your ' + d.name + (d.choice ? ' (' + d.choice + ')' : '') + ' is here.' : 'Your order is here.') + (d.email ? ' A copy is on its way to ' + d.email + '.' : '')));
            if (d.links && d.links.length) {
              var ul = el('ul', 'shoplinks');
              d.links.forEach(function(l){ var li = el('li'); var a = el('a', 'btn alt', 'Download'); a.href = l.link; a.rel = 'noopener'; a.target = '_blank';
                li.appendChild(el('span', null, l.title + ' · ' + l.kind)); li.appendChild(a); ul.appendChild(li); });
              box.appendChild(ul);
            } else if (d.status === 'delivered') {
              box.appendChild(el('p', null, 'We will ship it to the address you gave on checkout.'));
            }
            box.appendChild(el('p', 'shopnote', 'Every Wannabe Press book is in the Thread Weaver app too, if you would rather read on your phone.'));
          });
        })();
        try { sec.scrollIntoView(); } catch(e){}
      }
    }
  }
})();
