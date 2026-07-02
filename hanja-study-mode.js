/* ============================================================
   Hanja Roots — Anki-style Study Mode (self-contained add-on)
   Paste the accompanying <style>+HTML? No — everything is injected
   by this script. Just drop this whole <script> block in once.
   Reuses existing globals: CARDS, GROUPS, getActiveDeck, cardId,
   starred, saveStarred, STAR_GROUP, activeGroups, SENT, NOTES, PIECEMAP.
   ============================================================ */
(function(){
  if (window.__hanjaStudyLoaded) return;
  window.__hanjaStudyLoaded = true;

  // ---------- Scheduling config (SM-2 / Anki-style) ----------
  const MIN = 60*1000, DAY = 24*60*60*1000;
  const LEARN_STEPS   = [1, 10];   // minutes (New/Learning)
  const RELEARN_STEPS = [10];      // minutes (after a lapse)
  const GRAD_IVL   = 1;            // days: Good graduates to
  const EASY_IVL   = 4;            // days: Easy graduates to
  const EASY_BONUS = 1.3;          // extra multiplier for Easy in review
  const HARD_MULT  = 1.2;          // Hard multiplier in review
  const MIN_EASE   = 1.3;          // ease floor
  const LAPSE_MULT = 0.5;          // post-lapse interval = old * this (floored at 1d)
  const KEY = 'hanja_srs';

  // ---------- Persistence (localStorage, degrades gracefully) ----------
  function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
  function load(){
    try { const s=localStorage.getItem(KEY); if(s) return migrate(JSON.parse(s)); } catch(e){}
    return { v:1, settings:{newPerDay:20}, meta:{day:todayStr(),newDone:0}, cards:{} };
  }
  function migrate(o){ o.settings=o.settings||{newPerDay:20}; o.meta=o.meta||{day:todayStr(),newDone:0}; o.cards=o.cards||{}; return o; }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(SRS)); }catch(e){} }
  let SRS = load();
  function rollDay(){ if(SRS.meta.day!==todayStr()){ SRS.meta.day=todayStr(); SRS.meta.newDone=0; save(); } }
  function newRemaining(){ rollDay(); return Math.max(0,(SRS.settings.newPerDay||20)-(SRS.meta.newDone||0)); }

  // ---------- Scheduler ----------
  function freshRec(){ return {state:'new',due:0,interval:0,ease:2.5,step:0,reps:0,lapses:0,reviewIvl:0,last:0}; }
  function project(rec, grade, now){
    const r = Object.assign({}, rec); r.last=now; r.reps=(r.reps||0)+1; if(r.ease==null) r.ease=2.5;
    if(r.state==='new' || r.state==='learning'){
      const S=LEARN_STEPS;
      if(grade==='again'){ r.state='learning'; r.step=0; r.due=now+S[0]*MIN; }
      else if(grade==='hard'){ r.state='learning'; const s=Math.min(r.step,S.length-1); r.due=now+S[s]*MIN; }
      else if(grade==='good'){ const ns=(r.state==='new'?0:r.step)+1;
        if(ns>=S.length){ r.state='review'; r.step=0; r.interval=GRAD_IVL; r.due=now+GRAD_IVL*DAY; }
        else { r.state='learning'; r.step=ns; r.due=now+S[ns]*MIN; } }
      else { r.state='review'; r.step=0; r.interval=EASY_IVL; r.due=now+EASY_IVL*DAY; }
      return r;
    }
    if(r.state==='review'){
      if(grade==='again'){ r.lapses=(r.lapses||0)+1; r.ease=Math.max(MIN_EASE,r.ease-0.20);
        r.reviewIvl=Math.max(1,Math.round(r.interval*LAPSE_MULT)); r.state='relearning'; r.step=0; r.due=now+RELEARN_STEPS[0]*MIN; }
      else if(grade==='hard'){ r.ease=Math.max(MIN_EASE,r.ease-0.15); r.interval=Math.max(r.interval+1,Math.round(r.interval*HARD_MULT)); r.due=now+r.interval*DAY; }
      else if(grade==='good'){ r.interval=Math.max(r.interval+1,Math.round(r.interval*r.ease)); r.due=now+r.interval*DAY; }
      else { r.interval=Math.max(r.interval+1,Math.round(r.interval*r.ease*EASY_BONUS)); r.ease=r.ease+0.15; r.due=now+r.interval*DAY; }
      return r;
    }
    if(r.state==='relearning'){
      const S=RELEARN_STEPS;
      if(grade==='again'){ r.step=0; r.due=now+S[0]*MIN; }
      else if(grade==='hard'){ const s=Math.min(r.step,S.length-1); r.due=now+S[s]*MIN; }
      else if(grade==='good'){ const ns=r.step+1;
        if(ns>=S.length){ r.state='review'; r.step=0; r.interval=Math.max(1,r.reviewIvl||1); r.due=now+r.interval*DAY; }
        else { r.step=ns; r.due=now+S[ns]*MIN; } }
      else { r.state='review'; r.step=0; r.interval=Math.max(1,(r.reviewIvl||1)+1); r.due=now+r.interval*DAY; }
      return r;
    }
    return r;
  }
  function fmt(ms){
    if(ms<0) ms=0;
    if(ms<DAY){ const m=Math.round(ms/MIN); if(m<1) return '<1m'; if(m<60) return m+'m'; return Math.round(ms/(60*MIN))+'h'; }
    const d=Math.round(ms/DAY); if(d<30) return d+'d'; if(d<365) return (d/30).toFixed(1)+'mo'; return (d/365).toFixed(1)+'y';
  }

  // ---------- Deck queries (scoped to active groups + starred) ----------
  function counts(){
    rollDay(); const deck=getActiveDeck(); const now=Date.now(); let n=0,l=0,r=0;
    deck.forEach(c=>{ const rec=SRS.cards[cardId(c)];
      if(!rec||rec.state==='new') n++;
      else if(rec.state==='learning'||rec.state==='relearning') l++;
      else if(rec.state==='review'&&rec.due<=now) r++; });
    return { new:Math.min(n,newRemaining()), newTotal:n, learn:l, due:r };
  }
  function pickNext(){
    rollDay(); const deck=getActiveDeck(); const now=Date.now();
    let learnDue=[], learnSoon=[], review=[], news=[];
    deck.forEach(c=>{ const rec=SRS.cards[cardId(c)];
      if(!rec||rec.state==='new') news.push(c);
      else if(rec.state==='learning'||rec.state==='relearning'){ (rec.due<=now?learnDue:learnSoon).push({c,due:rec.due}); }
      else if(rec.state==='review' && rec.due<=now){ review.push({c,due:rec.due}); } });
    learnDue.sort((a,b)=>a.due-b.due); if(learnDue.length) return {card:learnDue[0].c};
    review.sort((a,b)=>a.due-b.due);   if(review.length)   return {card:review[0].c};
    if(newRemaining()>0 && news.length) return {card:news[0]};
    learnSoon.sort((a,b)=>a.due-b.due); if(learnSoon.length) return {card:learnSoon[0].c}; // learn-ahead
    return null;
  }

  // ---------- Session state ----------
  let studyCard=null, studyFlipped=false, studyNoteOpen=false, sessionCount=0, resetArmed=false;
  const $ = id => document.getElementById(id);

  // ---------- Rendering helpers ----------
  function sBold(s,w){ const i=s.indexOf(w); if(i<0) return s; return s.slice(0,i)+'<b>'+w+'</b>'+s.slice(i+w.length); }
  function sBreak(line){
    const wm=line.match(/^<b>([^<]+)<\/b>:?\s*/); const word=wm?wm[1]:''; let rest=wm?line.slice(wm[0].length):line;
    const ai=rest.indexOf('\u2192'); const head=ai>=0?rest.slice(0,ai):rest; const result=ai>=0?rest.slice(ai+1).trim():'';
    const pieces=[]; const re=/([A-Za-z][A-Za-z0-9/ .\-]*?)\s*\(([\uac00-\ud7a3])\)/g; let m;
    while((m=re.exec(head))!==null) pieces.push({gloss:m[1].trim(),syl:m[2]});
    let html='<div class="bd-line">'; if(word) html+='<span class="bd-word">'+word+'</span>';
    pieces.forEach((p,i)=>{ if(i>0) html+='<span class="bd-plus">+</span>';
      const hit=(typeof PIECEMAP!=='undefined')?PIECEMAP[word+'|'+p.syl]:null;
      const head2=hit?(p.syl+' ('+hit[0]+')'):p.syl;
      html+='<span class="tile"><span class="t-head">'+head2+'</span><span class="t-gl">'+p.gloss.toLowerCase()+'</span></span>';
    });
    if(result) html+='<span class="bd-arrow">\u2192</span><span class="bd-result">'+result+'</span>';
    const sent=(typeof SENT!=='undefined')?SENT[word]:null;
    if(sent) html+='<div class="sent"><div class="sent-ko">'+sBold(sent[0],word)+'</div><div class="sent-en">'+sent[1]+'</div></div>';
    html+='</div>'; return html;
  }
  function sylOf(c){ return c.root.split(' ')[0]; }
  function buildNote(c){
    const data=NOTES[sylOf(c)]; if(!data) return '';
    function entry(h,g,ex){ const head=h?(sylOf(c)+' ('+h+')'):sylOf(c);
      return '<div class="note-entry"><span class="ne-head">'+head+'</span> <span class="ne-gloss">'+g+'</span><div class="ne-ex">'+ex+'</div></div>'; }
    let html='';
    if(data.sino){ html+='<div class="note-section"><div class="note-label sino">Sino-Korean</div>'+data.sino.map(a=>entry(a[0],a[1],a[2])).join('')+'</div>'; }
    if(data.native){ html+='<div class="note-section"><div class="note-label nat">Native Korean</div>'+data.native.map(a=>entry(a[0],a[1],a[2])).join('')+'</div>'; }
    return html;
  }

  function render(){
    const c=studyCard; if(!c) return;
    const g=GROUPS.find(x=>x.id===c.group);
    $('s-grp-badge').innerText = g?g.name:'';
    $('s-affix-ko').innerText = c.root;
    $('s-examples-ko').innerHTML = c.examples.map(e=>{ const s=SENT[e]; return s?('<div>'+sBold(s[0],e)+'</div>'):('<div>'+e+'</div>'); }).join('');
    $('s-affix-en').innerText = c.gloss;
    $('s-affix-ko-back').innerText = c.root;
    $('s-examples-en').innerHTML = c.breakdown.map(sBreak).join('');
    $('s-info-btn').style.display = NOTES[sylOf(c)] ? 'flex' : 'none';
    updStar();
    const rec=SRS.cards[cardId(c)]||freshRec(); const now=Date.now();
    ['again','hard','good','easy'].forEach(gr=>{ $('s-lbl-'+gr).innerText = fmt(project(rec,gr,now).due-now); });
    refreshCounts();
  }
  function refreshCounts(){ const c=counts(); $('cnt-new').innerText=c.new; $('cnt-learn').innerText=c.learn; $('cnt-due').innerText=c.due; }
  function updStar(){ const on=(typeof starred!=='undefined')&&starred.has(cardId(studyCard)); const b=$('s-star-btn'); b.classList.toggle('on',on); b.innerText=on?'\u2605':'\u2606'; }

  // ---------- Flow ----------
  function screen(name){ ['home','review','done'].forEach(s=>{ $('study-'+s).classList.toggle('on', s===name); }); }
  function setFoot(showBack){ $('s-foot-front').style.display=showBack?'none':'block'; $('s-foot-back').style.display=showBack?'block':'none'; }

  function advance(){
    studyFlipped=false; $('s-flashcard').classList.remove('flipped'); setFoot(false);
    const nx=pickNext(); if(!nx){ showDone(); return; }
    studyCard=nx.card; render();
  }
  function start(){
    rollDay(); const c=counts();
    if(c.new+c.learn+c.due===0){ $('home-note').innerText='Nothing due right now — enable more groups in \u2630, or come back later.'; return; }
    sessionCount=0; $('home-note').innerText=''; screen('review'); advance();
  }
  function showDone(){
    screen('done');
    const deck=getActiveDeck(); const now=Date.now(); let next=Infinity;
    deck.forEach(c=>{ const rec=SRS.cards[cardId(c)];
      if(rec && rec.due>now && (rec.state==='review'||rec.state==='learning'||rec.state==='relearning')) next=Math.min(next,rec.due); });
    const rem=newRemaining();
    let msg='Reviewed '+sessionCount+' card'+(sessionCount!==1?'s':'')+' this session. ';
    if(next<Infinity) msg+='Next card due in '+fmt(next-now)+'.';
    else if(rem>0) msg+=rem+' new card'+(rem!==1?'s':'')+' still available today.';
    else msg+='You\u2019re all caught up. \uD83C\uDF89';
    $('done-sub').innerText=msg;
  }

  // ---------- Public handlers (inline onclick targets) ----------
  window.showStudy = function(){
    $('view-cards').classList.remove('active');
    $('view-table').classList.remove('active');
    $('view-study').classList.add('active');
    refreshHome(); screen('home');
  };
  window.goStudyHome = function(){ refreshHome(); screen('home'); };
  window.startSession = start;
  window.endSession = function(){ refreshHome(); screen('home'); };
  window.studyFlip = function(){
    if(studyNoteOpen){ window.studyCloseNote(); return; }
    studyFlipped=!studyFlipped; $('s-flashcard').classList.toggle('flipped',studyFlipped); setFoot(studyFlipped);
  };
  window.gradeCurrent = function(gr){
    if(!studyFlipped || !studyCard) return;
    const id=cardId(studyCard); const had=SRS.cards[id]; const wasNew=!had||had.state==='new';
    const nr=project(had||freshRec(), gr, Date.now()); SRS.cards[id]=nr;
    if(wasNew && nr.state!=='new') SRS.meta.newDone=(SRS.meta.newDone||0)+1;
    sessionCount++; save(); advance();
  };
  window.studyToggleStar = function(e){ if(e)e.stopPropagation(); if(!studyCard) return;
    const id=cardId(studyCard); if(starred.has(id)) starred.delete(id); else starred.add(id); saveStarred(); updStar(); };
  window.studyOpenNote = function(e){ if(e)e.stopPropagation(); if(!studyCard) return;
    $('s-note-title').innerText=sylOf(studyCard)+' \u2014 homophones';
    $('s-note-body').innerHTML=buildNote(studyCard);
    $('s-note-overlay').classList.add('show'); studyNoteOpen=true; };
  window.studyCloseNote = function(e){ if(e)e.stopPropagation(); $('s-note-overlay').classList.remove('show'); studyNoteOpen=false; };
  window.setNPD = function(n){ SRS.settings.newPerDay=n; save(); refreshHome(); };
  window.resetSrs = function(){
    const b=$('reset-btn');
    if(!resetArmed){ resetArmed=true; b.innerText='Tap again to erase all progress'; b.classList.add('armed');
      setTimeout(()=>{ resetArmed=false; b.innerText='Reset all progress'; b.classList.remove('armed'); }, 3000); return; }
    SRS.cards={}; SRS.meta={day:todayStr(),newDone:0}; save(); resetArmed=false;
    b.innerText='Reset all progress'; b.classList.remove('armed'); refreshHome();
  };

  function refreshHome(){
    const c=counts();
    $('home-new').innerText=c.new; $('home-learn').innerText=c.learn; $('home-due').innerText=c.due;
    $('home-note').innerText='';
    // scope
    let groupsOn=0; GROUPS.forEach(g=>{ if(activeGroups.has(g.id)) groupsOn++; });
    const starOn=activeGroups.has(STAR_GROUP);
    let scope='Scope: '+groupsOn+' of '+GROUPS.length+' groups';
    if(starOn) scope+=' + \u2605 Starred';
    scope+=' \u00b7 '+getActiveDeck().length+' cards';
    $('study-scope').innerText=scope;
    // segmented active state
    const npd=SRS.settings.newPerDay||20;
    document.querySelectorAll('#npd-seg .seg-btn').forEach(el=>{ el.classList.toggle('on', Number(el.dataset.n)===npd); });
  }

  // ---------- Style injection ----------
  function injectStyle(){
    const css = `
    #view-study{padding:0;align-items:stretch}
    .study-screen{position:absolute;inset:0;display:none;flex-direction:column}
    .study-screen.on{display:flex}
    /* HOME */
    #study-home{padding:1.1rem .95rem;overflow-y:auto;-webkit-overflow-scrolling:touch}
    .sh-title{font-size:1.15rem;font-weight:800;color:#fff;text-align:center;margin-bottom:.15rem}
    .study-scope{font-size:.62rem;color:#475569;text-align:center;margin-bottom:1rem;letter-spacing:.02em}
    .s-stats{display:flex;gap:.5rem;margin-bottom:1.1rem}
    .s-stat{flex:1;background:#1e293b;border:1px solid #334155;border-radius:.9rem;padding:.75rem .4rem;text-align:center}
    .s-stat .s-num{font-size:1.7rem;font-weight:800;line-height:1}
    .s-stat .s-lab{font-size:.55rem;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-top:.3rem}
    .s-stat.new .s-num{color:#60a5fa}.s-stat.learn .s-num{color:#f87171}.s-stat.due .s-num{color:#34d399}
    .sh-row{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:1rem}
    .sh-lab{font-size:.72rem;color:#94a3b8;font-weight:600}
    .seg{display:flex;background:#1e293b;border:1px solid #334155;border-radius:.6rem;overflow:hidden}
    .seg-btn{background:transparent;border:none;color:#94a3b8;font-size:.75rem;font-weight:700;padding:.4rem .6rem;cursor:pointer;-webkit-appearance:none;border-left:1px solid #334155}
    .seg-btn:first-child{border-left:none}
    .seg-btn.on{background:#059669;color:#fff}
    .start-btn{width:100%;padding:.85rem;background:#059669;color:#fff;border:none;border-radius:.85rem;font-weight:800;font-size:1rem;cursor:pointer;-webkit-appearance:none;box-shadow:0 8px 24px rgba(5,150,105,.35)}
    .start-btn:active{transform:scale(.98)}
    .sh-note{font-size:.72rem;color:#fbbf24;text-align:center;min-height:1rem;margin:.7rem 0}
    .reset-btn{margin-top:auto;width:100%;padding:.55rem;background:transparent;color:#475569;border:1px solid #1e293b;border-radius:.7rem;font-size:.7rem;font-weight:600;cursor:pointer;-webkit-appearance:none}
    .reset-btn.armed{color:#fca5a5;border-color:#7f1d1d;background:rgba(127,29,29,.15)}
    .sh-explain{font-size:.6rem;color:#334155;text-align:center;line-height:1.6;margin-top:.9rem}
    /* REVIEW */
    #study-review{padding:.4rem .9rem .7rem;align-items:center;justify-content:space-between}
    .s-counts{display:flex;align-items:center;gap:.5rem;width:100%;max-width:22rem;padding:.2rem 0 .35rem;flex-shrink:0}
    .s-counts .cnt{font-size:.82rem;font-weight:800;min-width:1.4rem;text-align:center}
    .s-counts .cnt.new{color:#60a5fa}.s-counts .cnt.learn{color:#f87171}.s-counts .cnt.due{color:#34d399}
    .s-counts .cnt-sep{flex:1}
    .s-end{width:1.8rem;height:1.8rem;border-radius:.5rem;background:#1e293b;border:1px solid #334155;color:#94a3b8;font-size:.9rem;cursor:pointer;-webkit-appearance:none;display:flex;align-items:center;justify-content:center}
    #s-flashcard{width:100%;height:100%;position:relative;transform-style:preserve-3d;transition:transform .5s cubic-bezier(.2,0,.2,1);border-radius:1.5rem;box-shadow:0 20px 60px rgba(0,0,0,.6)}
    #s-flashcard.flipped{transform:rotateY(180deg)}
    #s-affix-ko{font-size:2.6rem;font-weight:800;color:#fff;letter-spacing:-.02em;line-height:1.1}
    #s-examples-ko{font-size:1rem;color:#f1f5f9;font-weight:500;line-height:1.85}
    #s-examples-ko b{color:#34d399;font-weight:700}
    #s-affix-en{font-size:1.35rem;font-weight:700;color:#fff}
    #s-affix-ko-back{font-size:.8rem;color:#34d399;margin-top:.1rem}
    #s-examples-en{font-size:.7rem;color:#d1fae5;background:rgba(15,23,42,.45);padding:.6rem;border-radius:.65rem;border:1px solid rgba(6,78,59,.5);overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;touch-action:pan-y;display:flex;flex-direction:column;gap:.55rem}
    .study-foot{width:100%;max-width:22rem;flex-shrink:0;padding-top:.45rem}
    .show-ans-btn{width:100%;padding:.75rem;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:.8rem;font-weight:700;font-size:.95rem;cursor:pointer;-webkit-appearance:none}
    .show-ans-btn:active{background:#334155}
    .grade-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem}
    .grade-btn{border:none;border-radius:.75rem;padding:.55rem .1rem;cursor:pointer;-webkit-appearance:none;display:flex;flex-direction:column;align-items:center;gap:.15rem;color:#fff}
    .grade-btn:active{transform:scale(.95)}
    .grade-btn .g-name{font-size:.82rem;font-weight:800}
    .grade-btn .g-ivl{font-size:.6rem;font-weight:600;opacity:.9}
    .grade-btn.again{background:#dc2626}.grade-btn.hard{background:#d97706}
    .grade-btn.good{background:#059669}.grade-btn.easy{background:#2563eb}
    /* DONE */
    #study-done{align-items:center;justify-content:center;padding:2rem}
    .done-emoji{font-size:3rem;color:#34d399;margin-bottom:.6rem}
    .done-title{font-size:1.3rem;font-weight:800;color:#fff;margin-bottom:.5rem}
    .done-sub{font-size:.82rem;color:#94a3b8;text-align:center;line-height:1.6;max-width:18rem;margin-bottom:1.5rem}
    .done-inner{display:flex;flex-direction:column;align-items:center}
    .done-inner .start-btn{max-width:14rem}
    `;
    const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  }

  // ---------- View injection ----------
  function injectView(){
    const html = `
    <div class="view" id="view-study">
      <!-- HOME -->
      <div class="study-screen on" id="study-home">
        <div class="sh-title">Study Session</div>
        <div class="study-scope" id="study-scope">Scope: \u2014</div>
        <div class="s-stats">
          <div class="s-stat new"><div class="s-num" id="home-new">0</div><div class="s-lab">New</div></div>
          <div class="s-stat learn"><div class="s-num" id="home-learn">0</div><div class="s-lab">Learning</div></div>
          <div class="s-stat due"><div class="s-num" id="home-due">0</div><div class="s-lab">Due</div></div>
        </div>
        <div class="sh-row">
          <span class="sh-lab">New cards / day</span>
          <div class="seg" id="npd-seg">
            <button class="seg-btn" data-n="10" onclick="setNPD(10)">10</button>
            <button class="seg-btn" data-n="20" onclick="setNPD(20)">20</button>
            <button class="seg-btn" data-n="40" onclick="setNPD(40)">40</button>
            <button class="seg-btn" data-n="9999" onclick="setNPD(9999)">\u221e</button>
          </div>
        </div>
        <button class="start-btn" onclick="startSession()">Start studying</button>
        <div class="sh-note" id="home-note"></div>
        <div class="sh-explain">Cards you rate <b>Again</b> come back in ~1 min; <b>Good</b> steps them out to days, then weeks. Progress is scoped to your active groups (\u2630) and saved on this device.</div>
        <button class="reset-btn" id="reset-btn" onclick="resetSrs()">Reset all progress</button>
      </div>
      <!-- REVIEW -->
      <div class="study-screen" id="study-review">
        <div class="s-counts">
          <button class="s-end" onclick="endSession()" title="End session">\u2715</button>
          <span class="cnt-sep"></span>
          <span class="cnt new" id="cnt-new">0</span>
          <span class="cnt learn" id="cnt-learn">0</span>
          <span class="cnt due" id="cnt-due">0</span>
        </div>
        <div class="card-area">
          <div class="perspective" onclick="studyFlip()">
            <div id="s-flashcard">
              <div class="face face-front">
                <button class="star-btn" id="s-star-btn" onclick="studyToggleStar(event)">\u2606</button>
                <div class="progress">Recall the meaning</div>
                <div class="front-body">
                  <div class="grp-badge" id="s-grp-badge">\u2014</div>
                  <div id="s-affix-ko"></div>
                  <div id="s-examples-ko"></div>
                </div>
                <div class="hint">Tap to reveal</div>
              </div>
              <div class="face face-back">
                <button class="info-btn" id="s-info-btn" onclick="studyOpenNote(event)" style="display:none">i</button>
                <div class="progress bk">Answer</div>
                <div class="back-body">
                  <div class="back-title"><div id="s-affix-en"></div><div id="s-affix-ko-back"></div></div>
                  <div id="s-examples-en"></div>
                </div>
                <div class="hint bk">Rate how well you knew it</div>
              </div>
            </div>
            <div class="note-overlay" id="s-note-overlay">
              <div class="note-hdr">
                <div class="note-hdr-title" id="s-note-title">Homophones</div>
                <button class="note-close" onclick="studyCloseNote(event)">\u2715</button>
              </div>
              <div class="note-body" id="s-note-body"></div>
            </div>
          </div>
        </div>
        <div class="study-foot">
          <div id="s-foot-front"><button class="show-ans-btn" onclick="studyFlip()">Show answer</button></div>
          <div id="s-foot-back" style="display:none">
            <div class="grade-grid">
              <button class="grade-btn again" onclick="gradeCurrent('again')"><span class="g-name">Again</span><span class="g-ivl" id="s-lbl-again"></span></button>
              <button class="grade-btn hard" onclick="gradeCurrent('hard')"><span class="g-name">Hard</span><span class="g-ivl" id="s-lbl-hard"></span></button>
              <button class="grade-btn good" onclick="gradeCurrent('good')"><span class="g-name">Good</span><span class="g-ivl" id="s-lbl-good"></span></button>
              <button class="grade-btn easy" onclick="gradeCurrent('easy')"><span class="g-name">Easy</span><span class="g-ivl" id="s-lbl-easy"></span></button>
            </div>
          </div>
        </div>
      </div>
      <!-- DONE -->
      <div class="study-screen" id="study-done">
        <div class="done-inner">
          <div class="done-emoji">\u2713</div>
          <div class="done-title">Session complete</div>
          <div class="done-sub" id="done-sub"></div>
          <button class="start-btn" onclick="goStudyHome()">Back to summary</button>
        </div>
      </div>
    </div>`;
    document.querySelector('main.main').insertAdjacentHTML('beforeend', html);
  }

  // ---------- Header button injection ----------
  function injectHeaderButton(){
    const left=document.querySelector('.hdr .hdr-side'); // first spacer (left)
    if(left){ left.style.display='flex'; left.style.justifyContent='flex-start';
      left.innerHTML='<button class="icon-btn" id="study-btn" onclick="showStudy()" title="Study (spaced repetition)">\uD83C\uDF93</button>'; }
  }

  // ---------- Hook existing view switches so study view hides ----------
  function hookViews(){
    if(typeof window.showCards==='function'){ const o=window.showCards; window.showCards=function(){ const v=$('view-study'); if(v)v.classList.remove('active'); o(); }; }
    if(typeof window.showTable==='function'){ const o=window.showTable; window.showTable=function(){ const v=$('view-study'); if(v)v.classList.remove('active'); o(); }; }
  }

  // ---------- Keyboard (desktop convenience) ----------
  function keys(){
    document.addEventListener('keydown', e=>{
      if(!$('view-study') || !$('view-study').classList.contains('active')) return;
      if(!$('study-review').classList.contains('on')) return;
      if(studyNoteOpen) return;
      if(e.key===' '||e.key==='Enter'){ e.preventDefault(); if(!studyFlipped) window.studyFlip(); else window.gradeCurrent('good'); }
      else if(studyFlipped && e.key>='1' && e.key<='4'){ window.gradeCurrent(['again','hard','good','easy'][Number(e.key)-1]); }
    });
  }

  // ---------- Swipe up to reveal / grade Good (matches app feel) ----------
  function swipe(){
    let y0=0, fromScroll=false; const card=()=>$('s-flashcard');
    document.addEventListener('touchstart', e=>{ const c=card(); if(!c)return;
      if(!$('study-review').classList.contains('on'))return;
      y0=e.changedTouches[0].screenY; fromScroll=!!(e.target.closest&&e.target.closest('#s-examples-en')); }, {passive:true});
    document.addEventListener('touchend', e=>{ const c=card(); if(!c)return;
      if(!$('study-review').classList.contains('on')||studyNoteOpen||fromScroll)return;
      const d=y0-e.changedTouches[0].screenY;
      if(d>60){ if(!studyFlipped) window.studyFlip(); }
    }, {passive:true});
  }

  // ---------- Boot ----------
  function boot(){ injectStyle(); injectView(); injectHeaderButton(); hookViews(); keys(); swipe(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
