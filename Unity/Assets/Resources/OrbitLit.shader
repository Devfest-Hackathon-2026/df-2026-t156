Shader "Orbit/Lit"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)
        _EmissionColor ("Emission", Color) = (0,0,0,0)
        _Metallic ("Metalness", Range(0,1)) = 0
        _Smoothness ("Smoothness", Range(0,1)) = .16
        _NeutralTexture ("Neutral Texture", Range(0,1)) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 200

        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows addshadow noforwardadd
        #pragma target 3.0

        sampler2D _MainTex;
        fixed4 _Color, _EmissionColor;
        half _Metallic, _Smoothness, _NeutralTexture;

        struct Input { float2 uv_MainTex; };

        void surf(Input input, inout SurfaceOutputStandard output)
        {
            fixed3 albedo = tex2D(_MainTex, input.uv_MainTex).rgb;
            fixed brightness = saturate(.24 + 1.32 * dot(albedo, fixed3(.24,.68,.08)));
            output.Albedo = _Color.rgb * lerp(albedo, brightness.xxx, _NeutralTexture);
            output.Metallic = _Metallic;
            output.Smoothness = _Smoothness;
            output.Emission = _EmissionColor.rgb * .42;
            output.Alpha = 1;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
