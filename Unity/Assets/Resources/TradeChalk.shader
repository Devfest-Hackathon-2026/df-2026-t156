Shader "Orbit/TradeChalk"
{
    Properties { _MainTex("Texture", 2D) = "white" {} _Color("Lime", Color) = (.77,.73,.60,.72) }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" }
        ZWrite Off
        CGPROGRAM
        #pragma surface surf Standard alpha:fade fullforwardshadows
        #pragma target 3.0
        sampler2D _MainTex;
        fixed4 _Color;
        struct Input { float2 uv_MainTex; float3 worldPos; };
        float Grain(float2 p) { return frac(sin(dot(p,float2(127.1,311.7)))*43758.5453); }
        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            float grain = Grain(floor(IN.worldPos.xz * 78));
            float wear = Grain(floor(IN.worldPos.xz * 9));
            float across = IN.uv_MainTex.y;
            float edge = .13 + wear * .11;
            float feather = max(fwidth(across), .025);
            float paint = smoothstep(edge-feather,edge+.13,across) *
                (1-smoothstep(1-edge-.13,1-edge+feather,across));
            o.Albedo = _Color.rgb * lerp(.77,1,grain);
            o.Metallic = 0; o.Smoothness = 0;
            o.Alpha = _Color.a * paint * lerp(.55,1,grain);
        }
        ENDCG
    }
    Fallback "Transparent/Diffuse"
}
