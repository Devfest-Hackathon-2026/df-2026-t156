Shader "Orbit/ValleySky" {
 Properties { _SunDirection("Sun",Vector)=(.4,.6,.3,0) }
 SubShader {Tags {"Queue"="Background" "RenderType"="Background" "PreviewType"="Skybox"} Cull Off ZWrite Off
 Pass { CGPROGRAM
 #pragma vertex vert
 #pragma fragment frag
 #include "UnityCG.cginc"
 struct appdata{float4 vertex:POSITION;};struct v2f{float4 pos:SV_POSITION;float3 dir:TEXCOORD0;};float4 _SunDirection;
 v2f vert(appdata v){v2f o;o.pos=UnityObjectToClipPos(v.vertex);o.dir=v.vertex.xyz;return o;}
 float h(float2 p){return frac(sin(dot(p,float2(127.1,311.7)))*43758.5453);}
 float n(float2 p){float2 a=floor(p),f=frac(p);f=f*f*(3-2*f);return lerp(lerp(h(a),h(a+float2(1,0)),f.x),lerp(h(a+float2(0,1)),h(a+1),f.x),f.y);}
 fixed4 frag(v2f i):SV_Target{float3 d=normalize(i.dir);float k=pow(saturate(d.y),.55);float3 col=lerp(float3(.77,.83,.82),float3(.29,.5,.7),k);float sun=dot(d,normalize(_SunDirection.xyz));col+=float3(1,.87,.59)*pow(saturate(sun),1600)*2;col+=float3(.12,.08,.025)*pow(saturate(sun),12);float2 p=d.xz/max(.12,d.y)*1.7;float cloud=n(p)*.52+n(p*2.1)*.28+n(p*4.3)*.13+n(p*8.2)*.07;float c=smoothstep(.57,.77,cloud)*smoothstep(.02,.2,d.y);col=lerp(col,float3(.95,.95,.89),c*.7);return fixed4(col,1);}
 ENDCG }
 }Fallback Off
}
