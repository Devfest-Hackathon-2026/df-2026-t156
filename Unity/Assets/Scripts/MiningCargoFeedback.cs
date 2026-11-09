using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public partial class OrbitGame
{
    private sealed class CargoView
    {
        public Walker Person;
        public Transform Root;
        public int Count = -1;
        public float ReceivedAt = -10, LostAt = -10, LastRattle;
    }
    private sealed class CargoTransfer
    {
        public Transform Root;
        public Vector3 From, To;
        public string Recipient;
        public float Started, Duration;
        public bool Selling;
    }
    private readonly Dictionary<string,CargoView> cargoViews = new Dictionary<string,CargoView>();
    private readonly HashSet<string> cargoEvents = new HashSet<string>();
    private readonly List<CargoTransfer> cargoTransfers = new List<CargoTransfer>();
    private readonly List<string> lostCargo = new List<string>();
    private Material cargoQuartz, cargoGold;
    private Mesh cargoStoneMesh;
    private int cargoRound = -1;
    private float cargoReceivedAt = -10;
    private readonly AudioSource[] nearbyMiningVoices=new AudioSource[6];
    private int nextNearbyVoice;

    private void InitCargoAssets()
    {
        if (cargoQuartz) return;
        cargoQuartz = GearMaterial(new Color(.70f,.68f,.58f),"Oxide",.25f);
        cargoGold = GearMaterial(new Color(.84f,.58f,.18f),"Oxide",.55f,.83f);
        var prototype = Chunk(transform,Vector3.zero,Vector3.one,stone,218);
        cargoStoneMesh = prototype.GetComponent<MeshFilter>().sharedMesh;
        Destroy(prototype.gameObject);
    }

    private CargoView CreateCargo(Walker walker)
    {
        // The existing rucksack owns the visible load shape. This attachment
        // remains the authoritative transfer/audio endpoint, without extra
        // hip bags or exposed mineral colors.
        return new CargoView {Person=walker,Root=GearPivot(walker.body,
            "Rucksack ore receiving point",new Vector3(0,.28f,-.30f))};
    }

    private void UpdateCargoVisuals()
    {
        InitCargoAssets();
        lostCargo.Clear();
        foreach(var pair in cargoViews)
            if(!walkers.TryGetValue(pair.Key,out var person)||person!=pair.Value.Person) lostCargo.Add(pair.Key);
        foreach(var id in lostCargo) cargoViews.Remove(id);
        foreach(var pair in walkers)
        {
            var player=pair.Value.data;
            if(player==null) continue;
            if(!cargoViews.TryGetValue(pair.Key,out var view)) cargoViews[pair.Key]=view=CreateCargo(pair.Value);
            view.Count=player.inventoryCount;
        }

        if(cargoRound!=state.round)
        {
            cargoRound=state.round;cargoEvents.Clear();
            // Joining a round does not replay its retained historical effects.
            if(state.events!=null) foreach(var e in state.events) cargoEvents.Add(e.id);
            return;
        }
        if(state.events==null) return;
        foreach(var e in state.events)
        {
            if(!cargoEvents.Add(e.id)||e.amount<=0) continue;
            if(e.type!="harvest"&&e.type!="steal"&&e.type!="sold") continue;
            bool own=e.actorId==localId;
            Vector3 destination;
            if(own) destination=cam.transform.TransformPoint(new Vector3(.30f,-.39f,.65f));
            else if(cargoViews.TryGetValue(e.actorId,out var receiver)) destination=receiver.Root.position+Vector3.up*.10f;
            else continue;
            var source=new Vector3(e.x,e.y,e.z);
            if(e.type=="steal"&&cargoViews.TryGetValue(e.targetId,out var victim)) source=victim.Root.position+Vector3.up*.15f;
            if(e.type=="steal"&&cargoViews.TryGetValue(e.targetId,out var struck)) struck.LostAt=Time.unscaledTime;
            if(e.type=="sold") {source=destination;destination=new Vector3(e.x,e.y+1.02f,e.z);}
            if(!own&&(!CargoInView(source)||!CargoInView(destination))) continue;
            if((source-destination).sqrMagnitude>36) continue;
            if(own&&e.type!="sold") cargoReceivedAt=Time.unscaledTime;
            if(cargoViews.TryGetValue(e.actorId,out var cargo)) cargo.ReceivedAt=Time.unscaledTime;
            for(int i=0;i<Mathf.Min(e.amount,3);i++)
                CreateCargoTransfer(source+Vector3.up*(.09f*i),destination,e.actorId,e.kind,e.type=="sold",i);
        }
    }

    private bool CargoInView(Vector3 point)
    {
        var screen=cam.WorldToViewportPoint(point);
        if(screen.z<=0||screen.z>14||screen.x<-.08f||screen.x>1.08f||screen.y<-.1f||screen.y>1.1f) return false;
        var offset=point-cam.transform.position;
        return SightDistance(cam.transform.position,offset.normalized,offset.magnitude)>=offset.magnitude-.15f;
    }

    private void CreateCargoTransfer(Vector3 from,Vector3 to,string recipient,string kind,bool selling,int index)
    {
        if(cargoTransfers.Count>=12) return;
        var root=GearPivot(transform,"Authoritative ore transfer",Vector3.zero);
        root.position=from;
        root.localScale=Vector3.one*(kind=="gold"?.14f:.105f);
        root.rotation=Quaternion.Euler(index*63,31+index*87,14);
        GearMesh(root,"Broken mineral matrix",cargoStoneMesh,cargoQuartz);
        var mineral=GearMesh(root,"Fresh fracture",cargoStoneMesh,kind=="gold"?cargoGold:OreMaterial(kind));
        mineral.localPosition=new Vector3(.08f,.23f,-.16f);
        mineral.localScale=new Vector3(.83f,.48f,.64f);
        foreach(var renderer in root.GetComponentsInChildren<MeshRenderer>()) renderer.shadowCastingMode=ShadowCastingMode.Off;
        cargoTransfers.Add(new CargoTransfer {Root=root,From=from,To=to,Recipient=recipient,
            Started=Time.unscaledTime+index*.045f,Duration=.40f+index*.04f,Selling=selling});
    }

    private void AnimateCargoVisuals()
    {
        AnimateReceiptAudio();
        float now=Time.unscaledTime;
        foreach(var view in cargoViews.Values)
        {
            if(!view.Root||view.Count<=0) continue;
            float pulse=Mathf.Clamp01(1-(now-view.ReceivedAt)/.42f);
            float settle=Mathf.Sin((1-pulse)*Mathf.PI*2)*pulse;
            float sway=Mathf.Sin(view.Person.step)*view.Person.gearPace;
            float loss=Mathf.Clamp01(1-(now-view.LostAt)/.30f);
            float tug=Mathf.Sin((1-loss)*Mathf.PI)*loss;
            view.Root.localRotation=Quaternion.Euler(0,tug*8,settle*8+sway*3.5f-tug*9);
            view.Root.localPosition=new Vector3(0,.28f-Mathf.Abs(settle)*.035f,-.30f);
            if(view.Person.gearPace>.45f&&now>view.LastRattle&&
                (cam.transform.position-view.Root.position).sqrMagnitude<64)
            {
                view.LastRattle=now+1.05f+(view.Count%3)*.13f;
                PlayNearbyMining(bagSettleSound,view.Root.position,.11f,.88f);
            }
        }
        for(int i=cargoTransfers.Count-1;i>=0;i--)
        {
            var transfer=cargoTransfers[i];
            float t=Mathf.Clamp01((now-transfer.Started)/transfer.Duration);
            if(t>=1){Destroy(transfer.Root.gameObject);cargoTransfers.RemoveAt(i);continue;}
            Vector3 destination=transfer.To;
            if(!transfer.Selling)
            {
                if(transfer.Recipient==localId) destination=cam.transform.TransformPoint(new Vector3(.30f,-.39f,.65f));
                else if(cargoViews.TryGetValue(transfer.Recipient,out var view)) destination=view.Root.position+Vector3.up*.1f;
            }
            transfer.Root.position=Vector3.Lerp(transfer.From,destination,Mathf.SmoothStep(0,1,t))+Vector3.up*(Mathf.Sin(t*Mathf.PI)*.22f);
            transfer.Root.Rotate(70*Time.deltaTime,100*Time.deltaTime,20*Time.deltaTime);
            transfer.Root.localScale*=1-Time.deltaTime*Mathf.Clamp01((t-.70f)*3)*5;
        }
    }

    private void PlayNearbyMining(AudioClip clip,Vector3 point,float volume,float pitch=1,float range=12)
    {
        var offset=point-cam.transform.position;
        if(offset.sqrMagnitude>range*range||!clip||!CanSeeNameplate(point)) return;
        int index=nextNearbyVoice++%nearbyMiningVoices.Length;
        var voice=nearbyMiningVoices[index];
        if(!voice)
        {
            voice=GearPivot(transform,"Nearby mining voice "+index,Vector3.zero).gameObject.AddComponent<AudioSource>();
            voice.spatialBlend=1;voice.rolloffMode=AudioRolloffMode.Linear;
            voice.minDistance=1;voice.maxDistance=12;voice.dopplerLevel=0;
            nearbyMiningVoices[index]=voice;
        }
        voice.maxDistance=range;voice.transform.position=point;voice.pitch=pitch;
        voice.clip=clip;voice.volume=volume;voice.Play();
    }
}
