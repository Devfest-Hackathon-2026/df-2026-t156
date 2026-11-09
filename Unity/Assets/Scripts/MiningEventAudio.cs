using UnityEngine;

public partial class OrbitGame
{
    private AudioClip forgeStrikeSound, bagSettleSound, bagTugSound, surfaceCrackSound;
    private OrbitState firstAudioSnapshot;
    private int miningAudioRound=-1;
    private bool skipFinalStrikeFeedback;
    private int feedbackGoldLayer;
    private bool feedbackSceneryChip;
    private float cargoLostAt=-10, receiptSoundAt=-10;
    private string receiptSoundKind;
    private readonly AudioSource[] localMiningVoices=new AudioSource[3];
    private int nextLocalVoice;

    private void LoadMiningEventSounds()
    {
        forgeStrikeSound=Resources.Load<AudioClip>("MiningAudio/forge-stroke")??weakSound;
        bagSettleSound=Resources.Load<AudioClip>("MiningAudio/bag-settle")??stoneSound;
        bagTugSound=Resources.Load<AudioClip>("MiningAudio/bag-tug")??hurtSound;
        surfaceCrackSound=Resources.Load<AudioClip>("MiningAudio/surface-crack")??breakSound;
    }

    private bool StrikeEndsLayer(OrbitEvent item)
    {
        // Server emits the final mine/weak immediately followed by its harvest.
        // Ownership may differ from the last striker, so pair by vein, not actor.
        if(state.events==null)return false;
        for(int i=0;i+1<state.events.Length;i++)
            if(state.events[i].id==item.id)
            {
                var next=state.events[i+1];
                return next.type=="harvest"&&next.targetId==item.targetId&&next.kind==item.kind;
            }
        return false;
    }

    private void PlayMiningEventAudio(OrbitEvent item,bool own,bool victim)
    {
        skipFinalStrikeFeedback=false;
        feedbackGoldLayer=item.kind=="gold"?item.layer:0;
        feedbackSceneryChip=item.targetId!=null&&item.targetId.StartsWith("rock-",System.StringComparison.Ordinal);
        if(!forgeStrikeSound)LoadMiningEventSounds();
        PrepareMiningAudioSnapshot();
        bool historical=ReferenceEquals(firstAudioSnapshot,state);
        skipFinalStrikeFeedback=historical;
        var point=new Vector3(item.x,item.y,item.z);
        if(item.type=="mine"||item.type=="weak")
        {
            skipFinalStrikeFeedback=historical||StrikeEndsLayer(item);
            if(skipFinalStrikeFeedback||historical)return;
            bool weak=item.type=="weak";
            PlayStrike(weak?weakSound:stoneSound,point,own,weak?.37f:.62f,
                MaterialStrikePitch(item.kind,item.actorId)*(weak?1.04f:1));
        }
        else if(item.type=="harvest")
        {
            if(historical)return;
            if(item.pickup)
            {
                skipFinalStrikeFeedback=true;
                PlayStrike(stoneSound,point,own,.20f,1.23f);
                if(own){receiptSoundAt=Time.unscaledTime+.24f;receiptSoundKind=item.kind;}
                return;
            }
            bool core=item.kind=="gold"&&item.layer>=2;
            bool surface=item.kind=="gold"&&item.layer==1;
            PlayStrike(surface||feedbackSceneryChip?surfaceCrackSound:breakSound,point,own,
                feedbackSceneryChip?.38f:core?.64f:surface?.60f:.51f,core?.84f:1.06f);
            if(own&&item.amount>0)
            {
                receiptSoundAt=Time.unscaledTime+.24f;
                receiptSoundKind=item.kind;
            }
        }
        else if(item.type=="hard"&&!historical)
        {
            if(own)hitAt=Time.unscaledTime;
            PlayStrike(forgeStrikeSound,point,own,.25f,.73f);
        }
        else if(own&&item.type=="upgraded"&&!historical)
            PlayStrike(weakSound,point,true,.32f,.83f);
        else if(own&&item.type=="sold"&&!historical)
            PlayStrike(coinSound,point,true,.84f,1);
        else if(item.type=="steal"&&(own||victim)&&!historical)
        {
            if(victim)cargoLostAt=Time.unscaledTime;
            PlayStrike(victim?bagTugSound:bagSettleSound,point,true,victim?.78f:.58f,victim?.82f:1.12f);
        }
        else if(item.type=="steal"&&!historical)
            PlayStrike(bagTugSound,point,false,.35f,.82f);
    }

    private void PrepareMiningAudioSnapshot()
    {
        if(state==null||miningAudioRound==state.round)return;
        miningAudioRound=state.round;firstAudioSnapshot=state;receiptSoundAt=-10;
    }

    private float MaterialStrikePitch(string kind,string actor)
    {
        int level=renderedPickLevel;
        if(actor!=localId&&walkers.TryGetValue(actor,out var person)&&person.data!=null)
            level=Mathf.Max(1,person.data.pickLevel);
        float pitch=kind=="ruby"?.76f:kind=="gold"?.87f:kind=="silver"?1.13f:kind=="crystal"?1.24f:.94f;
        return pitch*(1-(level-1)*.045f)+UnityEngine.Random.Range(-.035f,.035f);
    }

    private void PlayStrike(AudioClip clip,Vector3 point,bool own,float gain,float pitch)
    {
        if(!clip)return;
        if(own)
        {
            int index=nextLocalVoice++%localMiningVoices.Length;
            var voice=localMiningVoices[index];
            if(!voice)
            {
                voice=gameObject.AddComponent<AudioSource>();
                voice.spatialBlend=0;voice.playOnAwake=false;
                localMiningVoices[index]=voice;
            }
            voice.pitch=pitch;voice.clip=clip;voice.volume=gain;voice.Play();
        }
        else PlayNearbyMining(clip,point,gain*.52f,pitch);
    }

    private void AnimateReceiptAudio()
    {
        if(receiptSoundAt<0||Time.unscaledTime<receiptSoundAt)return;
        receiptSoundAt=-10;
        PlayStrike(bagSettleSound,cam.transform.position,true,receiptSoundKind=="gold"?.39f:.23f,.93f);
    }
}
