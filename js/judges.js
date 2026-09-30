/* FTT Poomsae — Remote Judge QR / Phone Interface */
let judgePeer = null;
let judgeConnections = {};
let judgeRuntime = { currentSession: "", connected: 0 };
let ctxMatForHeader = 1;

function judgeRandomToken(){
  if(window.crypto?.getRandomValues){const a=new Uint32Array(3);crypto.getRandomValues(a);return [...a].map(x=>x.toString(36)).join("");}
  return Math.random().toString(36).slice(2)+Date.now().toString(36);
}
function judgeNewSessionId(){return "S"+Date.now().toString(36)+judgeRandomToken().slice(0,6);}
function judgeIsPhone(){return new URLSearchParams(location.search).get("judge")==="1";}
function judgeParams(){const q=new URLSearchParams(location.search);return {peer:q.get("peer")||"",judge:Number(q.get("j")||0),token:q.get("t")||""};}
function judgeBaseUrl(){return location.origin+location.pathname;}

function ensureJudgePeer(){
  if(typeof Peer!=="function")return;
  if(judgePeer && !judgePeer.destroyed)return;
  const desired=(STATE.judgeQr?.peerId)||("ftt-poomsae-"+judgeRandomToken().slice(0,12));
  judgePeer=new Peer(desired,{debug:0});
  judgePeer.on("open",id=>{
    STATE.judgeQr=STATE.judgeQr||{peerId:"",tokens:{},deleted:{},sessionId:"",scores:{}};
    STATE.judgeQr.peerId=id;
    STATE.collectorQr=STATE.collectorQr||{peerId:"",token:"",deleted:false}; STATE.collectorQr.peerId=id;
    saveState();
    judgeSendContext();
    if(document.getElementById("judgesQrOverlay")){ openJudgesQR(true); setTimeout(judgeRenderAllQRCodes,50); }
  });
  judgePeer.on("connection",conn=>{
    conn.on("open",()=>{
      const data=conn.metadata||{};
      const role=String(data.role||"judge");
      if(role==="collector") {
        const token=String(data.token||"");
        if(!token || token!==String(STATE.collectorQr?.token||"")){conn.close();return;}
        window.collectorConnection=conn;
        conn.on("close",()=>{if(window.collectorConnection===conn)window.collectorConnection=null;});
        conn.send({type:"COLLECTOR_CONTEXT",...judgeContextPayload()});
        judgeUpdateQrStatuses();
        return;
      }
      const j=Number(data.judge||0), token=String(data.token||"");
      if(!j || STATE.judgeQr?.tokens?.[j]!==token){conn.close();return;}
      judgeConnections[j]=conn;
      conn.on("data",msg=>judgeReceive(msg,j));
      conn.on("close",()=>{delete judgeConnections[j];judgeUpdateQrStatuses();});
      conn.send({type:"CONTEXT",...judgeContextPayload()});
      judgeUpdateQrStatuses();
    });
    conn.on("error",()=>{});
  });
  judgePeer.on("error",e=>{console.warn("Judge peer",e); if(e?.type==="unavailable-id"){ try{judgePeer.destroy()}catch(_){} STATE.judgeQr=STATE.judgeQr||{peerId:"",tokens:{},deleted:{},sessionId:"",scores:{}}; STATE.judgeQr.peerId=""; setTimeout(ensureJudgePeer,250); }});
}
function judgeReceive(msg,j){
  if(!msg||msg.type!=="SCORE")return;
  if(String(msg.token)!==String(STATE.judgeQr?.tokens?.[j]||""))return;
  if(msg.sessionId!==STATE.judgeQr?.sessionId)return;
  const a=msg.accuracy, p=msg.presentation;
  if(!Number.isFinite(Number(a))||Number(a)<0||Number(a)>4)return;
  const parts=msg.parts||{};
  const vals=[parts.speedPower,parts.rhythmTempo,parts.expressionEnergy].map(Number);
  if(vals.some(v=>!Number.isFinite(v)||v<0.5||v>2))return;
  const presentation=Number((vals[0]+vals[1]+vals[2]).toFixed(1));
  if(Math.abs(presentation-Number(p))>0.001)return;
  STATE.judgeQr.scores[j]={accuracy:Number(a),presentation,parts:{speedPower:vals[0],rhythmTempo:vals[1],expressionEnergy:vals[2]},receivedAt:Date.now(),sessionId:msg.sessionId};
  saveState();
  if(window.collectorConnection?.open){try{window.collectorConnection.send({type:"COLLECTOR_CONTEXT",...judgeContextPayload({scoreReceived:true,judge:j})});}catch(_){} }
  const ai=j-1;
  const acc=document.getElementById(`acc${ai}`),pres=document.getElementById(`pres${ai}`);
  if(acc)acc.value=Number(a).toFixed(3);
  if(pres)pres.value=presentation.toFixed(3);
  updateJudgeSubmitButton?.();
  judgeUpdateQrStatuses();
  renderJudgeRemoteToast?.(j);
}
function judgeContextPayload(extra={}){
  const a=currentAthlete?.();
  const p=currentRoundPoomsae?.();
  return {type:"CONTEXT",sessionId:STATE.judgeQr?.sessionId||"",active:STATE.state===STATES.ROUND_RUNNING||STATE.state===STATES.CALCULATING,scoringOpen:STATE.state===STATES.ROUND_RUNNING||STATE.state===STATES.CALCULATING,round:STATE.currentRound,athlete:a?.name||"",club:a?.club||"",poomsae:WT_DATA.poomsae[p]||p||"",competition:STATE.competitionName||"FTT POOMSAE",matNumber:STATE.matNumber||1,judgeScores:STATE.judgeQr?.scores||{},judgeCount:Number(STATE.judgeCount||0),...extra};
}
function judgeSendContext(extra={}){
  if(!judgeConnections)return;
  const payload=judgeContextPayload(extra);
  Object.values(judgeConnections).forEach(c=>{try{if(c.open)c.send(payload)}catch(e){}});
}
function judgeGenerateTokens(){
  STATE.judgeQr=STATE.judgeQr||{peerId:"",tokens:{},deleted:{},sessionId:"",scores:{}};
  STATE.judgeQr.tokens={};STATE.judgeQr.deleted={};STATE.judgeQr.scores={};
  for(let i=1;i<=Number(STATE.judgeCount||0);i++)STATE.judgeQr.tokens[i]=judgeRandomToken();
  saveState();ensureJudgePeer();openJudgesQR(true);
}
function judgeRegenerateOne(j){
  STATE.judgeQr=STATE.judgeQr||{peerId:"",tokens:{},deleted:{},sessionId:"",scores:{}};
  STATE.judgeQr.tokens[j]=judgeRandomToken();
  STATE.judgeQr.deleted[j]=false;
  delete STATE.judgeQr.scores[j];
  try{judgeConnections[j]?.close()}catch(e){}
  delete judgeConnections[j];saveState();openJudgesQR(true);
}
function judgeDeleteOne(j){
  if(!confirmAction(`DELETE QR FOR JUDGE ${j}?`))return;
  STATE.judgeQr=STATE.judgeQr||{peerId:"",tokens:{},deleted:{},sessionId:"",scores:{}};
  delete STATE.judgeQr.tokens[j];STATE.judgeQr.deleted[j]=true;delete STATE.judgeQr.scores[j];
  try{judgeConnections[j]?.close()}catch(e){} delete judgeConnections[j];
  saveState();openJudgesQR(true);
}
function judgeUpdateQrStatuses(){
  Object.keys(STATE.judgeQr?.tokens||{}).forEach(j=>{const connected=!!judgeConnections[j]?.open, scored=!!STATE.judgeQr?.scores?.[j];const el=document.getElementById(`judgeQrStatus${j}`);if(el){el.textContent=scored?"SCORE RECEIVED":connected?"CONNECTED":"WAITING";el.classList.toggle("connected",connected||scored);}const op=document.querySelector(`.operatorJudgeStatusItem[data-judge="${j}"]`);if(op){op.classList.toggle("online",connected);op.classList.toggle("scored",scored);const st=op.querySelector("span");if(st)st.textContent=scored?"SCORE RECEIVED":connected?"CONNECTED":"WAITING";}});
  const cs=document.getElementById("collectorQrStatus");if(cs)cs.textContent=window.collectorConnection?.open?"CONNECTED":"WAITING";
}
function judgeQrUrl(j){
  const base=judgeBaseUrl();
  const peer=STATE.judgeQr?.peerId||"";
  return `${base}?judge=1&peer=${encodeURIComponent(peer)}&j=${j}&t=${encodeURIComponent(STATE.judgeQr.tokens[j]||"")}`;
}
function openJudgesQR(regenerate=false){
  if(location.protocol==="file:")return alert("JUDGES QR requires the project to be opened from GitHub Pages, Netlify, or a local web server (not directly as a file).");
  if(!STATE.setupComplete)return alert("Complete the Competition Setup first.");
  ensureJudgePeer();
  STATE.judgeQr=STATE.judgeQr||{peerId:"",tokens:{},deleted:{},sessionId:"",scores:{}};
  if(!Object.keys(STATE.judgeQr.tokens||{}).length || Object.keys(STATE.judgeQr.tokens||{}).length!==Number(STATE.judgeCount||0)){
    STATE.judgeQr.tokens={};STATE.judgeQr.deleted={};STATE.judgeQr.scores={};for(let i=1;i<=STATE.judgeCount;i++)STATE.judgeQr.tokens[i]=judgeRandomToken();saveState();
  }
  const old=document.getElementById("judgesQrOverlay");if(old)old.remove();
  const overlay=document.createElement("div");overlay.id="judgesQrOverlay";overlay.className="judgeQrOverlay";
  overlay.innerHTML=`<div class="judgeQrModal"><div class="judgeQrHeader"><div><div class="phaseTag">REMOTE JUDGES</div><h2>JUDGES QR</h2><p>Chaque juge scanne uniquement son QR code avec son téléphone.</p></div><button class="btn" onclick="document.getElementById('judgesQrOverlay')?.remove()">CLOSE</button></div><div class="judgeQrGrid">${Array.from({length:Number(STATE.judgeCount||0)},(_,idx)=>{const j=idx+1;const hasQr=!!STATE.judgeQr.tokens?.[j];return `<div class="judgeQrCard"><div class="judgeQrCardTop"><strong>JUDGE ${j}</strong><span id="judgeQrStatus${j}" class="judgeQrStatus">${hasQr?(judgeConnections[j]?.open?"CONNECTED":"WAITING"):"QR DELETED"}</span></div>${hasQr?`<div id="judgeQr${j}" class="judgeQrImage"></div><div class="judgeQrHint">SCAN WITH PHONE</div>`:`<div class="judgeQrImage judgeQrDeleted"><span>QR<br>DELETED</span></div><div class="judgeQrHint">GENERATE A NEW CODE</div>`}<div class="judgeQrActions"><button class="btn" onclick="judgeRegenerateOne(${j})">${hasQr?"CHANGE QR":"GENERATE QR"}</button><button class="btn danger" onclick="judgeDeleteOne(${j})" ${hasQr?"":"disabled"}>DELETE</button></div></div>`}).join("")}</div><div class="judgeQrFooter"><span>PEER CONNECTION: <b>${esc(STATE.judgeQr.peerId||"CONNECTING...")}</b></span><button class="btn primary" onclick="judgeGenerateTokens()">REGENERATE ALL QR</button></div></div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(()=>judgeRenderAllQRCodes());
  setTimeout(()=>{ judgeRenderAllQRCodes(); judgeUpdateQrStatuses(); },250);
}

function judgeRenderAllQRCodes(){
  for(let j=1;j<=Number(STATE.judgeCount||0);j++){
    const box=document.getElementById(`judgeQr${j}`);
    if(!box || !STATE.judgeQr.tokens?.[j]) continue;
    const text=judgeQrUrl(j);
    box.innerHTML="";
    try{
      if(typeof window.QRCode === "function"){
        new QRCode(box,{text,width:190,height:190,colorDark:"#07111d",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
        if(box.children.length)continue;
      }
    }catch(e){ console.warn("QRCode library failed",e); }
    // Reliable fallback: render the QR through a public QR image endpoint.
    const img=document.createElement("img");
    img.alt=`QR CODE JUDGE ${j}`;
    img.width=190; img.height=190;
    img.referrerPolicy="no-referrer";
    img.src=`https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=8&data=${encodeURIComponent(text)}`;
    img.onerror=()=>{box.innerHTML='<div style="font-size:12px;text-align:center;color:#667789;padding:25px">QR IMAGE UNAVAILABLE<br><small>Check internet connection</small></div>';};
    box.appendChild(img);
  }
}

function judgePhoneSend(type,data){
  const {peer,judge,token}=judgeParams();
  if(!peer||!judge||!token){judgePhoneToast("Invalid judge link",true);return;}
  if(!window._judgePhoneConn||!window._judgePhoneConn.open){judgePhoneToast("Not connected to operator",true);return;}
  window._judgePhoneConn.send({type,...data,judge,token,sessionId:window._judgePhoneSession||""});
  if(type==="SCORE"){window._judgePhoneSent=true;judgePhoneRenderSent();}
}
function judgePhoneToast(msg,error=false){const el=document.getElementById("judgePhoneToast");if(!el)return;el.textContent=msg;el.className=`judgePhoneToast show ${error?"error":""}`;clearTimeout(window._judgeToastTimer);window._judgeToastTimer=setTimeout(()=>el.classList.remove("show"),1800);}
function judgePhoneRenderSent(){const b=document.getElementById("judgePhoneSend");if(b){b.textContent="✓ SCORE SENT";b.classList.add("sent");}}
function judgePhoneClamp(){window._judgePhoneAcc=Math.max(0,Math.min(4,Math.round((window._judgePhoneAcc+Number(window._judgePhoneDelta||0))*10)/10));window._judgePhoneDelta=0;const el=document.getElementById("judgeAccuracyValue");if(el)el.textContent=window._judgePhoneAcc.toFixed(1);}
function judgePhoneAdjust(delta){window._judgePhoneDelta=Number(delta)||0;judgePhoneClamp();window._judgePhoneSent=false;judgePhoneRenderReset();}
function judgePhoneSetPart(key,value){if(!window._judgePhoneParts)window._judgePhoneParts={speedPower:2,rhythmTempo:2,expressionEnergy:2};const next=Math.max(0.5,Math.min(2,Math.round(Number(value)*10)/10));window._judgePhoneParts[key]=next;const el=document.querySelector(`[data-part-value="${key}"]`);if(el)el.textContent=next.toFixed(1);const total=Object.values(window._judgePhoneParts).reduce((s,v)=>s+v,0);const t=document.getElementById("judgePresentationTotal");if(t)t.textContent=total.toFixed(1);window._judgePhoneSent=false;judgePhoneRenderReset();}
function renderJudgeRemoteToast(j){ const box=document.getElementById("judgeQrStatus"+j); if(box){box.textContent="SCORE RECEIVED";box.classList.add("connected");setTimeout(()=>judgeUpdateQrStatuses(),1300);} }
function judgePhoneRenderReset(){const b=document.getElementById("judgePhoneSend");if(b){b.textContent="SEND SCORE";b.classList.remove("sent");}}
function judgePhoneBuildValues(key){const value=Number(window._judgePhoneParts[key]||0.5);const down=Math.max(0.5,value-0.1).toFixed(1);const up=Math.min(2,value+0.1).toFixed(1);return `<button class="partAdjust partMinus" ${value<=0.5?"disabled":""} onclick="judgePhoneSetPart('${key}',${down})">−</button><div class="partValue" data-part-value="${key}">${value.toFixed(1)}</div><button class="partAdjust partPlus" ${value>=2?"disabled":""} onclick="judgePhoneSetPart('${key}',${up})">+</button>`;}
async function judgePhoneFullscreen(){
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen?.();
      try{await screen.orientation?.lock?.("landscape");}catch(_){}
    }else{
      await document.exitFullscreen?.();
    }
    judgePhoneUpdateViewport();
  }catch(e){judgePhoneToast("FULL SCREEN NOT AVAILABLE",true);}
}
function judgePhoneUpdateViewport(){
  const app=document.querySelector(".judgePhoneApp");
  const portrait=window.innerHeight>window.innerWidth;
  document.body.classList.toggle("judgePortrait",portrait);
  if(app) app.classList.toggle("judgeLandscape",!portrait);
  const b=document.getElementById("judgeFsBtn");
  if(b)b.textContent=document.fullscreenElement?"↙":"⛶";
  if(b)b.title=document.fullscreenElement?"Quitter le plein écran":"Plein écran";
}
function judgePhoneOrientationPrompt(){
  const p=document.getElementById("judgeOrientationOverlay");
  if(p)p.classList.toggle("show",window.innerHeight>window.innerWidth);
}
function judgePhoneInitControls(){
  document.addEventListener("fullscreenchange",()=>{judgePhoneUpdateViewport();judgePhoneOrientationPrompt();});
  window.addEventListener("resize",()=>{judgePhoneUpdateViewport();judgePhoneOrientationPrompt();});
  judgePhoneUpdateViewport();judgePhoneOrientationPrompt();
}

function collectorRandomToken(){return judgeRandomToken();}
function collectorQrUrl(){const base=judgeBaseUrl();const peer=STATE.collectorQr?.peerId||STATE.judgeQr?.peerId||"";return `${base}?collector=1&peer=${encodeURIComponent(peer)}&t=${encodeURIComponent(STATE.collectorQr?.token||"")}`;}
function ensureCollectorQr(){STATE.collectorQr=STATE.collectorQr||{peerId:"",token:"",deleted:false};if(!STATE.collectorQr.token)STATE.collectorQr.token=collectorRandomToken();STATE.collectorQr.peerId=STATE.judgeQr?.peerId||STATE.collectorQr.peerId||"";saveState();}
function openCollectorQR(){
  if(location.protocol==="file:")return alert("COLLECTOR QR requires a web server.");
  ensureCollectorQr();
  const old=document.getElementById("collectorQrOverlay");if(old)old.remove();
  const overlay=document.createElement("div");overlay.id="collectorQrOverlay";overlay.className="judgeQrOverlay";
  overlay.innerHTML=`<div class="judgeQrModal collectorModal"><div class="judgeQrHeader"><div><div class="phaseTag">REMOTE COLLECTOR</div><h2>COLLECTOR QR</h2><p>Scannez ce QR avec le téléphone du collecteur.</p></div><button class="btn" onclick="document.getElementById('collectorQrOverlay')?.remove()">CLOSE</button></div><div class="collectorQrCenter"><div id="collectorQrImage" class="judgeQrImage"></div><div class="judgeQrHint">SCAN WITH COLLECTOR PHONE</div><span id="collectorQrStatus" class="judgeQrStatus">${window.collectorConnection?.open?"CONNECTED":"WAITING"}</span><div class="judgeQrActions"><button class="btn" onclick="regenerateCollectorQR()">CHANGE QR</button><button class="btn danger" onclick="deleteCollectorQR()">DELETE</button></div></div></div>`;
  document.body.appendChild(overlay);renderCollectorQRCode();
}
function renderCollectorQRCode(){const box=document.getElementById("collectorQrImage");if(!box)return;box.innerHTML="";try{if(typeof QRCode==="function"){new QRCode(box,{text:collectorQrUrl(),width:220,height:220,colorDark:"#07111d",colorLight:"#fff",correctLevel:QRCode.CorrectLevel.M});if(box.children.length)return;}}catch(e){}const img=document.createElement("img");img.width=220;img.height=220;img.alt="COLLECTOR QR";img.src=`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(collectorQrUrl())}`;box.appendChild(img);}
function regenerateCollectorQR(){ensureCollectorQr();STATE.collectorQr.token=collectorRandomToken();STATE.collectorQr.deleted=false;try{window.collectorConnection?.close()}catch(_){}window.collectorConnection=null;saveState();openCollectorQR();}
function deleteCollectorQR(){if(!confirmAction("DELETE COLLECTOR QR?"))return;STATE.collectorQr.token="";STATE.collectorQr.deleted=true;try{window.collectorConnection?.close()}catch(_){}window.collectorConnection=null;saveState();openCollectorQR();}
function collectorPhoneConnect(p){if(typeof Peer!=="function"){collectorPhoneToast("PeerJS unavailable",true);return;}const local=new Peer();const status=t=>{const e=document.getElementById("collectorConnection");if(e)e.textContent=t;};local.on("open",()=>{const c=local.connect(p.peer,{reliable:true,metadata:{role:"collector",token:p.token}});window._collectorConn=c;c.on("open",()=>status("CONNECTED"));c.on("data",m=>{if(m?.type==="COLLECTOR_CONTEXT")renderCollectorPhoneContext(m)});c.on("close",()=>status("DISCONNECTED"));c.on("error",()=>status("ERROR"));});local.on("error",()=>status("DISCONNECTED"));}
function collectorPhoneToast(msg,error=false){const e=document.getElementById("collectorToast");if(e){e.textContent=msg;e.className=`judgePhoneToast show ${error?"error":""}`;setTimeout(()=>e.classList.remove("show"),1800);}}
function renderCollectorPhoneContext(ctx){const main=document.getElementById("collectorMain");if(!main)return;main.innerHTML=`<section class="collectorPhoneCard"><div class="phaseTag">COLLECTOR</div><h1>MAT ${esc(ctx.matNumber||1)}</h1><p>${esc(ctx.athlete||"WAITING")}</p><div class="collectorState">${ctx.scoringOpen?"SCORING OPEN":"WAITING FOR SCORING"}</div><div class="collectorJudgeList">${Array.from({length:Number(ctx.judgeCount||STATE.judgeCount||0)},(_,i)=>{const s=ctx.judgeScores?.[i+1];return `<div><b>JUDGE ${i+1}</b><span>${s?`✓ ${fmt3(s.accuracy+s.presentation)}`:"WAITING"}</span></div>`}).join("")}</div></section>`;}
function renderCollector(){const p=new URLSearchParams(location.search);document.body.innerHTML=`<div class="judgePhoneApp"><header class="judgePhoneHeader"><img src="federation_logo_transparent.png"><div><small>FTT POOMSAE · MAT ${esc(STATE.matNumber||1)}</small><strong>COLLECTOR</strong></div><span id="collectorConnection" class="judgePhoneConnection">CONNECTING</span></header><main id="collectorMain"></main><div id="collectorToast" class="judgePhoneToast"></div></div>`;renderCollectorPhoneContext({matNumber:STATE.matNumber||1,athlete:"",scoringOpen:false});collectorPhoneConnect({peer:p.get("peer"),token:p.get("t")});}

function renderJudgePhone(){
  const p=judgeParams();
  document.body.innerHTML=`<div class="judgePhoneApp"><div class="judgePhoneGlow g1"></div><div class="judgePhoneGlow g2"></div><header class="judgePhoneHeader"><img src="federation_logo_transparent.png"><div><small>FTT POOMSAE · MAT ${esc(ctxMatForHeader||STATE.matNumber||1)}</small><strong>JUDGE ${p.judge||"—"}</strong></div><div class="judgePhoneHeaderActions"><span id="judgePhoneConnection" class="judgePhoneConnection">CONNECTING</span><button id="judgeFsBtn" class="judgePhoneFsBtn" onclick="judgePhoneFullscreen()" title="Plein écran">⛶</button></div></header><main id="judgePhoneMain"></main><div id="judgePhoneToast" class="judgePhoneToast"></div><div id="judgeOrientationOverlay" class="judgeOrientationOverlay"><div class="orientationIcon">↔</div><strong>TURN PHONE TO LANDSCAPE</strong><span>Le mode paysage est obligatoire pour noter.</span><button class="judgePhoneFsBtn large" onclick="judgePhoneFullscreen()">⛶ FULL SCREEN</button></div></div>`;
  window._judgePhoneAcc=4;window._judgePhoneParts={speedPower:2,rhythmTempo:2,expressionEnergy:2};window._judgePhoneSent=false;
  judgePhoneInitControls();
  judgePhoneRenderMain({active:false,scoringOpen:false,athlete:"",club:"",poomsae:"",round:1,competition:"FTT POOMSAE"});
  judgePhoneConnect(p);
}
function judgePhoneConnect(p){
  if(typeof Peer!=="function"){judgePhoneToast("PeerJS unavailable",true);return;}
  if(!p.peer||!p.judge||!p.token){judgePhoneToast("Invalid judge QR",true);return;}
  let attempts=0, connected=false, retryTimer=null;
  const local=new Peer();
  const setStatus=(text,on)=>{const el=document.getElementById("judgePhoneConnection");if(el){el.textContent=text;el.classList.toggle("connected",!!on);}};
  const connect=()=>{
    if(connected)return;
    attempts++; setStatus(attempts>1?`RECONNECTING ${attempts}`:"CONNECTING",false);
    let conn; try{conn=local.connect(p.peer,{reliable:true,serialization:"json",metadata:{role:"judge",judge:p.judge,token:p.token}});}catch(e){retryTimer=setTimeout(connect,1200);return;}
    window._judgePhoneConn=conn;
    const fail=()=>{if(connected)return;try{conn.close()}catch(_){} if(attempts<8)retryTimer=setTimeout(connect,1000);else setStatus("DISCONNECTED",false);};
    conn.on("open",()=>{connected=true;clearTimeout(retryTimer);setStatus("CONNECTED",true);judgePhoneToast("CONNECTED TO OPERATOR");});
    conn.on("data",msg=>{if(msg?.type==="CONTEXT"){ctxMatForHeader=Number(msg.matNumber)||1;const nextSession=msg.sessionId||"";if(nextSession!==window._judgePhoneSession){window._judgePhoneAcc=4;window._judgePhoneParts={speedPower:2,rhythmTempo:2,expressionEnergy:2};window._judgePhoneSent=false;judgePhoneRenderReset();}window._judgePhoneSession=nextSession;judgePhoneRenderMain(msg);}});
    conn.on("close",()=>{connected=false;setStatus("DISCONNECTED",false);if(attempts<8)retryTimer=setTimeout(connect,1000);});
    conn.on("error",fail);
  };
  local.on("open",()=>{attempts=0;connect();});
  local.on("error",()=>{if(attempts<8){clearTimeout(retryTimer);retryTimer=setTimeout(connect,1000)}else judgePhoneToast("Cannot connect to operator",true)});
  window._judgePhonePeer=local;
}
function judgePhoneRenderMain(ctx){
  const open=!!ctx.scoringOpen;
  const total=Object.values(window._judgePhoneParts||{speedPower:2,rhythmTempo:2,expressionEnergy:2}).reduce((s,v)=>s+v,0);
  const main=document.getElementById("judgePhoneMain");if(!main)return;
  const header=`<section class="judgePhoneMatch"><div class="judgePhoneEyebrow">${esc(ctx.competition||"FTT POOMSAE")}</div><h1>${esc(ctx.athlete||"WAITING FOR NEXT POOMSAE")}</h1><p>${esc(ctx.club||"")}</p><div class="judgePhoneRound">ROUND ${ctx.round||1} · ${esc(ctx.poomsae||"—")}</div></section>`;
  const waiting=`<section class="judgeWaiting"><div class="waitingIcon">⌛</div><h2>WAITING FOR SCORING</h2><p>The operator will open the scoring screen after the performance.</p></section>`;
  const scoring=`<section class="judgeScoreCard"><div class="scoreSectionTitle"><span>ACCURACY</span><small>STARTING SCORE</small></div><div id="judgeAccuracyValue" class="judgeAccuracyValue">${Number(window._judgePhoneAcc||4).toFixed(1)}</div><div class="accuracyControls"><button class="accuracyMinus big" onclick="judgePhoneAdjust(-0.3)">−0.3</button><button class="accuracyMinus" onclick="judgePhoneAdjust(-0.1)">−0.1</button><button class="accuracyPlus" onclick="judgePhoneAdjust(0.1)">+0.1</button><button class="accuracyPlus" onclick="judgePhoneAdjust(0.3)">+0.3</button></div><div class="scoreSectionTitle presentationTitle"><span>PRESENTATION</span><small>3 PARAMETERS</small></div><div class="presentationParts"><div class="partCard"><b>SPEED &amp; POWER</b><div class="partControl">${judgePhoneBuildValues("speedPower")}</div></div><div class="partCard"><b>RHYTHM &amp; TEMPO</b><div class="partControl">${judgePhoneBuildValues("rhythmTempo")}</div></div><div class="partCard"><b>EXPRESSION OF ENERGY</b><div class="partControl">${judgePhoneBuildValues("expressionEnergy")}</div></div></div><div class="presentationTotal"><span>PRESENTATION</span><strong id="judgePresentationTotal">${total.toFixed(1)}</strong></div><button id="judgePhoneSend" class="judgePhoneSend" onclick="judgePhoneSend('SCORE',{accuracy:Number(window._judgePhoneAcc.toFixed(1)),presentation:Number(Object.values(window._judgePhoneParts).reduce((s,v)=>s+v,0).toFixed(1)),parts:{...window._judgePhoneParts}})">SEND SCORE</button></section>`;
  main.innerHTML=header+(open?scoring:waiting);
}

function renderJudge(){renderJudgePhone();}
if(judgeIsPhone())renderJudge();
else if(new URLSearchParams(location.search).get("collector")==="1")renderCollector();
else if(!new URLSearchParams(location.search).get("display")) ensureJudgePeer();
