(function(){
"use strict";
const cd=14400000,icons=["🍋","🍓","🍇","🍒","🍊","🍐"];let timer=null,profileBase;
const B=(s,fn,c="secondary")=>{const b=document.createElement("button");b.type="button";b.className=c;b.textContent=s;b.onclick=fn;return b},T=(s)=>safeText("p",s,"muted"),P=(a,b)=>{const e=document.createElement("section");e.className="feature-panel";e.append(safeText("h2",a),T(b));return e},F=n=>(Math.round(n*100)/100).toLocaleString("ru-RU",{maximumFractionDigits:2})+"%",own=()=>getUserTeam()?.players||[];
function rel(t,p,n){state.relationships||={};let k=playerRelationKey(t,p),v=Math.max(0,Math.min(100,Number(state.relationships[k]||0)+n/100));state.relationships[k]=v;return v}
function transfer(){openPage("transfers")}
function install(){
 state.relationships||={};state.trainingCooldowns||={};state.trainingHistory||=[];state.transferHistory||=[];state.externalRosters||={};
 const baseGetTeam=getUserTeam;
 getUserTeam=function(){const t=baseGetTeam();if(t&&Array.isArray(state.userRoster))t.players=state.userRoster;return t};

 const nav=document.querySelector(".menu-grid");if(nav&&!document.getElementById("transferHome")){const b=B("🔁 ТРАНСФЕРНЫЙ ОБМЕН ИГРОКАМИ",transfer,"transfer-home-button");b.id="transferHome";nav.append(b)}
 const old=pages.cabinet.render;if(!old.wrap){const w=function(){const n=old();n.prepend(B("🔁 Трансферный обмен игроками",transfer,"primary"));return n};w.wrap=true;pages.cabinet.render=w}
 profileBase=openPlayerProfile;openPlayerProfile=function(t,p,i){profileBase(t,p,i);if(t.id===getUserTeam()?.id)return;const box=P("Отношения с футболистом","Каждые 100 очков в «Три в ряд» дают +1 процентный пункт отношений.");box.append(B("ПОДНЯТЬ ОТНОШЕНИЯ С ИГРОКОМ",()=>match3(t,p),"primary"),B("Выбрать для наблюдения в следующем матче",()=>{state.matchRelationSelections||={};state.matchRelationSelections[t.id]=p.name;saveState();alert("Выбран игрок для наблюдения: "+p.name+". Начисление отношений после матча появится вместе с матчевым движком.")}),B("Предложить обмен",()=>{state.transferTarget={team:t.id,name:p.name};saveState();transfer()}));document.querySelector("#pageContent .player-profile")?.append(box)};
 pages.training.render=training;pages.transfers={title:"Трансферный обмен игроками",eyebrow:"ТРАНСФЕРЫ",render:transfersPage};
 saveState()
}
function match3(t,p){
 let board=[],sel=-1,score=0,lock=false,done=false;
 const ov=document.createElement("div");ov.className="feature-game-overlay";const m=document.createElement("section");m.className="feature-game-modal";const stat=safeText("p","Очки: 0 / 1000","feature-game-stats"),grid=document.createElement("div");grid.className="relation-match3-board";const msg=safeText("p","Собирай 3 и более одинаковых фишки.","feature-game-message"),actions=document.createElement("div");actions.className="feature-actions";ov.append(m);m.append(safeText("h2","🧩 ТРИ В РЯД"),T(p.name+" · "+t.name),stat,grid,msg,actions);document.body.append(ov);
 const close=()=>{clearTimeout(timer);ov.remove()};
 const rand=()=>Math.floor(Math.random()*6);
 function draw(){grid.replaceChildren();board.forEach((v,i)=>{const b=B(icons[v]||" ",()=>pick(i),"relation-match3-cell"+(sel===i?" selected":""));b.disabled=lock||done;grid.append(b)});stat.textContent="Очки: "+score+" / 1000"}
 function matches(){let f=new Set();for(let r=0;r<8;r++)for(let c=0;c<8;c++){let i=r*8+c,v=board[i];if(c<6&&v===board[i+1]&&v===board[i+2])for(let x=c;x<8&&board[r*8+x]===v;x++)f.add(r*8+x);if(r<6&&v===board[i+8]&&v===board[i+16])for(let y=r;y<8&&board[y*8+c]===v;y++)f.add(y*8+c)}return f}
 function clear(){if(done)return;let f=matches();if(!f.size){lock=false;draw();return}f.forEach(i=>board[i]=-1);score=Math.min(1000,score+f.size*10);draw();if(score>=1000){done=true;const before=Number(state.relationships[playerRelationKey(t,p)]||0),after=rel(t,p,score),delta=after-before;state.xp=Math.max(0,Number(state.xp)||0)+score;state.trainingHistory.push({type:"match3-relations",team:t.id,player:p.name,score,delta,at:Date.now()});saveState();msg.textContent="Готово! +" + score + " XP, отношения +" + F(delta)+".";actions.replaceChildren(B("Вернуться в профиль",()=>{close();openPlayerProfile(t,p,0)},"primary"),B("Закрыть",close));return}timer=setTimeout(()=>{for(let c=0;c<8;c++){let s=[];for(let r=7;r>=0;r--)if(board[r*8+c]>=0)s.push(board[r*8+c]);while(s.length<8)s.push(rand());for(let r=7;r>=0;r--)board[r*8+c]=s[7-r]}draw();timer=setTimeout(clear,90)},120)}
 function pick(i){if(lock||done)return;if(sel<0){sel=i;draw();return}if(Math.abs(Math.floor(sel/8)-Math.floor(i/8))+Math.abs(sel%8-i%8)!==1){sel=i;draw();return}let a=sel,b=i;sel=-1;[board[a],board[b]]=[board[b],board[a]];if(!matches().size){[board[a],board[b]]=[board[b],board[a]];draw();return}lock=true;draw();clear()}
 board=Array.from({length:64},rand);for(let i=0;i<64;i++)while((i%8>1&&board[i]===board[i-1]&&board[i]===board[i-2])||(i>15&&board[i]===board[i-8]&&board[i]===board[i-16]))board[i]=rand();actions.append(B("Выйти без награды",close));draw()
}
function training(){
 const w=document.createElement("div"),t=getUserTeam();
 if(!t){w.append(placeholder("Сначала создай команду."));return w}
 const teamPanel=P("Командная тренировка","Каждый футболист получает ровно +1 к одной характеристике. Случайно выбранный игрок получает балл к основной характеристике; остальные — к случайной характеристике не своей основной позиции. Повтор — раз в 8 часов.");
 const cdKey="team-training",left=28800000-(Date.now()-Number(state.trainingCooldowns[cdKey]||0));
 const tb=B(left>0?"Доступно через "+Math.ceil(left/60000)+" мин.":"Провести командную тренировку",()=>runTeamTraining(t),left>0?"secondary":"primary");tb.disabled=left>0;
 teamPanel.append(tb,T("Правило распределения: один случайный игрок тренируется по своей основной позиции; у всех остальных случайно выбирается одна из трёх неподходящих основной позиции характеристик. Каждый игрок получает ровно +1, без повторов и без превышения 100."));
 const listPanel=P("Индивидуальная тренировка","ВР — поймай мяч (+5, конец после 10 пропущенных); ЗЩ — выбей мяч (+5, промах −3, конец после 3 ошибок); ПЗ/НП — змейка (+10 за мяч). Повтор раз в 4 часа.");
 const list=document.createElement("div");list.className="feature-player-list";
 t.players.forEach(player=>{const row=document.createElement("div");row.className="feature-player-row";row.append(safeText("b",player.name+" · "+player.position));const id=t.id+"::"+player.name,left=cd-(Date.now()-Number(state.trainingCooldowns[id]||0));const b=B(left>0?"Доступно через "+Math.ceil(left/60000)+" мин.":"Начать тренировку",()=>playTraining(t,player,id),left>0?"secondary":"primary");b.disabled=left>0;row.append(b);list.append(row)});listPanel.append(list);
 w.append(teamPanel,listPanel,P("Расчёт наград индивидуальной тренировки","Каждые 100 итоговых очков = 1 п.п. отношений без округления. Каждые 200 положительных очков дают +1 к основной характеристике, остаток сгорает. Опыт тренера растёт на положительный итоговый счёт."));
 return w
}
function runTeamTraining(t){
 const key="team-training",cooldown=28800000,left=cooldown-(Date.now()-Number(state.trainingCooldowns[key]||0));
 if(left>0){alert("Командная тренировка будет доступна через "+Math.ceil(left/60000)+" мин.");return}
 const stats=["ВР","ЗЩ","ПЗ","НП"],mainIndex=Math.floor(Math.random()*t.players.length),results=[];
 if(!t.players.length){alert("В команде нет футболистов.");return}
 t.players.forEach((p,i)=>{
  p.skills=p.skills||{};
  stats.forEach(s=>{if(!Number.isFinite(Number(p.skills[s])))p.skills[s]=0});
  const main=stats.includes(p.position)?p.position:"ПЗ";
  const choices=i===mainIndex?[main]:stats.filter(s=>s!==main);
  const chosen=choices[Math.floor(Math.random()*choices.length)];
  const before=Number(p.skills[chosen])||0;
  p.skills[chosen]=Math.min(100,before+1);
  results.push({name:p.name,position:main,stat:chosen,main:i===mainIndex,atCap:before>=100});
 });
 state.trainingCooldowns[key]=Date.now();state.teamTrainingHistory=state.teamTrainingHistory||[];
 state.teamTrainingHistory.push({at:Date.now(),team:t.id,results});
 state.xp=Math.max(0,Number(state.xp)||0)+10;saveState();
 const ov=document.createElement("div");ov.className="feature-game-overlay";const m=document.createElement("section");m.className="feature-game-modal";const body=document.createElement("div");body.className="feature-player-list";
 results.forEach(r=>{const row=document.createElement("div");row.className="feature-player-row";row.append(safeText("b",r.name+" · "+r.position),safeText("span",(r.main?"Основная позиция":"Случайная характеристика")+" → "+r.stat+(r.atCap?" (уже 100)":" +1")));body.append(row)});
 const close=()=>{ov.remove();openPage("training")};m.append(safeText("h2","⚽ Командная тренировка завершена"),T("Каждый футболист получил одну случайно распределённую попытку развития. Начислено +10 XP тренеру."),body,B("Готово",close,"primary"));ov.append(m);document.body.append(ov)
}
function playTraining(t,p,id){
 const ov=document.createElement("div");ov.className="feature-game-overlay";const m=document.createElement("section");m.className="feature-game-modal";const scoreLine=safeText("p","Очки: 0","feature-game-stats"),field=document.createElement("div");field.className="training-playfield";const actions=document.createElement("div");actions.className="feature-actions";ov.append(m);m.append(safeText("h2",p.position==="ВР"?"🧤 ПОЙМАЙ МЯЧ":p.position==="ЗЩ"?"🛡️ УСПЕЙ ВЫБИТЬ МЯЧ":"🐍 ФУТБОЛЬНАЯ ЗМЕЙКА"),T(p.name),scoreLine,field,actions);document.body.append(ov);
 let score=0,miss=0,ended=false,snake=[{x:4,y:4},{x:3,y:4}],dir={x:1,y:0},food={x:7,y:4};const close=()=>{clearInterval(timer);clearTimeout(timer);ov.remove()};
 function finish(details){if(ended)return;ended=true;clearInterval(timer);clearTimeout(timer);let net=Math.max(0,score),before=Number(p.skills?.[p.position]||0),growth=Math.min(Math.floor(net/200),100-before),beforeRel=Number(state.relationships[playerRelationKey(t,p)]||0),after=rel(t,p,score);p.skills[p.position]=Math.min(100,before+growth);state.xp=Math.max(0,Number(state.xp)||0)+net;state.trainingCooldowns[id]=Date.now();state.trainingHistory.push({type:"individual",team:t.id,player:p.name,score,delta:after-beforeRel,growth,at:Date.now()});saveState();scoreLine.textContent="Итог "+score+" · Отношения "+F(after-beforeRel)+" · "+p.position+" +"+growth;field.replaceChildren(T(details));actions.replaceChildren(B("Готово",()=>{close();openPage("training")},"primary"))}
 actions.append(B("Выйти без награды",close));
 if(p.position==="ВР"){function next(){if(miss>=10){finish("Поймано: "+score/5+" · Пропущено: "+miss);return}scoreLine.textContent="Очки "+score+" · Пропущено "+miss+"/10";field.replaceChildren(B("⚽ Поймать (+5)",()=>{score+=5;next()},"training-target"),B("Пропустить",()=>{miss++;next()}))}next()}
 else if(p.position==="ЗЩ"){function next(){if(miss>=3){finish("Ошибок: "+miss);return}field.replaceChildren(B("⚽",()=>{clearTimeout(timer);score+=5;next()},"training-target"));scoreLine.textContent="Очки "+score+" · Ошибки "+miss+"/3";timer=setTimeout(()=>{score-=3;miss++;next()},1000)}next()}
 else {const grid=document.createElement("div");grid.className="snake-grid";field.append(grid);function draw(){grid.replaceChildren();for(let y=0;y<10;y++)for(let x=0;x<10;x++){const c=document.createElement("span");c.className="snake-cell"+(snake.some(s=>s.x===x&&s.y===y)?" snake-body":"")+(food.x===x&&food.y===y?" snake-food":"");c.textContent=food.x===x&&food.y===y?"⚽":"";grid.append(c)}scoreLine.textContent="Очки "+score}
 document.addEventListener("keydown",key);function key(e){const map={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]},v=map[e.key];if(v&&!(v[0]===-dir.x&&v[1]===-dir.y)){dir={x:v[0],y:v[1]};e.preventDefault()}}
 function tick(){const h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};if(h.x<0||h.y<0||h.x>=10||h.y>=10||snake.slice(0,-1).some(s=>s.x===h.x&&s.y===h.y)){document.removeEventListener("keydown",key);finish("Мячей собрано: "+score/10);return}snake.unshift(h);if(h.x===food.x&&h.y===food.y){score+=10;do{food={x:Math.floor(Math.random()*10),y:Math.floor(Math.random()*10)}}while(snake.some(s=>s.x===food.x&&s.y===food.y))}else snake.pop();draw()}draw();timer=setInterval(tick,280)}
}
function transfersPage(){
 const w=document.createElement("div");if(!leagueData){w.append(placeholder("Загружаю команды…"));return w} Object.entries(state.externalRosters||{}).forEach(([id,players])=>{const t=leagueData.teams.find(x=>x.id===id);if(t&&Array.isArray(players))t.players=players});
 if(state.transferTarget){const t=leagueData.teams.find(x=>x.id===state.transferTarget.team),p=t?.players.find(x=>x.name===state.transferTarget.name);if(t&&p){const panel=P("Обмен игроками","Выбери игрока своей команды в обмен на "+p.name+".");const sel=document.createElement("select");sel.className="league-select";own().forEach((x,i)=>sel.add(new Option(x.name+" · "+x.position,String(i))));panel.append(sel,B("Подтвердить обмен",()=>{const i=+sel.value,mine=own()[i];if(!mine||!confirm("Отдать "+mine.name+" и получить "+p.name+"?"))return;const ut=getUserTeam();ut.players.splice(i,1);t.players.splice(t.players.findIndex(x=>x.name===p.name),1);ut.players.push({...p});t.players.push({...mine});state.userRoster=ut.players;state.externalRosters[t.id]=t.players;state.transferHistory.push({team:t.id,received:p.name,given:mine.name,at:Date.now()});delete state.transferTarget;saveState();openPage("transfers")},"primary"),B("Отмена",()=>{delete state.transferTarget;openPage("transfers")}));w.append(panel);return w}}
 w.append(P("Трансферный обмен игроками","Просматривай отношения с игроками других команд и предлагай обмен. Подтверждение обязательно; переговоры и вероятность отказа пока не моделируются."));
 leagueData.teams.filter(t=>t.id!==getUserTeam()?.id).forEach(t=>{const p=P(t.name,t.league);t.players.forEach(x=>{const r=document.createElement("div");r.className="feature-player-row";r.append(safeText("span",x.name+" · "+x.position+" · "+F(getPlayerRelation(t,x))),B("Профиль",()=>openPlayerProfile(t,x,teamsPlayerIndex(t,x))),B("Обмен",()=>{state.transferTarget={team:t.id,name:x.name};saveState();openPage("transfers")},"primary"));p.append(r)});w.append(p)});return w
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();