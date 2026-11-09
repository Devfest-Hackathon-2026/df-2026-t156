Shader "Orbit/TradingLampGlass"
{
    Properties { _Color("Glass",Color) = (.45,.47,.39,.22) _Heat("Wick",Range(0,1)) = 0 }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" }
        ZWrite Off
        CGPROGRAM
        #pragma surface surf Standard alpha:premul noforwardadd
        #pragma target 3.0
        fixed4 _Color;
        half _Heat;
        struct Input { float3 viewDir; };
        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            float rim = pow(1-saturate(abs(dot(normalize(IN.viewDir),float3(0,0,1)))),3);
            o.Albedo = lerp(_Color.rgb,half3(.65,.47,.25),_Heat*.4);
            o.Smoothness = .58; o.Metallic = 0;
            o.Emission = _Heat * half3(1.35,.85,.28);
            o.Alpha = _Color.a + rim*.17 + _Heat*.20;
        }
        ENDCG
    }
    Fallback "Transparent/Diffuse"
}
