import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function browserBridge() {
  const messages = [], sent = [], sockets = [], noop = () => {}, handlers = {};
  const add = (name, fn) => handlers[name] = fn;
  const document = { addEventListener:add, removeEventListener:noop, hasFocus:()=>true, pointerLockElement:null };
  let locks = 0;
  const canvas = { addEventListener:add, removeEventListener:noop, focus:noop, requestPointerLock:()=>{locks++;document.pointerLockElement=canvas;} };
  document.exitPointerLock=()=>{document.pointerLockElement=null;handlers.pointerlockchange();};
  class Socket {
    constructor() { this.readyState = 1; this.bufferedAmount = 0; sockets.push(this); }
    send(text) { sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
  }
  let library;
  const context = { LibraryManager: { library: {} }, mergeInto: (_, x) => library = x, UTF8ToString: x => x,
    Module: { canvas },
    window: { addEventListener: add, removeEventListener: noop },
    document,
    location: { protocol: 'http:', host: 'local' }, WebSocket: Socket,
    SendMessage: (_, method, json) => messages.push({ method, json }), console };
  vm.runInNewContext(readFileSync(new URL('../Unity/Assets/Plugins/WebGL/OrbitSocket.jslib', import.meta.url), 'utf8'), context);
  library.OrbitConnect('OrbitClient');
  return { library, messages, sent, handlers, document, canvas, socket:sockets[0], locks:()=>locks, emit: frame => sockets[0].onmessage({ data: JSON.stringify(frame) }) };
}

test('concurrent arrow spawns and a removal survive several network ticks inside one rendered frame', () => {
  const { library, messages, emit } = browserBridge();
  emit({ type: 'frame', seq: 1, full: true, round: 1, players: [], poses: [], deposits: [], stations: [], bolts: [], events: [], bow: { fullDrawTicks: 20 } });
  emit({ type: 'frame', seq: 2, full: false, round: 1, bolts: [{ id: 'a', ownerId: 'p' }], events: [{ id: '1', type: 'shot' }] });
  emit({ type: 'frame', seq: 3, full: false, round: 1, bolts: [{ id: 'b', ownerId: 'q' }], events: [{ id: '2', type: 'shot' }] });
  emit({ type: 'frame', seq: 4, full: false, round: 1, removedBolts: ['a'], events: [{ id: '3', type: 'bolt-impact' }] });
  library.OrbitPoll();
  const frame = JSON.parse(messages[0].json);
  assert.deepEqual(frame.bolts.map(x => x.id), ['b']);
  assert.deepEqual(frame.removedBolts, ['a']);
  assert.deepEqual(frame.events.map(x => x.id), ['1', '2', '3']);
  assert.equal(frame.bow.fullDrawTicks, 20);
  assert.equal(frame.seq, 4);
});

test('round replacement clears earlier arrows and impacts even before the browser polls', () => {
  const { library, messages, emit } = browserBridge();
  emit({ type: 'frame', seq: 1, full: true, round: 1, bolts: [{ id: 'old' }], events: [{ id: '1' }] });
  emit({ type: 'frame', seq: 2, full: true, round: 2, bolts: [], events: [] });
  library.OrbitPoll();
  const frame = JSON.parse(messages[0].json);
  assert.equal(frame.round, 2);
  assert.deepEqual(frame.bolts, []);
  assert.deepEqual(frame.events, []);
});

test('shot intent retains independent shot and pick IDs while consumption ACK advances', () => {
  const { library, sent, emit } = browserBridge();
  emit({ type: 'frame', seq: 1, full: true, round: 1, bolts: [], events: [] });
  library.OrbitPoll();
  library.OrbitSend(JSON.stringify({ type: 'input', weapon: 'bow', shotId: 9, attackId: 7, shotAx: 1, fire: false }));
  assert.deepEqual(sent[0], { type: 'input', weapon: 'bow', shotId: 9, attackId: 7, shotAx: 1, fire: false, ack: 1 });
});

// Exercise the actual canvas event handlers, including the pointer-acquire press
// consumed by Unity. This is a bridge test, not a claim of native Chrome input.
test('right click acquires normal pointer lock, suppresses the context menu and still aims while held',()=>{
  const b=browserBridge();let prevented=0;
  b.handlers.mousedown({button:2,preventDefault:()=>prevented++});
  assert.equal(b.locks(),1);assert.equal(prevented,1);assert.equal(b.messages.at(-1).method,'PointerAcquirePressed');
  b.handlers.pointerlockchange();assert.equal(b.messages.at(-1).method,'PointerChanged');
  b.handlers.contextmenu({preventDefault:()=>prevented++});assert.equal(prevented,2);
  b.handlers.mousemove({movementX:5,movementY:-2});assert.equal(b.library.OrbitReadLookX(),5);assert.equal(b.library.OrbitReadLookY(),-2);
  b.library.OrbitSurveyMode(1);const before=b.locks();b.handlers.mousedown({button:2,preventDefault:()=>{}});assert.equal(b.locks(),before);
});


test('all locked motion survives fast and slow rendering consumption without frame-dependent gain', () => {
  const b = browserBridge();
  b.handlers.mousedown({button:0}); b.handlers.pointerlockchange();
  b.handlers.mousemove({movementX:19,movementY:-12});
  assert.equal(b.library.OrbitReadLookX(),19); assert.equal(b.library.OrbitReadLookY(),-12);
  // Eight high-polling samples, consumed together at a lower rendering rate.
  for(let i=0;i<8;i++) b.handlers.mousemove({movementX:90,movementY:12});
  assert.equal(b.library.OrbitReadLookX(),720); assert.equal(b.library.OrbitReadLookY(),96);
  const fast=browserBridge(); fast.handlers.mousedown({button:0}); fast.handlers.pointerlockchange();
  let x=0,y=0;
  for(let i=0;i<8;i++) { fast.handlers.mousemove({movementX:90,movementY:12}); x+=fast.library.OrbitReadLookX(); y+=fast.library.OrbitReadLookY(); }
  assert.equal(x,720); assert.equal(y,96);
  b.handlers.mousemove({movementX:NaN,movementY:Infinity});
  assert.equal(b.library.OrbitReadLookX(),0); assert.equal(b.library.OrbitReadLookY(),0);
  b.handlers.mousemove({movementX:4,movementY:6}); b.handlers.blur();
  assert.equal(b.library.OrbitReadLookX(),0); assert.equal(b.library.OrbitReadLookY(),0);
});

test('an unlocked right drag starts at its press and remains available when capture is unsupported', () => {
  const b = browserBridge(); b.canvas.requestPointerLock = undefined;
  b.handlers.mousedown({button:2,clientX:400,clientY:250,preventDefault:()=>{}});
  assert.equal(b.messages.find(m=>m.method==='PointerAcquirePressed').json,'right');
  assert.ok(b.messages.some(m=>m.method==='PointerUnavailable'));
  b.handlers.mousemove({clientX:411,clientY:247,buttons:2,movementX:3000,movementY:3000});
  assert.equal(b.library.OrbitReadLookX(),11); assert.equal(b.library.OrbitReadLookY(),-3);
  b.handlers.mouseup({button:2});
  b.handlers.mousemove({clientX:800,clientY:500,movementX:389,movementY:253});
  assert.equal(b.library.OrbitReadLookX(),0); assert.equal(b.library.OrbitReadLookY(),0);
});


test('the physical right hold survives capture acknowledgement and is cancelled on map, release and focus loss', () => {
  const b=browserBridge(); const press=()=>b.handlers.mousedown({button:2,clientX:400,clientY:250,preventDefault:()=>{}});
  press(); assert.equal(b.library.OrbitRightHeld(),1);
  b.handlers.pointerlockchange(); assert.equal(b.library.OrbitRightHeld(),1);
  b.handlers.mouseup({button:2}); assert.equal(b.library.OrbitRightHeld(),0);
  press(); b.library.OrbitSurveyMode(1); assert.equal(b.library.OrbitRightHeld(),0);
  b.library.OrbitSurveyMode(0); press(); b.handlers.blur(); assert.equal(b.library.OrbitRightHeld(),0);
  press(); b.library.OrbitRelease(); assert.equal(b.library.OrbitRightHeld(),0);
});


test('a consumed frame sends one standalone ACK, while a same-frame input carries it without an extra packet', async () => {
  const b=browserBridge();
  b.emit({type:'frame',seq:1,full:true,round:1,players:[],poses:[],deposits:[],stations:[],bolts:[],events:[]});
  assert.equal(b.sent.length,0,'receiving bytes is not a consumed frame');
  b.library.OrbitPoll(); await Promise.resolve();
  assert.deepEqual(b.sent,[{type:'ack',ack:1}]);
  b.library.OrbitPoll(); await Promise.resolve();
  assert.equal(b.sent.length,1,'an idle poll must not repeat an ACK');
  b.emit({type:'frame',seq:2,full:false,round:1,events:[]}); b.library.OrbitPoll();
  b.library.OrbitSend(JSON.stringify({type:'input',x:1})); await Promise.resolve();
  assert.deepEqual(b.sent.at(-1),{type:'input',x:1,ack:2});
  assert.equal(b.sent.length,2,'the normal same-frame input replaces the standalone ACK');
  b.socket.bufferedAmount=8192;
  b.emit({type:'frame',seq:3,full:false,round:1,events:[]}); b.library.OrbitPoll(); await Promise.resolve();
  assert.equal(b.sent.length,2,'a standalone ACK must honor the existing send-buffer bound');
  b.socket.bufferedAmount=0; b.library.OrbitSend(JSON.stringify({type:'input',x:1}));
  assert.deepEqual(b.sent.at(-1),{type:'input',x:1,ack:3});
});

test('a lost right release cannot turn a free cursor move into a camera delta', () => {
  const b = browserBridge(); b.canvas.requestPointerLock = undefined;
  b.handlers.mousedown({button:2,clientX:400,clientY:250,preventDefault:()=>{}});
  b.handlers.mousemove({clientX:410,clientY:260,buttons:2});
  assert.equal(b.library.OrbitReadLookX(),10);assert.equal(b.library.OrbitReadLookY(),10);
  // A release outside the document, or right released while left is still down:
  // pointerup is not guaranteed to report that individual button transition.
  b.handlers.mousemove({clientX:1010,clientY:100,buttons:1});
  assert.equal(b.library.OrbitReadLookX(),0);assert.equal(b.library.OrbitReadLookY(),0);
  assert.equal(b.library.OrbitRightHeld(),0);
});


test('each right button in a chord ends drag while fast genuine aim remains unbounded', () => {
 const b=browserBridge();b.canvas.requestPointerLock=undefined;
 b.handlers.mousedown({button:0,clientX:100,clientY:100});
 b.handlers.mousedown({button:2,clientX:100,clientY:100,preventDefault:()=>{}});
 b.handlers.mousemove({buttons:3,clientX:820,clientY:196});
 assert.equal(b.library.OrbitReadLookX(),720);assert.equal(b.library.OrbitReadLookY(),96);
 b.handlers.mouseup({button:2,buttons:1});
 b.handlers.mousemove({buttons:1,clientX:1200,clientY:400});
 assert.equal(b.library.OrbitReadLookX(),0);assert.equal(b.library.OrbitRightHeld(),0);
 b.handlers.mousedown({button:2,clientX:1200,clientY:400,preventDefault:()=>{}});
 b.handlers.pointercancel({});b.handlers.mousemove({buttons:0,clientX:10,clientY:10});
 assert.equal(b.library.OrbitReadLookX(),0);assert.equal(b.library.OrbitReadLookY(),0);
 assert.equal(b.messages.at(-1).method,'PointerGestureCancelled');
});

test('thumb buttons do not interrupt an actual held right drag', () => {
 const b=browserBridge();b.canvas.requestPointerLock=undefined;
 b.handlers.mousedown({button:2,clientX:100,clientY:100,preventDefault:()=>{}});
 b.handlers.mousemove({buttons:18,clientX:300,clientY:100});
 b.handlers.mouseup({button:4,buttons:2});
 b.handlers.mousemove({buttons:2,clientX:500,clientY:120});
 assert.equal(b.library.OrbitReadLookX(),400);assert.equal(b.library.OrbitReadLookY(),20);
 assert.equal(b.library.OrbitRightHeld(),1);
 b.handlers.mouseup({button:2,buttons:0});
});

test('a held unlocked drag rebases at the canvas boundary without a focus loss', () => {
 const b=browserBridge();b.canvas.requestPointerLock=undefined;
 b.handlers.mousedown({button:2,clientX:400,clientY:250,preventDefault:()=>{}});
 b.handlers.mousemove({buttons:2,clientX:410,clientY:260});
 assert.equal(b.library.OrbitReadLookX(),10);assert.equal(b.library.OrbitReadLookY(),10);
 b.handlers.mouseleave();b.handlers.mousemove({buttons:2,clientX:1400,clientY:900});
 b.handlers.mouseout({relatedTarget:null});
 b.handlers.mouseenter({buttons:2,clientX:800,clientY:100});
 b.handlers.mousemove({buttons:2,clientX:800,clientY:100});
 assert.equal(b.library.OrbitReadLookX(),0);assert.equal(b.library.OrbitReadLookY(),0);
 b.handlers.mousemove({buttons:2,clientX:1520,clientY:196});
 assert.equal(b.library.OrbitReadLookX(),720);assert.equal(b.library.OrbitReadLookY(),96);
});
