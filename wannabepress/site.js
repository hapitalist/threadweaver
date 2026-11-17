// Phone bar: show once the top of the page scrolls away, hide again at the signup form.
(function(){
  var bar=document.getElementById('sticky'), top=document.querySelector('.qz'), su=document.getElementById('signup');
  if(!('IntersectionObserver' in window)||!bar||!top) return;
  var gone=false, end=false;
  function set(){ var on=gone&&!end; bar.classList.toggle('on',on); bar.setAttribute('aria-hidden',on?'false':'true'); }
  new IntersectionObserver(function(e){ gone=!e[0].isIntersecting && e[0].boundingClientRect.top<0; set(); }).observe(top);
  if(su) new IntersectionObserver(function(e){ end=e[0].isIntersecting; set(); },{rootMargin:'0px 0px -30% 0px'}).observe(su);
})();
// This week's emailed chapter, live from the newsletter (home page only).
(function(){
  var t=document.getElementById('weekTitle'); if(!t||!window.fetch) return;
  fetch('/api/latest').then(function(r){return r.ok?r.json():null}).then(function(d){
    var p=d&&(d.posts||d)[0]; if(!p||!p.title||!p.slug) return;
    t.textContent=String(p.title).replace(/\s+-\s+/,' — ').trim();
    if(p.section_name) document.getElementById('weekLine').textContent='From '+p.section_name+', a chapter a week in your inbox.';
    document.getElementById('weekCard').href='https://wannabepress.substack.com/p/'+encodeURIComponent(p.slug);
  }).catch(function(){});
})();
