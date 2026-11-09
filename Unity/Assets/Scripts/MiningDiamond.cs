using UnityEngine;

public partial class OrbitGame
{
    private Texture2D diamondIcon;

    private void DrawDiamondIcon(Rect rect, Color tint)
    {
        if (!diamondIcon)
        {
            const int size = 64;
            diamondIcon = new Texture2D(size,size,TextureFormat.RGBA32,false) { name="Diamond specimen icon", filterMode=FilterMode.Bilinear };
            var pixels = new Color[size*size];
            for (int y=0;y<size;y++) for(int x=0;x<size;x++)
            {
                float u=(x+.5f)/size,v=(y+.5f)/size;
                float half=v < .54f ? Mathf.Lerp(0,.39f,Mathf.InverseLerp(.10f,.54f,v))
                    : Mathf.Lerp(.39f,.22f,Mathf.InverseLerp(.54f,.85f,v));
                if(v<.10f || v>.85f || Mathf.Abs(u-.5f)>half) continue;
                Color color=v>.54f ? new Color(.80f,.97f,1) : u < .5f ? new Color(.34f,.72f,.85f) : new Color(.64f,.88f,.96f);
                if(v<.54f&&Mathf.Abs(u-.5f)<(.54f-v)*.30f) color=new Color(.84f,.98f,1);
                if(v>.77f || Mathf.Abs(v-.54f)<.018f) color=Color.white;
                pixels[y*size+x]=color;
            }
            diamondIcon.SetPixels(pixels);diamondIcon.Apply(false,true);
        }
        GUI.color=GuiTint(tint);
        GUI.DrawTexture(rect,diamondIcon);
        GUI.color=Color.white;
    }
}
