Shader "Orbit/ValleyFoliage"
{
    Properties
    {
        _MainTex ("Needles", 2D) = "white" {}
        _AlphaTex ("Alpha", 2D) = "white" {}
        _Color ("Tint", Color) = (1,1,1,1)
        _Cutoff ("Cutoff", Range(0,1)) = .45
    }
    SubShader
    {
        Tags { "Queue" = "AlphaTest" "RenderType" = "TransparentCutout" }
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #include "UnityCG.cginc"
            sampler2D _MainTex, _AlphaTex;
            fixed4 _Color;
            float _Cutoff;
            struct Input { float4 vertex:POSITION; float3 normal:NORMAL; float2 uv:TEXCOORD0; fixed4 color:COLOR; };
            struct Output { float4 position:SV_POSITION; float2 uv:TEXCOORD0; fixed4 tint:COLOR; UNITY_FOG_COORDS(1) };
            Output vert(Input v)
            {
                Output o;
                o.position = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                float3 normal = UnityObjectToWorldNormal(v.normal);
                float sky = .72 + .28 * abs(dot(normal, normalize(float3(.41, .73, -.55))));
                o.tint = v.color * _Color * sky;
                UNITY_TRANSFER_FOG(o, o.position);
                return o;
            }
            fixed4 frag(Output i) : SV_Target
            {
                clip(tex2D(_AlphaTex, i.uv).r - _Cutoff);
                fixed4 color = tex2D(_MainTex, i.uv) * i.tint;
                UNITY_APPLY_FOG(i.fogCoord, color);
                return color;
            }
            ENDCG
        }
        // The landscape enables this pass on nearby canopy chunks only.
        Pass
        {
            Tags { "LightMode" = "ShadowCaster" }
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_shadowcaster
            #include "UnityCG.cginc"

            sampler2D _AlphaTex;
            float _Cutoff;
            struct Output { V2F_SHADOW_CASTER; float2 uv : TEXCOORD1; };

            Output vert(appdata_base v)
            {
                Output o;
                o.uv = v.texcoord.xy;
                TRANSFER_SHADOW_CASTER_NORMALOFFSET(o)
                return o;
            }

            float4 frag(Output i) : SV_Target
            {
                clip(tex2D(_AlphaTex, i.uv).r - _Cutoff);
                SHADOW_CASTER_FRAGMENT(i)
            }
            ENDCG
        }
    }
}
