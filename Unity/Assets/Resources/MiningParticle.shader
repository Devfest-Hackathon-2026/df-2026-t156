Shader "Orbit/MiningParticle"
{
    Properties
    {
        _MainTex ("Mask", 2D) = "white" {}
        _Tint ("Tint", Color) = (1,1,1,1)
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" }
        Cull Off
        ZWrite Off
        Blend SrcAlpha OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex vert_img
            #pragma fragment frag
            #include "UnityCG.cginc"
            sampler2D _MainTex;
            fixed4 _Tint;
            fixed4 frag(v2f_img i) : SV_Target
            {
                return fixed4(_Tint.rgb, tex2D(_MainTex, i.uv).a * _Tint.a);
            }
            ENDCG
        }
    }
}
