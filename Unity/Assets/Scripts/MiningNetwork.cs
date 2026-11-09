using System;
using System.Collections.Generic;

[Serializable] public class OrbitPose
{
    public string id;
    public float x, y, z, yaw, meleeBoostUntil;
    public int motionSeq, correctionId, impulseId;
    public float correctionX, correctionY, correctionZ, impulseX, impulseY, impulseZ, velocityX, velocityY, velocityZ;
    public bool grounded, sprintSuppressed;

    public void ApplyTo(OrbitPlayer p)
    {
        p.x=x;p.y=y;p.z=z;p.yaw=yaw;p.motionSeq=motionSeq;
        p.correctionId=correctionId;p.correctionX=correctionX;p.correctionY=correctionY;p.correctionZ=correctionZ;
        p.impulseId=impulseId;p.impulseX=impulseX;p.impulseY=impulseY;p.impulseZ=impulseZ;
        p.velocityX=velocityX;p.velocityY=velocityY;p.velocityZ=velocityZ;
        p.grounded=grounded;p.sprintSuppressed=sprintSuppressed;p.meleeBoostUntil=meleeBoostUntil;
    }
}

public partial class OrbitGame
{
    private readonly Dictionary<string,OrbitPlayer> networkPlayers = new Dictionary<string,OrbitPlayer>();
    private readonly Dictionary<string,OrbitPose> networkPoses = new Dictionary<string,OrbitPose>();
    private readonly Dictionary<string,OrbitDeposit> networkDeposits = new Dictionary<string,OrbitDeposit>();
    private readonly Dictionary<string,OrbitStation> networkStations = new Dictionary<string,OrbitStation>();
    private readonly Dictionary<string,OrbitSceneryRock> networkScenery = new Dictionary<string,OrbitSceneryRock>();
    private readonly Dictionary<string,OrbitBolt> networkBolts = new Dictionary<string,OrbitBolt>();
    private static readonly OrbitDeposit[] NoDepositUpdates = new OrbitDeposit[0];
    private int networkSequence;

    private void ResetNetworkSession()
    {
        networkSequence=0;miningAudioRound=-1;cargoRound=-1;eventsSeen.Clear();
    }

    private void PollNetwork()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        OrbitPoll();
#elif UNITY_EDITOR
        PollEditor();
#endif
    }

    private static T[] NetworkValues<T>(Dictionary<string,T> source)
    {
        var result = new T[source.Count];source.Values.CopyTo(result,0);return result;
    }

    private void ReceiveNetworkFrame(OrbitState frame)
    {
        if (!frame.full && (state == null || frame.seq <= networkSequence)) return;
        if (frame.full)
        {
            networkPlayers.Clear();networkPoses.Clear();networkDeposits.Clear();networkStations.Clear();networkScenery.Clear();networkBolts.Clear();
        }
        networkSequence = frame.seq;
        bool playersChanged = frame.full || frame.players != null || frame.removedPlayers != null;
        if (frame.removedPlayers != null) foreach (string id in frame.removedPlayers)
        { networkPlayers.Remove(id);networkPoses.Remove(id); }
        if (frame.players != null) foreach (var player in frame.players) networkPlayers[player.id]=player;
        if (frame.poses != null) foreach (var pose in frame.poses) networkPoses[pose.id]=pose;
        // Metadata replacement must retain the latest pose even when that pose did not change this frame.
        foreach (var pair in networkPoses)
            if (networkPlayers.TryGetValue(pair.Key,out var player)) pair.Value.ApplyTo(player);
        if (frame.deposits != null) foreach (var item in frame.deposits) networkDeposits[item.id]=item;
        if (frame.stations != null) foreach (var item in frame.stations) networkStations[item.id]=item;
        if (frame.scenery != null) foreach (var item in frame.scenery) networkScenery[item.id]=item;
        if (frame.removedBolts != null) foreach (var id in frame.removedBolts) networkBolts.Remove(id);
        if (frame.bolts != null) foreach (var item in frame.bolts) networkBolts[item.id]=item;
        var previous=frame.full?null:state;
        // Each receive has its own identity, while unchanged entity arrays/objects remain shared.
        // Event/audio consumers use snapshot identity to suppress only historical join events.
        frame.players=playersChanged?NetworkValues(networkPlayers):previous.players;
        var veinUpdates=frame.deposits??NoDepositUpdates;
        frame.deposits=frame.full||frame.deposits!=null?NetworkValues(networkDeposits):previous.deposits;
        frame.stations=frame.full||frame.stations!=null?NetworkValues(networkStations):previous.stations;
        frame.scenery=frame.full||frame.scenery!=null?NetworkValues(networkScenery):previous.scenery;
        frame.picks=frame.picks??previous?.picks;
        frame.bow=frame.bow??previous?.bow;
        frame.bolts=NetworkValues(networkBolts);
        frame.goldLayers=frame.goldLayers??previous?.goldLayers;
        frame.standings=frame.standings??previous?.standings;
        frame.winners=frame.winners??previous?.winners;
        state=frame;
        Apply(frame,veinUpdates,playersChanged||veinUpdates.Length>0);
    }
}
