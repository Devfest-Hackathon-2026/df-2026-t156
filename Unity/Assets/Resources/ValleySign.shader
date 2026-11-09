Shader "Orbit/ValleySign" {Properties{_MainTex("Font",2D)="white"{} _Color("Tint",Color)=(1,1,1,1)} SubShader{Tags{"Queue"="Transparent" "RenderType"="Transparent"} Blend SrcAlpha OneMinusSrcAlpha ZWrite Off Cull Back Pass{CGPROGRAM
#pragma vertex vert
#pragma fragment frag
#include "UnityCG.cginc"
struct appdata{float4 vertex:POSITION;float2 uv:TEXCOORD0;fixed4 color:COLOR;};struct v2f{float4 pos:SV_POSITION;float2 uv:TEXCOORD0;fixed4 color:COLOR;};sampler2D _MainTex;fixed4 _Color;
v2f vert(appdata i){v2f o;o.pos=UnityObjectToClipPos(i.vertex);o.uv=i.uv;o.color=i.color*_Color;return o;}fixed4 frag(v2f i):SV_Target{fixed4 c=i.color;c.a*=tex2D(_MainTex,i.uv).a;return c;}
ENDCG
}
}
}
