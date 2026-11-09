Shader "Orbit/ValleySurface" {
 Properties { _MainTex("Surface",2D)="white"{} _RockTex("Rock",2D)="white"{} _BumpMap("Detail normal",2D)="bump"{} _Color("Tint",Color)=(1,1,1,1) _Scale("World scale",Float)=0.28 _Terrain("Terrain blend",Float)=0 _UseVertexTint("Vertex tint",Float)=1 _NormalStrength("Detail strength",Range(0,1))=.65 _WearMap("Local ground wear",2D)="black"{} _WearBounds("Wear bounds",Vector)=(0,0,1,1) }
 SubShader { Tags {"RenderType"="Opaque"} LOD 250
 CGPROGRAM
 #pragma surface surf Standard fullforwardshadows vertex:vert
 #pragma target 3.0
 sampler2D _MainTex,_RockTex,_BumpMap,_WearMap; fixed4 _Color; float4 _WearBounds; float _Scale,_Terrain,_UseVertexTint,_NormalStrength;
 struct Input {float3 worldPos;float3 worldNormal;INTERNAL_DATA float4 color:COLOR;};
 void vert(inout appdata_full v,out Input o){UNITY_INITIALIZE_OUTPUT(Input,o);o.color=v.color;}
 float h(float2 p){return frac(sin(dot(p,float2(127.1,311.7)))*43758.5453);}
 float noise(float2 p){float2 i=floor(p),f=frac(p);f=f*f*(3-2*f);return lerp(lerp(h(i),h(i+float2(1,0)),f.x),lerp(h(i+float2(0,1)),h(i+1),f.x),f.y);}
 void surf(Input IN,inout SurfaceOutputStandard o){
 float3 baseNormal=normalize(WorldNormalVector(IN,float3(0,0,1)));float3 p=IN.worldPos;float3 w=pow(abs(baseNormal),4);w/=max(w.x+w.y+w.z,0.001);
 fixed3 tex=tex2D(_MainTex,p.zy*_Scale).rgb*w.x+tex2D(_MainTex,p.xz*_Scale).rgb*w.y+tex2D(_MainTex,p.xy*_Scale).rgb*w.z;
 float macro=noise(p.xz*.075);float detail=noise(p.xz*4.7);
 if(_Terrain>.5){fixed3 rock=tex2D(_RockTex,p.zy*.25).rgb*w.x+tex2D(_RockTex,p.xz*.25).rgb*w.y+tex2D(_RockTex,p.xy*.25).rgb*w.z;
 float slope=saturate((.86-baseNormal.y)*3.8);tex=lerp(tex,rock,slope);}
 float strata=1-.035*smoothstep(.77,.98,sin(p.y*4.5+noise(p.xz*.13)*3));
  float3 nx=UnpackNormal(tex2D(_BumpMap,p.zy*_Scale)),ny=UnpackNormal(tex2D(_BumpMap,p.xz*_Scale)),nz=UnpackNormal(tex2D(_BumpMap,p.xy*_Scale));
 nx=float3(nx.z*sign(baseNormal.x),nx.y,nx.x);ny=float3(ny.x,ny.z*sign(baseNormal.y),ny.y);nz=float3(nz.x,nz.y,nz.z*sign(baseNormal.z));
 float3 mapped=normalize(nx*w.x+ny*w.y+nz*w.z);mapped=normalize(lerp(baseNormal,mapped,_NormalStrength));
 float3 tangent=normalize(WorldNormalVector(IN,float3(1,0,0))),bitangent=normalize(WorldNormalVector(IN,float3(0,1,0)));
 o.Normal=float3(dot(mapped,tangent),dot(mapped,bitangent),dot(mapped,baseNormal));
 fixed3 tint=lerp(fixed3(1,1,1),IN.color.rgb,_UseVertexTint);
 float rut=0;
 if(_Terrain>.5){float3 wear=tex2D(_WearMap,(p.xz-_WearBounds.xy)*_WearBounds.zw).rgb;
 tint=lerp(tint,fixed3(.39,.35,.27),wear.b*.70);rut=wear.g;tint*=1-rut*.38;}
 o.Albedo=tex*_Color.rgb*tint*lerp(.78,1.13,macro)*lerp(.96,1.04,detail)*strata;o.Metallic=0;o.Smoothness=lerp(.13,.19,rut);o.Occlusion=lerp(.85,1,baseNormal.y)*(1-rut*.10);
 }
 ENDCG
 } FallBack "Diffuse"
}
