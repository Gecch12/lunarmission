
(()=>{"use strict";
const $=s=>document.querySelector(s),connect=$("#connect"),game=$("#game"),name=$("#name"),room=$("#room"),join=$("#join"),create=$("#create"),crew=$("#crew"),role=$("#role"),ready=$("#ready"),start=$("#start"),roleInfo=$("#roleInfo"),roomDisplay=$("#roomDisplay"),score=$("#score"),actions=$("#actions"),phaseNo=$("#phaseNo"),phaseTitle=$("#phaseTitle"),phaseContext=$("#phaseContext"),milestone=$("#milestone"),status=$("#status"),cards=$("#cards"),active=$("#active"),challengeTitle=$("#challengeTitle"),challengePrompt=$("#challengePrompt"),clues=$("#clues"),options=$("#options"),scan=$("#scan"),gauges=$("#gauges"),log=$("#log"),pips=$("#pips"),toast=$("#toast"),progressPath=$("#progressPath"),shipMarker=$("#shipMarker");
let ws,state,session,token,roomCode,removed=new Set();
for(const r of ["","Commander","Pilot","Navigator","Systems","Science","Medical"]){const o=document.createElement("option");o.value=r;o.textContent=r||"SELECT STATION";role.append(o)}
name.value=localStorage.getItem("lm_name")||"";
const invite=new URLSearchParams(window.location.search).get("room");if(invite)room.value=invite.toUpperCase();
function say(t){toast.textContent=t;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),2600)}
function socketUrl(){return `${location.protocol==="https:"?"wss":"ws"}://${location.host}/ws`}
function open(first){const s=new WebSocket(socketUrl());s.onopen=()=>s.send(JSON.stringify(first));s.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="joined"){ws=s;session=m.sessionId;token=m.reconnectionToken;roomCode=m.roomCode;connect.classList.add("hidden");game.classList.remove("hidden")}else if(m.type==="state"){state=m.state;render()}else if(m.type==="error")say(m.message);else if(m.type==="scan_result"){removed.add(m.removedOption);say(m.message);renderOptions()}};s.onclose=()=>{if(state&&!state.finished)setTimeout(()=>open({type:"reconnect",roomCode,reconnectionToken:token}),1500)};s.onerror=()=>say("Connection failed.")}
function ident(){const n=name.value.trim();if(!n)throw Error("Enter a call sign.");localStorage.setItem("lm_name",n);return n}
create.onclick=()=>{try{open({type:"create",name:ident()})}catch(e){say(e.message)}};
join.onclick=()=>{try{open({type:"join",name:ident(),roomCode:room.value.trim().toUpperCase()})}catch(e){say(e.message)}};
function send(type,x={}){if(ws?.readyState===1)ws.send(JSON.stringify({type,...x}))}
role.onchange=()=>send("set_role",{role:role.value});ready.onclick=()=>send("toggle_ready");start.onclick=()=>send("start");scan.onclick=()=>send("scan");

function render(){
 const me=state.players[session];roomDisplay.textContent=state.roomCode;role.value=me?.role||"";ready.textContent=me?.ready?"STANDBY":"READY";start.style.display=session===state.hostSessionId&&!state.started?"block":"none";
 crew.innerHTML=Object.entries(state.players).map(([id,p])=>`<div class="crew"><b>${p.name}${id===state.hostSessionId?" ★":""}</b><span>${p.role||"UNASSIGNED"} • ${p.ready?"READY":"STANDBY"}${p.connected?"":" • RECONNECTING"}</span></div>`).join("");
 const ri=state.roleInfo[me?.role];roleInfo.innerHTML=ri?`<h3>${me.role.toUpperCase()}</h3><div class="roleText"><strong>${ri[0]}</strong><br>${ri[1]}<br><small>${ri[2]}</small></div>`:"<h3>ROLE BRIEFING</h3><small>Select a station.</small>";
 score.textContent=`${state.successes} / 3 VERIFIED`;actions.textContent=`${state.actions} ACTIONS`;status.textContent=state.status;
 pips.innerHTML=[0,1,2,3,4].map(i=>`<span class="pip ${i<state.successes?"ok":i>=5-state.failures?"bad":""}"></span>`).join("");
 if(state.phaseData){phaseNo.textContent=`PHASE ${state.phaseIndex+1} OF 5`;phaseTitle.textContent=state.phaseData.title.toUpperCase();phaseContext.textContent=state.phaseData.context;milestone.textContent=state.phaseData.milestone.toUpperCase();moveShip(state.phaseData.position)}
 else{phaseNo.textContent="MISSION BOARD";phaseTitle.textContent=state.finished?"MISSION COMPLETE":"ASSEMBLE THE CREW";phaseContext.textContent=state.status;milestone.textContent="KENNEDY SPACE CENTER";moveShip(0)}
 cards.innerHTML=state.challengeCards.map(c=>`<button class="card ${c.resolved?"resolved":""}" data-id="${c.id}" ${c.resolved||state.currentChallenge?"disabled":""}><b>${c.title}</b><small>1 SHARED ACTION</small></button>`).join("");
 cards.querySelectorAll(".card:not(.resolved)").forEach(b=>b.onclick=()=>{removed.clear();send("select_challenge",{challengeId:b.dataset.id})});
 active.classList.toggle("hidden",!state.currentChallenge);
 if(state.currentChallenge){challengeTitle.textContent=state.currentChallenge.title;challengePrompt.textContent=state.currentChallenge.prompt;clues.innerHTML=state.privateClues.map(c=>`<div class="clue"><b>${c.role.toUpperCase()}</b><div>${c.clue}</div><div class="taboo">FORBIDDEN: ${c.taboo.join(" • ")}</div></div>`).join("");renderOptions()}
 gauges.innerHTML=[["OXYGEN",state.oxygen,false],["POWER",state.power,false],["HEAT",state.heat,true],["TRAJECTORY",state.trajectory,false],["MISSION DATA",state.data,false]].map(([n,v,rev])=>`<div class="gauge"><div class="gaugeTop"><span>${n}</span><b>${Math.round(v)}%</b></div><div class="track"><div class="fill ${(rev?v>75:v<25)?"warn":""}" style="width:${v}%"></div></div></div>`).join("");
 log.innerHTML=[...state.log].reverse().map(e=>`<div class="event ${e.tone}">${e.t}</div>`).join("");
 if(state.finished){active.classList.add("hidden");cards.innerHTML=`<div class="card" style="grid-column:1/-1"><b>${state.status}</b></div>${session===state.hostSessionId?'<button id="reset" class="primary">NEW MISSION</button>':""}`;const r=$("#reset");if(r)r.onclick=()=>send("reset")}
}
function renderOptions(){options.innerHTML=state.currentChallenge.options.map((o,i)=>`<button class="${removed.has(i)?"eliminated":""}" data-i="${i}">${String.fromCharCode(65+i)}. ${o}</button>`).join("");options.querySelectorAll("button:not(.eliminated)").forEach(b=>b.onclick=()=>send("submit_answer",{optionIndex:Number(b.dataset.i)}))}
function moveShip(percent){const path=progressPath,total=path.getTotalLength(),point=path.getPointAtLength(total*percent/100);shipMarker.setAttribute("transform",`translate(${point.x} ${point.y})`);path.style.strokeDashoffset=String(total*(1-percent/100))}
renderStars();
function renderStars(){const g=$("#stars");let s="";for(let i=0;i<90;i++){const x=(i*83)%1000,y=(i*47)%390,r=(i%4===0?1.4:.7);s+=`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${.25+(i%5)*.12}"/>`}g.innerHTML=s}
})();