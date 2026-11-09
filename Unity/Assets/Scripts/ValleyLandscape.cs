using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

// Rendering follows the authoritative valley grid. Gameplay remains in OrbitGame/server.
public static partial class ValleyLandscape {
 [Serializable] class Map { public float originX,originZ,cellSize,boundary;public int columns,rows;public float[] heights;public Obstacle[] colliders,deposits;public Gate gate;public Gate[] stations; }
 [Serializable] class Obstacle {public string id,kind;public float x,z,radius,height;}
 [Serializable] class Gate {public float x,z,radius;}
 static Map map;static Transform root;static Material earth,stone,bark,wood,needles,plants,roof,iron;
 static MeshPack trunks,herbs,smallStone,boards,metal,roofing;
 static ChunkMeshes barkChunks, canopyChunks, distantCanopyChunks, grassChunks;static Material grassMaterial;
 static readonly Vector2[] trail={new Vector2(-8,-56),new Vector2(-5,-38),new Vector2(3,-22),new Vector2(0,0),new Vector2(4,18),new Vector2(-2,35),new Vector2(7,57)};
 static void Load(){if(map!=null)return;var t=Resources.Load<TextAsset>("valley");if(!t)throw new InvalidOperationException("Resources/valley.json is required");map=JsonUtility.FromJson<Map>(t.text);if(map.heights==null||map.heights.Length!=map.columns*map.rows)throw new InvalidOperationException("Invalid valley height grid");}
 public static float Height(float x,float z){Load();float gx=Mathf.Clamp((x-map.originX)/map.cellSize,0,map.columns-1),gz=Mathf.Clamp((z-map.originZ)/map.cellSize,0,map.rows-1);int ix=Mathf.Min(Mathf.FloorToInt(gx),map.columns-2),iz=Mathf.Min(Mathf.FloorToInt(gz),map.rows-2);float tx=gx-ix,tz=gz-iz;return Mathf.Lerp(Mathf.Lerp(map.heights[iz*map.columns+ix],map.heights[iz*map.columns+ix+1],tx),Mathf.Lerp(map.heights[(iz+1)*map.columns+ix],map.heights[(iz+1)*map.columns+ix+1],tx),tz);}
 static float Noise(float x,float z){return Mathf.PerlinNoise(x+213.2f,z+79.8f);}
 static float VisualHeight(float x,float z) {
  float square=Mathf.Max(Mathf.Abs(x),Mathf.Abs(z));
  float edge=Height(x,z);
  if(square<=60)return edge;
  var point=new Vector2(x,z);
  float d=Mathf.Lerp(square,point.magnitude*.90f,Mathf.SmoothStep(0,1,(square-64)/88));
  float a=Mathf.Atan2(z,x);
  // The playable surface ends before this blend. Broad ridges turn gradually into broken granite.
  float warp=Noise(x*.013f,z*.013f)-.5f;
  float ridgeWave=.47f+Mathf.Sin(a*3+.9f+warp*.72f)*.23f+Mathf.Sin(a*5-1.4f)*.16f;
  float ridge=30+Mathf.SmoothStep(0,1,ridgeWave)*52+warp*21;
  float shoulder=Mathf.SmoothStep(0,1,(d-60)/74);
  float far=Mathf.SmoothStep(0,1,(d-115)/115);
  float erosion=(Noise(x*.055f,z*.055f)-.5f)*7+(Noise(x*.112f,z*.112f)-.5f)*2.2f;
  return Mathf.Lerp(edge,ridge,shoulder)+far*(35+24*Mathf.Sin(a*4-.9f))+erosion*shoulder;
 }
 static Material Surface(string tex,Color tint,float scale){var m=new Material(Resources.Load<Shader>("ValleySurface"));m.SetTexture("_MainTex",Resources.Load<Texture2D>("Valley/"+tex)??Texture2D.whiteTexture);m.SetTexture("_RockTex",Resources.Load<Texture2D>("Valley/Rock"));var normal=Resources.Load<Texture2D>("Valley/"+tex+"Normal");if(normal)m.SetTexture("_BumpMap",normal);m.SetColor("_Color",tint);m.SetFloat("_Scale",scale);return m;}
 public static void Build(){
  Load();var previous=GameObject.Find("ValleyLandscape");if(previous){if(Application.isPlaying)UnityEngine.Object.Destroy(previous);else UnityEngine.Object.DestroyImmediate(previous);}
  root=new GameObject("ValleyLandscape").transform;
  earth=Surface("Ground",Color.white,.35f);earth.SetFloat("_Terrain",1);stone=Surface("Rock",new Color(.88f,.89f,.91f),.48f);bark=Surface("Bark",new Color(.83f,.82f,.76f),.55f);wood=Surface("Wood",new Color(.81f,.77f,.65f),.55f);
  plants=Surface("",Color.white,1);roof=Surface("Bark",new Color(.39f,.42f,.39f),.4f);iron=Surface("",new Color(.21f,.23f,.2f),1);
  needles=new Material(Resources.Load<Shader>("ValleyFoliage"));needles.SetTexture("_MainTex",Resources.Load<Texture2D>("Valley/Needles"));needles.SetTexture("_AlphaTex",Resources.Load<Texture2D>("Valley/NeedlesAlpha"));needles.SetColor("_Color",new Color(.9f,.97f,.83f));
  grassMaterial=new Material(needles);grassMaterial.SetTexture("_MainTex",Resources.Load<Texture2D>("Valley/Grass"));grassMaterial.SetTexture("_AlphaTex",Resources.Load<Texture2D>("Valley/GrassAlpha"));grassMaterial.SetColor("_Color",new Color(1.15f,1.15f,1.08f));grassMaterial.SetFloat("_Cutoff",.3f);grassChunks=new ChunkMeshes(20);barkChunks=new ChunkMeshes(32);canopyChunks=new ChunkMeshes(24);distantCanopyChunks=new ChunkMeshes(32);trunks=new MeshPack();herbs=new MeshPack();smallStone=new MeshPack();boards=new MeshPack();metal=new MeshPack();roofing=new MeshPack();
  BindEastHaulWear();Environment();Ground();
  int index=0;foreach(var c in map.colliders){if(c.id.StartsWith("shed-post"))continue;var p=new Vector3(c.x,Height(c.x,c.z),c.z);if(c.kind=="rock")Boulder(p,c.radius,c.height,index++,c.id);else if(c.kind=="tree"||c.kind=="trunk")Tree(p,c.radius,c.height*1.7f,index++);}
  // Forest stands enclose the playable valley; there are no unlisted solid trunks inside it.
  ForestStands();
  Undergrowth();EastHaulGravel();Cabin();CliffLedges();
  trunks.Emit("Shed bracing",bark);barkChunks.Emit("Bark and branches",bark);canopyChunks.Emit("Pine needle canopy",needles);distantCanopyChunks.Emit("Far pine needle canopy",needles,false);herbs.Emit("Meadow and trail plants",plants,false);grassChunks.Emit("Uneven meadow grass tufts",grassMaterial,false);smallStone.Emit("Talus and path gravel",stone);boards.Emit("Delivery hut timbers",wood);metal.Emit("Hut ironwork",iron);roofing.Emit("Weathered shingle roof",roof);
 }
 static void Environment(){
  RenderSettings.fog=true;RenderSettings.fogMode=FogMode.ExponentialSquared;RenderSettings.fogColor=new Color(.63f,.72f,.74f);RenderSettings.fogDensity=.0037f;
  RenderSettings.ambientMode=AmbientMode.Trilight;RenderSettings.ambientSkyColor=new Color(.60f,.69f,.78f);RenderSettings.ambientEquatorColor=new Color(.44f,.46f,.40f);RenderSettings.ambientGroundColor=new Color(.19f,.21f,.16f);RenderSettings.ambientIntensity=1;
  var sunObj=new GameObject("Afternoon mountain sun");sunObj.transform.SetParent(root);sunObj.transform.rotation=Quaternion.Euler(37,-47,0);var sun=sunObj.AddComponent<Light>();sun.type=LightType.Directional;sun.color=new Color(1,.93f,.79f);sun.intensity=1.15f;sun.shadows=LightShadows.Soft;sun.shadowStrength=.80f;sun.shadowBias=.025f;sun.shadowNormalBias=.2f;RenderSettings.sun=sun;
  QualitySettings.shadows=ShadowQuality.All;QualitySettings.shadowDistance=65;QualitySettings.shadowCascades=0;QualitySettings.shadowResolution=ShadowResolution.Medium;
  var sky=new Material(Resources.Load<Shader>("ValleySky"));sky.SetVector("_SunDirection",-sunObj.transform.forward);RenderSettings.skybox=sky;
 }
 static float SegmentDistance(Vector2 p, Vector2 a, Vector2 b) {
  Vector2 segment=b-a;
  float t=Mathf.Clamp01(Vector2.Dot(p-a,segment)/segment.sqrMagnitude);
  return Vector2.Distance(p,a+t*segment);
 }
 static float TrailDistance(float x,float z) {
  var p=new Vector2(x,z);float distance=float.MaxValue;
  for(int i=1;i<trail.Length;i++)distance=Mathf.Min(distance,SegmentDistance(p,trail[i-1],trail[i]));
  distance=Mathf.Min(distance,SegmentDistance(p,new Vector2(-31,1),new Vector2(-14,-3)));
  distance=Mathf.Min(distance,SegmentDistance(p,new Vector2(-14,-3),Vector2.zero));
  distance=Mathf.Min(distance,SegmentDistance(p,Vector2.zero,new Vector2(16,7)));
  return Mathf.Min(distance,SegmentDistance(p,new Vector2(16,7),new Vector2(31,2)));
 }
 static float YardDistance(float x,float z) {
  float distance=float.MaxValue;
  foreach(var station in map.stations) {
   float dx=x-station.x,dz=z-station.z;
   distance=Mathf.Min(distance,Mathf.Sqrt(dx*dx+dz*dz)-station.radius);
  }
  return distance;
 }
 static Color GroundColor(float x,float z) {
  float n=Noise(x*.12f,z*.12f),d=TrailDistance(x,z);
  float meadow=Mathf.SmoothStep(0,1,(d-.85f)/2.8f);
  Color grass=Color.Lerp(new Color(.40f,.48f,.28f),new Color(.78f,.79f,.53f),n);
  Color dirt=Color.Lerp(new Color(.70f,.65f,.50f),new Color(.97f,.91f,.75f),Noise(x*.39f,z*.39f));
  float yard=Mathf.SmoothStep(0,1,(YardDistance(x,z)+.8f)/2.7f);
  Color floor=Color.Lerp(dirt,grass,meadow*yard);
  return EastHaulGround(x,z,floor);
 }
 static void ForestStands() {
  var rng=new System.Random(7401);
  const int stands=17;
  for(int group=0;group<stands;group++) {
   float heading=(group+(float)rng.NextDouble()*.68f)*Mathf.PI*2/stands;
   float radius=84+(float)rng.NextDouble()*32;
   Vector2 center=new Vector2(Mathf.Cos(heading),Mathf.Sin(heading))*radius;
   int trees=6+rng.Next(4);
   for(int i=0;i<trees;i++) {
    float angle=(float)rng.NextDouble()*Mathf.PI*2;
    float spread=4+Mathf.Sqrt((float)rng.NextDouble())*23;
    float x=center.x+Mathf.Cos(angle)*spread,z=center.y+Mathf.Sin(angle)*spread;
    if(Mathf.Max(Mathf.Abs(x),Mathf.Abs(z))<61)continue;
    float age=(float)rng.NextDouble();
    Tree(new Vector3(x,VisualHeight(x,z)-.25f,z),.19f+age*.30f,8+age*16,group*23+i+70);
   }
  }
 }
 static void Ground(){
  const int count=105;const float size=130;var v=new Vector3[count*count];var uv=new Vector2[v.Length];var colors=new Color[v.Length];var tris=new int[(count-1)*(count-1)*6];int ti=0;
  for(int z=0;z<count;z++)for(int x=0;x<count;x++){float xx=-65+x*size/(count-1),zz=-65+z*size/(count-1);int k=z*count+x;v[k]=new Vector3(xx,VisualHeight(xx,zz),zz);uv[k]=new Vector2(xx,zz);colors[k]=GroundColor(xx,zz);if(x<count-1&&z<count-1){tris[ti++]=k;tris[ti++]=k+count;tris[ti++]=k+1;tris[ti++]=k+1;tris[ti++]=k+count;tris[ti++]=k+count+1;}}
  var mesh=new Mesh{name="Authoritative valley surface"};mesh.vertices=v;mesh.uv=uv;mesh.colors=colors;mesh.triangles=tris;mesh.RecalculateNormals();mesh.RecalculateBounds();MeshObject("Valley floor",mesh,earth);
  DistantTerrain();
 }
 static void DistantTerrain() {
  const int sectors=160, rings=32;
  var positions=new Vector3[sectors*(rings+1)];
  var uv=new Vector2[positions.Length];
  var tint=new Color[positions.Length];
  var normals=new Vector3[positions.Length];
  var triangles=new int[sectors*rings*6];int next=0;
  for(int ring=0;ring<=rings;ring++) {
   float radius=65+ring*8.8f;
   for(int i=0;i<sectors;i++) {
    float angle=i*Mathf.PI*2/sectors;
    var direction=new Vector2(Mathf.Cos(angle),Mathf.Sin(angle));
    float square=Mathf.Max(Mathf.Abs(direction.x),Mathf.Abs(direction.y));
    Vector2 point=direction*(radius/square);
    float x=point.x,z=point.y,y=VisualHeight(x,z);
    int k=ring*sectors+i;
    positions[k]=new Vector3(x,y,z);
    uv[k]=point*.15f;
    var n=new Vector3(VisualHeight(x-.65f,z)-VisualHeight(x+.65f,z),1.3f,
     VisualHeight(x,z-.65f)-VisualHeight(x,z+.65f)).normalized;
    normals[k]=n;
    float seams=Noise(x*.033f,z*.033f)*.72f+Noise(x*.11f,z*.11f)*.28f;
    float weathered=Noise(x*.015f+z*.009f,z*.022f);
    Color granite=Color.Lerp(new Color(.50f,.53f,.55f),new Color(.96f,.98f,1.01f),weathered);
    Color scree=Color.Lerp(new Color(.53f,.49f,.41f),new Color(.76f,.70f,.58f),seams);
    Color alpine=Color.Lerp(new Color(.42f,.51f,.34f),new Color(.70f,.73f,.51f),seams);
    float ledge=Mathf.SmoothStep(0,1,(.92f-n.y)*2.2f+seams*.49f);
    float plants=Mathf.SmoothStep(0,1,(.70f-seams)*2.5f)*(1-Mathf.SmoothStep(17,48,y))*n.y;
    var mountain=Color.Lerp(Color.Lerp(scree,granite,ledge),alpine,plants*.82f);
    mountain=Color.Lerp(mountain,new Color(.68f,.76f,.83f),Mathf.SmoothStep(0,1,(radius-115)/155)*.70f);
    tint[k]=Color.Lerp(GroundColor(x,z),mountain,Mathf.SmoothStep(0,1,ring/3f));
    if(ring==rings)continue;
    int neighbor=ring*sectors+(i+1)%sectors;
    triangles[next++]=k;triangles[next++]=neighbor;triangles[next++]=neighbor+sectors;
    triangles[next++]=k;triangles[next++]=neighbor+sectors;triangles[next++]=k+sectors;
   }
  }
  var mesh=new Mesh{name="Granite ridges and scree"};
  mesh.vertices=positions;mesh.uv=uv;mesh.colors=tint;mesh.normals=normals;mesh.triangles=triangles;
  mesh.RecalculateBounds();
  var material=Surface("Rock",Color.white,.125f);
  material.SetFloat("_NormalStrength",.26f);
  MeshObject("Granite ridges and scree",mesh,material,false);
 }
 static GameObject MeshObject(string name,Mesh mesh,Material mat,bool shadows=true){if(mat.shader.name=="Orbit/ValleySurface")mesh.RecalculateTangents();var go=new GameObject(name);go.transform.SetParent(root,false);go.AddComponent<MeshFilter>().sharedMesh=mesh;var mr=go.AddComponent<MeshRenderer>();mr.sharedMaterial=mat;mr.shadowCastingMode=shadows?ShadowCastingMode.On:ShadowCastingMode.Off;mr.receiveShadows=true;return go;}
 internal static readonly Dictionary<string,Transform> SceneryRocks=new Dictionary<string,Transform>();
 static void Boulder(Vector3 p,float radius,float height,int seed,string id){ if(ScannedBoulder(p,radius,height,seed,null,id))return;
  var mesh=new MeshPack();const int n=13;var rng=new System.Random(seed*197+23);float rot=(float)rng.NextDouble()*6.28f;var rings=new Vector3[5,n];
  for(int j=0;j<5;j++)for(int i=0;i<n;i++){float a=i*6.28318f/n+rot;float shape=new[]{.92f,1f,.94f,.86f,.57f}[j];float rr=radius*(.88f+.12f*Noise(i*1.7f,seed*.2f))*shape;float y=j*height/4;if(j>0)y+=Mathf.Sin(i*1.9f+j+seed)*height*(j==4?.1f:.075f);rings[j,i]=p+new Vector3(Mathf.Cos(a)*rr+Mathf.Sin(seed)*radius*j*.025f,y-.12f,Mathf.Sin(a)*rr);}
  for(int j=0;j<4;j++)for(int i=0;i<n;i++){int k=(i+1)%n;Color c=Color.Lerp(new Color(.72f,.73f,.73f),Color.white,j/4f);mesh.Quad(rings[j,i],rings[j+1,i],rings[j+1,k],rings[j,k],c);}for(int i=0;i<n;i++)mesh.Tri(rings[4,(i+1)%n],rings[4,i],p+Vector3.up*(height-.03f),new Color(.9f,.9f,.86f));mesh.Emit("Weathered outcrop "+seed,stone);
  // Low chips are visual dressing below capsule height, not extra unregistered boulders.
  for(int i=0;i<8;i++){float a=rot+i*.78f;var q=p+new Vector3(Mathf.Cos(a),0,Mathf.Sin(a))*(radius+.2f+(float)rng.NextDouble()*.6f);q.y=Height(q.x,q.z);Pebble(q,.16f+(float)rng.NextDouble()*.18f,smallStone);}
 }
 static Mesh scannedRock;static Material scannedRockMaterial;
 internal static Transform DepositRock(Transform parent,float radius,float height,int seed){
  ScannedBoulder(parent.position,radius,height,seed,parent);
  return parent.childCount>0?parent.GetChild(0).GetChild(0):null;
 }
 static bool ScannedBoulder(Vector3 p,float radius,float height,int seed,Transform parent=null,string sceneryId=null){
  if(!scannedRock){var choices=Resources.LoadAll<Mesh>("Valley/Boulder");foreach(var mesh in choices)if(!scannedRock||mesh.vertexCount<scannedRock.vertexCount)scannedRock=mesh;}
  if(!scannedRock)return false;
  if(!scannedRockMaterial){scannedRockMaterial=new Material(Shader.Find("Standard"));scannedRockMaterial.mainTexture=Resources.Load<Texture2D>("Valley/Boulder");scannedRockMaterial.SetTexture("_BumpMap",Resources.Load<Texture2D>("Valley/BoulderNormal"));scannedRockMaterial.EnableKeyword("_NORMALMAP");scannedRockMaterial.SetFloat("_BumpScale",.75f);scannedRockMaterial.SetFloat("_Glossiness",.14f);}
  var bounds=scannedRock.bounds;
  float sink=height*.35f;
  if(!parent) {
   float low=p.y;
   for(int i=0;i<8;i++) {
    float angle=i*Mathf.PI*.25f;
    low=Mathf.Min(low,Height(p.x+Mathf.Cos(angle)*radius*.78f,p.z+Mathf.Sin(angle)*radius*.78f));
   }
   sink=Mathf.Max(sink,p.y-low+height*.19f);
  }
  var pivot=new GameObject("Scanned outcrop "+seed);
  pivot.transform.SetParent(parent?parent:root,false);
  pivot.transform.position=p-Vector3.up*sink;
  pivot.transform.rotation=Quaternion.Euler(0,seed*79,0);
  float scale=radius/Mathf.Max(bounds.extents.x,bounds.extents.z);
  pivot.transform.localScale=new Vector3(scale,(height+sink)/bounds.size.y,scale);
  if(sceneryId!=null)SceneryRocks[sceneryId]=pivot.transform;
  var go=new GameObject("Eroded rock surface");
  go.transform.SetParent(pivot.transform,false);
  go.transform.localPosition=new Vector3(-bounds.center.x,-bounds.min.y,-bounds.center.z);
  go.AddComponent<MeshFilter>().sharedMesh=scannedRock;
  go.AddComponent<MeshRenderer>().sharedMaterial=scannedRockMaterial;
  if(parent){QuarriedCrown(go.GetComponent<MeshFilter>(),parent.position,radius,height);return true;}
  for(int i=0;i<6;i++){float a=i*1.047f+seed;var q=p+new Vector3(Mathf.Cos(a),0,Mathf.Sin(a))*(radius+.12f);q.y=Height(q.x,q.z);Pebble(q,.12f+(i%3)*.08f,smallStone);}return true;
 }
 static void CliffLedges(){
  var meshes=Resources.LoadAll<Mesh>("Valley/RockFace");
  if(meshes.Length==0)return;
  var mesh=meshes[0];var bounds=mesh.bounds;
  var material=Surface("RockFace",new Color(.85f,.86f,.83f),.25f);
  material.SetFloat("_UseVertexTint",0);
  for(int i=0;i<9;i++) {
   // The southeast slab exposes the scan cut from the starter approach.
   if(i==7)continue;
   float a=(i+.35f+Mathf.Sin(i*23.8f)*.23f)*6.28318f/9;
   float radius=81+(i%3)*11,width=23+i%3*6,height=11+i%4*2.7f;
   Vector2 outward=new Vector2(Mathf.Cos(a),Mathf.Sin(a));
   Vector2 side=new Vector2(-outward.y,outward.x);
   Vector2 center=outward*radius;
   float previous=VisualHeight(center.x,center.y)-10.5f;
   float bottom=previous;
   // The cliff front overhangs the downslope side. Ground that face across its width.
   for(int j=-2;j<=2;j++) {
    Vector2 foot=center-outward*5.5f+side*(width*j*.20f);
    bottom=Mathf.Min(bottom,VisualHeight(foot.x,foot.y)-height*.52f);
   }
   var pivot=new GameObject("Folded rock ledge "+i);
   pivot.transform.SetParent(root,false);
   pivot.transform.position=new Vector3(center.x,bottom,center.y);
   pivot.transform.rotation=Quaternion.Euler(0,-a*Mathf.Rad2Deg-90,0);
   pivot.transform.localScale=new Vector3(width/bounds.size.x,(height+(previous-bottom)*.36f)/bounds.size.y,14/bounds.size.z);
   var go=new GameObject("Stratified cliff surface");
   go.transform.SetParent(pivot.transform,false);
   go.transform.localPosition=new Vector3(-bounds.center.x,-bounds.min.y,-bounds.center.z);
   go.AddComponent<MeshFilter>().sharedMesh=mesh;
   go.AddComponent<MeshRenderer>().sharedMaterial=material;
  }
 }
 static void Tube(MeshPack bag,Vector3 a,Vector3 b,float ra,float rb,Color color,int sides=8){Vector3 axis=(b-a).normalized;Vector3 u=Vector3.Cross(axis,Mathf.Abs(axis.y)>.9f?Vector3.right:Vector3.up).normalized,v=Vector3.Cross(axis,u);for(int i=0;i<sides;i++){float x=i*6.28318f/sides,y=(i+1)*6.28318f/sides;Vector3 q=u*Mathf.Cos(x)+v*Mathf.Sin(x),r=u*Mathf.Cos(y)+v*Mathf.Sin(y);bag.Quad(a+q*ra,a+r*ra,b+r*rb,b+q*rb,color,new Vector2(i/(float)sides,0),new Vector2((i+1)/(float)sides,0),new Vector2((i+1)/(float)sides,Vector3.Distance(a,b)),new Vector2(i/(float)sides,Vector3.Distance(a,b)));}}
 static void Tree(Vector3 p,float radius,float height,int seed) {
  bool distant=Mathf.Max(Mathf.Abs(p.x),Mathf.Abs(p.z))>60;
  var treeBark=barkChunks.At(p);
  var treeCanopy=(distant?distantCanopyChunks:canopyChunks).At(p);
  var rng=new System.Random(787+seed*71);
  float Rand()=> (float)rng.NextDouble();
  float rotation=Rand()*Mathf.PI*2;
  Vector3 lean=new Vector3(Mathf.Cos(rotation),0,Mathf.Sin(rotation))*height*(.019f+Rand()*.038f);
  Vector3 Axis(float t)=>p+Vector3.up*(t*height)+lean*(t*t);
  Vector3 foot=Axis(0)-Vector3.up*.17f;
  Tube(treeBark,foot,Axis(.46f),radius,radius*.55f,Color.white,distant?8:10);
  Tube(treeBark,Axis(.46f),Axis(.79f),radius*.55f,radius*.24f,Color.white,8);
  Tube(treeBark,Axis(.79f),Axis(1),radius*.24f,.017f,Color.white,6);
  if(!distant) {
   for(int j=0;j<4;j++) {
    float a=rotation+j*1.58f+Rand()*.44f;
    Vector3 tip=p+new Vector3(Mathf.Cos(a),0,Mathf.Sin(a))*radius*(1.6f+Rand()*.52f);
    tip.y=Height(tip.x,tip.z)-.055f;
    Tube(treeBark,p+Vector3.up*radius*.65f,tip,radius*.22f,.028f,new Color(.77f,.76f,.70f),5);
   }
  }

  int branches=(distant?18:30)+rng.Next(distant?7:9);
  float bare=.20f+Rand()*.13f;
  float crownScale=.78f+Rand()*.42f;
  float windward=rotation+1.3f;
  Color shade=new Color(.70f,.77f,.61f), tipTint=new Color(.91f,.98f,.80f);
  for(int j=0;j<branches;j++) {
   // One spiralling branch at a time, with gaps, off-centre tips and a continuous crown.
   // Last-branch jitter can exceed one; fractional Pow(1-t) would create NaNs.
   float t=Mathf.Clamp01((j+.3f+Rand()*.9f)/branches);
   float y=Mathf.Lerp(bare,.98f,t);
   float heading=rotation+j*2.399963f+(Rand()-.5f)*.85f;
   Vector3 radial=new Vector3(Mathf.Cos(heading),0,Mathf.Sin(heading));
   Vector3 side=Vector3.Cross(radial,Vector3.up);
   float aspect=.82f+.23f*Mathf.Cos(heading-windward);
   float taper=Mathf.Pow(1-t,.83f);
   float length=height*(.018f+.24f*taper)*crownScale*aspect*(.69f+Rand()*.55f);
   Vector3 from=Axis(y);
   float down=length*(.16f+Rand()*.17f)*(1-t);
   Vector3 elbow=from+radial*(length*.57f)+side*(length*(Rand()-.5f)*.18f)-Vector3.up*down;
   Vector3 end=elbow+radial*(length*.43f)+side*(length*(Rand()-.5f)*.35f)+Vector3.up*(length*(.09f+Rand()*.23f));
   float stem=radius*(.10f+.11f*taper);
   Tube(treeBark,from,elbow,stem,stem*.47f,Color.white,distant?4:5);
   Tube(treeBark,elbow,end,stem*.47f,.009f,Color.white,4);
   int sprays=distant?3:5;
   for(int k=0;k<sprays;k++) {
    float progress=(k+.43f+Rand()*.43f)/sprays;
    Vector3 at=progress<.57f?Vector3.Lerp(from,elbow,progress/.57f):Vector3.Lerp(elbow,end,(progress-.57f)/.43f);
    float fanSize=length*(.52f-progress*.15f)*(.81f+Rand()*.36f);
    for(int mirror=-1;mirror<=1;mirror+=2) {
     Vector3 twig=(radial*.68f+side*mirror*(.45f+Rand()*.39f)+Vector3.up*(.17f+Rand()*.58f)).normalized*fanSize;
     Color tint=Color.Lerp(shade,tipTint,Mathf.Clamp01(.28f*t+progress*.28f+Rand()*.48f));
     Needle(treeCanopy,at,twig,side,fanSize*(distant?1.15f:1.0f),tint);
    }
   }
  }
 }
 static void Needle(MeshPack fronds,Vector3 a,Vector3 direction,Vector3 side,float width,Color tint) {
  Vector3 b=a+direction;
  Vector3 w=(side.normalized+Vector3.up*.24f)*width*.47f;
  Vector3 cross=(Vector3.up-side*.25f)*width*.40f;
  // The atlas outside the black-backed needle island is white, not transparent.
  // Keep all four card corners inside that island to avoid solid green wedges.
  var lowerLeft=new Vector2(.048f,.60f);var lowerRight=new Vector2(.19f,.60f);
  var upperRight=new Vector2(.19f,.955f);var upperLeft=new Vector2(.048f,.955f);
  fronds.Quad(a-w,a+w,b+w*.62f,b-w*.62f,tint,lowerLeft,lowerRight,upperRight,upperLeft);
  fronds.Quad(a-cross,a+cross,b+cross*.65f,b-cross*.65f,tint,lowerLeft,lowerRight,upperRight,upperLeft);
 }
 static bool NearObstacle(float x,float z) {
  foreach(var obstacle in map.colliders) {
   float dx=x-obstacle.x,dz=z-obstacle.z,r=obstacle.radius+.25f;
   if(dx*dx+dz*dz<r*r)return true;
  }
  foreach(var seam in map.deposits) {
   float dx=x-seam.x,dz=z-seam.z,r=seam.radius+.12f;
   if(dx*dx+dz*dz<r*r)return true;
  }
  return false;
 }
 static void Undergrowth() {
  var rng=new System.Random(2318);
  float Rand()=> (float)rng.NextDouble();
  for(int z=-60;z<60;z++)for(int x=-60;x<60;x++) {
   float xx=x+Rand(),zz=z+Rand(),path=TrailDistance(xx,zz);
   if(YardDistance(xx,zz)<.85f||path<1.2f||EastHaulCleared(xx,zz)||NearObstacle(xx,zz))continue;
   float patch=.66f*Noise(xx*.073f,zz*.073f)+.34f*Noise(xx*.25f,zz*.25f);
   if(patch<.39f||Rand()>patch*.78f)continue;
   int count=2+(int)(patch*3);
   for(int i=0;i<count;i++) {
    float px=xx+(Rand()-.5f)*.95f,pz=zz+(Rand()-.5f)*.95f;
    float h=.15f+patch*.17f+Rand()*.23f,width=h*(1.45f+Rand()*.85f),heading=Rand()*Mathf.PI*2;
    h*=Mathf.Lerp(.62f,1f,Mathf.SmoothStep(0,1,(path-1.2f)/2.0f));
    Color tint=Color.Lerp(new Color(.65f,.75f,.54f),new Color(1.07f,1.04f,.78f),Rand());
    var tufts=grassChunks.At(new Vector3(px,0,pz));
    Vector3 tilt=new Vector3(Mathf.Cos(heading+1),0,Mathf.Sin(heading+1))*(h*.24f);
    for(int face=0;face<2;face++) {
     float angle=heading+face*1.39f;
     Vector3 side=new Vector3(Mathf.Cos(angle),0,Mathf.Sin(angle))*width*.5f;
     Vector3 left=new Vector3(px-side.x,0,pz-side.z),right=new Vector3(px+side.x,0,pz+side.z);
     left.y=Height(left.x,left.z)-.022f;right.y=Height(right.x,right.z)-.022f;
     tufts.Quad(left,right,right+Vector3.up*h+tilt,left+Vector3.up*h+tilt,tint,
      new Vector2(.17f,.098f),new Vector2(.51f,.098f),new Vector2(.51f,.25f),new Vector2(.17f,.25f));
    }
   }
   if(patch>.66f&&Rand()<.04)Fern(new Vector3(xx,Height(xx,zz),zz),.55f+Rand()*.5f,rng);
  }
  for(int i=0;i<450;i++) {
   float z=-58+Rand()*116,x=-55+Rand()*110;
   if(TrailDistance(x,z)>2.6f||NearObstacle(x,z)||YardDistance(x,z)<-.5f)continue;
   Pebble(new Vector3(x,Height(x,z),z),.055f+Rand()*.09f,smallStone);
  }
 }
 static void Fern(Vector3 p,float size,System.Random rng){for(int j=0;j<7;j++){float a=j*6.28318f/7;var dir=new Vector3(Mathf.Cos(a),0,Mathf.Sin(a));Vector3 side=Vector3.Cross(dir,Vector3.up);for(int k=1;k<=6;k++){float t=k/7f;var at=p+dir*t*size+Vector3.up*Mathf.Sin(t*Mathf.PI)*size*.45f;float w=(1-t)*size*.2f;for(int s=-1;s<=1;s+=2)herbs.Tri(at,at+side*s*w+dir*size*.17f,at+dir*size*.18f,new Color(.24f,.4f,.12f));}}}
 static void Pebble(Vector3 p,float r,MeshPack bag){var top=p+Vector3.up*r*.65f;for(int j=0;j<6;j++){float a=j*6.28318f/6,b=(j+1)*6.28318f/6;bag.Tri(p+new Vector3(Mathf.Cos(b)*r,0,Mathf.Sin(b)*r),p+new Vector3(Mathf.Cos(a)*r,0,Mathf.Sin(a)*r),top,new Color(.8f,.78f,.68f));}}
 static void Box(MeshPack bag,Vector3 p,Vector3 size,Color color,Quaternion rotation){var v=new Vector3[8];for(int i=0;i<8;i++)v[i]=p+rotation*Vector3.Scale(new Vector3((i&1)==0?-.5f:.5f,(i&2)==0?-.5f:.5f,(i&4)==0?-.5f:.5f),size);int[] f={0,4,6,2,1,3,7,5,0,1,5,4,2,6,7,3,0,2,3,1,4,5,7,6};for(int i=0;i<f.Length;i+=4)bag.Quad(v[f[i]],v[f[i+1]],v[f[i+2]],v[f[i+3]],color);}
 internal static void TradingShelter(Transform shelter,bool west) {
  // Batch the workshop timbers and roof into the same surface materials as the central shed.
  var frame=new MeshPack();var sheets=new MeshPack();var fittings=new MeshPack();
  Quaternion turn=shelter.rotation;
  Color timber=new Color(.88f,.78f,.63f), endGrain=new Color(.60f,.51f,.39f);
  Color paint=west?new Color(.57f,.68f,.51f):new Color(.85f,.63f,.46f);
  Vector3 At(float x,float y,float z)=>shelter.TransformPoint(new Vector3(x,y,z));
  void Timber(float x,float y,float z,float w,float h,float depth,Color tint) {
   Box(frame,At(x,y,z),new Vector3(w,h,depth),tint,turn);
  }
  foreach(float x in new[]{-1.23f,1.23f}) {
   foreach(float z in new[]{-.69f,.44f}) {
    Vector3 foot=At(x,0,z);foot.y=Height(foot.x,foot.z);
    float top=At(x,z<0?2.26f:2.53f,z).y;
    Box(frame,foot+Vector3.up*(top-foot.y)*.5f,new Vector3(.145f,top-foot.y,.145f),timber,turn);
    Box(fittings,foot+Vector3.up*.07f,new Vector3(.25f,.15f,.25f),Color.white,turn);
   }
   Tube(frame,At(x,1.88f,-.70f),At(x*.61f,2.28f,-.70f),.066f,.066f,endGrain,4);
   Tube(frame,At(x,2.05f,.44f),At(x*.62f,2.45f,.44f),.06f,.06f,timber,4);
  }
  Timber(0,2.26f,-.69f,2.70f,.16f,.15f,timber);
  Timber(0,2.47f,.44f,2.70f,.16f,.15f,timber);
  for(int i=0;i<10;i++) {
   float x=(i-4.5f)*.30f;
   var shade=Color.Lerp(paint,paint*.72f,Noise(i*3.7f,west?1:9)*.72f);
   Box(sheets,At(x,2.56f,-.10f),new Vector3(.298f,.10f,1.90f),shade,turn*Quaternion.Euler(-11,0,0));
   Box(fittings,At(x-.15f,2.63f,-.10f),new Vector3(.028f,.032f,1.93f),shade,turn*Quaternion.Euler(-11,0,0));
  }
  foreach(float x in new[]{-.95f,.95f}) {
   for(int j=0;j<3;j++) {
    Vector3 tread=At(x*.81f,0,.92f+j*.34f);tread.y=Height(tread.x,tread.z)+.015f;
    Box(frame,tread,new Vector3(.72f,.042f,.15f),endGrain,turn);
   }
  }
  frame.Emit(west?"West workshop timbers":"East workshop timbers",wood);
  sheets.Emit(west?"West lapped roof":"East lapped roof",roof);
  fittings.Emit("Workshop roof ironwork",iron);
 }

 static void Cabin(){
  float gx=map.gate.x,gz=map.gate.z,baseY=Height(gx,gz);Color timber=new Color(.85f,.81f,.68f);Quaternion identity=Quaternion.identity;
  // A walk-through ore receiving shelter: the delivery circle and both entrances remain open.
  foreach(float x in new[]{-5f,5f})foreach(float z in new[]{-3.5f,3.5f}){var p=new Vector3(gx+x,Height(gx+x,gz+z),gz+z);Box(boards,p+Vector3.up*1.9f,new Vector3(.44f,3.8f,.44f),timber,identity);Box(metal,p+Vector3.up*.2f,new Vector3(.48f,.16f,.48f),Color.white,identity);}
  for(int side=-1;side<=1;side+=2){Box(boards,new Vector3(gx+side*5,baseY+3.7f,gz),new Vector3(.32f,.4f,8.2f),timber,identity);Box(boards,new Vector3(gx,baseY+3.8f,gz+side*3.5f),new Vector3(10.4f,.38f,.3f),timber,identity);
   for(int k=-1;k<=1;k+=2)Tube(trunks,new Vector3(gx+side*5,baseY+2.7f,gz+k*3.5f),new Vector3(gx+side*3.8f,baseY+3.7f,gz+k*3.5f),.1f,.1f,timber,6);}
  // Gabled rafters, board courses and a ridge cap give the small building a readable roof silhouette.
  float pitch=22;for(int side=-1;side<=1;side+=2){Quaternion q=Quaternion.Euler(0,0,-side*pitch);Box(roofing,new Vector3(gx+side*2.7f,baseY+4.8f,gz),new Vector3(6.15f,.17f,9),Color.white,q);
   for(int z=-4;z<=4;z++)Box(boards,new Vector3(gx+side*2.6f,baseY+4.65f,gz+z),new Vector3(5.8f,.16f,.12f),timber,q);
   for(int r=0;r<8;r++)Box(roofing,new Vector3(gx+side*(.45f+r*.73f),baseY+5.86f-(.45f+r*.73f)*.404f,gz),new Vector3(.065f,.045f,9.05f),new Color(.7f,.72f,.65f),identity);}
  Box(boards,new Vector3(gx,baseY+5.96f,gz),new Vector3(.25f,.2f,9.2f),timber,identity);
  // Flush sleepers mark the drop zone without changing walk height or adding hidden obstacles.
  for(int j=-2;j<=2;j++)Box(boards,new Vector3(gx,baseY+.025f,gz+j*.8f),new Vector3(5.5f,.045f,.19f),new Color(.65f,.64f,.52f),identity);
 }
 class ChunkMeshes {
  readonly int cellSize;
  readonly Dictionary<Vector2Int, MeshPack> cells = new Dictionary<Vector2Int, MeshPack>();

  public ChunkMeshes(int cellSize) { this.cellSize = cellSize; }

  public MeshPack At(Vector3 position) {
   var key = new Vector2Int(Mathf.FloorToInt(position.x / cellSize), Mathf.FloorToInt(position.z / cellSize));
   if (!cells.TryGetValue(key, out var chunk)) cells[key] = chunk = new MeshPack();
   return chunk;
  }

  public void Emit(string name, Material material, bool shadows = true) {
   foreach (var cell in cells) cell.Value.Emit($"{name} {cell.Key.x},{cell.Key.y}", material, shadows);
  }
 }

 class MeshPack {
  readonly List<Vector3> vertices=new List<Vector3>();readonly List<Vector2> uv=new List<Vector2>();readonly List<Color> colors=new List<Color>();readonly List<int> triangles=new List<int>();
  public void Tri(Vector3 a,Vector3 b,Vector3 c,Color color){int k=vertices.Count;vertices.AddRange(new[]{a,b,c});uv.AddRange(new[]{Vector2.zero,Vector2.right,Vector2.up});colors.AddRange(new[]{color,color,color});triangles.AddRange(new[]{k,k+1,k+2});}
  public void Quad(Vector3 a,Vector3 b,Vector3 c,Vector3 d,Color color){Quad(a,b,c,d,color,Vector2.zero,Vector2.right,Vector2.one,Vector2.up);}
  public void Quad(Vector3 a,Vector3 b,Vector3 c,Vector3 d,Color color,Vector2 u0,Vector2 u1,Vector2 u2,Vector2 u3){int k=vertices.Count;vertices.AddRange(new[]{a,b,c,d});uv.AddRange(new[]{u0,u1,u2,u3});colors.AddRange(new[]{color,color,color,color});triangles.AddRange(new[]{k,k+1,k+2,k,k+2,k+3});}
  public void Emit(string name,Material material,bool shadows=true){if(vertices.Count==0)return;var m=new Mesh{name=name,indexFormat=IndexFormat.UInt32};m.SetVertices(vertices);m.SetUVs(0,uv);m.SetColors(colors);m.SetTriangles(triangles,0);m.RecalculateNormals();m.RecalculateBounds();MeshObject(name,m,material,shadows);}
 }
}
