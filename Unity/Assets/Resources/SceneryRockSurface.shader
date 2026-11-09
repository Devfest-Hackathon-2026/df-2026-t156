Shader "Orbit/SceneryRockSurface"
{
    Properties
    {
        _MainTex ("Photographed rock", 2D) = "white" {}
        _BumpMap ("Photographed surface normal", 2D) = "bump" {}
        _BumpScale ("Normal strength", Float) = .75
        _RockOrigin ("Rock origin and variation", Vector) = (0,0,0,0)
        _RockSize ("Rock radius and height", Vector) = (1,1,0,0)
        _Passage ("Break-through rock", Float) = 0
        _Damage ("Break progress", Range(0,1)) = 0
        _HitCount ("Recorded contacts", Int) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 220
        CGPROGRAM
        #pragma target 3.0
        #pragma surface surf Standard fullforwardshadows
        sampler2D _MainTex, _BumpMap;
        float4 _RockOrigin, _RockSize;
        float4 _Hits[8], _HitNormals[8];
        float _BumpScale, _Damage, _Passage;
        int _HitCount;
        struct Input { float2 uv_MainTex; float3 worldPos; float3 worldNormal; INTERNAL_DATA };

        float Grain(float3 p)
        { return frac(sin(dot(p,float3(12.9898,78.233,34.53)))*43758.5453); }

        void surf(Input input, inout SurfaceOutputStandard output)
        {
            float3 photo=tex2D(_MainTex,input.uv_MainTex).rgb;
            float3 normal=UnpackNormal(tex2D(_BumpMap,input.uv_MainTex));
            normal.xy*=_BumpScale;
            float3 color=photo;
            float pit=0, rim=0, copper=0;
            float3 worldSlope=0;
            // Marks are cut into the original rock material, with no overlay
            // polygons. The early radius/depth checks keep most pixels cheap.
            for(int i=0;i<8;i++)
            {
                if(i>=_HitCount) break;
                float3 delta=input.worldPos-_Hits[i].xyz;
                float radius=.079+_Hits[i].w*.014;
                if(dot(delta,delta)>radius*radius*2.4) continue;
                float3 n=normalize(_HitNormals[i].xyz);
                float depth=dot(delta,n);
                if(abs(depth)>.048) continue;
                float3 axis=abs(n.y)>.92?float3(0,0,1):float3(0,1,0);
                float3 u=normalize(cross(n,axis)), v=cross(n,u);
                float2 q=float2(dot(delta,u),dot(delta,v));
                // Unequal cleavage faces, rather than a radial scallop or a
                // solid decal outline. Fine breakup comes from stone grains.
                float r=max(max(dot(q,float2(.96,.28))/.88,dot(q,float2(.31,.95))/.77),
                    max(max(dot(q,float2(-.79,.61))/.96,dot(q,float2(-.91,-.42))/.69),
                        max(dot(q,float2(-.12,-.99))/.88,dot(q,float2(.79,-.61))/.79)))/radius;
                float grain=Grain(floor(input.worldPos*235+_RockOrigin.w));
                r+=(grain-.5)*.065;
                float imprint=1-smoothstep(.92,1.04,r);
                float hollow=(1-smoothstep(.18,.84,r))*imprint;
                float lip=(smoothstep(.78,.87,r)-smoothstep(.94,1.01,r))*imprint;
                float fresh=(1-smoothstep(.19,.78,r))*(.46+grain*.44);
                // A small asymmetric fracture lip still carries the original
                // photo grain. It cannot turn into a beige paper disc.
                float litSide=saturate(.48+q.y/max(radius,.01)*.7-q.x/max(radius,.01)*.25);
                float3 rockLip=photo*(1.05+grain*.25)+float3(.035,.032,.025);
                color=lerp(color,photo*.50,lip*.48);
                color=lerp(color,photo*.75+float3(.045,.043,.036),hollow*.42);
                color=lerp(color,rockLip,fresh*litSide*.54);
                float fleck=step(.95,grain)*hollow*(1-smoothstep(.035,.052,abs(depth)));
                copper=max(copper,fleck);
                float branchA=abs(q.y*.55+q.x+sin(q.y*113)*.0017);
                float branchB=abs(q.y-q.x*.46-.011);
                float taper=saturate(1-r);
                float hairline=(1-smoothstep(.0008,.0025,min(branchA,branchB)))*imprint*taper;
                color*=1-hairline*.37;
                worldSlope-=(u*q.x+v*q.y)/max(radius,.01)*hollow*.18;
                pit=max(pit,hollow);rim=max(rim,lip);
            }
            color=lerp(color,float3(.56,.30,.11)+photo*.21,copper*.77);
            float3 p=(input.worldPos-_RockOrigin.xyz)/float3(max(.1,_RockSize.x),max(.1,_RockSize.y),max(.1,_RockSize.x));
            float seed=_RockOrigin.w;
            float fault=abs(p.x*.72+p.z*.55+sin(p.y*5+seed)*.10+sin(p.y*18+seed)*.012);
            float fork=abs(p.x*.31-p.z*.78+p.y*.32-.18+sin(p.y*9-seed)*.025);
            float taper=smoothstep(.08,.30,p.y)*(1-smoothstep(.74,.99,p.y));
            taper*=.57+.43*saturate(sin(p.y*19+seed)*.5+.5);
            float opening=(.0015+pow(saturate(_Damage),1.6)*.016)*taper/max(.1,_RockSize.x);
            float mainCut=(1-smoothstep(opening,opening+.0016,fault))*taper;
            float forkCut=(1-smoothstep(opening*.63,opening*.63+.0012,fork))*smoothstep(.28,.52,p.y)*taper;
            float split=max(mainCut,forkCut*.72)*_Passage;
            float border=(1-smoothstep(opening+.002,opening+.004,fault))*taper*_Passage-split;
            color=lerp(color,photo*.84+float3(.035,.031,.023),saturate(border)*.6);
            color*=1-split*(.54+_Damage*.2);
            float3 tangent=WorldNormalVector(input,float3(1,0,0));
            float3 bitangent=WorldNormalVector(input,float3(0,1,0));
            tangent*=rsqrt(max(dot(tangent,tangent),.000001));
            bitangent*=rsqrt(max(dot(bitangent,bitangent),.000001));
            normal.xy+=float2(dot(worldSlope,tangent),dot(worldSlope,bitangent));
            output.Albedo=color;
            output.Normal=normalize(normal);
            output.Metallic=copper*.55;
            output.Smoothness=lerp(.14,.31,copper);
            output.Occlusion=saturate(1-pit*.19-rim*.20-split*.34);
        }
        ENDCG
    }
    FallBack "Standard"
}
