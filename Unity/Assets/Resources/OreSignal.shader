Shader "Orbit/OreSignal"
{
    Properties { _Tint ("Sunlit mineral dust", Color) = (1,.68,.20,.36) }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Cull Off ZWrite Off Blend SrcAlpha OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct In { float4 vertex:POSITION; float2 uv:TEXCOORD0; };
            struct Out { float4 pos:SV_POSITION; float2 uv:TEXCOORD0; };
            fixed4 _Tint;
            Out vert(In v) { Out o;o.pos=UnityObjectToClipPos(v.vertex);o.uv=v.uv;return o; }
            float hash(float2 p) { return frac(sin(dot(p,float2(127.1,311.7)))*43758.5453); }
            float noise(float2 p)
            {
                float2 i=floor(p),f=frac(p);f=f*f*(3-2*f);
                return lerp(lerp(hash(i),hash(i+float2(1,0)),f.x),
                    lerp(hash(i+float2(0,1)),hash(i+1),f.x),f.y);
            }
            fixed4 frag(Out i):SV_Target
            {
                float y=i.uv.y;
                float drift=sin(y*8-_Time.y*.65)*.055;
                float x=abs(i.uv.x-.5+drift);
                float envelope=(1-smoothstep(.12,.47,x))
                    *smoothstep(0,.10,y)*(1-smoothstep(.60,1,y));
                float billow=noise(float2(i.uv.x*5,y*9-_Time.y*.65));
                float grain=noise(float2(i.uv.x*34,y*80-_Time.y*2.4));
                float dust=saturate((billow-.27)*1.5)*(.42+grain*.58);
                // Broken pale reflections remain legible against sunlit slopes.
                float spine=1-smoothstep(.035,.12,x);
                float glints=smoothstep(.48,.76,noise(float2(y*17-_Time.y*.8,3.7)));
                float reflection=spine*(.38+glints*.62)*smoothstep(.04,.18,y)*(1-smoothstep(.64,.93,y));
                float alpha=max(_Tint.a*envelope*dust,reflection*.92*saturate(_Tint.a/.55));
                float3 tint=lerp(_Tint.rgb*(.88+grain*.28),float3(1,.98,.83),saturate(reflection*4));
                return fixed4(tint,alpha);
            }
            ENDCG
        }
    }
}
