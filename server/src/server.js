
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const __dirname=dirname(fileURLToPath(import.meta.url));
const ROOT=resolve(__dirname,"../.."), CLIENT=resolve(ROOT,"client");
const PORT=Number(process.env.PORT||2567);
const ROLES=["Commander","Pilot","Navigator","Systems","Science","Medical"];
const rooms=new Map();
const MIME={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json"};

const ROLE_INFO={
 Commander:["What should we prioritize?","Owns mission priorities and irreversible go/no-go decisions.","Needs technical recommendations from every station."],
 Pilot:["What can Orion execute?","Controls attitude, burns, docking practice, and entry configuration.","Needs Navigator targets and Systems limits."],
 Navigator:["Where must Orion go?","Protects the free-return trajectory and entry corridor.","Needs Pilot execution and Science interpretation."],
 Systems:["What can Orion support?","Manages power, cooling, propulsion, communications, and failures.","Needs Medical priorities and Commander trade-offs."],
 Science:["What do the data mean?","Interprets sensors, formulas, lunar observations, and uncertainty.","Needs timing from Navigator and power from Systems."],
 Medical:["What can the crew survive?","Defines oxygen, temperature, radiation, fatigue, and g-load limits.","Needs Systems support and Commander decisions."]
};

const PHASES=[
 {id:"earth-orbit",title:"Earth Orbit Checkout",milestone:"Two high Earth orbits",position:8,
  context:"Orion remains near Earth while the crew verifies life support, communications, navigation, manual flying, and readiness for deep space.",
  challenges:[
   ["Cabin integrity","Which sequence is safe?","Begin circulation|Pressure test|Seal hatch","0",
    {"Commander":"No release without a verified pressure check.","Pilot":"The hatch closes after circulation begins.","Navigator":"The pressure check is the middle operation.","Systems":"Environmental circulation is first.","Science":"Testing happens before final closure.","Medical":"Do not enclose the crew before air processing starts."},
    {"Commander":["release","pressure"],"Pilot":["hatch","circulation"],"Navigator":["middle","operation"],"Systems":["environmental","first"],"Science":["testing","closure"],"Medical":["crew","air"]},
    {"oxygen":4},{"oxygen":-10,"heat":6}],
   ["Manual flight demo","Which target should the Pilot hold?","Stable attitude reference|Fastest rotation|Sun-pointing regardless of limits","0",
    {"Commander":"The objective is capability verification, not speed.","Pilot":"The control test needs a steady reference.","Navigator":"A stable attitude makes navigation comparison possible.","Systems":"Fast rotation increases propellant use.","Science":"The Sun angle may blind one sensor.","Medical":"Minimize unnecessary motion sickness."},
    {"Commander":["verification","speed"],"Pilot":["steady","reference"],"Navigator":["stable","navigation"],"Systems":["rotation","propellant"],"Science":["Sun","sensor"],"Medical":["motion","sickness"]},
    {"trajectory":5},{"trajectory":-8,"power":-3}],
   ["Communications check","Which route is valid?","High gain + visible relay|Low gain + blocked relay|Any antenna","0",
    {"Commander":"Mission Control needs full telemetry.","Pilot":"One relay is below the horizon.","Navigator":"The visible relay has line of sight.","Systems":"High gain is powered and healthy.","Science":"Low gain cannot carry the full data stream.","Medical":"Medical telemetry must remain available."},
    {"Commander":["Mission Control","telemetry"],"Pilot":["relay","horizon"],"Navigator":["visible","sight"],"Systems":["high gain","healthy"],"Science":["low gain","data"],"Medical":["medical","available"]},
    {"data":5},{"data":-4}],
   ["Deep-space go/no-go","Which posture is justified?","GO with all red faults cleared|GO with unresolved red fault|NO-GO for any amber caution","0",
    {"Commander":"Red faults block departure; amber cautions require mitigation.","Pilot":"The propulsion system is green.","Navigator":"The departure corridor remains open.","Systems":"No red fault remains.","Science":"A reduced experiment does not prevent flight.","Medical":"Crew limits are inside the envelope."},
    {"Commander":["red","amber"],"Pilot":["propulsion","green"],"Navigator":["corridor","open"],"Systems":["fault","remains"],"Science":["experiment","flight"],"Medical":["crew","envelope"]},
    {"power":4},{"trajectory":-6}],
   ["Payload trade-off","Where should 12 spare power units go?","8 cooling + 4 science|12 science|6 guidance + 6 science","0",
    {"Commander":"Protect survival margin while preserving some mission value.","Pilot":"Guidance is already nominal.","Navigator":"No extra guidance power is required.","Systems":"Cooling needs eight units.","Science":"Four units preserve the sample freezer.","Medical":"The hotspot becomes a crew hazard."},
    {"Commander":["survival","mission"],"Pilot":["guidance","nominal"],"Navigator":["extra","power"],"Systems":["cooling","eight"],"Science":["four","freezer"],"Medical":["hotspot","hazard"]},
    {"heat":-8,"data":8},{"heat":12}]
  ]},
 {id:"tli",title:"Translunar Injection",milestone:"Commit to the Moon",position:25,
  context:"The main engine raises Orion's energy and places the spacecraft on a free-return trajectory. This is the mission's central commitment.",
  challenges:[
   ["Burn direction","Which attitude adds orbital energy?","Prograde|Retrograde|Radial inward","0",
    {"Commander":"The maneuver must increase orbital energy.","Pilot":"The aft engine thrusts through the nose axis.","Navigator":"Velocity must increase in the direction of travel.","Systems":"The main engine is available.","Science":"Positive energy raises apogee toward the Moon.","Medical":"The planned acceleration is acceptable."},
    {"Commander":["increase","energy"],"Pilot":["engine","nose"],"Navigator":["velocity","travel"],"Systems":["main","available"],"Science":["apogee","Moon"],"Medical":["acceleration","acceptable"]},
    {"trajectory":10},{"trajectory":-14}],
   ["Burn duration","Required delta-v is 120 m/s. Effective acceleration is 2.4 m/s².","40 seconds|50 seconds|60 seconds","1",
    {"Commander":"Use one continuous burn.","Pilot":"Rated acceleration is 3.0 m/s².","Navigator":"Required velocity change is 120 m/s.","Systems":"Efficiency is 80 percent.","Science":"Time equals delta-v divided by effective acceleration.","Medical":"A burn under one minute is acceptable."},
    {"Commander":["continuous","burn"],"Pilot":["3.0","acceleration"],"Navigator":["120","velocity"],"Systems":["80","efficiency"],"Science":["time","divided"],"Medical":["minute","acceptable"]},
    {"trajectory":12,"power":-4},{"trajectory":-12,"power":-5}],
   ["Sensor conflict","A=118, B=121, C=160 and flagged. Use:","Average all|Median of healthy readings|Highest","1",
    {"Commander":"Flagged data cannot drive a critical maneuver.","Pilot":"A and B agree within tolerance.","Navigator":"Expected value is about 120.","Systems":"C shares power with a failed heater.","Science":"Use the center of reliable evidence.","Medical":"Do not lengthen the burn for one suspect value."},
    {"Commander":["flagged","critical"],"Pilot":["agree","tolerance"],"Navigator":["120","expected"],"Systems":["C","heater"],"Science":["center","reliable"],"Medical":["lengthen","suspect"]},
    {"trajectory":7},{"trajectory":-10}],
   ["Fuel reserve","What policy protects the return?","Keep 20% for corrections|Spend all remaining fuel|Keep 5%","0",
    {"Commander":"A safe return requires contingency capability.","Pilot":"Future attitude corrections use propellant.","Navigator":"Multiple correction opportunities remain.","Systems":"Twenty percent covers the planned reserve.","Science":"More coast time helps observations but is optional.","Medical":"Longer exposure increases fatigue."},
    {"Commander":["safe","contingency"],"Pilot":["attitude","propellant"],"Navigator":["correction","remain"],"Systems":["twenty","reserve"],"Science":["observations","optional"],"Medical":["exposure","fatigue"]},
    {"power":5},{"trajectory":-6}],
   ["Commit decision","Cooling is improving and remains 6 C below red. Choose:","Continue monitored burn|Immediate abort|Disable cooling","0",
    {"Commander":"Abort is for a red-limit breach or failed control.","Pilot":"The engine can stop quickly if trend reverses.","Navigator":"Stopping now misses free return.","Systems":"Cooling trend is improving.","Science":"The sensor is calibrated.","Medical":"Six degrees of margin remains acceptable."},
    {"Commander":["abort","red"],"Pilot":["engine","stop"],"Navigator":["misses","return"],"Systems":["cooling","improving"],"Science":["sensor","calibrated"],"Medical":["six","margin"]},
    {"heat":-5,"trajectory":4},{"trajectory":-9}]
  ]},
 {id:"outbound",title:"Outbound Cruise",milestone:"Beyond Earth's magnetosphere",position:45,
  context:"The crew travels through deep space, manages radiation exposure, protects life support, and decides whether trajectory correction is necessary.",
  challenges:[
   ["Thermal fault","What is the root cause?","Cooling pump B|Oxygen tank|Main engine","0",
    {"Commander":"The thermal anomaly began before the oxygen warning.","Pilot":"Engine thrust remains nominal.","Navigator":"Trajectory changed only after power shedding.","Systems":"Pump B current fell to zero.","Science":"Temperature rose before pressure changed.","Medical":"The oxygen warning is a secondary effect."},
    {"Commander":["thermal","oxygen"],"Pilot":["engine","nominal"],"Navigator":["trajectory","power"],"Systems":["pump","zero"],"Science":["temperature","pressure"],"Medical":["warning","secondary"]},
    {"heat":-5},{"heat":14}],
   ["Emergency power","You have 10 units. Cooling needs 6; life support needs 4.","6 cooling + 4 life support|8 cooling + 2 science|5 cooling + 5 navigation","0",
    {"Commander":"Survival systems come before optional goals.","Pilot":"Navigation can coast this round.","Navigator":"No maneuver is scheduled.","Systems":"Cooling requires six units.","Science":"Experiments can power down.","Medical":"Life support requires four units."},
    {"Commander":["survival","optional"],"Pilot":["navigation","coast"],"Navigator":["maneuver","scheduled"],"Systems":["cooling","six"],"Science":["experiments","down"],"Medical":["life support","four"]},
    {"heat":-12,"oxygen":5},{"heat":12,"oxygen":-10}],
   ["Radiation shelter","Where should the crew shelter?","Central equipment bay|Window deck|Airlock","0",
    {"Commander":"Choose the location with most surrounding mass.","Pilot":"The window deck has the least shielding.","Navigator":"The airlock is on the outer hull.","Systems":"Water and equipment surround the central bay.","Science":"Dense material lowers particle dose.","Medical":"Minimize exposure even if observations stop."},
    {"Commander":["mass","surrounding"],"Pilot":["window","shielding"],"Navigator":["airlock","outer"],"Systems":["water","central"],"Science":["dense","dose"],"Medical":["exposure","observations"]},
    {"oxygen":3},{"oxygen":-12}],
   ["Correction decision","Navigation predicts entry corridor remains nominal. Choose:","Cancel unnecessary burn|Burn anyway|Double correction","0",
    {"Commander":"Avoid risk without a demonstrated need.","Pilot":"Every burn introduces execution error.","Navigator":"Current path is already inside limits.","Systems":"Fuel reserve is finite.","Science":"More tracking data reduces uncertainty.","Medical":"Unneeded maneuvering increases workload."},
    {"Commander":["risk","need"],"Pilot":["burn","error"],"Navigator":["inside","limits"],"Systems":["fuel","finite"],"Science":["tracking","uncertainty"],"Medical":["maneuvering","workload"]},
    {"power":4,"trajectory":4},{"trajectory":-6,"power":-4}],
   ["Science window","Spend 6 power while reserve is 18?","Run scan|Skip all science|Spend all 18","0",
    {"Commander":"Maintain at least ten power after optional work.","Pilot":"No maneuver occurs during the scan.","Navigator":"Trajectory is stable for the window.","Systems":"Eighteen is available; six is requested.","Science":"The scan substantially increases mission value.","Medical":"The scan adds no crew exposure."},
    {"Commander":["ten","optional"],"Pilot":["maneuver","scan"],"Navigator":["stable","window"],"Systems":["eighteen","six"],"Science":["mission","value"],"Medical":["crew","exposure"]},
    {"data":15,"power":-6},{"data":-3}]
  ]},
 {id:"flyby",title:"Lunar Flyby",milestone:"Far side of the Moon",position:68,
  context:"Orion swings around the Moon on the free-return path. Earth communications are interrupted while the crew observes the lunar far side and protects the return geometry.",
  challenges:[
   ["Free-return geometry","Orion is 3 km high relative to target. Choose:","Short retrograde correction|Short prograde correction|No evaluation","0",
    {"Commander":"Return safety outranks observation timing.","Pilot":"Retrograde reduces energy.","Navigator":"The path is above the target corridor.","Systems":"Either short burn is within limits.","Science":"A lower pass improves imaging but is not required.","Medical":"Avoid a larger high-g correction."},
    {"Commander":["return","observation"],"Pilot":["retrograde","energy"],"Navigator":["above","corridor"],"Systems":["burn","limits"],"Science":["lower","imaging"],"Medical":["larger","correction"]},
    {"trajectory":10},{"trajectory":-12}],
   ["Blackout authority","Who holds immediate operational authority?","Commander onboard|Mission Control|Science Officer","0",
    {"Commander":"The spacecraft must continue without external approval.","Pilot":"Immediate control cannot wait for Earth.","Navigator":"The blackout is expected.","Systems":"Autonomous procedures are loaded.","Science":"Observation requests remain advisory.","Medical":"A crew emergency needs an onboard decision."},
    {"Commander":["external","approval"],"Pilot":["Earth","wait"],"Navigator":["blackout","expected"],"Systems":["autonomous","loaded"],"Science":["requests","advisory"],"Medical":["emergency","onboard"]},
    {"power":2},{"trajectory":-5}],
   ["Lunar observation","Which view offers the most unique science?","Far-side terrain during closest approach|Cabin wall|Repeated Earth image","0",
    {"Commander":"Protect flight first, then use the unique opportunity.","Pilot":"Attitude can support a short observation.","Navigator":"Closest approach gives the best scale.","Systems":"Camera power is available.","Science":"The far side contains terrain not visible from Earth.","Medical":"Keep the observation window short."},
    {"Commander":["flight","opportunity"],"Pilot":["attitude","observation"],"Navigator":["closest","scale"],"Systems":["camera","power"],"Science":["far side","Earth"],"Medical":["window","short"]},
    {"data":15},{"data":-5}],
   ["Star fix","One tracker is blinded by lunar glare. Use:","Two healthy trackers + inertial estimate|Blinded tracker only|Average all equally","0",
    {"Commander":"Known-bad data must not receive equal weight.","Pilot":"Inertial guidance drifts but remains useful.","Navigator":"Two trackers agree within 0.2 degrees.","Systems":"The third tracker reports saturation.","Science":"Combine independent reliable evidence.","Medical":"Avoid repeating the maneuver."},
    {"Commander":["bad","equal"],"Pilot":["inertial","drift"],"Navigator":["two","0.2"],"Systems":["third","saturation"],"Science":["independent","reliable"],"Medical":["repeat","maneuver"]},
    {"trajectory":8},{"trajectory":-9}],
   ["Return posture","After closest approach, Orion should:","Maintain free-return path|Enter lunar orbit|Land on the Moon","0",
    {"Commander":"This mission is a flyby test, not a landing.","Pilot":"No lunar-orbit insertion burn is planned.","Navigator":"The trajectory already bends homeward.","Systems":"Fuel is reserved for corrections and entry.","Science":"Observations continue during departure.","Medical":"The crew must prepare for return."},
    {"Commander":["flyby","landing"],"Pilot":["orbit","burn"],"Navigator":["homeward","trajectory"],"Systems":["fuel","entry"],"Science":["observations","departure"],"Medical":["crew","return"]},
    {"trajectory":5},{"power":-10,"trajectory":-8}]
  ]},
 {id:"return",title:"Return & Re-entry",milestone:"Pacific splashdown",position:92,
  context:"Orion approaches Earth, targets a narrow entry corridor, survives plasma heating, and deploys parachutes for ocean recovery.",
  challenges:[
   ["Entry angle","Safe overlap is 6.1 to 6.7 degrees. Choose midpoint.","6.0|6.4|6.8","1",
    {"Commander":"Use the center of the final overlap.","Pilot":"Steeper than 6.7 exceeds heat limits.","Navigator":"Guidance allows 5.8 to 7.1.","Systems":"Shield damage caps at 6.7.","Science":"Weather raises the lower edge to 6.1.","Medical":"Crew load requires at least 6.0."},
    {"Commander":["center","overlap"],"Pilot":["steeper","6.7"],"Navigator":["guidance","7.1"],"Systems":["shield","cap"],"Science":["weather","6.1"],"Medical":["crew","6.0"]},
    {"trajectory":10},{"heat":18,"trajectory":-10}],
   ["Heat-shield attitude","Which orientation is correct?","Blunt heat shield forward|Nose forward|Sideways","0",
    {"Commander":"Present the designed protective surface to airflow.","Pilot":"The blunt end controls deceleration.","Navigator":"Velocity points into the atmosphere.","Systems":"Thermal protection is concentrated on the base.","Science":"A blunt body creates a detached shock layer.","Medical":"Controlled deceleration reduces peak load."},
    {"Commander":["protective","airflow"],"Pilot":["blunt","deceleration"],"Navigator":["velocity","atmosphere"],"Systems":["thermal","base"],"Science":["shock","body"],"Medical":["controlled","load"]},
    {"heat":-10},{"heat":22}],
   ["Plasma blackout","Communications disappear during peak heating. Choose:","Continue pre-briefed profile|Change angle randomly|Deploy parachutes","0",
    {"Commander":"Expected loss of signal is not failure.","Pilot":"Programmed attitude remains stable.","Navigator":"The corridor prediction remains valid.","Systems":"Ionized gas blocks radio.","Science":"Plasma causes temporary blackout.","Medical":"Unplanned maneuver raises risk."},
    {"Commander":["signal","failure"],"Pilot":["programmed","stable"],"Navigator":["prediction","valid"],"Systems":["gas","radio"],"Science":["plasma","blackout"],"Medical":["unplanned","risk"]},
    {"trajectory":5},{"trajectory":-9}],
   ["Drogue deployment","Limit 260 m/s; current speed 248 m/s.","Deploy now|Wait until 300|Never deploy","0",
    {"Commander":"Current conditions are inside the approved window.","Pilot":"Speed is falling.","Navigator":"Altitude remains sufficient.","Systems":"Drogue limit is 260.","Science":"248 is below the maximum.","Medical":"Earlier stabilization reduces motion."},
    {"Commander":["inside","window"],"Pilot":["speed","falling"],"Navigator":["altitude","sufficient"],"Systems":["260","limit"],"Science":["248","below"],"Medical":["stabilization","motion"]},
    {"trajectory":5},{"trajectory":-12}],
   ["Main parachutes","Need altitude above 5.5 km and speed below 90 m/s. Current: 6.2 km, 82 m/s.","Deploy|Wait|Cut drogues","0",
    {"Commander":"Both required conditions are satisfied.","Pilot":"Velocity is below the ceiling.","Navigator":"Altitude is above the floor.","Systems":"Parachute circuits are armed.","Science":"Both inequalities support deployment.","Medical":"Delay reduces safety margin."},
    {"Commander":["both","satisfied"],"Pilot":["velocity","ceiling"],"Navigator":["altitude","floor"],"Systems":["circuits","armed"],"Science":["inequalities","deployment"],"Medical":["delay","margin"]},
    {"oxygen":4},{"trajectory":-18}]
  ]}
];

function rid(n=10){return randomBytes(n).toString("base64url")}
function roomCode(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s;do{s=Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("")}while(rooms.has(s));return s}
function clamp(v){return Math.max(0,Math.min(100,v))}
function send(ws,obj){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function name(v){return String(v||"Crew").replace(/[^a-zA-Z0-9 _-]/g,"").trim().slice(0,18)||"Crew"}

class Room{
 constructor(code){this.code=code;this.players=new Map();this.host="";this.started=false;this.finished=false;this.phaseIndex=-1;this.current=null;this.successes=0;this.failures=0;this.actions=0;this.resolved=[];this.oxygen=100;this.power=100;this.heat=12;this.trajectory=82;this.data=10;this.log=[];this.status="Assemble the crew."}
 add(ws,n){if(this.started)throw Error("Mission already launched.");if(this.players.size>=6)throw Error("Crew full.");
  const session=rid(8),token=rid(20);this.players.set(session,{session,name:name(n),role:"",ready:false,ws,token,connected:true});if(!this.host)this.host=session;ws.ctx={room:this.code,session};send(ws,{type:"joined",roomCode:this.code,sessionId:session,reconnectionToken:token});this.broadcast()}
 reconnect(ws,token){const p=[...this.players.values()].find(x=>x.token===token);if(!p)throw Error("Reconnection expired.");p.ws=ws;p.connected=true;p.token=rid(20);ws.ctx={room:this.code,session:p.session};send(ws,{type:"joined",roomCode:this.code,sessionId:p.session,reconnectionToken:p.token});this.broadcast()}
 assigned(p){if(!p.role)return[];const active=[...this.players.values()].filter(x=>x.role);const owner=new Map(active.map(x=>[x.role,x]));let i=0;for(const r of ROLES)if(!owner.has(r)){owner.set(r,active[i%active.length]);i++}return ROLES.filter(r=>owner.get(r)?.session===p.session)}
 public(){const ph=this.phaseIndex>=0?PHASES[this.phaseIndex]:null;return{gameName:"Lunar Mission - Artemis II",version:"0.6.0",roomCode:this.code,hostSessionId:this.host,players:Object.fromEntries([...this.players].map(([k,p])=>[k,{name:p.name,role:p.role,ready:p.ready,connected:p.connected}])),started:this.started,finished:this.finished,phaseIndex:this.phaseIndex,phaseData:ph?{id:ph.id,title:ph.title,milestone:ph.milestone,context:ph.context,position:ph.position}:null,currentChallenge:this.current?{id:this.current.id,title:this.current.title,prompt:this.current.prompt,options:this.current.options}:null,challengeCards:ph?ph.challenges.map(c=>({id:c.id,title:c.title,resolved:this.resolved.includes(c.id)})):[],successes:this.successes,failures:this.failures,actions:this.actions,oxygen:this.oxygen,power:this.power,heat:this.heat,trajectory:this.trajectory,data:this.data,status:this.status,roleInfo:ROLE_INFO,log:this.log.slice(-12)}}
 stateFor(p){return{...this.public(),myRole:p.role,assignedRoles:this.assigned(p),privateClues:this.current?this.assigned(p).map(r=>({role:r,clue:this.current.clues[r],taboo:this.current.taboo[r]})):[]}}
 broadcast(){for(const p of this.players.values())send(p.ws,{type:"state",state:this.stateFor(p)})}
 event(t,tone="info"){this.log.push({t,tone,id:Date.now()+Math.random()});if(this.log.length>40)this.log.shift()}
 err(p,m){send(p.ws,{type:"error",message:m})}
 role(p,r){if(this.started)return;if(!ROLES.includes(r))return this.err(p,"Invalid role.");if([...this.players.values()].some(x=>x.session!==p.session&&x.role===r))return this.err(p,"Role occupied.");p.role=r;p.ready=false;this.event(`${p.name} selected ${r}.`);this.broadcast()}
 start(p){if(p.session!==this.host)return this.err(p,"Only host can launch.");if([...this.players.values()].some(x=>!x.role||!x.ready))return this.err(p,"Every crew member needs a role and Ready status.");this.started=true;this.phaseIndex=0;this.begin()}
 begin(){this.current=null;this.successes=0;this.failures=0;this.actions=6;this.resolved=[];this.status=`${PHASES[this.phaseIndex].title}: select a challenge.`;this.event(`${PHASES[this.phaseIndex].title} began.`,"phase");this.broadcast()}
 select(p,id){if(this.current)return this.err(p,"Resolve the active challenge.");const raw=PHASES[this.phaseIndex].challenges.find(x=>x[0]===id);if(!raw||this.resolved.includes(id))return this.err(p,"Challenge unavailable.");if(this.actions<1)return this.err(p,"No actions remain.");
  const [cid,title,prompt,opts,answer,clues,taboo,success,failure]=raw;this.current={id:cid,title,prompt,options:opts.split("|"),answer:Number(answer),clues,taboo,success,failure};this.status=`${title}: communicate without forbidden words.`;this.event(`${p.name} opened ${title}.`);this.broadcast()}
 answer(p,i){if(!this.current)return this.err(p,"No active challenge.");const c=this.current;this.actions--;this.resolved.push(c.id);const ok=Number(i)===c.answer;for(const [k,v] of Object.entries(ok?c.success:c.failure))this[k]=clamp(this[k]+v);if(ok){this.successes++;this.event(`${c.title} verified.`,"success");this.status=`Success: ${c.title}.`}else{this.failures++;this.event(`${c.title} failed; consequence applied.`,"critical");this.status=`Failure: ${c.title}.`}this.current=null;
  if(this.oxygen<=0||this.power<=0||this.trajectory<=0||this.heat>=100)return this.finish(false,"Critical spacecraft margin lost.");
  if(this.successes>=3){if(this.phaseIndex===PHASES.length-1)return this.finish(true,"Splashdown confirmed. Artemis II mission complete.");this.phaseIndex++;return this.begin()}
  const remaining=5-this.resolved.length;if(this.successes+remaining<3||this.actions<=0)return this.finish(false,"The crew failed to verify three challenges.");this.broadcast()}
 scan(p){if(!this.current)return this.err(p,"Open a challenge first.");if(this.actions<1)return this.err(p,"No action points.");this.actions--;const wrong=this.current.options.map((_,i)=>i).filter(i=>i!==this.current.answer);const removed=wrong[Math.floor(Math.random()*wrong.length)];send(p.ws,{type:"scan_result",removedOption:removed,message:"Mission analysis removed one unsafe option. Cost: 1 action."});this.event(`${p.name} requested mission analysis.`,"warning");this.broadcast()}
 finish(win,msg){this.finished=true;this.status=msg;this.event(msg,win?"success":"critical");this.broadcast()}
 reset(p){if(p.session!==this.host)return;this.started=false;this.finished=false;this.phaseIndex=-1;this.current=null;this.successes=0;this.failures=0;this.actions=0;this.resolved=[];this.oxygen=100;this.power=100;this.heat=12;this.trajectory=82;this.data=10;this.status="Assemble the crew.";for(const x of this.players.values())x.ready=false;this.broadcast()}
 handle(s,m){const p=this.players.get(s);if(!p)return;if(m.type==="set_role")this.role(p,m.role);else if(m.type==="toggle_ready"){if(!this.started&&p.role){p.ready=!p.ready;this.broadcast()}}else if(m.type==="start")this.start(p);else if(m.type==="select_challenge")this.select(p,m.challengeId);else if(m.type==="submit_answer")this.answer(p,m.optionIndex);else if(m.type==="scan")this.scan(p);else if(m.type==="reset")this.reset(p)}
 disconnect(s,ws){const p=this.players.get(s);if(!p||p.ws!==ws)return;p.connected=false;this.broadcast();setTimeout(()=>{if(!p.connected){this.players.delete(s);if(this.host===s)this.host=this.players.keys().next().value||"";if(!this.players.size)rooms.delete(this.code);else this.broadcast()}},45000)}
}

function serve(req,res){res.setHeader("Cache-Control","no-cache");const u=new URL(req.url||"/",`http://${req.headers.host||"localhost"}`);if(u.pathname==="/health"){res.writeHead(200,{"Content-Type":"application/json"});return res.end(JSON.stringify({status:"ok",game:"Lunar Mission - Artemis II",version:"0.6.0",rooms:rooms.size}))}let rel=decodeURIComponent(u.pathname);if(rel==="/")rel="/index.html";const p=resolve(CLIENT,`.${normalize(rel)}`);if(!p.startsWith(CLIENT)||!existsSync(p)||!statSync(p).isFile()){res.writeHead(404);return res.end("Not found")}res.writeHead(200,{"Content-Type":MIME[extname(p)]||"application/octet-stream"});createReadStream(p).pipe(res)}
const http=createServer(serve),wss=new WebSocketServer({server:http,path:"/ws"});
wss.on("connection",ws=>{ws.on("message",buf=>{let m;try{m=JSON.parse(buf)}catch{return}try{if(!ws.ctx){if(m.type==="create"){const r=new Room(roomCode());rooms.set(r.code,r);return r.add(ws,m.name)}if(m.type==="join"){const r=rooms.get(String(m.roomCode||"").toUpperCase());if(!r)throw Error("Room not found.");return r.add(ws,m.name)}if(m.type==="reconnect"){const r=rooms.get(String(m.roomCode||"").toUpperCase());if(!r)throw Error("Room not found.");return r.reconnect(ws,m.reconnectionToken)}throw Error("Join first.")}rooms.get(ws.ctx.room)?.handle(ws.ctx.session,m)}catch(e){send(ws,{type:"error",message:e.message||"Mission error."})}});ws.on("close",()=>{if(ws.ctx)rooms.get(ws.ctx.room)?.disconnect(ws.ctx.session,ws)})});
http.listen(PORT,()=>console.log(`Lunar Mission Artemis II v0.6 on ${PORT}`));
