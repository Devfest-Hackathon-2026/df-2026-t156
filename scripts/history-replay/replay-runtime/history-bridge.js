(() => {
  const script=document.currentScript;
  const version=script.dataset.version;
  const workerUrl=new URL('../../runtime/history-worker.js?version='+version,location.href);
  const NativeWebSocket=window.WebSocket;
  class HistorySocket extends EventTarget {
    static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
    constructor(url, protocols) {
      super();
      if(new URL(url,location.href).pathname!=='/ws') return new NativeWebSocket(url,protocols);
      this.url=String(url);this.readyState=0;this.bufferedAmount=0;this.protocol='';this.extensions='';this.binaryType='blob';
      this.worker=new Worker(workerUrl,{type:'module'});
      this.worker.onmessage=({data})=>{
        if(data.kind==='ready'){this.readyState=1;this.emit('open',new Event('open'));}
        else if(data.kind==='message'){
          const packet=JSON.parse(data.data);
          if(packet.type==='welcome')window.historyReplay.playerId=packet.id;
          if(packet.type==='state'){
            const self=packet.players?.find(p=>p.id===window.historyReplay.playerId);
            window.historyReplay.observation={frames:(window.historyReplay.observation?.frames||0)+1,round:packet.round,timeLeft:packet.timeLeft,phase:packet.phase,players:packet.players?.length,self:self?{x:self.x,y:self.y,z:self.z,score:self.score,bag:self.bag?.length,cargo:self.cargo?.length}:null};
          }
          this.emit('message',new MessageEvent('message',{data:data.data}));
        }
        else if(data.kind==='error'){window.historyReplay.error=data.message;console.error('Historical replay:',data.message);this.emit('error',new Event('error'));this.close(1011,'Replay unavailable');}
      };
      this.worker.onerror=event=>{window.historyReplay.error=event.message;this.emit('error',new Event('error'));this.close(1011,'Replay unavailable');};
    }
    emit(type,event){this.dispatchEvent(event);this['on'+type]?.(event);}
    send(text){if(this.readyState!==1)throw new DOMException('Socket not open','InvalidStateError');this.worker.postMessage(JSON.parse(text));}
    close(code=1000,reason=''){if(this.readyState===3)return;this.readyState=3;this.worker.terminate();this.emit('close',new CloseEvent('close',{code,reason,wasClean:true}));}
  }
  for(const [key,value] of Object.entries({CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3}))HistorySocket.prototype[key]=value;
  window.WebSocket=HistorySocket;
  window.historyReplay={version,mode:'historical-client-and-world-local',error:null};
  const label=document.createElement('aside');
  label.textContent='履歴 '+version.slice(1)+' · 当時のゲーム／このタブだけのNPC対戦';
  Object.assign(label.style,{position:'fixed',bottom:'0',left:'0',zIndex:'9999',padding:'3px 8px',font:'11px system-ui',background:'#101719d9',color:'#fff',pointerEvents:'none'});
  document.addEventListener('DOMContentLoaded',()=>document.body.append(label),{once:true});
})();
