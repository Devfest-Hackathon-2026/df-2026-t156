Shader "Orbit/ValleyOre"
{
    Properties
    {
        _MainTex ("Host rock", 2D) = "white" {}
        _BumpMap ("Host normal", 2D) = "bump" {}
        _Mineral ("Mineral", Color) = (.61,.34,.19,1)
        _Style ("Mineral family", Float) = 0
        _Height ("Authored rock height", Float) = 1.12
        _Deposit ("Seam origin and variation", Vector) = (0,0,0,0)
        _Weak ("Current fracture", Vector) = (0,0,0,0)
        _WeakRadius ("Authoritative fracture radius", Float) = .22
        _FractureTime ("Last fracture relocation", Float) = -10
        _Damage ("Rock damage", Range(0,1)) = 0
        _Active ("Ore present", Range(0,1)) = 1
        _Preview ("Public opening fracture", Range(0,1)) = 0
        _GoldLayer ("Authoritative gold layer", Float) = 0
        _GoldLayers ("Gold layers in exposure", Float) = 1
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 220
        CGPROGRAM
        #pragma target 3.0
        #pragma surface surf Standard fullforwardshadows
        sampler2D _MainTex, _BumpMap;
        fixed4 _Mineral;
        float4 _Deposit, _Weak;
        half _Damage, _Active, _Style, _Preview, _GoldLayer, _GoldLayers;
        float _WeakRadius, _FractureTime, _Height;

        struct Input { float2 uv_MainTex; float3 worldPos; float3 worldNormal; INTERNAL_DATA };
        float Grain(float3 p)
        {
            return frac(sin(dot(p, float3(12.9898,78.233,34.53))) * 43758.5453);
        }

        void surf(Input input, inout SurfaceOutputStandard output)
        {
            float3 p = input.worldPos - _Deposit.xyz;
            p.y *= 1.12 / max(.1,_Height);
            float seed = _Deposit.w;
            float seam = p.x * .71 + p.z * .92 + p.y * .38
                + sin(p.x * 8.4 + p.z * 5.2 + seed) * .075
                + sin(p.y * 24 + p.z * 31) * .022;
            float grit = Grain(floor(p * 37 + seed));
            float strata = 1 - smoothstep(.024, .088, abs(seam - .37));
            float splinter = 1 - smoothstep(.014, .047, abs(seam + .10 + p.z * .11));
            float exposed = smoothstep(.29,.91,p.y);
            float ore = saturate((strata + splinter * .57) * exposed * (.37 + grit * .54));
            float3 hit = input.worldPos - _Weak.xyz;
            // Every bright fracture fragment lies INSIDE the same 3-D sphere as
            // the server weak hit. Mineral bands below it are not aim markers.
            float focus = 1 - smoothstep(_WeakRadius*.62,_WeakRadius*.98,length(hit));
            float stem = dot(hit.xz,float2(.71,.71)) + sin(hit.z*38)*.009;
            float forkA = dot(hit.xz,float2(-.43,.90))+.026;
            float forkB = dot(hit.xz,float2(.96,-.28))-.034;
            float primary = 1-smoothstep(.006,.018,abs(stem));
            float forks = (1-smoothstep(.004,.012,abs(forkA)))*smoothstep(-.055,.025,hit.z)
                +(1-smoothstep(.004,.011,abs(forkB)))*(1-smoothstep(-.02,.075,hit.z));
            float fresh = saturate(primary+forks*.82)*focus;
            float darkEdge=(1-smoothstep(.017,.032,abs(stem)))*focus;
            float relocation=saturate(1-(_Time.y-_FractureTime)/.24)*step(_FractureTime,_Time.y);
            float incision = (1 - smoothstep(.009,.029,abs(seam - .42))) * exposed * _Damage;
            float3 normal=normalize(WorldNormalVector(input,float3(0,0,1)));
            float3 weights=pow(abs(normal),6);weights/=max(dot(weights,float3(1,1,1)),.001);
            float3 world=input.worldPos*1.65;
            float3 stone=tex2D(_MainTex,world.zy).rgb*weights.x
                +tex2D(_MainTex,world.xz).rgb*weights.y+tex2D(_MainTex,world.xy).rgb*weights.z;
            float3 fragment = lerp(_Mineral.rgb * .48, _Mineral.rgb * 1.19, grit);
            float oxidized = (1 - step(.5,_Style)) * smoothstep(.43,.78,grit);
            fragment = lerp(fragment, float3(.32,.47,.36), oxidized * .48);
            float diamond = step(4.5,_Style);
            float ruby = step(3.5,_Style)*(1-diamond);
            float gold = step(2.5,_Style) * (1-ruby)*(1-diamond);
            // Broad real mineral faces survive at a distance; fine branching
            // seams and the small bright fracture remain close-up aim cues.
            float broadBand=1-smoothstep(.12,.29,abs(seam-.22));
            float silver=step(.5,_Style)*(1-step(1.5,_Style));
            float crystal=step(1.5,_Style)*(1-gold);
            ore=max(ore,broadBand*exposed*(.66+grit*.25)*(1-gold));
            float crownGrain=smoothstep(-.35,.45,sin(p.x*13+seed)*sin(p.z*17-seed*.7));
            ore=max(ore,smoothstep(.72,.95,p.y)*(silver*.48+crystal*.73)*(.34+crownGrain*.66));
            float quartz = step(1.5,_Style) * (1 - gold);
            // Garnet grows as compact red facets rather than a continuous
            // painted stripe. The pale moving fracture remains the aim cue.
            float3 gemPoint=p*float3(6.1,8.7,5.3)+float3(seed,0,seed*.7);
            gemPoint+=float3(sin(p.z*7+seed),sin(p.x*9),sin(p.y*11))*.22;
            float3 cell=floor(gemPoint);
            float gemSeed=Grain(cell);
            float3 inCell=frac(gemPoint)-.5;
            float gemEdge=abs(inCell.x)+abs(inCell.y)*.65+abs(inCell.z);
            float gems=(1-smoothstep(.34,.50,gemEdge))*step(.68,gemSeed)*exposed;
            ore=lerp(ore,max(gems,strata*exposed*.25),ruby);
            float diamondFace = max(broadBand*.65, smoothstep(.62,.93,p.y)) * exposed;
            ore=lerp(ore,diamondFace*(.55+grit*.45),diamond);
            float facet=step(inCell.x+inCell.z,0)*.28+step(inCell.y-inCell.z,0)*.23;
            fragment=lerp(fragment,_Mineral.rgb*(.35+facet*.65),ruby);
            fragment=lerp(fragment,lerp(float3(.36,.68,.76),float3(.90,.98,1),facet),diamond);
            quartz*=1-ruby;
            float hostValue=dot(stone,float3(.299,.587,.114));
            float3 quartzMatrix=hostValue*float3(.86,.88,.90)+float3(.17,.165,.15);
            stone=lerp(stone,quartzMatrix,gold*_Active*.65);
            float layers = smoothstep(.2,.82,sin(p.x * 88 - p.z * 42 + p.y * 46) * .5 + .5);
            fragment = lerp(fragment, lerp(fragment,float3(.50,.44,.57),layers), quartz * .35);
            // The rare seam exposes branching native gold in pale quartz, following the host rock.
            float goldRibbon = 1 - smoothstep(.012,.042,abs(seam - .32 + sin(p.y * 13) * .038));
            float goldBranch = 1 - smoothstep(.009,.025,abs(seam + .13 + p.y * .28));
            float layered = step(1.5,_GoldLayers) * gold;
            float core = step(1.5,_GoldLayer) * layered;
            // The first thin outer seam leaves a chipped quartz lip. The deeper
            // continuous seam is exposed immediately, in this same piece of rock.
            float coreRibbon = 1 - smoothstep(.010,.037,abs(seam + .035 + sin(p.y * 17) * .018));
            // Exposed bands continue around the visible side of the worked
            // face. The old diagonal seam alone could fall entirely behind it.
            float flank=1-smoothstep(.55,.87,abs(normal.y));
            float outerHeight=.77+sin(p.x*4.1+p.z*3.3+seed)*.075+sin(p.z*15+p.x*9)*.014;
            float coreHeight=.53+sin(p.z*5.2-p.x*2.7+seed)*.09;
            float around=atan2(p.z,p.x);
            float pinch=sin(around*3+seed)+sin(around*7-seed*.7)*.48;
            float width=lerp(.028,.11,smoothstep(-.65,.95,pinch));
            float cluster=smoothstep(-.18,.28,sin(around*5+seed)*.68+sin(around*11-seed)*.32);
            float granular=smoothstep(.12,.64,grit);
            float outerFlank=(1-smoothstep(width,width*1.55+.006,abs(p.y-outerHeight)))*flank*cluster*granular;
            float coreFlank=(1-smoothstep(width*.85,width*1.45+.007,abs(p.y-coreHeight)))*flank*cluster*granular;
            float currentHeight=lerp(outerHeight,coreHeight,core);
            float rise=p.y-currentHeight;
            float veinBranch=(1-smoothstep(.035,.12,abs(sin(around*6+p.y*9+seed))))
                *smoothstep(.012,.055,rise)*(1-smoothstep(.17,.27,rise))*flank*cluster;
            float flecks=smoothstep(.89,.97,grit)*(1-smoothstep(.04,.12,abs(rise)))*flank;
            float flankQuartz=(1-smoothstep(.045+width,.085+width*1.8,abs(rise)))*flank*(.5+cluster*.5);
            flankQuartz=max(flankQuartz,veinBranch*.84);
            float surfaceOre = (goldRibbon + goldBranch * .46) * smoothstep(.52,.92,p.y);
            float mainOre = (coreRibbon + goldBranch * .22) * smoothstep(.28,.73,p.y);
            surfaceOre=max(surfaceOre,outerFlank+veinBranch*(1-core)*.58+flecks*.33);
            mainOre=max(mainOre,coreFlank+veinBranch*core*.62+flecks*.36);
            float layeredOre = lerp(surfaceOre,mainOre,core);
            float goldOre = saturate(lerp((goldRibbon + goldBranch * .66) * exposed,
                layeredOre,layered) * (.58 + grit * .42));
            ore = lerp(ore,goldOre,gold);
            fragment = lerp(fragment,lerp(float3(.62,.36,.07),float3(.98,.76,.29),grit),gold);
            float3 quartzHost = lerp(stone,stone * .54 + float3(.40,.37,.30),
                (strata * .40 + splinter * .60) * exposed * gold * _Active);
            quartzHost=lerp(quartzHost,stone*.45+float3(.36,.34,.28),flankQuartz*gold*_Active*.65);
            float brokenLip = (1 - smoothstep(.045,.12,abs(seam - .32))) * exposed * core;
            brokenLip=max(brokenLip,outerFlank*core*.62);
            quartzHost = lerp(quartzHost,quartzHost * .49 + float3(.13,.12,.095),brokenLip);
            // A retained dark crack makes the layer change read as material lost,
            // rather than an intact second boulder regenerating at full HP.
            float retainedCut = goldRibbon * exposed * core;
            stone = quartzHost * (1 - retainedCut * .39);
            float3 worn = lerp(stone, stone * float3(.86,.79,.69) + float3(.055,.045,.026), ore * .78);
            float3 mineral = lerp(worn, fragment, ore * _Active);
            mineral *= 1-darkEdge*_Active*.46;
            float3 fractureLip=lerp(float3(.86,.84,.76),float3(.89,.87,.94),quartz);
            fractureLip=lerp(fractureLip,float3(.93,.86,.66),gold);
            mineral=lerp(mineral,fractureLip,fresh*_Active*(.88+relocation*.12));
            float previewCrack = goldRibbon * exposed * gold * _Preview;
            mineral = lerp(mineral,stone * .42,previewCrack * .66);
            // Damage remains as opened, non-emissive faults in the host rock.
            // These broad cuts record progress; only the small white fracture
            // inside the authoritative weak sphere is a precision aim cue.
            float worked=max(saturate(_Damage),core*.34);
            float faultA=abs(seam-.23+sin(p.y*7+seed)*.035);
            float faultB=abs(p.y*.63+p.x*.39-p.z*.74-.31+sin(p.x*11)*.022);
            float faultC=abs(p.y*.57-p.x*.52-p.z*.28-.22+sin(p.z*14)*.018);
            float splitDistance=min(faultA,min(faultB,faultC));
            float splitWidth=.002+worked*.024;
            float opened=(1-smoothstep(splitWidth,splitWidth+.009,splitDistance))*smoothstep(.02,.88,worked);
            float cutRim=(1-smoothstep(splitWidth+.009,splitWidth+.025,splitDistance))*worked-opened;
            mineral=lerp(mineral,stone*.70+float3(.035,.032,.026),saturate(cutRim)*.7);
            mineral*=1-opened*.73;
            output.Albedo = mineral * (1 - incision * .57);
            float3 nx=UnpackNormal(tex2D(_BumpMap,world.zy));
            float3 ny=UnpackNormal(tex2D(_BumpMap,world.xz));
            float3 nz=UnpackNormal(tex2D(_BumpMap,world.xy));
            nx=float3(nx.z*sign(normal.x),nx.y,nx.x);
            ny=float3(ny.x,ny.z*sign(normal.y),ny.y);
            nz=float3(nz.x,nz.y,nz.z*sign(normal.z));
            float3 mapped=normalize(lerp(normal,normalize(nx*weights.x+ny*weights.y+nz*weights.z),.68));
            float3 tangent=normalize(WorldNormalVector(input,float3(1,0,0)));
            float3 bitangent=normalize(WorldNormalVector(input,float3(0,1,0)));
            output.Normal=float3(dot(mapped,tangent),dot(mapped,bitangent),dot(mapped,normal));
            output.Metallic = ore * _Active * lerp(lerp(.39,.12,quartz),.68,gold)*(1-fresh);
            output.Smoothness = lerp(.16 + ore*_Active*lerp(lerp(.29,.18,quartz),.39,gold),.18,fresh*_Active);
            output.Emission = fractureLip*fresh*_Active*(.035+relocation*.045) + float3(.12,.09,.035)*previewCrack*.11;
            output.Emission += _Mineral.rgb*ore*_Active*(gold*.72+diamond*.10);
            output.Occlusion = saturate(1 - incision * .35 - brokenLip * .20 - opened*.38);
        }
        ENDCG
    }
    FallBack "Diffuse"
}
