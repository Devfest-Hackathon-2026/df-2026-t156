using UnityEngine;

public static partial class ValleyLandscape
{
    // Two physical exits from the survey cut. Both follow the existing shared
    // height/collision data; neither changes terrain, movement or sight blockers.
    // The broad cart scar stays outside rock-7 and reaches the east workshop.
    static readonly Vector2[] eastCartTrack={
        new Vector2(39,24),new Vector2(42,23),new Vector2(42,16),
        new Vector2(41,2),new Vector2(31,2)
    };
    // A narrower miners' shortcut runs inside that outcrop toward the valley
    // floor. Existing trunks/outcrops interrupt some views from the outer road;
    // this is not continuous protection from a pursuer at the cut itself.
    static readonly Vector2[] eastFootTrack={
        new Vector2(39,24),new Vector2(34,24),new Vector2(31,20),
        new Vector2(30,13),new Vector2(26,5.5f),new Vector2(16,7)
    };

    static float HaulDistance(Vector2 p,Vector2[] points)
    {
        float distance=float.MaxValue;
        for(int i=1;i<points.Length;i++)
            distance=Mathf.Min(distance,SegmentDistance(p,points[i-1],points[i]));
        return distance;
    }

    static void BindEastHaulWear()
    {
        // A local mask resolves boot wear and two shallow cart ruts below the
        // floor mesh's vertex spacing. One texture on the existing floor pass;
        // no decal objects, extra geometry, height changes or physics surfaces.
        const int size=256;
        var mask=new Texture2D(size,size,TextureFormat.RGBA32,false,true);
        mask.name="East survey cut ground wear";mask.wrapMode=TextureWrapMode.Clamp;
        mask.filterMode=FilterMode.Bilinear;
        var pixels=new Color32[size*size];
        for(int z=0;z<size;z++)for(int x=0;x<size;x++)
        {
            var p=new Vector2(14+x*32f/(size-1),-2+z*30f/(size-1));
            float wheel=float.MaxValue;
            for(int i=1;i<eastCartTrack.Length;i++)
            {
                Vector2 a=eastCartTrack[i-1],b=eastCartTrack[i];
                Vector2 along=(b-a).normalized,side=new Vector2(-along.y,along.x);
                float bend=(Noise(p.x*.64f,p.y*.64f)-.5f)*.09f;
                wheel=Mathf.Min(wheel,SegmentDistance(p,a+side*(.47f+bend),b+side*(.47f+bend)));
                wheel=Mathf.Min(wheel,SegmentDistance(p,a-side*(.47f+bend),b-side*(.47f+bend)));
            }
            float broken=.50f+.50f*Noise(p.x*3.4f,p.y*3.4f);
            float rut=(1-Mathf.SmoothStep(0,1,(wheel-.055f)/.16f))*broken;
            float foot=(1-Mathf.SmoothStep(0,1,(HaulDistance(p,eastFootTrack)-.20f)/.55f));
            float grit=Noise(p.x*4.8f,p.y*4.8f);
            pixels[z*size+x]=new Color(0,rut,foot*(.64f+grit*.36f),1);
        }
        mask.SetPixels32(pixels);mask.Apply(false,true);
        earth.SetTexture("_WearMap",mask);
        earth.SetVector("_WearBounds",new Vector4(14,-2,1f/32,1f/30));
    }

    static Color EastHaulGround(float x,float z,Color floor)
    {
        if(x<14||x>46||z< -2||z>28)return floor;
        var p=new Vector2(x,z);
        float irregular=(Noise(x*.67f,z*.67f)-.5f)*.36f;
        float cart=1-Mathf.SmoothStep(0,1,(HaulDistance(p,eastCartTrack)+irregular-.65f)/1.15f);
        float foot=1-Mathf.SmoothStep(0,1,(HaulDistance(p,eastFootTrack)+irregular-.26f)/.90f);
        // Exposed pale crushed stone versus dark, compressed earth. The same
        // ground texture/normal remains visible, rather than a painted stripe.
        Color gravel=Color.Lerp(new Color(.67f,.65f,.55f),new Color(.88f,.86f,.73f),Noise(x*.48f,z*.48f));
        Color tread=Color.Lerp(new Color(.49f,.46f,.35f),new Color(.71f,.65f,.50f),Noise(x*.57f,z*.57f));
        floor=Color.Lerp(floor,tread,foot*.85f);
        return Color.Lerp(floor,gravel,cart*.94f);
    }

    static bool EastHaulCleared(float x,float z)
    {
        if(x<14||x>46||z< -2||z>28)return false;
        var p=new Vector2(x,z);
        return HaulDistance(p,eastCartTrack)<1.05f||HaulDistance(p,eastFootTrack)<.65f;
    }

    internal static bool OnHaulGravel(float x,float z)
    {
        if(x<29||x>45||z<0||z>27)return false;
        return HaulDistance(new Vector2(x,z),eastCartTrack)<1.25f;
    }

    static void EastHaulGravel()
    {
        var random=new System.Random(8614);
        // One batched scattering at the margins of the haul road, below ankle
        // height. No props across the mining face and no additional colliders.
        for(int i=1;i<eastCartTrack.Length;i++)
        {
            Vector2 a=eastCartTrack[i-1],b=eastCartTrack[i],direction=(b-a).normalized;
            Vector2 side=new Vector2(-direction.y,direction.x);
            int count=Mathf.CeilToInt(Vector2.Distance(a,b)*2.5f);
            for(int j=0;j<count;j++)
            {
                float t=(j+(float)random.NextDouble())/count;
                float margin=(random.Next(2)==0?-1:1)*(.75f+(float)random.NextDouble()*.66f);
                Vector2 point=Vector2.Lerp(a,b,t)+side*margin;
                if(NearObstacle(point.x,point.y)||YardDistance(point.x,point.y)<.1f)continue;
                Pebble(new Vector3(point.x,Height(point.x,point.y),point.y),
                    .035f+(float)random.NextDouble()*.055f,smallStone);
            }
        }
    }
}
