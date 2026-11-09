Shader "Orbit/Arrow Wake"
{
    Properties { _Opacity ("Opacity", Range(0,1)) = 1 }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        ZTest LEqual
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float _Opacity;
            struct appdata { float4 vertex:POSITION; fixed4 color:COLOR; float2 uv:TEXCOORD0; };
            struct v2f { float4 pos:SV_POSITION; fixed4 color:COLOR; float2 uv:TEXCOORD0; };
            v2f vert(appdata v) { v2f o; o.pos=UnityObjectToClipPos(v.vertex); o.color=v.color; o.uv=v.uv; return o; }
            fixed4 frag(v2f i):SV_Target
            {
                float edge=abs(i.uv.y-.5)*2;
                float core=1-smoothstep(.30,.58,edge);
                fixed3 color=lerp(fixed3(.02,.03,.04),fixed3(.98,.95,.82),core);
                float alpha=_Opacity*i.color.a*(1-smoothstep(.78,1,edge));
                return fixed4(color,alpha);
            }
            ENDCG
        }
    }
}
