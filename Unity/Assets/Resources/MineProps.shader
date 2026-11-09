Shader "Orbit/MineProps"
{
 Properties
 {
  _MainTex("Authored albedo",2D)="white"{}
  _BumpMap("Authored normal",2D)="bump"{}
  _MetalMap("Authored metal",2D)="black"{}
  _RoughMap("Authored roughness",2D)="white"{}
  _Color("Tint",Color)=(1,1,1,1)
  _Desaturate("Weathered pigment",Range(0,1))=.5
 }
 SubShader
 {
  Tags {"RenderType"="Opaque"}
  LOD 200
  CGPROGRAM
  #pragma surface surf Standard fullforwardshadows addshadow noforwardadd
  #pragma target 3.0
  sampler2D _MainTex,_BumpMap,_MetalMap,_RoughMap;
  fixed4 _Color;
  half _Desaturate;
  struct Input {float2 uv_MainTex;};
  void surf(Input i,inout SurfaceOutputStandard o)
  {
   fixed3 pigment=tex2D(_MainTex,i.uv_MainTex).rgb;
   half luma=dot(pigment,fixed3(.299,.587,.114));
   o.Albedo=lerp(pigment,luma.xxx,_Desaturate)*_Color.rgb;
   o.Normal=UnpackNormal(tex2D(_BumpMap,i.uv_MainTex));
   o.Metallic=tex2D(_MetalMap,i.uv_MainTex).r*.82;
   o.Smoothness=saturate(1-tex2D(_RoughMap,i.uv_MainTex).r)*.76;
   o.Alpha=1;
  }
  ENDCG
 }
 FallBack "Diffuse"
}
